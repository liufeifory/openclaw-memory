/**
 * OpenClaw Memory Plugin - New SDK Format
 *
 * Backend: SurrealDB with vector search capabilities.
 *
 * Features:
 * - Semantic retrieval via vector search
 * - Importance-based ranking
 * - Episodic, semantic, and reflection memories
 * - Message queue + background worker for decoupled storage
 */

import { Type } from '@sinclair/typebox';
import { MemoryManager as SurrealMemoryManager } from './memory-manager-surreal.js';
import { LLMLimiter } from './llm-limiter.js';
import { MemoryFilter } from './memory-filter.js';
import { PreferenceExtractor } from './preference-extractor.js';
import { Summarizer } from './summarizer.js';
import { createDocumentImporter } from './document-importer.js';
import { DocumentParser } from './document-parser.js';
import { DocumentSplitter } from './document-splitter.js';
import { logInfo, logWarn, logError } from './maintenance-logger.js';
import { LLMClient, createLLMClients } from './llm-client.js';
import * as fs from 'fs';
import * as path from 'path';

// Define plugin entry type
interface PluginEntry {
  id: string;
  name: string;
  description: string;
  kind?: string;
  init?: (config: any) => Promise<void>;
  register: (api: any) => void | Promise<void>;
  dispose?: () => Promise<void>;
}

// Helper to create plugin entry (replaces definePluginEntry)
function createPluginEntry(entry: PluginEntry): PluginEntry {
  return entry;
}

interface SurrealConfig {
  backend: 'surrealdb';
  surrealdb: {
    url: string;
    namespace: string;
    database: string;
    username: string;
    password: string;
  };
  embedding?: {
    endpoint: string;
  };
  llm?: {
    endpoint?: string;  // Local LLM endpoint (default: 8082)
    cloudEnabled?: boolean;
    cloudProvider?: 'bailian' | 'openai' | 'custom';
    cloudBaseUrl?: string;
    cloudApiKey?: string;
    cloudModel?: string;
    cloudTasks?: ('preference' | 'summarizer' | 'clusterer' | 'reranker')[];
  };
  documentImport?: {
    watchDir?: string;
    chunkSize?: number;
    chunkOverlap?: number;
  };
}

type MemoryPluginConfig = SurrealConfig;

// Global instance for reuse across requests
let memoryManager: SurrealMemoryManager | null = null;
let memoryFilter: MemoryFilter | null = null;
let preferenceExtractor: PreferenceExtractor | null = null;
let summarizer: Summarizer | null = null;
let globalLimiter: LLMLimiter | null = null;
let llmClient: LLMClient | null = null;
let savedConfig: MemoryPluginConfig | null = null;
let initialized = false;

/**
 * Lazy initialization - only initialize when actually needed
 * This prevents resource leaks when plugin is loaded but not used (e.g., status commands)
 */
async function ensureInitialized(): Promise<void> {
  if (initialized || !savedConfig) return;

  logInfo('Lazy initializing plugin...');

  const mm = getMemoryManager(savedConfig);

  // Initialize SurrealDB backend
  if (mm instanceof SurrealMemoryManager) {
    try {
      const result = await mm.initialize();
      if (result.migrated) {
        logInfo(`SurrealDB schema migration: ${result.changes.join(', ')}`);
      }
      logInfo('SurrealDB connection established');
    } catch (error: any) {
      logError(`Failed to initialize SurrealDB: ${error.message}`);
      throw error;
    }
  }

  // Initialize LLM clients (hybrid: local 7B + cloud)
  const llmConfig: NonNullable<MemoryPluginConfig['llm']> = savedConfig.llm || {};
  const llmOptions = {
    localEndpoint: llmConfig.endpoint ?? 'http://localhost:8082',
    cloudEnabled: llmConfig.cloudEnabled ?? false,
    cloudProvider: llmConfig.cloudProvider,
    cloudBaseUrl: llmConfig.cloudBaseUrl,
    cloudApiKey: llmConfig.cloudApiKey,
    cloudModel: llmConfig.cloudModel,
    cloudTasks: llmConfig.cloudTasks,
  };
  llmClient = new LLMClient(llmOptions);

  globalLimiter = new LLMLimiter({ maxConcurrent: 2, minInterval: 100, queueLimit: 50 });

  // Initialize helpers with LLM client
  memoryFilter = getMemoryFilter(llmClient, globalLimiter);
  preferenceExtractor = getPreferenceExtractor(llmClient, globalLimiter);
  summarizer = getSummarizer(llmClient, globalLimiter);

  logInfo(`[LLM] Config: ${llmClient.getConfigInfo()}`);
  initialized = true;
  logInfo('Plugin lazy initialized');
}

// Message queue state (module scope for dispose access)
interface QueuedMessage {
  sessionId: string;
  message: string;
  source: 'channel' | 'tui';
  timestamp: number;
}

const messageQueue: QueuedMessage[] = [];
let queueProcessing = false;
let queueShutDown = false;
let storedMessages = new Set<string>();  // For TUI duplicate prevention
const conversationBuffers = new Map<string, string[]>();  // Conversation buffer for summarization

// Track if cleanup has been done to avoid double cleanup
let cleanedUp = false;

// Auto-cleanup timeout - runs after CLI commands complete
// Disabled in Gateway mode (long-running server)
let autoCleanupTimeout: NodeJS.Timeout | null = null;
let autoCleanupScheduled = false;  // Track if we've already scheduled cleanup
const AUTO_CLEANUP_DELAY = 3000;  // Wait 3 seconds after last activity before cleanup
const IS_GATEWAY_MODE = process.env.OPENCLAW_GATEWAY === '1' || process.env.OPENCLAW_MODE === 'gateway';

// Document watcher reference for cleanup
let documentWatcher: any = null;

/**
 * Schedule auto-cleanup after CLI command completes
 * Only schedules once per initialization cycle
 * Disabled in Gateway mode (long-running server)
 */
function scheduleAutoCleanup(): void {
  if (IS_GATEWAY_MODE) {
    logInfo('[Plugin] Auto-cleanup disabled in Gateway mode');
    return;
  }
  if (autoCleanupScheduled) return;  // Already scheduled
  autoCleanupScheduled = true;

  autoCleanupTimeout = setTimeout(async () => {
    if (!cleanedUp && initialized && messageQueue.length === 0) {
      logInfo('[Plugin] Auto-cleanup triggered');
      await cleanup();
      logInfo('[Plugin] Auto-cleanup completed');
    }
  }, AUTO_CLEANUP_DELAY);
  // Don't call unref() - let this timeout fire and close the DB connection
}

/**
 * Cleanup function called on process exit or plugin dispose
 */
async function cleanup(): Promise<void> {
  if (cleanedUp) return;
  cleanedUp = true;

  logInfo('[Plugin] cleanup() called');

  // Clear auto-cleanup timeout
  if (autoCleanupTimeout) {
    clearTimeout(autoCleanupTimeout);
    autoCleanupTimeout = null;
  }
  autoCleanupScheduled = false;  // Allow re-scheduling

  // Stop document watcher
  if (documentWatcher) {
    documentWatcher.stop();
    documentWatcher = null;
  }

  // Stop message queue
  queueShutDown = true;
  messageQueue.length = 0;

  // Dispose memory manager (stops idle clustering worker and closes DB)
  if (memoryManager) {
    await memoryManager.dispose();
    memoryManager = null;
  }

  // Reset other singletons
  memoryFilter = null;
  preferenceExtractor = null;
  summarizer = null;
  globalLimiter = null;
  storedMessages.clear();
  conversationBuffers.clear();

  // Reset initialized flag to allow re-initialization
  initialized = false;

  logInfo('[Plugin] cleanup() completed');
}

// Register process exit handlers to ensure cleanup on unexpected exit
process.on('exit', () => {
  // Synchronous cleanup for exit event (no async operations possible here)
  queueShutDown = true;
  if (!cleanedUp) {
    logInfo('[Plugin] exit handler triggered');
  }
});

// beforeExit is called when event loop is empty and process would exit
// This is async and can close connections
process.on('beforeExit', async () => {
  if (!cleanedUp) {
    logInfo('[Plugin] beforeExit handler triggered - cleaning up');
    await cleanup();
  }
});

// Handle uncaught exceptions and rejections
process.on('uncaughtException', async (err) => {
  logError(`[Plugin] Uncaught exception: ${err.message}`);
  await cleanup();
});

process.on('unhandledRejection', async (reason) => {
  logError(`[Plugin] Unhandled rejection: ${reason}`);
  await cleanup();
});

// Handle SIGINT/SIGTERM for graceful shutdown
process.on('SIGINT', async () => {
  await cleanup();
  process.exit(130);
});

process.on('SIGTERM', async () => {
  await cleanup();
  process.exit(143);
});

/**
 * Build context string from retrieved memories.
 */
function buildMemoryContext(memories: any[]): string {
  if (memories.length === 0) {
    return '';
  }

  const contextParts = memories.map(m => {
    const type = m.type || m.memory_type || 'unknown';
    const similarity = m.similarity?.toFixed(3) || 'N/A';
    const importance = m.importance?.toFixed(2) || 'N/A';
    const content = m.content || m.text || '';
    return `[${type.toUpperCase()}] (sim: ${similarity}, imp: ${importance}) ${content}`;
  });

  return '\n--- Relevant Memories ---\n' + contextParts.join('\n') + '\n--- End Memories ---\n';
}

function getMemoryManager(config: MemoryPluginConfig): SurrealMemoryManager {
  if (!memoryManager) {
    memoryManager = new SurrealMemoryManager(config);
  }
  return memoryManager;
}

function getMemoryFilter(client: LLMClient, limiter: LLMLimiter): MemoryFilter {
  if (!memoryFilter) {
    memoryFilter = new MemoryFilter(client, limiter);
  }
  return memoryFilter;
}

function getPreferenceExtractor(client: LLMClient, limiter: LLMLimiter): PreferenceExtractor {
  if (!preferenceExtractor) {
    preferenceExtractor = new PreferenceExtractor(client, limiter);
  }
  return preferenceExtractor;
}

function getSummarizer(client: LLMClient, limiter: LLMLimiter): Summarizer {
  if (!summarizer) {
    summarizer = new Summarizer(client, limiter);
  }
  return summarizer;
}

/**
 * Append memory to local Markdown file for self-improving-agent compatibility.
 */
function appendToLocalMemory(content: string, sessionId?: string): void {
  try {
    const workspaceDir = process.env.HOME ? path.join(process.env.HOME, '.openclaw', 'workspace') : '~/.openclaw/workspace';
    const memoryDir = path.join(workspaceDir, 'memory');
    const memoryFile = path.join(memoryDir, `${new Date().toISOString().split('T')[0]}.md`);

    // Ensure directory exists
    if (!fs.existsSync(memoryDir)) {
      fs.mkdirSync(memoryDir, { recursive: true });
    }

    // Format memory entry
    const timestamp = new Date().toISOString();
    const entry = `- ${timestamp}: ${content}\n`;

    // Check if file exists, create header if not
    let fileContent = '';
    if (fs.existsSync(memoryFile)) {
      fileContent = fs.readFileSync(memoryFile, 'utf-8');
    } else {
      const dateStr = new Date().toISOString().split('T')[0];
      fileContent = `# ${dateStr}\n\n## 日志\n\n`;
    }

    // Append entry
    fs.writeFileSync(memoryFile, fileContent + entry);
    logInfo(`[openclaw-memory] Appended to local memory: ${memoryFile}`);
  } catch (error: any) {
    logError(`[openclaw-memory] Failed to write local memory: ${error.message}`);
  }
}

export default createPluginEntry({
  id: 'openclaw-memory',
  name: 'OpenClaw Memory',
  description: 'Long-term memory with semantic search (SurrealDB backend)',

  async init(config: MemoryPluginConfig) {
    // Store config for later lazy initialization
    savedConfig = config;
    logInfo('Plugin config stored (lazy initialization enabled)');
  },

  register(api) {
    // Get plugin config from OpenClaw
    const pluginConfig = api.pluginConfig as any;

    // Handle both formats: {enabled, config} or direct config
    const config = pluginConfig?.config || pluginConfig;

    if (!config) {
      logInfo('No config found, plugin disabled');
      return;
    }

    // Check for SurrealDB config
    if (!config.surrealdb) {
      logInfo('No SurrealDB config found, plugin disabled');
      return;
    }

    // Store config for lazy initialization
    savedConfig = config;

    // Document Import Configuration - start watcher only if configured
    const docConfig = config.documentImport || {};
    let watchDir = docConfig.watchDir;

    if (watchDir) {
      // Expand ~ to home directory
      if (watchDir.startsWith('~/')) {
        watchDir = watchDir.replace('~/', process.env.HOME + '/');
      }

      // For document watcher, we need to initialize immediately
      ensureInitialized();
      const mm = getMemoryManager(config);
      const importer = createDocumentImporter(mm, {
        watchDir,
        chunkSize: docConfig.chunkSize,
        chunkOverlap: docConfig.chunkOverlap,
      });
      documentWatcher = importer.watcher;  // Store reference for cleanup
      documentWatcher?.start();  // Start watcher (don't await)
      logInfo(`Document watcher started: ${watchDir}`);
    }

    // Schedule auto-cleanup AFTER document watcher completes initial scan
    if (watchDir) {
      setTimeout(() => {
        scheduleAutoCleanup();
      }, 5000);
    } else {
      scheduleAutoCleanup();
    }

    // ============================================================
    // 消息队列 + 后台 Worker - 解耦记忆存储，确保故障不影响主流程
    // ============================================================
    async function processQueue() {
      if (queueProcessing) return;
      queueProcessing = true;

      while (!queueShutDown && messageQueue.length > 0) {
        const item = messageQueue.shift();
        if (!item) continue;

        try {
          await ensureInitialized();

          // Type check: ensure message is string
          if (typeof item.message !== 'string') {
            logWarn(`[openclaw-memory] Queue: received non-string message (type: ${typeof item.message})`);
            item.message = String(item.message);
          }

          // Skip empty messages
          if (!item.message || item.message.trim().length === 0) {
            continue;
          }

          // 1. Classification (for labels only)
          const filterResult = await memoryFilter!.classify(item.message);

          // 2. Store memories (all as episodic, write to both DB and file)
          await memoryManager!.storeMemory(item.sessionId, item.message, filterResult.importance);

          // Write to local Markdown file (for self-improving-agent)
          const categoryLabel = filterResult.category ? `[${filterResult.category}] ` : '';
          appendToLocalMemory(`${categoryLabel}${item.message}`, item.sessionId);

          // 3. Preference extraction (every 10 messages)
          const buffer = conversationBuffers.get(item.sessionId) || [];
          buffer.push(item.message);
          conversationBuffers.set(item.sessionId, buffer);

          if (buffer.length >= 10) {
            const userProfile = await preferenceExtractor!.extract(buffer);
            for (const like of userProfile.likes) {
              await memoryManager!.storeSemantic(like, 0.8, item.sessionId);
              appendToLocalMemory(`[PREFERENCE-LIKE] ${like}`);
            }
            for (const dislike of userProfile.dislikes) {
              await memoryManager!.storeSemantic(dislike, 0.8, item.sessionId);
              appendToLocalMemory(`[PREFERENCE-DISLIKE] ${dislike}`);
            }

            const summaryResult = await summarizer!.summarize(buffer);
            if (summaryResult.summary) {
              await memoryManager!.storeReflection(summaryResult.summary, 0.9, item.sessionId);
              appendToLocalMemory(`[REFLECTION] ${summaryResult.summary}`);
            }

            conversationBuffers.set(item.sessionId, []);
          }

          logInfo(`Queue: processed message for session ${item.sessionId}`);
        } catch (error: any) {
          logError(`Queue: failed to process message for session ${item.sessionId}: ${error.message}`);
        }
      }

      queueProcessing = false;
    }

    function enqueueMessage(sessionId: string, message: string, source: 'channel' | 'tui') {
      if (queueShutDown) return;

      messageQueue.push({
        sessionId,
        message,
        source,
        timestamp: Date.now(),
      });

      // Start worker if not running (async, non-blocking)
      if (!queueProcessing) {
        processQueue();
      }
    }

    // ============================================================
    // Register message_received Hook - Channel mode
    // ============================================================
    api.on('message_received', (event: any, ctx: any) => {
      const sessionId = ctx.conversationId || 'default';
      const message = event.content;

      // Skip empty messages
      if (!message || message.trim().length === 0) {
        return;
      }

      // Channel mode: copy message to queue, return immediately
      enqueueMessage(sessionId, message, 'channel');
    });

    // ============================================================
    // Register before_prompt_build Hook - TUI mode
    // ============================================================
    api.on('before_prompt_build', async (event: any, ctx: any) => {
      const sessionId = ctx.sessionId || 'default';
      const messages = event.messages as any[];

      if (!messages || messages.length === 0) {
        return;
      }

      // Get last user message
      const lastUserMessage = messages.filter(m => m.role === 'user').pop();
      if (!lastUserMessage) {
        return;
      }

      // Extract message content (handle array/object/string formats)
      let lastMessageContent: string;

      if (typeof lastUserMessage.content === 'string') {
        lastMessageContent = lastUserMessage.content;
      } else if (Array.isArray(lastUserMessage.content)) {
        const textParts = lastUserMessage.content
          .filter((part: any) => part.type === 'text')
          .map((part: any) => part.text)
          .join(' ');
        lastMessageContent = textParts || String(lastUserMessage.content);
      } else if (lastUserMessage.content && typeof lastUserMessage.content === 'object' && lastUserMessage.content.text) {
        lastMessageContent = lastUserMessage.content.text;
      } else {
        lastMessageContent = String(lastUserMessage.content ?? '');
      }

      if (!lastMessageContent) {
        return;
      }

      // TUI mode: copy message to queue (async, non-blocking)
      const messageHash = `${sessionId}:${lastMessageContent.slice(0, 50)}`;
      if (!storedMessages.has(messageHash)) {
        storedMessages.add(messageHash);
        enqueueMessage(sessionId, lastMessageContent, 'tui');
      }

      // Timeout control: must return within 1000ms
      const timeoutMs = 1000;

      try {
        await ensureInitialized();

        // 1. Retrieve relevant memories (with timeout)
        const memories = await Promise.race([
          memoryManager!.retrieveRelevant(lastMessageContent, sessionId, 3, 0.65),
          new Promise<any[]>((_, reject) =>
            setTimeout(() => reject(new Error('Memory retrieval timeout')), timeoutMs)
          )
        ]);

        if (!memories || memories.length === 0) {
          return;
        }

        // 2. Build context (limit total length)
        const context = buildMemoryContext(memories.slice(0, 3));

        // 3. Return prependContext
        return {
          prependContext: context,
        };
      } catch (error: any) {
        if (error.message !== 'Memory retrieval timeout') {
          logError(`before_prompt_build hook failed: ${error.message}`);
          logError(`Stack trace: ${error.stack}`);
        } else {
          logWarn(`before_prompt_build hook timeout >${timeoutMs}ms`);
        }
        return;
      }
    });

    // ============================================================
    // Register memory_search tool - New SDK Format
    // ============================================================
    api.registerTool({
      name: 'memory_search',
      description: 'Search long-term memory using semantic similarity',
      parameters: Type.Object({
        query: Type.String({ description: 'Search query' }),
        top_k: Type.Optional(Type.Number({ default: 5 })),
        threshold: Type.Optional(Type.Number({ default: 0.6 })),
      }),
      async execute(_id: string, params: any) {
        try {
          const { query, top_k = 5, threshold = 0.6, session_id } = params as any;

          logInfo(`[memory_search] query="${query}", top_k=${top_k}, threshold=${threshold}, session_id=${session_id}`);

          if (!query) {
            return { error: 'Missing required parameter: query' };
          }

          await ensureInitialized();
          const memories = await memoryManager!.retrieveRelevant(query, session_id, top_k, threshold);
          return {
            memories,
            count: memories.length,
          };
        } catch (error: any) {
          logError(`[memory_search] Error: ${error.message}`);
          return { error: `Memory search failed: ${error.message}` };
        }
      },
    });

    // ============================================================
    // Register document_import tool - New SDK Format
    // ============================================================
    api.registerTool({
      name: 'document_import',
      description: 'Import document from URL or local path (PDF, Word, Markdown)',
      parameters: Type.Object({
        url: Type.Optional(Type.String({ description: 'URL to import' })),
        path: Type.Optional(Type.String({ description: 'Local file path' })),
      }),
      async execute(_id: string, params: any) {
        try {
          const { url, path: filePath } = params as any;

          if (url) {
            await ensureInitialized();
            const { urlImporter } = createDocumentImporter(memoryManager!, {
              chunkSize: savedConfig?.documentImport?.chunkSize,
              chunkOverlap: savedConfig?.documentImport?.chunkOverlap,
            });
            const count = await urlImporter.import(url);
            return { success: true, chunks: count, source: url };
          }

          if (filePath) {
            await ensureInitialized();
            const parser = new DocumentParser();
            const splitter = new DocumentSplitter(
              savedConfig?.documentImport?.chunkSize || 500,
              savedConfig?.documentImport?.chunkOverlap || 50,
            );

            const parsed = await parser.parse(filePath);
            const chunks = splitter.split(parsed.content, filePath);

            for (const chunk of chunks) {
              await memoryManager!.storeSemantic(chunk.content, 0.7, `doc:${filePath}`);
            }

            return { success: true, chunks: chunks.length, source: filePath };
          }

          return { error: 'URL or path required' };
        } catch (error: any) {
          return { error: `Import failed: ${error.message}` };
        }
      },
    });

    logInfo('Plugin registered');
  },

  /**
   * Dispose plugin - clean up background workers and close database connections.
   */
  async dispose() {
    await cleanup();
  },
});

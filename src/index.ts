/**
 * OpenClaw Memory Plugin - Native Node.js Implementation
 *
 * Backend: SurrealDB with vector search capabilities.
 *
 * Features:
 * - Semantic retrieval via vector search
 * - Importance-based ranking
 * - Episodic, semantic, and reflection memories
 * - Message queue + background worker for decoupled storage
 */

import { MemoryManager as SurrealMemoryManager } from './memory-manager-surreal.js';
import { LLMLimiter } from './llm-limiter.js';
import { MemoryFilter } from './memory-filter.js';
import { PreferenceExtractor } from './preference-extractor.js';
import { Summarizer } from './summarizer.js';
import { createDocumentImporter } from './document-importer.js';
import { DocumentParser } from './document-parser.js';
import { DocumentSplitter } from './document-splitter.js';
import { logInfo, logWarn, logError } from './maintenance-logger.js';
import * as fs from 'fs';
import * as path from 'path';

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

  // Initialize 1B model helpers
  const llamaEndpoint = savedConfig.embedding?.endpoint?.replace('8080', '8081') ?? 'http://localhost:8081';
  globalLimiter = new LLMLimiter({ maxConcurrent: 2, minInterval: 100, queueLimit: 50 });

  // Initialize helpers
  memoryFilter = getMemoryFilter(llamaEndpoint, globalLimiter);
  preferenceExtractor = getPreferenceExtractor(llamaEndpoint, globalLimiter);
  summarizer = getSummarizer(llamaEndpoint, globalLimiter);

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
let autoCleanupTimeout: NodeJS.Timeout | null = null;
let autoCleanupScheduled = false;  // Track if we've already scheduled cleanup
const AUTO_CLEANUP_DELAY = 3000;  // Wait 3 seconds after last activity before cleanup

// Document watcher reference for cleanup
let documentWatcher: any = null;

/**
 * Schedule auto-cleanup after CLI command completes
 * Only schedules once per initialization cycle
 */
function scheduleAutoCleanup(): void {
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
 * Append memory to local Markdown file for self-improving-agent compatibility.
 * This function is NOT affected by backend choice - always writes to file.
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

function getMemoryManager(config: MemoryPluginConfig): SurrealMemoryManager {
  if (!memoryManager) {
    memoryManager = new SurrealMemoryManager(config);
  }
  return memoryManager;
}

function getMemoryFilter(llamaEndpoint: string, limiter: LLMLimiter): MemoryFilter {
  if (!memoryFilter) {
    memoryFilter = new MemoryFilter(llamaEndpoint, limiter);
  }
  return memoryFilter;
}

function getPreferenceExtractor(llamaEndpoint: string, limiter: LLMLimiter): PreferenceExtractor {
  if (!preferenceExtractor) {
    preferenceExtractor = new PreferenceExtractor(llamaEndpoint, limiter);
  }
  return preferenceExtractor;
}

function getSummarizer(llamaEndpoint: string, limiter: LLMLimiter): Summarizer {
  if (!summarizer) {
    summarizer = new Summarizer(llamaEndpoint, limiter);
  }
  return summarizer;
}

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

const memoryPlugin = {
  id: 'openclaw-memory',
  name: 'OpenClaw Memory',
  description: 'Long-term memory with semantic search (SurrealDB backend)',
  kind: 'memory',

  async init(config: MemoryPluginConfig) {
    // Store config for later lazy initialization
    savedConfig = config;
    logInfo('Plugin config stored (lazy initialization enabled)');
  },

  async register(api: any) {
    // Get plugin config from OpenClaw - use api.pluginConfig property (not getConfig method)
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
      await ensureInitialized();
      const mm = getMemoryManager(config);
      const importer = createDocumentImporter(mm, {
        watchDir,
        chunkSize: docConfig.chunkSize,
        chunkOverlap: docConfig.chunkOverlap,
      });
      documentWatcher = importer.watcher;  // Store reference for cleanup
      await documentWatcher?.start();  // Wait for initial scan to complete
      logInfo(`Document watcher started: ${watchDir}`);
    }

    // Schedule auto-cleanup AFTER document watcher completes initial scan
    // This ensures import operations finish before database connection closes
    if (watchDir) {
      // Give a few more seconds for any async store operations to complete
      setTimeout(() => {
        scheduleAutoCleanup();
      }, 5000);
    } else {
      // No document watcher, schedule cleanup immediately
      scheduleAutoCleanup();
    }

    // ============================================================
    // 消息队列 + 后台 Worker - 解耦记忆存储，确保故障不影响主流程
    // ============================================================
    // Note: messageQueue, queueProcessing, queueShutDown are now module-scoped

    /**
     * 后台 Worker - 持续处理消息队列
     * 错误完全隔离，只记录日志，不影响主流程
     */
    async function processQueue() {
      if (queueProcessing) return;
      queueProcessing = true;

      while (!queueShutDown && messageQueue.length > 0) {
        const item = messageQueue.shift();
        if (!item) continue;

        try {
          // Ensure plugin is initialized before processing
          await ensureInitialized();

          // 类型检查：确保 message 是字符串
          if (typeof item.message !== 'string') {
            logWarn(`[openclaw-memory] Queue: received non-string message (type: ${typeof item.message})`);
            item.message = String(item.message);
          }

          // 跳过空消息
          if (!item.message || item.message.trim().length === 0) {
            continue;
          }

          // 1. 分类消息
          const filterResult = await memoryFilter!.classify(item.message);

          // 2. 存储记忆（同时写入数据库和本地文件）
          if (filterResult.shouldStore && filterResult.memoryType) {
            if (filterResult.memoryType === 'semantic') {
              await memoryManager!.storeSemanticWithConflictCheck(item.message, filterResult.importance, 0.85, item.sessionId);
            } else {
              await memoryManager!.storeMemory(item.sessionId, item.message, filterResult.importance);
            }

            // 同时写入本地 Markdown 文件（用于 self-improving-agent 读取）
            const categoryLabel = filterResult.category ? `[${filterResult.category}] ` : '';
            appendToLocalMemory(`${categoryLabel}${item.message}`, item.sessionId);
          }

          // 3. 偏好提取（每 10 条）
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
          // 错误完全隔离，只记录日志，不影响队列继续处理
          logError(`Queue: failed to process message for session ${item.sessionId}: ${error.message}`);
        }
      }

      queueProcessing = false;
    }

    /**
     * 入队消息 - Hook 只负责复制，立即返回
     */
    function enqueueMessage(sessionId: string, message: string, source: 'channel' | 'tui') {
      if (queueShutDown) return;

      messageQueue.push({
        sessionId,
        message,
        source,
        timestamp: Date.now(),
      });

      // 如果 Worker 没在运行，启动它（不 await，后台运行）
      if (!queueProcessing) {
        processQueue();
      }
    }

    // ============================================================
    // ✅ 注册 message_received Hook - 复制消息到队列 (渠道模式)
    // Hook 立即返回，不等待存储完成
    // ============================================================
    api.on('message_received', (event: any, ctx: any) => {
      const sessionId = ctx.conversationId || 'default';
      const message = event.content;

      // 跳过空消息
      if (!message || message.trim().length === 0) {
        return;
      }

      // 渠道模式：复制消息到队列，立即返回
      enqueueMessage(sessionId, message, 'channel');
    });

    // ============================================================
    // ✅ 注册 before_prompt_build Hook - 注入上下文 + 复制消息 (TUI 模式)
    // 此 Hook 在所有模式下都会触发（包括 TUI 和渠道）
    // TUI 模式下：复制最后一条用户消息到队列并检索记忆
    // 渠道模式下：只检索记忆（消息已由 message_received 复制）
    // ============================================================
    api.on('before_prompt_build', async (event: any, ctx: any) => {
      const sessionId = ctx.sessionId || 'default';
      const messages = event.messages as any[];

      // 检查 messages 是否存在
      if (!messages || messages.length === 0) {
        return;
      }

      // 获取最后一条用户消息
      const lastUserMessage = messages.filter(m => m.role === 'user').pop();
      if (!lastUserMessage) {
        return;
      }

      // 提取消息内容（处理数组/对象/字符串三种格式）
      let lastMessageContent: string;

      if (typeof lastUserMessage.content === 'string') {
        // 字符串格式
        lastMessageContent = lastUserMessage.content;
      } else if (Array.isArray(lastUserMessage.content)) {
        // 数组格式：[{ type: 'text', text: '...' }]
        const textParts = lastUserMessage.content
          .filter((part: any) => part.type === 'text')
          .map((part: any) => part.text)
          .join(' ');
        lastMessageContent = textParts || String(lastUserMessage.content);
      } else if (lastUserMessage.content && typeof lastUserMessage.content === 'object' && lastUserMessage.content.text) {
        // 对象格式：{ text: '...' }
        lastMessageContent = lastUserMessage.content.text;
      } else {
        lastMessageContent = String(lastUserMessage.content ?? '');
      }

      if (!lastMessageContent) {
        return;
      }

      // TUI 模式：复制消息到队列（异步执行，不阻塞）
      // 使用消息哈希避免重复存储
      const messageHash = `${sessionId}:${lastMessageContent.slice(0, 50)}`;
      if (!storedMessages.has(messageHash)) {
        storedMessages.add(messageHash);
        // 异步入队，不阻塞
        enqueueMessage(sessionId, lastMessageContent, 'tui');
      }

      // 超时控制：1000ms 内必须返回，避免阻塞 Agent 响应（Rerank 需要调用 LLM，约 800-900ms）
      const timeoutMs = 1000;

      try {
        // Ensure plugin is initialized before accessing memory
        await ensureInitialized();

        // 1. 检索相关记忆 (带超时)
        const memories = await Promise.race([
          memoryManager!.retrieveRelevant(lastUserMessage.content, sessionId, 3, 0.65),  // top_k=3, threshold=0.65
          new Promise<any[]>((_, reject) =>
            setTimeout(() => reject(new Error('Memory retrieval timeout')), timeoutMs)
          )
        ]);

        if (!memories || memories.length === 0) {
          return;  // 没有相关记忆
        }

        // 2. 构建上下文 (限制总长度)
        const context = buildMemoryContext(memories.slice(0, 3));  // 最多 3 条记忆

        // 3. 返回 prependContext
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
        return;  // 超时或失败时不注入上下文
      }
    });

    // Register memory_search tool
    api.registerTool(
      (ctx: any) => {
        const memorySearchTool = {
          name: 'memory_search',
          description: 'Search long-term memory using semantic similarity',
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'Search query' },
              top_k: { type: 'number', default: 5, description: 'Number of results' },
              threshold: { type: 'number', default: 0.6, description: 'Similarity threshold' },
            },
            required: ['query'],
          },
          execute: async ({ query, top_k = 5, threshold = 0.6, session_id }: any) => {
            try {
              await ensureInitialized();
              const memories = await memoryManager!.retrieveRelevant(query, session_id, top_k, threshold);
              return {
                memories,
                count: memories.length,
              };
            } catch (error: any) {
              return { error: `Memory search failed: ${error.message}` };
            }
          },
        };
        return [memorySearchTool];
      },
      { names: ['memory_search'] }
    );

    // Register document_import tool
    api.registerTool(
      (ctx: any) => {
        const documentImportTool = {
          name: 'document_import',
          description: 'Import document from URL or local path (PDF, Word, Markdown)',
          parameters: {
            type: 'object',
            properties: {
              url: { type: 'string', description: 'URL to import' },
              path: { type: 'string', description: 'Local file path' },
            },
          },
          execute: async ({ url, path: filePath }: any) => {
            try {
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
                // Create parser and splitter directly for local file import
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
        };
        return [documentImportTool];
      },
      { names: ['document_import'] }
    );

    logInfo('Plugin registered');

    // Expose dispose function on api for cleanup - calls plugin's dispose()
    api.dispose = async () => {
      await memoryPlugin.dispose();
    };
  },

  /**
   * Dispose plugin - clean up background workers and close database connections.
   * Called when OpenClaw shuts down or when commands complete.
   */
  async dispose() {
    await cleanup();
  },
};

export default memoryPlugin;

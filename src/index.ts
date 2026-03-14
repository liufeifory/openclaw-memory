/**
 * OpenClaw Memory Plugin - Native Node.js Implementation
 *
 * Supports both PostgreSQL (pgvector) and Qdrant backends.
 *
 * Features:
 * - Semantic retrieval via vector search
 * - Importance-based ranking
 * - Episodic, semantic, and reflection memories
 */

import { MemoryManager as PgMemoryManager } from './memory-manager.js';
import { MemoryManager as QdrantMemoryManager } from './memory-manager-qdrant.js';
import { MemoryFilter } from './memory-filter.js';
import { PreferenceExtractor } from './preference-extractor.js';
import { Summarizer } from './summarizer.js';
import { LLMLimiter } from './llm-limiter.js';

interface PgConfig {
  backend?: 'pgvector';
  database: {
    host: string;
    port: number;
    database: string;
    user: string;
    password: string;
  };
  embedding?: {
    endpoint: string;
  };
}

interface QdrantConfig {
  backend: 'qdrant';
  qdrant: {
    url: string;
    port?: number;
    apiKey?: string;
  };
  embedding?: {
    endpoint: string;
  };
}

type MemoryPluginConfig = PgConfig | QdrantConfig;

// Global instance for reuse across requests
let memoryManager: PgMemoryManager | QdrantMemoryManager | null = null;
let memoryFilter: MemoryFilter | null = null;
let preferenceExtractor: PreferenceExtractor | null = null;
let summarizer: Summarizer | null = null;
let globalLimiter: LLMLimiter | null = null;

function getMemoryManager(config: MemoryPluginConfig): PgMemoryManager | QdrantMemoryManager {
  if (!memoryManager) {
    if (config.backend === 'qdrant') {
      memoryManager = new QdrantMemoryManager(config);
    } else {
      memoryManager = new PgMemoryManager(config as PgConfig);
    }
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

const memoryPlugin = {
  id: 'openclaw-memory',
  name: 'OpenClaw Memory',
  description: 'Long-term memory with semantic search (supports pgvector and Qdrant)',
  kind: 'memory',

  async init(config: MemoryPluginConfig) {
    // Initialize memory manager on plugin load
    const mm = getMemoryManager(config);

    // Initialize Qdrant if using that backend (run migration)
    if (config.backend === 'qdrant' && mm instanceof QdrantMemoryManager) {
      const result = await mm.initialize();
      if (result.migrated) {
        console.log('[openclaw-memory] Schema migration:', result.changes);
      }
    }

    console.log('[openclaw-memory] Plugin initialized with', config.backend === 'qdrant' ? 'Qdrant' : 'PostgreSQL');
  },

  register(api: any) {
    // Get config from OpenClaw
    const config = api.getConfig?.() as MemoryPluginConfig | undefined;

    if (!config) {
      console.warn('[openclaw-memory] No config found, plugin disabled');
      return;
    }

    // Check for either pgvector or qdrant config
    const hasPgConfig = 'database' in config && !!config.database;
    const hasQdrantConfig = config.backend === 'qdrant' || ('qdrant' in config && !!config.qdrant);

    if (!hasPgConfig && !hasQdrantConfig) {
      console.warn('[openclaw-memory] No database config found, plugin disabled');
      return;
    }

    // Initialize memory manager
    const mm = getMemoryManager(config);

    // Initialize 1B model helpers (Llama-3.2-1B-Instruct on port 8081)
    const llamaEndpoint = config.embedding?.endpoint?.replace('8080', '8081') ?? 'http://localhost:8081';

    // Create shared LLM limiter (only for Qdrant backend)
    if (config.backend === 'qdrant' && mm instanceof QdrantMemoryManager) {
      // Limiter is managed internally by QdrantMemoryManager
    } else {
      // For pgvector or standalone usage, create global limiter
      globalLimiter = new LLMLimiter({ maxConcurrent: 2, minInterval: 100, queueLimit: 50 });
    }

    const limiter = globalLimiter!;
    const filter = getMemoryFilter(llamaEndpoint, limiter);
    const extractor = getPreferenceExtractor(llamaEndpoint, limiter);
    const summarizer = getSummarizer(llamaEndpoint, limiter);

    // Conversation buffer for summarization
    const conversationBuffers = new Map<string, string[]>();

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
          execute: async ({ query, top_k = 5, threshold = 0.6 }: any) => {
            try {
              const memories = await mm.retrieveRelevant(query, top_k, threshold);
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

    // Register hook for user messages - build context automatically
    api.onUserMessage?.(async (sessionId: string, message: string, recentConversation?: string) => {
      try {
        // Retrieve relevant memories
        const memories = await mm.retrieveRelevant(message);

        // Build context
        const context = mm.buildContext(sessionId, memories, recentConversation);

        // Smart storage: use 1B model to classify and filter
        const filterResult = await filter.classify(message);

        if (filterResult.shouldStore && filterResult.memoryType) {
          // Check for conflicts if storing semantic memory
          if (filterResult.memoryType === 'semantic') {
            // Use conflict-aware storage (Qdrant only)
            if (config.backend === 'qdrant' && mm instanceof QdrantMemoryManager) {
              const result = await mm.storeSemanticWithConflictCheck(message, filterResult.importance, 0.85);
              if (result.conflictDetected) {
                console.log(
                  `[Memory] Conflict: "${message.substring(0, 40)}..." supersedes memory ${result.supersededId}`
                );
              }
            } else {
              // Fallback without conflict detection
              mm.storeSemantic(message, filterResult.importance);
            }
          } else {
            // Episodic memory - store normally
            mm.storeMemory(sessionId, message, filterResult.importance);
          }
        } else {
          console.log(`[Memory] Skipped: ${filterResult.category} - ${filterResult.reason}`);
        }

        // Add to conversation buffer for summarization
        if (!conversationBuffers.has(sessionId)) {
          conversationBuffers.set(sessionId, []);
        }
        const buffer = conversationBuffers.get(sessionId)!;
        buffer.push(`User: ${message}`);

        // Summarize every 10 turns (Task 2.A: high frequency temporal rolling)
        if (buffer.length >= 10) {
          const summary = await summarizer.summarize(buffer);
          if (!summary.isEmpty) {
            mm.storeReflection(`Summary: ${summary.summary}`, 0.8);
            console.log('[Memory] Conversation summarized');
          }
          buffer.length = 0;  // Clear buffer
        }

        // Extract preferences periodically
        if (buffer.length % 10 === 0 && buffer.length > 0) {
          const profile = await extractor.extract(buffer);
          if (profile.likes.length > 0 || profile.dislikes.length > 0) {
            console.log('[Memory] Extracted preferences:', profile);
            // Store extracted preferences as semantic memories (without conflict detection for now)
            for (const like of profile.likes) {
              if (config.backend === 'qdrant' && mm instanceof QdrantMemoryManager) {
                await mm.storeSemanticWithConflictCheck(`User likes: ${like}`, 0.7, 0.9);
              } else {
                mm.storeSemantic(`User likes: ${like}`, 0.7);
              }
            }
            for (const dislike of profile.dislikes) {
              if (config.backend === 'qdrant' && mm instanceof QdrantMemoryManager) {
                await mm.storeSemanticWithConflictCheck(`User dislikes: ${dislike}`, 0.7, 0.9);
              } else {
                mm.storeSemantic(`User dislikes: ${dislike}`, 0.7);
              }
            }
          }
        }

        return context;
      } catch (error: any) {
        console.error('[openclaw-memory] Error processing message:', error);
        return 'SYSTEM:\\n\\n[Memory system temporarily unavailable]';
      }
    });

    // Register hook for assistant messages
    api.onAssistantMessage?.(async (sessionId: string, message: string) => {
      try {
        // Store assistant messages with lower importance
        mm.storeMemory(sessionId, `Assistant: ${message}`, 0.3);
      } catch (error: any) {
        console.error('[openclaw-memory] Error storing assistant message:', error);
      }
    });

    console.log('[openclaw-memory] Plugin registered');
  },

  async shutdown() {
    if (memoryManager) {
      await memoryManager.shutdown();
      memoryManager = null;
      console.log('[openclaw-memory] Plugin shut down');
    }
  },
};

export default memoryPlugin;

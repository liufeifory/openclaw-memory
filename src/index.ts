/**
 * OpenClaw Memory Plugin - Native Node.js Implementation
 *
 * Provides long-term memory with:
 * - Semantic retrieval via pgvector
 * - Importance-based ranking
 * - Episodic, semantic, and reflection memories
 */

import { MemoryManager } from './memory-manager.js';

interface MemoryPluginConfig {
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

// Global instance for reuse across requests
let memoryManager: MemoryManager | null = null;

function getMemoryManager(config: MemoryPluginConfig): MemoryManager {
  if (!memoryManager) {
    memoryManager = new MemoryManager(config);
  }
  return memoryManager;
}

const memoryPlugin = {
  id: 'openclaw-memory',
  name: 'OpenClaw Memory (PostgreSQL)',
  description: 'PostgreSQL-based long-term memory with semantic search using pgvector',
  kind: 'memory',

  async init(config: MemoryPluginConfig) {
    // Initialize memory manager on plugin load
    getMemoryManager(config);
    console.log('[openclaw-memory] Plugin initialized');
  },

  register(api: any) {
    // Get config from OpenClaw
    const config = api.getConfig?.() as MemoryPluginConfig | undefined;

    if (!config?.database) {
      console.warn('[openclaw-memory] No database config found, plugin disabled');
      return;
    }

    // Initialize memory manager
    const mm = getMemoryManager(config);

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

        // Store message asynchronously (fire and forget)
        mm.storeMemory(sessionId, message);

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

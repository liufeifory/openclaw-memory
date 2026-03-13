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
// Global instance for reuse across requests
let memoryManager = null;
function getMemoryManager(config) {
    if (!memoryManager) {
        if (config.backend === 'qdrant') {
            memoryManager = new QdrantMemoryManager(config);
        }
        else {
            memoryManager = new PgMemoryManager(config);
        }
    }
    return memoryManager;
}
const memoryPlugin = {
    id: 'openclaw-memory',
    name: 'OpenClaw Memory',
    description: 'Long-term memory with semantic search (supports pgvector and Qdrant)',
    kind: 'memory',
    async init(config) {
        // Initialize memory manager on plugin load
        const mm = getMemoryManager(config);
        // Initialize Qdrant if using that backend
        if (config.backend === 'qdrant' && mm instanceof QdrantMemoryManager) {
            await mm.initialize();
        }
        console.log('[openclaw-memory] Plugin initialized with', config.backend === 'qdrant' ? 'Qdrant' : 'PostgreSQL');
    },
    register(api) {
        // Get config from OpenClaw
        const config = api.getConfig?.();
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
        // Register memory_search tool
        api.registerTool((ctx) => {
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
                execute: async ({ query, top_k = 5, threshold = 0.6 }) => {
                    try {
                        const memories = await mm.retrieveRelevant(query, top_k, threshold);
                        return {
                            memories,
                            count: memories.length,
                        };
                    }
                    catch (error) {
                        return { error: `Memory search failed: ${error.message}` };
                    }
                },
            };
            return [memorySearchTool];
        }, { names: ['memory_search'] });
        // Register hook for user messages - build context automatically
        api.onUserMessage?.(async (sessionId, message, recentConversation) => {
            try {
                // Retrieve relevant memories
                const memories = await mm.retrieveRelevant(message);
                // Build context
                const context = mm.buildContext(sessionId, memories, recentConversation);
                // Store message asynchronously (fire and forget)
                mm.storeMemory(sessionId, message);
                return context;
            }
            catch (error) {
                console.error('[openclaw-memory] Error processing message:', error);
                return 'SYSTEM:\\n\\n[Memory system temporarily unavailable]';
            }
        });
        // Register hook for assistant messages
        api.onAssistantMessage?.(async (sessionId, message) => {
            try {
                // Store assistant messages with lower importance
                mm.storeMemory(sessionId, `Assistant: ${message}`, 0.3);
            }
            catch (error) {
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
//# sourceMappingURL=index.js.map
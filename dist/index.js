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
// Global instance for reuse across requests
let memoryManager = null;
let memoryFilter = null;
let preferenceExtractor = null;
let summarizer = null;
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
function getMemoryFilter(llamaEndpoint) {
    if (!memoryFilter) {
        memoryFilter = new MemoryFilter(llamaEndpoint);
    }
    return memoryFilter;
}
function getPreferenceExtractor(llamaEndpoint) {
    if (!preferenceExtractor) {
        preferenceExtractor = new PreferenceExtractor(llamaEndpoint);
    }
    return preferenceExtractor;
}
function getSummarizer(llamaEndpoint) {
    if (!summarizer) {
        summarizer = new Summarizer(llamaEndpoint);
    }
    return summarizer;
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
        // Initialize 1B model helpers (Llama-3.2-1B-Instruct on port 8081)
        const llamaEndpoint = config.embedding?.endpoint?.replace('8080', '8081') ?? 'http://localhost:8081';
        const filter = getMemoryFilter(llamaEndpoint);
        const extractor = getPreferenceExtractor(llamaEndpoint);
        const summarizer = getSummarizer(llamaEndpoint);
        // Conversation buffer for summarization
        const conversationBuffers = new Map();
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
                // Smart storage: use 1B model to classify and filter
                const filterResult = await filter.classify(message);
                if (filterResult.shouldStore && filterResult.memoryType) {
                    // Check for conflicts if storing semantic memory
                    if (filterResult.memoryType === 'semantic') {
                        // Search for similar memories to check for conflicts
                        const similar = await mm.retrieveRelevant(message, 5, 0.85);
                        if (similar.length > 0) {
                            // Conflict detection would go here (implemented in memory-manager)
                            console.log(`[Memory] Classified as ${filterResult.category}, importance: ${filterResult.importance}`);
                        }
                    }
                    // Store with classified importance and type
                    if (filterResult.memoryType === 'episodic') {
                        mm.storeMemory(sessionId, message, filterResult.importance);
                    }
                    else {
                        // Semantic memory - store without session ID
                        mm.storeSemantic(message, filterResult.importance);
                    }
                }
                else {
                    console.log(`[Memory] Skipped: ${filterResult.category} - ${filterResult.reason}`);
                }
                // Add to conversation buffer for summarization
                if (!conversationBuffers.has(sessionId)) {
                    conversationBuffers.set(sessionId, []);
                }
                const buffer = conversationBuffers.get(sessionId);
                buffer.push(`User: ${message}`);
                // Summarize every 20 turns
                if (buffer.length >= 20) {
                    const summary = await summarizer.summarize(buffer);
                    if (!summary.isEmpty) {
                        mm.storeReflection(`Summary: ${summary.summary}`, 0.8);
                        console.log('[Memory] Conversation summarized');
                    }
                    buffer.length = 0; // Clear buffer
                }
                // Extract preferences periodically
                if (buffer.length % 10 === 0 && buffer.length > 0) {
                    const profile = await extractor.extract(buffer);
                    if (profile.likes.length > 0 || profile.dislikes.length > 0) {
                        console.log('[Memory] Extracted preferences:', profile);
                        // Store extracted preferences as semantic memories
                        for (const like of profile.likes) {
                            mm.storeSemantic(`User likes: ${like}`, 0.7);
                        }
                        for (const dislike of profile.dislikes) {
                            mm.storeSemantic(`User dislikes: ${dislike}`, 0.7);
                        }
                    }
                }
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
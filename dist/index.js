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
import { LLMLimiter } from './llm-limiter.js';
import { MemoryFilter } from './memory-filter.js';
import { PreferenceExtractor } from './preference-extractor.js';
import { Summarizer } from './summarizer.js';
// Global instance for reuse across requests
let memoryManager = null;
let memoryFilter = null;
let preferenceExtractor = null;
let summarizer = null;
let globalLimiter = null;
let savedConfig = null; // Store config from init
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
function getMemoryFilter(llamaEndpoint, limiter) {
    if (!memoryFilter) {
        memoryFilter = new MemoryFilter(llamaEndpoint, limiter);
    }
    return memoryFilter;
}
function getPreferenceExtractor(llamaEndpoint, limiter) {
    if (!preferenceExtractor) {
        preferenceExtractor = new PreferenceExtractor(llamaEndpoint, limiter);
    }
    return preferenceExtractor;
}
function getSummarizer(llamaEndpoint, limiter) {
    if (!summarizer) {
        summarizer = new Summarizer(llamaEndpoint, limiter);
    }
    return summarizer;
}
/**
 * Build context string from retrieved memories.
 */
function buildMemoryContext(memories) {
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
    description: 'Long-term memory with semantic search (supports pgvector and Qdrant)',
    kind: 'memory',
    async init(config) {
        // Store config for later use in register
        savedConfig = config;
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
    register(api) {
        // Get plugin config from OpenClaw - use api.pluginConfig property (not getConfig method)
        const pluginConfig = api.pluginConfig;
        // Debug: log what we received
        console.log('[openclaw-memory] Plugin config from api.pluginConfig:', JSON.stringify(pluginConfig, null, 2));
        // Handle both formats: {enabled, config} or direct config
        const config = pluginConfig?.config || pluginConfig;
        if (!config) {
            console.warn('[openclaw-memory] No config found, plugin disabled');
            return;
        }
        // Debug: log resolved config
        console.log('[openclaw-memory] Resolved config:', JSON.stringify(config, null, 2));
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
        // Create shared LLM limiter
        globalLimiter = new LLMLimiter({ maxConcurrent: 2, minInterval: 100, queueLimit: 50 });
        const limiter = globalLimiter;
        // Initialize helpers
        const filter = getMemoryFilter(llamaEndpoint, limiter);
        const extractor = getPreferenceExtractor(llamaEndpoint, limiter);
        const summarizer = getSummarizer(llamaEndpoint, limiter);
        // Conversation buffer for summarization
        const conversationBuffers = new Map();
        // ============================================================
        // ✅ 注册 message_received Hook - 存储消息 (异步非阻塞)
        // ============================================================
        api.on('message_received', async (event, ctx) => {
            console.log('[openclaw-memory] message_received hook triggered:', {
                from: event.from || 'anonymous',
                content: event.content?.slice(0, 50),
                conversationId: ctx.conversationId
            });
            const sessionId = ctx.conversationId || 'default';
            const message = event.content;
            // 跳过空消息（允许 from 为空，因为某些渠道不提供 from 字段）
            if (!message || message.trim().length === 0) {
                console.log('[openclaw-memory] Skipping message: no content');
                return;
            }
            try {
                // 1. 分类消息
                const filterResult = await filter.classify(message);
                // 2. 存储记忆
                if (filterResult.shouldStore && filterResult.memoryType) {
                    if (filterResult.memoryType === 'semantic') {
                        // Only QdrantMemoryManager has storeSemanticWithConflictCheck
                        if (mm instanceof QdrantMemoryManager) {
                            await mm.storeSemanticWithConflictCheck(message, filterResult.importance, 0.85);
                        }
                        else {
                            await mm.storeSemantic(message, filterResult.importance);
                        }
                    }
                    else {
                        await mm.storeMemory(sessionId, message, filterResult.importance);
                    }
                }
                // 3. 偏好提取（每 10 条）
                const buffer = conversationBuffers.get(sessionId) || [];
                buffer.push(message);
                conversationBuffers.set(sessionId, buffer);
                if (buffer.length >= 10) {
                    // 提取偏好
                    const userProfile = await extractor.extract(buffer);
                    // Store likes as semantic memories
                    for (const like of userProfile.likes) {
                        await mm.storeSemantic(like, 0.8);
                    }
                    // Store dislikes as semantic memories
                    for (const dislike of userProfile.dislikes) {
                        await mm.storeSemantic(dislike, 0.8);
                    }
                    // 生成摘要
                    const summaryResult = await summarizer.summarize(buffer);
                    if (summaryResult.summary) {
                        await mm.storeReflection(summaryResult.summary, 0.9);
                    }
                    // 清空缓冲
                    conversationBuffers.set(sessionId, []);
                }
            }
            catch (error) {
                console.error('[openclaw-memory] message_received hook failed:', error.message);
            }
        });
        // ============================================================
        // ✅ 注册 before_prompt_build Hook - 注入上下文 (带超时优化)
        // ============================================================
        api.on('before_prompt_build', async (event, ctx) => {
            console.log('[openclaw-memory] before_prompt_build hook triggered:', {
                hasMessages: !!event.messages,
                messagesCount: event.messages?.length || 0,
                sessionId: ctx.sessionId
            });
            const sessionId = ctx.sessionId;
            const messages = event.messages;
            // 检查 messages 是否存在
            if (!messages || messages.length === 0) {
                console.log('[openclaw-memory] No messages in event, skipping context injection');
                return;
            }
            // 获取最后一条用户消息
            const lastUserMessage = messages.filter(m => m.role === 'user').pop();
            if (!lastUserMessage) {
                console.log('[openclaw-memory] No user message found, skipping context injection');
                return; // 没有用户消息，不注入
            }
            // 超时控制：300ms 内必须返回，避免阻塞 Agent 响应
            const timeoutMs = 300;
            try {
                // 1. 检索相关记忆 (带超时)
                const memories = await Promise.race([
                    mm.retrieveRelevant(lastUserMessage.content, sessionId, 3, 0.65), // top_k=3, threshold=0.65
                    new Promise((_, reject) => setTimeout(() => reject(new Error('Memory retrieval timeout')), timeoutMs))
                ]);
                if (!memories || memories.length === 0) {
                    return; // 没有相关记忆
                }
                // 2. 构建上下文 (限制总长度)
                const context = buildMemoryContext(memories.slice(0, 3)); // 最多 3 条记忆
                // 3. 返回 prependContext
                return {
                    prependContext: context,
                };
            }
            catch (error) {
                if (error.message !== 'Memory retrieval timeout') {
                    console.error('[openclaw-memory] before_prompt_build hook failed:', error.message);
                    console.error('[openclaw-memory] Stack trace:', error.stack);
                }
                else {
                    console.warn('[openclaw-memory] before_prompt_build hook timeout (>', timeoutMs, 'ms)');
                }
                return; // 超时或失败时不注入上下文
            }
        });
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
                execute: async ({ query, top_k = 5, threshold = 0.6, session_id }) => {
                    try {
                        const memories = await mm.retrieveRelevant(query, session_id, top_k, threshold);
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
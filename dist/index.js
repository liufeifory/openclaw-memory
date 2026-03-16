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
import * as fs from 'fs';
import * as path from 'path';
// Global instance for reuse across requests
let memoryManager = null;
let memoryFilter = null;
let preferenceExtractor = null;
let summarizer = null;
let globalLimiter = null;
let savedConfig = null;
/**
 * Append memory to local Markdown file for self-improving-agent compatibility.
 * This function is NOT affected by backend choice - always writes to file.
 */
function appendToLocalMemory(content, sessionId) {
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
        }
        else {
            const dateStr = new Date().toISOString().split('T')[0];
            fileContent = `# ${dateStr}\n\n## 日志\n\n`;
        }
        // Append entry
        fs.writeFileSync(memoryFile, fileContent + entry);
        console.log(`[openclaw-memory] Appended to local memory: ${memoryFile}`);
    }
    catch (error) {
        console.error('[openclaw-memory] Failed to write local memory:', error.message);
    }
}
function getMemoryManager(config) {
    if (!memoryManager) {
        memoryManager = new SurrealMemoryManager(config);
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
    description: 'Long-term memory with semantic search (SurrealDB backend)',
    kind: 'memory',
    async init(config) {
        // Store config for later use in register
        savedConfig = config;
        // Initialize memory manager
        const mm = getMemoryManager(config);
        // Initialize SurrealDB backend
        if (mm instanceof SurrealMemoryManager) {
            const result = await mm.initialize();
            if (result.migrated) {
                console.log('[openclaw-memory] SurrealDB schema migration:', result.changes);
            }
        }
        console.log('[openclaw-memory] Plugin initialized with SurrealDB backend');
    },
    async register(api) {
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
        // Check for SurrealDB config
        if (!config.surrealdb) {
            console.warn('[openclaw-memory] No SurrealDB config found, plugin disabled');
            return;
        }
        // Initialize memory manager and SurrealDB backend
        console.log('[openclaw-memory] Creating MemoryManager...');
        const mm = getMemoryManager(config);
        console.log('[openclaw-memory] MemoryManager created, instance:', mm?.constructor?.name);
        // Initialize SurrealDB connection if not already done by init()
        // This ensures connection even if OpenClaw doesn't call init()
        if (mm instanceof SurrealMemoryManager) {
            try {
                console.log('[openclaw-memory] Initializing SurrealDB connection...');
                const result = await mm.initialize();
                if (result.migrated) {
                    console.log('[openclaw-memory] SurrealDB schema migration:', result.changes);
                }
                console.log('[openclaw-memory] SurrealDB connection established');
            }
            catch (error) {
                console.error('[openclaw-memory] Failed to initialize SurrealDB:', error.message);
                console.error('[openclaw-memory] Stack:', error.stack);
            }
        }
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
        const messageQueue = [];
        let queueProcessing = false;
        let queueShutDown = false;
        /**
         * 后台 Worker - 持续处理消息队列
         * 错误完全隔离，只记录日志，不影响主流程
         */
        async function processQueue() {
            if (queueProcessing)
                return;
            queueProcessing = true;
            while (!queueShutDown && messageQueue.length > 0) {
                const item = messageQueue.shift();
                if (!item)
                    continue;
                try {
                    // 类型检查：确保 message 是字符串
                    if (typeof item.message !== 'string') {
                        console.warn(`[openclaw-memory] Queue: received non-string message (type: ${typeof item.message})`);
                        item.message = String(item.message);
                    }
                    // 跳过空消息
                    if (!item.message || item.message.trim().length === 0) {
                        continue;
                    }
                    // 1. 分类消息
                    const filterResult = await filter.classify(item.message);
                    // 2. 存储记忆（同时写入数据库和本地文件）
                    if (filterResult.shouldStore && filterResult.memoryType) {
                        if (filterResult.memoryType === 'semantic') {
                            await mm.storeSemanticWithConflictCheck(item.message, filterResult.importance, 0.85, item.sessionId);
                        }
                        else {
                            await mm.storeMemory(item.sessionId, item.message, filterResult.importance);
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
                        const userProfile = await extractor.extract(buffer);
                        for (const like of userProfile.likes) {
                            await mm.storeSemantic(like, 0.8, item.sessionId);
                            appendToLocalMemory(`[PREFERENCE-LIKE] ${like}`);
                        }
                        for (const dislike of userProfile.dislikes) {
                            await mm.storeSemantic(dislike, 0.8, item.sessionId);
                            appendToLocalMemory(`[PREFERENCE-DISLIKE] ${dislike}`);
                        }
                        const summaryResult = await summarizer.summarize(buffer);
                        if (summaryResult.summary) {
                            await mm.storeReflection(summaryResult.summary, 0.9, item.sessionId);
                            appendToLocalMemory(`[REFLECTION] ${summaryResult.summary}`);
                        }
                        conversationBuffers.set(item.sessionId, []);
                    }
                    console.log(`[openclaw-memory] Queue: processed message for session ${item.sessionId}`);
                }
                catch (error) {
                    // 错误完全隔离，只记录日志，不影响队列继续处理
                    console.error(`[openclaw-memory] Queue: failed to process message for session ${item.sessionId}:`, error.message);
                }
            }
            queueProcessing = false;
        }
        /**
         * 入队消息 - Hook 只负责复制，立即返回
         */
        function enqueueMessage(sessionId, message, source) {
            if (queueShutDown)
                return;
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
            console.log(`[openclaw-memory] Message enqueued (queue size: ${messageQueue.length})`);
        }
        // 已存储消息记录（用于避免 TUI 模式下重复存储）
        const storedMessages = new Set();
        // ============================================================
        // ✅ 注册 message_received Hook - 复制消息到队列 (渠道模式)
        // Hook 立即返回，不等待存储完成
        // ============================================================
        api.on('message_received', (event, ctx) => {
            console.log('[openclaw-memory] message_received hook triggered (channel mode):', {
                from: event.from || 'anonymous',
                content: event.content?.slice(0, 50),
                conversationId: ctx.conversationId
            });
            const sessionId = ctx.conversationId || 'default';
            const message = event.content;
            // 跳过空消息
            if (!message || message.trim().length === 0) {
                console.log('[openclaw-memory] Skipping message: no content');
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
        api.on('before_prompt_build', async (event, ctx) => {
            console.log('[openclaw-memory] before_prompt_build hook triggered:', {
                hasMessages: !!event.messages,
                messagesCount: event.messages?.length || 0,
                sessionId: ctx.sessionId
            });
            const sessionId = ctx.sessionId || 'default';
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
                return;
            }
            // 提取消息内容（处理数组/对象/字符串三种格式）
            let lastMessageContent;
            if (typeof lastUserMessage.content === 'string') {
                // 字符串格式
                lastMessageContent = lastUserMessage.content;
            }
            else if (Array.isArray(lastUserMessage.content)) {
                // 数组格式：[{ type: 'text', text: '...' }]
                const textParts = lastUserMessage.content
                    .filter((part) => part.type === 'text')
                    .map((part) => part.text)
                    .join(' ');
                lastMessageContent = textParts || String(lastUserMessage.content);
            }
            else if (lastUserMessage.content && typeof lastUserMessage.content === 'object' && lastUserMessage.content.text) {
                // 对象格式：{ text: '...' }
                lastMessageContent = lastUserMessage.content.text;
            }
            else {
                lastMessageContent = String(lastUserMessage.content ?? '');
            }
            if (!lastMessageContent) {
                console.log('[openclaw-memory] Empty user message, skipping');
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
};
export default memoryPlugin;
//# sourceMappingURL=index.js.map
/* eslint-disable @typescript-eslint/no-explicit-any -- OpenClaw SDK API types are dynamic */
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
import { buildPromptSection, buildMemoryFlushPlan, createMemoryRuntime, } from './memory-runtime-provider.js';
import { ServiceFactory, initServices } from './service-factory.js';
import * as fs from 'fs';
import * as path from 'path';
// Helper to create plugin entry (replaces definePluginEntry)
function createPluginEntry(entry) {
    return entry;
}
// Global instance for reuse across requests
let memoryManager = null;
let memoryFilter = null;
let preferenceExtractor = null;
let summarizer = null;
let globalLimiter = null;
let llmClient = null;
let savedConfig = null;
let initialized = false;
let initPromise = null; // Promise-based lock (avoids busy-wait)
/**
 * Lazy initialization - only initialize when actually needed
 * This prevents resource leaks when plugin is loaded but not used (e.g., status commands)
 * Uses Promise-based lock instead of busy-wait polling
 */
async function ensureInitialized() {
    if (initialized || !savedConfig)
        return;
    // If initialization is already in progress, wait for the same Promise
    // This avoids busy-wait and ensures all callers share the same result
    if (!initPromise) {
        initPromise = doInitialize();
    }
    await initPromise;
}
/**
 * Actual initialization logic (separated for Promise-based locking)
 */
async function doInitialize() {
    if (!savedConfig) {
        logWarn('No config available, skipping initialization');
        return;
    }
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
        }
        catch (error) {
            logError(`Failed to initialize SurrealDB: ${error.message}`);
            throw error;
        }
    }
    // Initialize ServiceFactory with config (single source of truth)
    initServices(savedConfig);
    // Get LLM client from factory
    llmClient = ServiceFactory.getLLM();
    globalLimiter = new LLMLimiter({ maxConcurrent: 2, minInterval: 100, queueLimit: 50 });
    // Initialize helpers with LLM client
    memoryFilter = getMemoryFilter(llmClient, globalLimiter);
    preferenceExtractor = getPreferenceExtractor(llmClient, globalLimiter);
    summarizer = getSummarizer(llmClient, globalLimiter);
    logInfo(`[LLM] Config: ${llmClient.getConfigInfo()}`);
    initialized = true;
    logInfo('Plugin lazy initialized');
}
const messageQueue = [];
let queueProcessing = false;
let queueShutDown = false;
const storedMessages = new Set(); // For TUI duplicate prevention
const conversationBuffers = new Map(); // Conversation buffer for summarization
// Track if cleanup has been done to avoid double cleanup
let cleanedUp = false;
// Auto-cleanup timeout - runs after CLI commands complete
// Disabled in Gateway mode (long-running server)
let autoCleanupTimeout = null;
let autoCleanupScheduled = false; // Track if we've already scheduled cleanup
const AUTO_CLEANUP_DELAY = 3000; // Wait 3 seconds after last activity before cleanup
const IS_GATEWAY_MODE = process.env.OPENCLAW_GATEWAY === '1'
    || process.env.OPENCLAW_MODE === 'gateway'
    || process.env.OPENCLAW_SERVICE_KIND === 'gateway';
// Document watcher reference for cleanup
let documentWatcher = null;
/**
 * Schedule auto-cleanup after CLI command completes
 * Only schedules once per initialization cycle
 * Disabled in Gateway mode (long-running server)
 */
function scheduleAutoCleanup() {
    if (IS_GATEWAY_MODE) {
        logInfo('[Plugin] Auto-cleanup disabled in Gateway mode');
        return;
    }
    if (autoCleanupScheduled)
        return; // Already scheduled
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
async function cleanup() {
    if (cleanedUp)
        return;
    cleanedUp = true;
    logInfo('[Plugin] cleanup() called');
    // Clear auto-cleanup timeout
    if (autoCleanupTimeout) {
        clearTimeout(autoCleanupTimeout);
        autoCleanupTimeout = null;
    }
    autoCleanupScheduled = false; // Allow re-scheduling
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
    llmClient = null; // Reset LLM client to allow re-initialization
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
// Only cleanup in CLI mode, not in Gateway mode (long-running server)
process.on('beforeExit', async () => {
    // Skip cleanup in Gateway mode - the server is long-running
    if (IS_GATEWAY_MODE) {
        return;
    }
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
function buildMemoryContext(memories) {
    if (!memories || memories.length === 0) {
        return '';
    }
    const contextParts = memories
        .filter(m => {
        const content = m.content || m.text || '';
        return content && content.trim().length > 0; // Filter out empty content
    })
        .map(m => {
        const type = m.type || m.memory_type || 'unknown';
        const similarity = m.similarity?.toFixed(3) || 'N/A';
        const importance = m.importance?.toFixed(2) || 'N/A';
        const content = m.content || m.text || '';
        return `[${type.toUpperCase()}] (sim: ${similarity}, imp: ${importance}) ${content}`;
    });
    if (contextParts.length === 0) {
        return ''; // No valid memories after filtering
    }
    return '\n--- Relevant Memories ---\n' + contextParts.join('\n') + '\n--- End Memories ---\n';
}
/**
 * Intent detection patterns for memory type prioritization
 * Zero-cost keyword matching (no LLM call)
 */
const INTENT_PATTERNS = {
    episodic: [
        /上次/, /之前/, /刚才/, /曾经/, /什么时候/, /哪天/, /几号/, /那天/,
        /最近/, /最近一次/, /前几天/, /上周/, /上个月/,
        /具体/, /详细/, /原话/, /怎么说的/, /怎么说/,
        /记得/, /还记得/, /我说/,
        /我说过/, /我提过/,
        /那次/, /那个/, /这件事/, /那件事/, /这个事/,
        /怎么做的/, /如何做的/, /步骤/, /流程/, /过程/,
    ],
    semantic: [
        /我喜欢/, /我讨厌/, /我想要/, /我不喜欢/, /我爱/, /我烦/,
        /习惯/, /通常/, /一般/, /平时/, /老是/, /总是/,
        /推荐/, /适合我/, /我需要/, /我要找/,
        /偏好/, /更喜欢/, /最喜欢/, /比较好/,
    ],
    reflection: [
        /总结/, /学到/, /收获/, /心得/, /体会/, /感悟/,
        /总的来说/, /整体上/, /概括/, /简述/,
        /进展/, /进步/, /提升/, /改善/, /变化/,
        /做了什么/, /完成了/, /做完了/,
    ],
};
/**
 * Historical query patterns - triggers deep retrieval mode
 * When detected, expands time windows significantly
 */
const HISTORICAL_PATTERNS = [
    /很久以前/, /很久之前/, /好久以前/, /好久之前/,
    /几个月前/, /半年前/, /一年前/, /年前/, /多年前/,
    /去年/, /前年/, /早年/, /当初/, /最初/, /刚开始/,
    /第一次/, /最早/, /最开始的/, /原始的/,
    /所有/, /全部/, /完整/, /全部历史/, /历史记录/,
    /从头到尾/, /整个过程/, /来龙去脉/,
];
/**
 * Extended time windows for historical queries (in days)
 */
const HISTORICAL_TIME_WINDOWS = {
    episodic: 365, // 1 year
    semantic: 730, // 2 years
    reflection: 730, // 2 years
    default: 365, // 1 year
};
/**
 * Time window config (in days) for each intent type
 */
const TIME_WINDOWS = {
    episodic: 7,
    semantic: 30,
    reflection: 90,
    default: 30,
};
/**
 * Time decay factor: 0.98 = 2% decay per day
 */
const TIME_DECAY_FACTOR = 0.98;
/**
 * Detect user intent from query using keyword matching
 */
function detectIntent(query) {
    for (const [intent, patterns] of Object.entries(INTENT_PATTERNS)) {
        for (const pattern of patterns) {
            if (pattern.test(query)) {
                return intent;
            }
        }
    }
    return 'default';
}
/**
 * Check if query has explicit detail recall intent
 */
function hasDetailIntent(query) {
    return /上次 |之前 |记得 |具体 |原话 |怎么说的 |还记得/.test(query);
}
/**
 * Check if query is a historical query (wants old information)
 */
function isHistoricalQuery(query) {
    return HISTORICAL_PATTERNS.some(p => p.test(query));
}
/**
 * Get time window for intent type (unused - kept for future use)
 * @param intent - Detected intent type
 * @param isHistorical - Whether this is a historical query
 */
function _getTimeWindow(intent, isHistorical) {
    if (isHistorical) {
        return HISTORICAL_TIME_WINDOWS[intent] || HISTORICAL_TIME_WINDOWS.default;
    }
    return TIME_WINDOWS[intent] || TIME_WINDOWS.default;
}
/**
 * Calculate comprehensive score for memory sorting
 * Combines: intent match + time decay + similarity + type priority
 */
function calculateMemoryScore(memory, intent, hasDetail) {
    const type = memory.type || memory.memory_type || 'episodic';
    // 1. Intent match score
    const intentScore = (type === intent) ? 1.0 : 0.5;
    // 2. Time decay score (newer is better)
    const memoryDate = memory.created_at ? new Date(memory.created_at).getTime() : Date.now();
    const daysOld = (Date.now() - memoryDate) / (24 * 60 * 60 * 1000);
    const timeScore = Math.pow(TIME_DECAY_FACTOR, Math.max(0, daysOld));
    // 3. Similarity score
    const similarityScore = memory.similarity || memory.score || 0;
    // 4. Type priority based on intent
    let typePriority;
    if (hasDetail) {
        // Detail intent: episodic first
        typePriority = type === 'episodic' ? 1.5 : 0.8;
    }
    else {
        // Default: reflection/semantic first
        const priorityMap = {
            reflection: 1.2,
            semantic: 1.0,
            episodic: 0.8,
        };
        typePriority = priorityMap[type] || 0.8;
    }
    // Combined score
    return intentScore * typePriority + timeScore * 0.8 + similarityScore * 0.7;
}
/**
 * Sort memories by comprehensive score
 */
function sortMemoriesByScore(memories, intent, hasDetail) {
    return memories.sort((a, b) => calculateMemoryScore(b, intent, hasDetail) - calculateMemoryScore(a, intent, hasDetail));
}
function getMemoryManager(config) {
    if (!memoryManager) {
        memoryManager = new SurrealMemoryManager(config);
    }
    return memoryManager;
}
function getMemoryFilter(client, limiter) {
    if (!memoryFilter) {
        memoryFilter = new MemoryFilter(client, limiter);
    }
    return memoryFilter;
}
function getPreferenceExtractor(_client, limiter) {
    if (!preferenceExtractor) {
        preferenceExtractor = new PreferenceExtractor(limiter);
    }
    return preferenceExtractor;
}
function getSummarizer(_client, limiter) {
    if (!summarizer) {
        summarizer = new Summarizer(limiter);
    }
    return summarizer;
}
/**
 * Append memory to local Markdown file for self-improving-agent compatibility.
 */
function appendToLocalMemory(content, _sessionId) {
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
        logInfo(`[openclaw-memory] Appended to local memory: ${memoryFile}`);
    }
    catch (error) {
        logError(`[openclaw-memory] Failed to write local memory: ${error.message}`);
    }
}
export default createPluginEntry({
    id: 'openclaw-memory',
    name: 'OpenClaw Memory',
    description: 'Long-term memory with semantic search (SurrealDB backend)',
    kind: 'memory',
    async init(config) {
        logInfo('[openclaw-memory] init() called');
        // Store config for later use
        savedConfig = config;
        logInfo('Plugin init called, storing config...');
        // Initialize immediately since gateway doesn't await register()
        try {
            await ensureInitialized();
            logInfo('Plugin initialized via init()');
        }
        catch (error) {
            logError(`Plugin init failed: ${error.message}`);
            throw error;
        }
    },
    register(api) {
        // Get plugin config from OpenClaw
        const pluginConfig = api.pluginConfig;
        const config = pluginConfig?.config || pluginConfig;
        logInfo('[openclaw-memory] register() called');
        if (!config) {
            logInfo('No config found, plugin disabled');
            return;
        }
        if (!config.surrealdb) {
            logInfo('No SurrealDB config found, plugin disabled');
            return;
        }
        // Update savedConfig if not already set by init()
        if (!savedConfig) {
            savedConfig = config;
            logInfo('[openclaw-memory] Config saved from register()');
        }
        // ============================================================
        // Register Memory Runtime API - Required for OpenClaw recognition
        // ============================================================
        const memoryRuntime = createMemoryRuntime(() => savedConfig);
        // Register prompt section for memory guidance
        api.registerMemoryPromptSection(buildPromptSection);
        // Register memory flush plan for compaction
        api.registerMemoryFlushPlan(buildMemoryFlushPlan);
        // Register memory runtime provider
        api.registerMemoryRuntime(memoryRuntime);
        logInfo('[openclaw-memory] Memory runtime API registered');
        // Document Import Configuration - start watcher only if configured
        const docConfig = config.documentImport || {};
        let watchDir = docConfig.watchDir;
        if (watchDir) {
            // Expand ~ to home directory
            if (watchDir.startsWith('~/')) {
                watchDir = watchDir.replace('~/', process.env.HOME + '/');
            }
            // Document watcher starts asynchronously - does NOT block TUI startup
            // Uses setImmediate to defer initialization until after register() returns
            setImmediate(async () => {
                try {
                    await ensureInitialized();
                    const mm = getMemoryManager(config);
                    const importer = createDocumentImporter(mm, {
                        watchDir,
                        chunkSize: docConfig.chunkSize,
                        chunkOverlap: docConfig.chunkOverlap,
                    });
                    documentWatcher = importer.watcher;
                    await documentWatcher?.start(); // Non-blocking async start
                    logInfo(`Document watcher started (async): ${watchDir}`);
                }
                catch (error) {
                    logError(`Failed to start document watcher: ${error.message}`);
                }
            });
            logInfo(`Document watcher scheduled to start asynchronously: ${watchDir}`);
        }
        else {
            // Note: setImmediate above handles initialization for non-document-watcher mode
        }
        // Schedule auto-cleanup AFTER document watcher completes initial scan
        if (watchDir) {
            setTimeout(() => {
                scheduleAutoCleanup();
            }, 5000);
        }
        else {
            scheduleAutoCleanup();
        }
        // ============================================================
        // 消息队列 + 后台 Worker - 解耦记忆存储，确保故障不影响主流程
        // ============================================================
        async function processQueue() {
            if (queueProcessing)
                return;
            queueProcessing = true;
            try {
                while (!queueShutDown && messageQueue.length > 0) {
                    const item = messageQueue.shift();
                    if (!item)
                        continue;
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
                        if (!memoryFilter || !memoryManager) {
                            logWarn('[Queue] Memory filter or manager not initialized, skipping');
                            continue;
                        }
                        const filterResult = await memoryFilter.classify(item.message);
                        // 2. Store memories (all as episodic, write to both DB and file)
                        await memoryManager.storeMemory(item.sessionId, item.message, filterResult.importance);
                        // Write to local Markdown file (for self-improving-agent)
                        const categoryLabel = filterResult.category ? `[${filterResult.category}] ` : '';
                        appendToLocalMemory(`${categoryLabel}${item.message}`, item.sessionId);
                        // 3. Preference extraction (every 10 messages)
                        const buffer = conversationBuffers.get(item.sessionId) || [];
                        buffer.push(item.message);
                        conversationBuffers.set(item.sessionId, buffer);
                        if (buffer.length >= 10 && preferenceExtractor && summarizer) {
                            const userProfile = await preferenceExtractor.extract(buffer);
                            for (const like of userProfile.likes) {
                                await memoryManager.storeSemantic(like, 0.8, item.sessionId);
                                appendToLocalMemory(`[PREFERENCE-LIKE] ${like}`);
                            }
                            for (const dislike of userProfile.dislikes) {
                                await memoryManager.storeSemantic(dislike, 0.8, item.sessionId);
                                appendToLocalMemory(`[PREFERENCE-DISLIKE] ${dislike}`);
                            }
                            const summaryResult = await summarizer.summarize(buffer);
                            if (summaryResult.summary) {
                                await memoryManager.storeReflection(summaryResult.summary, 0.9, item.sessionId);
                                appendToLocalMemory(`[REFLECTION] ${summaryResult.summary}`);
                            }
                            conversationBuffers.set(item.sessionId, []);
                        }
                        logInfo(`Queue: processed message for session ${item.sessionId}`);
                    }
                    catch (error) {
                        logError(`Queue: failed to process message for session ${item.sessionId}: ${error.message}`);
                        if (error.stack) {
                            logError(`Queue: stack trace: ${error.stack}`);
                        }
                        // Continue processing next message (don't break the queue)
                    }
                }
            }
            finally {
                queueProcessing = false; // Ensure lock is released even on exception
            }
        }
        function enqueueMessage(sessionId, message, source) {
            if (queueShutDown)
                return;
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
        api.on('message_received', (event, ctx) => {
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
        api.on('before_prompt_build', async (event, ctx) => {
            const sessionId = ctx.sessionId || 'default';
            const messages = event.messages;
            if (!messages || messages.length === 0) {
                return;
            }
            // Get last user message
            const lastUserMessage = messages.filter(m => m.role === 'user').pop();
            if (!lastUserMessage) {
                return;
            }
            // Extract message content (handle array/object/string formats)
            let lastMessageContent;
            if (typeof lastUserMessage.content === 'string') {
                lastMessageContent = lastUserMessage.content;
            }
            else if (Array.isArray(lastUserMessage.content)) {
                const textParts = lastUserMessage.content
                    .filter((part) => part.type === 'text')
                    .map((part) => part.text)
                    .join(' ');
                lastMessageContent = textParts || String(lastUserMessage.content);
            }
            else if (lastUserMessage.content && typeof lastUserMessage.content === 'object' && lastUserMessage.content.text) {
                lastMessageContent = lastUserMessage.content.text;
            }
            else {
                lastMessageContent = String(lastUserMessage.content ?? '');
            }
            if (!lastMessageContent) {
                return;
            }
            // 短消息不触发记忆检索（参考原始 OpenClaw 逻辑）
            if (lastMessageContent.trim().length < 5) {
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
                // 1. Detect user intent (zero-cost keyword matching)
                const intent = detectIntent(lastMessageContent);
                const hasDetail = hasDetailIntent(lastMessageContent);
                const isHistorical = isHistoricalQuery(lastMessageContent);
                logInfo(`[Memory Inject] intent=${intent}, hasDetail=${hasDetail}, isHistorical=${isHistorical}, query="${lastMessageContent.slice(0, 30)}..."`);
                // 2. Retrieve relevant memories (with timeout)
                // For historical queries, increase top_k to get more results from longer time range
                const topK = isHistorical ? 30 : 10;
                if (!memoryManager) {
                    logWarn('[Memory Inject] Memory manager not initialized');
                    return;
                }
                const memories = await Promise.race([
                    memoryManager.retrieveRelevant(lastMessageContent, sessionId, topK, 0.5), // Lower threshold for historical
                    new Promise((_, reject) => setTimeout(() => reject(new Error('Memory retrieval timeout')), timeoutMs))
                ]);
                if (!memories || memories.length === 0) {
                    return;
                }
                // 3. Sort memories by comprehensive score (intent + time + similarity)
                const sortedMemories = sortMemoriesByScore(memories, intent, hasDetail);
                // 4. Take top N after sorting (more for historical queries)
                const takeCount = isHistorical ? 10 : 3;
                const topMemories = sortedMemories.slice(0, takeCount);
                // 5. Build context
                const context = buildMemoryContext(topMemories);
                // 6. Don't inject if context is empty
                if (!context || context.trim().length === 0) {
                    logInfo('[Memory Inject] No context to inject (empty)');
                    return;
                }
                logInfo(`[Memory Inject] Injecting context: ${context.substring(0, 100)}...`);
                // 7. Return prependContext
                return {
                    prependContext: context,
                };
            }
            catch (error) {
                if (error.message !== 'Memory retrieval timeout') {
                    logError(`before_prompt_build hook failed: ${error.message}`);
                    logError(`Stack trace: ${error.stack}`);
                }
                else {
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
            async execute(_id, params) {
                try {
                    const { query, top_k = 5, threshold = 0.6, session_id } = params;
                    logInfo(`[memory_search] query="${query}", top_k=${top_k}, threshold=${threshold}, session_id=${session_id}`);
                    if (!query) {
                        return { error: 'Missing required parameter: query' };
                    }
                    await ensureInitialized();
                    if (!memoryManager) {
                        return { error: 'Memory manager not initialized' };
                    }
                    const memories = await memoryManager.retrieveRelevant(query, session_id, top_k, threshold);
                    return {
                        memories,
                        count: memories.length,
                    };
                }
                catch (error) {
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
            async execute(_id, params) {
                try {
                    const { url, path: filePath } = params;
                    if (url) {
                        await ensureInitialized();
                        if (!memoryManager) {
                            return { error: 'Memory manager not initialized' };
                        }
                        const { urlImporter } = createDocumentImporter(memoryManager, {
                            chunkSize: savedConfig?.documentImport?.chunkSize,
                            chunkOverlap: savedConfig?.documentImport?.chunkOverlap,
                        });
                        const count = await urlImporter.import(url);
                        return { success: true, chunks: count, source: url };
                    }
                    if (filePath) {
                        await ensureInitialized();
                        if (!memoryManager) {
                            return { error: 'Memory manager not initialized' };
                        }
                        const parser = new DocumentParser();
                        const splitter = new DocumentSplitter(savedConfig?.documentImport?.chunkSize || 500, savedConfig?.documentImport?.chunkOverlap || 50);
                        const parsed = await parser.parse(filePath);
                        const chunks = splitter.split(parsed.content, filePath);
                        for (const chunk of chunks) {
                            await memoryManager.storeSemantic(chunk.content, 0.7, `doc:${filePath}`);
                        }
                        return { success: true, chunks: chunks.length, source: filePath };
                    }
                    return { error: 'URL or path required' };
                }
                catch (error) {
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
//# sourceMappingURL=index.js.map
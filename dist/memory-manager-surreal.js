/* eslint-disable @typescript-eslint/no-explicit-any -- Database query returns have flexible SurrealDB formats */
/**
 * Memory Manager - orchestrates all memory operations using SurrealDB.
 */
import { MemoryStore } from './memory-store-surreal.js';
import { ContextBuilder } from './context-builder.js';
import { Reranker } from './reranker.js';
import { ConflictDetector } from './conflict-detector.js';
import { LLMLimiter } from './llm-limiter.js';
import { ImportanceLearning } from './importance-learning.js';
import { SemanticClusterer } from './clusterer.js';
import { Summarizer } from './summarizer.js';
import { HybridRetriever } from './hybrid-retrieval.js';
import { EntityIndexer } from './entity-indexer.js';
import { logInfo, logError } from './maintenance-logger.js';
import { ServiceFactory, getDB, getEmbedding, getLLM } from './service-factory.js';
export class MemoryManager {
    db;
    embedding;
    memoryStore;
    contextBuilder;
    reranker;
    conflictDetector;
    limiter;
    importanceLearning;
    clusterer;
    summarizer;
    hybridRetriever;
    entityIndexer;
    idleClusteringInterval;
    activeSessions = new Set();
    sessionBuffers = new Map();
    lastRequestTime = Date.now();
    maintenanceHistory = {
        lastClustering: 0,
        lastDecay: 0,
        lastSummarization: 0,
        lastTtlPruning: 0,
    };
    constructor(config) {
        // Initialize ServiceFactory if not already initialized
        if (!ServiceFactory.isInitialized()) {
            ServiceFactory.init(config);
        }
        // Get services from factory (single source of truth)
        this.db = getDB();
        this.embedding = getEmbedding();
        this.memoryStore = new MemoryStore(this.db, this.embedding);
        this.contextBuilder = new ContextBuilder();
        // Get LLM client from factory
        const llmClient = getLLM();
        this.limiter = new LLMLimiter({ maxConcurrent: 2, minInterval: 100, queueLimit: 50 });
        // Local-only tasks (reranker, conflict detector, entity extractor)
        this.reranker = new Reranker(this.limiter);
        this.conflictDetector = new ConflictDetector(llmClient, this.limiter);
        // Hybrid tasks (can use cloud when configured)
        this.importanceLearning = new ImportanceLearning();
        this.clusterer = new SemanticClusterer(llmClient, this.limiter);
        this.summarizer = new Summarizer(this.limiter);
        logInfo(`[MemoryManager] LLM config: ${llmClient.getConfigInfo()}`);
        // Initialize EntityIndexer and HybridRetriever
        this.entityIndexer = new EntityIndexer(this.db);
        this.hybridRetriever = new HybridRetriever(this.db, this.embedding, this.entityIndexer, this.reranker);
        // Set EntityIndexer on MemoryStore for storage integration
        this.memoryStore.setEntityIndexer(this.entityIndexer);
    }
    /**
     * Initialize the memory manager (connect to SurrealDB).
     */
    async initialize() {
        const result = await this.db.initialize();
        logInfo('[MemoryManager] Initialized with SurrealDB');
        // Load known entities into EntityExtractor cache
        await this.loadKnownEntitiesToCache();
        // Start idle clustering worker
        this.startIdleClusteringWorker();
        return result;
    }
    /**
     * Dispose the memory manager - stop background workers and close DB connection.
     */
    async dispose() {
        // Stop idle clustering worker
        if (this.idleClusteringInterval) {
            clearInterval(this.idleClusteringInterval);
            this.idleClusteringInterval = undefined;
        }
        // Dispose EntityIndexer (stops all background schedulers)
        this.entityIndexer.dispose();
        // Dispose EntityExtractor (stops buffer flush)
        this.entityIndexer.getExtractor().dispose();
        // Close SurrealDB connection
        await this.db.close();
        logInfo('[MemoryManager] Disposed');
    }
    /**
     * Load known entities from database into EntityExtractor cache
     */
    async loadKnownEntitiesToCache() {
        try {
            const knownEntities = await this.db.loadKnownEntities(10000);
            if (knownEntities.length > 0) {
                // Load entities into EntityExtractor cache via EntityIndexer
                this.entityIndexer.getExtractor().addKnownEntities(knownEntities);
                logInfo(`[MemoryManager] Loaded ${knownEntities.length} known entities to EntityExtractor cache`);
            }
            else {
                logInfo('[MemoryManager] No known entities to load (fresh database)');
            }
        }
        catch (error) {
            logError(`[MemoryManager] Failed to load known entities: ${error.message}`);
        }
    }
    /**
     * Start idle clustering worker - runs semantic clustering during idle time.
     * Uses unref() to not block process exit.
     */
    startIdleClusteringWorker() {
        this.idleClusteringInterval = setInterval(async () => {
            try {
                const now = Date.now();
                const isIdle = this.activeSessions.size === 0 && (now - this.lastRequestTime) > 30000;
                if (!isIdle) {
                    return;
                }
                // Only log maintenance status every 10 minutes (not every 2 minutes)
                const shouldLog = (now - this.maintenanceHistory.lastClustering) % 600000 < 120000;
                // Run clustering every 5 minutes
                if (now - this.maintenanceHistory.lastClustering > 300000) {
                    await this.runIdleClustering();
                    this.maintenanceHistory.lastClustering = now;
                }
                // Run importance decay every 10 minutes
                if (now - this.maintenanceHistory.lastDecay > 600000) {
                    await this.runImportanceDecay();
                    this.maintenanceHistory.lastDecay = now;
                }
                // Log entity indexer stats every 10 minutes (not every 2 minutes) - file only
                const indexerStats = this.entityIndexer.getStats();
                if (shouldLog) {
                    logInfo(`Idle maintenance completed (queue=${indexerStats.queueSize}, indexed=${indexerStats.totalIndexed}, frozen=${indexerStats.totalFrozen}, pruned=${indexerStats.totalPruned})`);
                }
                // Run TTL pruning every 7 days
                const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
                if (now - this.maintenanceHistory.lastTtlPruning > sevenDaysMs) {
                    await this.runTtlPruning();
                    this.maintenanceHistory.lastTtlPruning = now;
                    logInfo('TTL pruning completed');
                }
            }
            catch (error) {
                logError(`Idle maintenance failed: ${error.message}`);
            }
        }, 120000);
        // Don't block process exit - allows CLI commands to complete
        this.idleClusteringInterval.unref();
    }
    /**
     * Track session activity for idle detection.
     */
    trackSessionActivity(sessionId) {
        this.activeSessions.add(sessionId);
        this.lastRequestTime = Date.now();
    }
    /**
     * Track session end for idle detection and trigger auto-reflection.
     */
    async trackSessionEnd(sessionId) {
        this.activeSessions.delete(sessionId);
        const buffer = this.sessionBuffers.get(sessionId);
        if (buffer && buffer.length > 0) {
            await this.generateAutoReflection(sessionId, buffer);
        }
        this.sessionBuffers.delete(sessionId);
    }
    /**
     * Add conversation turn to session buffer for later reflection generation.
     */
    addToSessionBuffer(sessionId, message) {
        if (!this.sessionBuffers.has(sessionId)) {
            this.sessionBuffers.set(sessionId, []);
        }
        const buffer = this.sessionBuffers.get(sessionId);
        if (buffer) {
            buffer.push(message);
            if (buffer.length > 50) {
                buffer.shift();
            }
        }
    }
    /**
     * Generate reflection memory automatically from session conversation.
     */
    async generateAutoReflection(sessionId, messages) {
        logInfo(`[MemoryManager] Generating auto-reflection for session ${sessionId} (${messages.length} messages)`);
        const result = await this.summarizer.summarize(messages);
        if (!result.isEmpty && result.summary) {
            await this.storeReflection(result.summary, 0.85);
            logInfo(`[MemoryManager] Stored auto-reflection: "${result.summary.substring(0, 50)}..."`);
        }
        else {
            logInfo(`[MemoryManager] No significant content for reflection in session ${sessionId}`);
        }
    }
    /**
     * Run idle clustering during maintenance window.
     */
    async runIdleClustering() {
        logInfo('Running idle clustering...');
        const semanticMemories = await this.memoryStore.getSemantic(100);
        if (semanticMemories.length < 5) {
            logInfo('Not enough memories for clustering');
            return;
        }
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 120000);
        try {
            const clusteringPromise = this.clusterer.runIdleClustering(async () => semanticMemories.map(m => ({ id: m.id, content: m.content })), async (result) => {
                const mergedId = await this.memoryStore.addReflection(`Merged fact: ${result.mergedContent}`, 0.85);
                logInfo(`Stored merged memory ${mergedId} from ${result.sourceIds.length} sources: ${result.theme}`);
            }, { timeoutMs: 120000, maxMemories: 100 });
            await Promise.race([
                clusteringPromise,
                new Promise((_, reject) => {
                    controller.signal.addEventListener('abort', () => {
                        reject(new Error('[MemoryManager] Clustering timeout after 2 minutes'));
                    });
                }),
            ]);
            clearTimeout(timeoutId);
        }
        catch (error) {
            logError(`Idle clustering failed or timed out: ${error.message}`);
        }
    }
    /**
     * Run importance decay during maintenance window.
     */
    async runImportanceDecay() {
        logInfo('Running importance decay...');
        const now = Date.now();
        const halfLifeDays = 30;
        const lambda = Math.log(2) / halfLifeDays;
        const allMemories = await this.db.scroll(undefined, 100);
        let updatedCount = 0;
        for (const memory of allMemories) {
            const ageMs = now - new Date(memory.payload.created_at).getTime();
            const ageDays = ageMs / (1000 * 60 * 60 * 24);
            if (ageDays < 1) {
                continue;
            }
            const decayFactor = Math.exp(-lambda * ageDays);
            const oldImportance = memory.payload.importance || 0.5;
            const newImportance = oldImportance * decayFactor;
            if (Math.abs(oldImportance - newImportance) > 0.05) {
                await this.db.updatePayload(memory.id, {
                    importance: Math.max(newImportance, 0.1),
                    updated_at: new Date().toISOString(),
                });
                updatedCount++;
            }
        }
        logInfo(`Decay applied: ${updatedCount}/${allMemories.length} memories updated`);
    }
    /**
     * Run TTL pruning - remove entities not accessed in TTL_DAYS.
     * Called weekly during idle maintenance.
     */
    async runTtlPruning() {
        logInfo('Running TTL pruning...');
        const prunedCount = await this.entityIndexer.runTTLPruning();
        logInfo(`TTL pruning completed: ${prunedCount} entities pruned`);
    }
    /**
     * Retrieve memories relevant to a query using HybridRetriever.
     * Combines vector search + graph traversal + reranking.
     */
    async retrieveRelevant(query, sessionId, topK = 5, threshold = 0.6, enableFunnelStats = true) {
        const funnel = {
            initialCount: 0,
            afterTimeDecay: 0,
            afterRerank: 0,
            afterThreshold: 0,
            afterImportance: 0,
            finalCount: 0,
            avgSimilarity: 0,
            avgImportance: 0,
            typeDistribution: {},
        };
        // Use HybridRetriever for vector + graph hybrid search
        const hybridResult = await this.hybridRetriever.retrieve(query, sessionId, topK, threshold);
        funnel.initialCount = hybridResult.stats.vectorCount + hybridResult.stats.graphCount;
        funnel.afterRerank = hybridResult.stats.mergedCount;
        funnel.afterThreshold = hybridResult.stats.finalCount;
        funnel.finalCount = hybridResult.stats.finalCount;
        funnel.avgSimilarity = hybridResult.stats.avgSimilarity;
        // Convert MemoryResult to MemoryWithSimilarity format
        const results = hybridResult.results.map(r => ({
            id: r.id,
            content: r.content,
            type: r.type,
            similarity: r.score ?? r.similarity ?? 0,
            score: r.score ?? r.similarity ?? 0,
            importance: r.importance ?? 0.5,
            created_at: r.created_at ?? new Date(),
            access_count: r.access_count ?? 0,
            cluster_id: r.cluster_id,
        }));
        // Increment access counts for retrieved memories
        for (const mem of results) {
            await this.memoryStore.incrementAccess(mem.id, mem.type);
        }
        if (enableFunnelStats && hybridResult.stats.mergedCount > 0) {
            logInfo(`[MemoryManager] Hybrid Funnel: ${funnel.initialCount} (vector:${hybridResult.stats.vectorCount} + graph:${hybridResult.stats.graphCount}) → ${funnel.afterRerank} merged → ${funnel.finalCount} final`);
            logInfo(`[MemoryManager] Avg similarity: ${funnel.avgSimilarity.toFixed(2)}`);
        }
        return results;
    }
    /**
     * Store memory asynchronously.
     */
    async storeMemory(sessionId, content, importance = 0.5) {
        this.memoryStore.enqueueStorage(async () => {
            await this.memoryStore.storeEpisodic(sessionId, content, importance);
        });
    }
    /**
     * Store semantic memory asynchronously.
     */
    async storeSemantic(content, importance = 0.7, sessionId) {
        this.memoryStore.enqueueStorage(async () => {
            await this.memoryStore.storeSemantic(content, importance, sessionId);
        });
    }
    /**
     * Store semantic memory with conflict detection.
     */
    async storeSemanticWithConflictCheck(content, importance = 0.7, similarityThreshold = 0.85, sessionId) {
        const embedding = await this.embedding.embed(content);
        const similar = await this.memoryStore.search(embedding, 5, similarityThreshold);
        if (similar.length > 0) {
            const conflictResult = await this.conflictDetector.detectConflict(content, similar.map(m => ({ id: m.id, content: m.content, type: m.type })), async (memoryId, metadata) => {
                await this.memoryStore.markAsSuperseded(memoryId, metadata);
            });
            if (conflictResult.isConflict) {
                logInfo(`[Memory] Conflict detected: "${content.substring(0, 50)}..." supersedes memory ${conflictResult.oldMemoryId}`);
                this.memoryStore.enqueueStorage(async () => {
                    await this.memoryStore.storeSemantic(content, importance, sessionId);
                });
                return {
                    stored: true,
                    conflictDetected: true,
                    supersededId: conflictResult.oldMemoryId,
                };
            }
        }
        this.memoryStore.enqueueStorage(async () => {
            await this.memoryStore.storeSemantic(content, importance, sessionId);
        });
        return { stored: true, conflictDetected: false };
    }
    /**
     * Store reflection memory.
     */
    async storeReflection(summary, importance = 0.9, sessionId) {
        return this.memoryStore.addReflection(summary, importance, sessionId);
    }
    /**
     * Get memory statistics.
     */
    async getStats() {
        return this.memoryStore.getStats();
    }
    /**
     * Build context string for LLM.
     */
    buildContext(sessionId, memories, recentConversation) {
        const reflectionMemories = memories.filter(m => m.type === 'reflection');
        return this.contextBuilder.buildContext(sessionId, memories, reflectionMemories, recentConversation);
    }
    /**
     * Close the memory manager.
     */
    async close() {
        if (this.idleClusteringInterval) {
            clearInterval(this.idleClusteringInterval);
        }
        await this.db.close();
    }
}
//# sourceMappingURL=memory-manager-surreal.js.map
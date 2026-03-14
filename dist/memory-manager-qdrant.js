/**
 * Memory Manager - orchestrates all memory operations using Qdrant.
 */
import { QdrantDatabase } from './qdrant-client.js';
import { EmbeddingService } from './embedding.js';
import { MemoryStore } from './memory-store-qdrant.js';
import { ContextBuilder } from './context-builder.js';
import { Reranker } from './reranker.js';
import { ConflictDetector } from './conflict-detector.js';
import { LLMLimiter } from './llm-limiter.js';
export class MemoryManager {
    db;
    embedding;
    memoryStore;
    contextBuilder;
    reranker;
    conflictDetector;
    limiter;
    constructor(config) {
        this.db = new QdrantDatabase(config.qdrant);
        this.embedding = new EmbeddingService(config.embedding?.endpoint ?? 'http://localhost:8080');
        this.memoryStore = new MemoryStore(this.db, this.embedding);
        this.contextBuilder = new ContextBuilder();
        // Create shared LLM limiter for rate control
        const llamaEndpoint = config.embedding?.endpoint?.replace('8080', '8081') ?? 'http://localhost:8081';
        this.limiter = new LLMLimiter({ maxConcurrent: 2, minInterval: 100, queueLimit: 50 });
        this.reranker = new Reranker(llamaEndpoint, this.limiter);
        this.conflictDetector = new ConflictDetector(llamaEndpoint, this.limiter);
    }
    /**
     * Initialize the memory manager (connect to Qdrant).
     * @returns Migration result
     */
    async initialize() {
        const result = await this.db.initialize();
        console.log('[MemoryManager] Initialized with Qdrant');
        return result;
    }
    /**
     * Retrieve memories relevant to a query.
     * Uses vector search + reranking + recency boost.
     */
    async retrieveRelevant(query, topK = 10, threshold = 0.6) {
        // Generate embedding for query
        const embedding = await this.embedding.embed(query);
        // Search all memories including reflections
        const searchResults = await this.memoryStore.search(embedding, topK * 2, threshold);
        // Apply recency boost (memories from last 3 days get +0.1 score)
        const now = Date.now();
        const threeDaysMs = 3 * 24 * 60 * 60 * 1000;
        for (const mem of searchResults) {
            const memoryTime = mem.created_at?.getTime() || 0;
            if (now - memoryTime < threeDaysMs) {
                // Boost recent memories
                mem.similarity = (mem.similarity ?? 0.5) + 0.1;
            }
        }
        // Rerank results using 1B model (take top 10 for reranking)
        const reranked = await this.reranker.rerank(query, searchResults);
        // Increment access count for ALL retrieved memories (including reflection)
        for (const mem of reranked) {
            await this.memoryStore.incrementAccess(mem.id, mem.type);
        }
        // Sort by combined score (similarity × importance)
        reranked.sort((a, b) => {
            const scoreA = (a.similarity ?? a.score) * (a.importance ?? 0.5);
            const scoreB = (b.similarity ?? b.score) * (b.importance ?? 0.5);
            return scoreB - scoreA;
        });
        // Apply threshold and limit
        return reranked
            .filter(r => (r.similarity ?? r.score) >= threshold)
            .slice(0, 5);
    }
    /**
     * Build context string for LLM.
     */
    buildContext(sessionId, memories, recentConversation) {
        const reflectionMemories = memories.filter(m => m.type === 'reflection');
        return this.contextBuilder.buildContext(sessionId, memories, reflectionMemories, recentConversation);
    }
    /**
     * Store memory asynchronously (non-blocking).
     * Uses internal queue to avoid blocking the conversation flow.
     */
    async storeMemory(sessionId, content, importance = 0.5) {
        // Add to async queue - returns immediately
        this.memoryStore.enqueueStorage(async () => {
            await this.memoryStore.storeEpisodic(sessionId, content, importance);
        });
    }
    /**
     * Store semantic memory asynchronously (non-blocking).
     */
    async storeSemantic(content, importance = 0.7) {
        this.memoryStore.enqueueStorage(async () => {
            await this.memoryStore.storeSemantic(content, importance);
        });
    }
    /**
     * Store semantic memory with conflict detection.
     * Marks conflicting memories as superseded (not deleted).
     */
    async storeSemanticWithConflictCheck(content, importance = 0.7, similarityThreshold = 0.85) {
        // Search for similar memories
        const embedding = await this.embedding.embed(content);
        const similar = await this.memoryStore.search(embedding, 5, similarityThreshold);
        if (similar.length > 0) {
            // Check for conflicts
            const conflictResult = await this.conflictDetector.detectConflict(content, similar.map(m => ({ id: m.id, content: m.content, type: m.type })), async (memoryId, metadata) => {
                // Mark old memory as superseded
                await this.memoryStore.markAsSuperseded(memoryId, metadata);
            });
            if (conflictResult.isConflict) {
                console.log(`[Memory] Conflict detected: "${content.substring(0, 50)}..." supersedes memory ${conflictResult.oldMemoryId}`);
                // Still store the new memory, but mark the old one as superseded
                this.memoryStore.enqueueStorage(async () => {
                    await this.memoryStore.storeSemantic(content, importance);
                });
                return {
                    stored: true,
                    conflictDetected: true,
                    supersededId: conflictResult.oldMemoryId,
                };
            }
        }
        // No conflict, store normally
        this.memoryStore.enqueueStorage(async () => {
            await this.memoryStore.storeSemantic(content, importance);
        });
        return { stored: true, conflictDetected: false };
    }
    /**
     * Store reflection memory.
     */
    async storeReflection(summary, importance = 0.9) {
        return this.memoryStore.addReflection(summary, importance);
    }
    /**
     * Get memory statistics.
     */
    async getStats() {
        return this.memoryStore.getStats();
    }
    /**
     * Shutdown and cleanup resources.
     */
    async shutdown() {
        console.log('[MemoryManager] Shutting down');
    }
}
//# sourceMappingURL=memory-manager-qdrant.js.map
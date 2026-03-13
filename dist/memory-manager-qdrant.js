/**
 * Memory Manager - orchestrates all memory operations using Qdrant.
 */
import { QdrantDatabase } from './qdrant-client.js';
import { EmbeddingService } from './embedding.js';
import { MemoryStore } from './memory-store-qdrant.js';
import { ContextBuilder } from './context-builder.js';
export class MemoryManager {
    db;
    embedding;
    memoryStore;
    contextBuilder;
    constructor(config) {
        this.db = new QdrantDatabase(config.qdrant);
        this.embedding = new EmbeddingService(config.embedding?.endpoint ?? 'http://localhost:8080');
        this.memoryStore = new MemoryStore(this.db, this.embedding);
        this.contextBuilder = new ContextBuilder();
    }
    /**
     * Initialize the memory manager (connect to Qdrant).
     */
    async initialize() {
        await this.db.initialize();
        console.log('[MemoryManager] Initialized with Qdrant');
    }
    /**
     * Retrieve memories relevant to a query.
     */
    async retrieveRelevant(query, topK = 10, threshold = 0.6) {
        // Generate embedding for query
        const embedding = await this.embedding.embed(query);
        // Search all memories (no type filter)
        const searchResults = await this.memoryStore.search(embedding, topK, threshold);
        // Get reflection memories (highest priority)
        const reflectionMemories = await this.memoryStore.getReflection(5);
        // Combine results
        const results = [];
        // Add reflection memories first (highest importance)
        for (const ref of reflectionMemories) {
            results.push({
                id: ref.id,
                type: 'reflection',
                content: ref.summary,
                importance: ref.importance,
                similarity: 1.0,
                created_at: ref.created_at,
                access_count: ref.access_count,
            });
        }
        // Add search results
        for (const m of searchResults) {
            results.push(m);
        }
        // Sort by combined score (similarity × importance)
        results.sort((a, b) => (b.similarity * b.importance) - (a.similarity * a.importance));
        // Filter by threshold and limit
        return results
            .filter(r => r.similarity >= threshold)
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
     */
    async storeMemory(sessionId, content, importance = 0.5) {
        // Fire and forget
        this.memoryStore.storeEpisodic(sessionId, content, importance).catch(err => {
            console.error('[MemoryManager] Failed to store memory:', err);
        });
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
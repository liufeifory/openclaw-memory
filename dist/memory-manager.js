/**
 * Memory Manager - orchestrates all memory operations.
 */
import { Database } from './database.js';
import { EmbeddingService } from './embedding.js';
import { MemoryStore } from './memory-store.js';
import { ContextBuilder } from './context-builder.js';
export class MemoryManager {
    db;
    embedding;
    memoryStore;
    contextBuilder;
    constructor(config) {
        this.db = new Database(config.database);
        this.embedding = new EmbeddingService(config.embedding?.endpoint ?? 'http://localhost:8080');
        this.memoryStore = new MemoryStore(this.db, this.embedding);
        this.contextBuilder = new ContextBuilder();
    }
    /**
     * Retrieve memories relevant to a query.
     * @param query - The search query
     * @param sessionId - Optional session ID for session isolation (PG backend only)
     * @param topK - Maximum number of results to return
     * @param threshold - Minimum similarity threshold
     */
    async retrieveRelevant(query, sessionId, topK = 10, threshold = 0.6) {
        // Generate embedding for query
        const embedding = await this.embedding.embed(query);
        // Search episodic memories (optionally filtered by session)
        const episodicResults = await this.memoryStore.searchEpisodic(embedding, topK, threshold, sessionId);
        // Get semantic memories
        const semanticMemories = await this.memoryStore.getSemantic(20);
        // Get reflection memories
        const reflectionMemories = await this.memoryStore.getReflection(5);
        // Combine results with type markers
        const results = [];
        // Add reflection memories (with vector similarity)
        for (const ref of reflectionMemories) {
            results.push({
                id: ref.id,
                type: 'reflection',
                content: ref.summary,
                importance: ref.importance,
                similarity: 0.85, // High base similarity for reflections
                created_at: ref.created_at,
                access_count: ref.access_count,
            });
        }
        // Add episodic results
        for (const ep of episodicResults) {
            results.push(ep);
        }
        // Add semantic memories
        for (const sem of semanticMemories) {
            results.push({
                id: sem.id,
                type: 'semantic',
                content: sem.content,
                importance: sem.importance,
                similarity: 0.8,
                created_at: sem.created_at,
                access_count: sem.access_count,
            });
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
        // Fire and forget - don't await
        this.memoryStore.storeEpisodic(sessionId, content, importance).catch(err => {
            console.error('Failed to store memory:', err);
        });
    }
    /**
     * Store semantic memory asynchronously (non-blocking).
     */
    async storeSemantic(content, importance = 0.7) {
        // Fire and forget - don't await
        this.memoryStore.storeSemantic(content, importance).catch(err => {
            console.error('Failed to store semantic memory:', err);
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
        await this.db.close();
    }
}
//# sourceMappingURL=memory-manager.js.map
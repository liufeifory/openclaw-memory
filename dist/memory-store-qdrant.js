/**
 * Memory store using Qdrant vector database.
 */
import { MemoryType } from './qdrant-client.js';
export class MemoryStore {
    db;
    embedding;
    // In-memory stores for non-vector data
    episodicMemories = new Map();
    semanticMemories = new Map();
    reflectionMemories = new Map();
    idCounter = 0;
    constructor(db, embedding) {
        this.db = db;
        this.embedding = embedding;
    }
    /**
     * Store episodic memory with embedding.
     */
    async storeEpisodic(sessionId, content, importance = 0.5) {
        const memoryId = ++this.idCounter;
        // Generate embedding
        const embedding = await this.embedding.embed(content);
        // Store in Qdrant
        await this.db.upsert(memoryId, embedding, {
            type: MemoryType.EPISODIC,
            session_id: sessionId,
            content: content,
            importance: importance,
            access_count: 0,
            created_at: new Date().toISOString(),
        });
        // Store in memory
        this.episodicMemories.set(memoryId, {
            id: memoryId,
            session_id: sessionId,
            content,
            importance,
            access_count: 0,
            created_at: new Date(),
        });
        return memoryId;
    }
    /**
     * Store semantic memory with embedding.
     */
    async storeSemantic(content, importance = 0.7) {
        const memoryId = ++this.idCounter;
        const embedding = await this.embedding.embed(content);
        await this.db.upsert(memoryId, embedding, {
            type: MemoryType.SEMANTIC,
            content: content,
            importance: importance,
            access_count: 0,
            created_at: new Date().toISOString(),
        });
        this.semanticMemories.set(memoryId, {
            id: memoryId,
            content,
            importance,
            access_count: 0,
            created_at: new Date(),
        });
        return memoryId;
    }
    /**
     * Search memories by vector similarity.
     */
    async search(embedding, topK = 10, threshold = 0.6, memoryType) {
        const filter = memoryType ? { type: memoryType } : undefined;
        const results = await this.db.search(embedding, topK, filter);
        return results
            .map(r => ({
            id: r.id,
            content: r.payload.content,
            importance: r.payload.importance,
            similarity: r.score,
            type: r.payload.memory_type,
            created_at: new Date(r.payload.created_at),
            access_count: r.payload.access_count || 0,
            session_id: r.payload.session_id,
        }))
            .filter(m => m.similarity > threshold);
    }
    /**
     * Get all semantic memories.
     */
    async getSemantic(limit = 20) {
        const results = Array.from(this.semanticMemories.values())
            .sort((a, b) => b.importance - a.importance)
            .slice(0, limit);
        return results;
    }
    /**
     * Get all reflection memories.
     */
    async getReflection(limit = 5) {
        const results = Array.from(this.reflectionMemories.values())
            .sort((a, b) => b.importance - a.importance)
            .slice(0, limit);
        return results;
    }
    /**
     * Add reflection memory (in-memory only, also stored in Qdrant).
     */
    async addReflection(summary, importance = 0.9) {
        const memoryId = ++this.idCounter;
        const embedding = await this.embedding.embed(summary);
        await this.db.upsert(memoryId, embedding, {
            type: MemoryType.REFLECTION,
            summary: summary,
            importance: importance,
            access_count: 0,
            created_at: new Date().toISOString(),
        });
        const reflection = {
            id: memoryId,
            summary,
            importance,
            access_count: 0,
            created_at: new Date(),
        };
        this.reflectionMemories.set(memoryId, reflection);
        return memoryId;
    }
    /**
     * Increment access count for a memory.
     */
    async incrementAccess(memoryId, type) {
        if (type === 'episodic') {
            const memory = this.episodicMemories.get(memoryId);
            if (memory) {
                memory.access_count++;
                this.episodicMemories.set(memoryId, memory);
            }
        }
        else {
            const memory = this.semanticMemories.get(memoryId);
            if (memory) {
                memory.access_count++;
                this.semanticMemories.set(memoryId, memory);
            }
        }
    }
    /**
     * Get memory statistics.
     */
    async getStats() {
        const qdrantCount = await this.db.count();
        return {
            episodic_count: this.episodicMemories.size,
            semantic_count: this.semanticMemories.size,
            reflection_count: this.reflectionMemories.size,
            total_count: qdrantCount,
        };
    }
}
//# sourceMappingURL=memory-store-qdrant.js.map
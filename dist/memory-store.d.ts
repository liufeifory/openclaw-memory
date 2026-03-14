/**
 * Memory store for episodic, semantic, and reflection memories.
 */
import { Database } from './database.js';
import { EmbeddingService } from './embedding.js';
import type { SemanticMemory, ReflectionMemory, MemoryWithSimilarity } from './memory-types.js';
export declare class MemoryStore {
    private db;
    private embedding;
    constructor(db: Database, embedding: EmbeddingService);
    /**
     * Store episodic memory with embedding.
     */
    storeEpisodic(sessionId: string, content: string, importance?: number): Promise<number>;
    /**
     * Store semantic memory with embedding.
     */
    storeSemantic(content: string, importance?: number): Promise<number>;
    /**
     * Search episodic memories by vector similarity.
     */
    searchEpisodic(embedding: number[], topK?: number, threshold?: number): Promise<MemoryWithSimilarity[]>;
    /**
     * Get all semantic memories.
     */
    getSemantic(limit?: number): Promise<SemanticMemory[]>;
    /**
     * Get all reflection memories.
     */
    getReflection(limit?: number): Promise<ReflectionMemory[]>;
    /**
     * Add reflection memory.
     */
    addReflection(summary: string, importance?: number): Promise<number>;
    /**
     * Increment access count for a memory.
     */
    incrementAccess(memoryId: number, type: 'episodic' | 'semantic' | 'reflection'): Promise<void>;
    /**
     * Get memory statistics.
     */
    getStats(): Promise<{
        episodic_count: number;
        semantic_count: number;
        reflection_count: number;
        embedding_count: number;
    }>;
}
//# sourceMappingURL=memory-store.d.ts.map
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
     * @param sessionId - Optional session ID for session isolation
     */
    searchEpisodic(embedding: number[], topK?: number, threshold?: number, sessionId?: string): Promise<MemoryWithSimilarity[]>;
    /**
     * Get all semantic memories.
     * @param limit - Maximum number of results
     * @param sessionId - Optional session ID for session isolation (not applicable for semantic memories in PostgreSQL)
     */
    getSemantic(limit?: number, sessionId?: string): Promise<SemanticMemory[]>;
    /**
     * Get all reflection memories.
     * @param limit - Maximum number of results
     * @param sessionId - Optional session ID for session isolation (not applicable for reflection memories in PostgreSQL)
     */
    getReflection(limit?: number, sessionId?: string): Promise<ReflectionMemory[]>;
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
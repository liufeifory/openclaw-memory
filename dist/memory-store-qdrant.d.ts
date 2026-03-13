/**
 * Memory store using Qdrant vector database.
 */
import { QdrantDatabase } from './qdrant-client.js';
import { EmbeddingService } from './embedding.js';
export interface Memory {
    id: number;
    content: string;
    importance: number;
    created_at: Date;
    access_count: number;
}
export interface MemoryWithSimilarity extends Memory {
    similarity: number;
    type: 'episodic' | 'semantic' | 'reflection';
}
export interface EpisodicMemory extends Memory {
    session_id: string;
}
export interface SemanticMemory extends Memory {
    summary?: string;
}
export interface ReflectionMemory {
    id: number;
    summary: string;
    importance: number;
    created_at: Date;
    access_count: number;
    content?: string;
}
export declare class MemoryStore {
    private db;
    private embedding;
    private episodicMemories;
    private semanticMemories;
    private reflectionMemories;
    private idCounter;
    constructor(db: QdrantDatabase, embedding: EmbeddingService);
    /**
     * Store episodic memory with embedding.
     */
    storeEpisodic(sessionId: string, content: string, importance?: number): Promise<number>;
    /**
     * Store semantic memory with embedding.
     */
    storeSemantic(content: string, importance?: number): Promise<number>;
    /**
     * Search memories by vector similarity.
     */
    search(embedding: number[], topK?: number, threshold?: number, memoryType?: string): Promise<MemoryWithSimilarity[]>;
    /**
     * Get all semantic memories.
     */
    getSemantic(limit?: number): Promise<SemanticMemory[]>;
    /**
     * Get all reflection memories.
     */
    getReflection(limit?: number): Promise<ReflectionMemory[]>;
    /**
     * Add reflection memory (in-memory only, also stored in Qdrant).
     */
    addReflection(summary: string, importance?: number): Promise<number>;
    /**
     * Increment access count for a memory.
     */
    incrementAccess(memoryId: number, type: 'episodic' | 'semantic'): Promise<void>;
    /**
     * Get memory statistics.
     */
    getStats(): Promise<{
        episodic_count: number;
        semantic_count: number;
        reflection_count: number;
        total_count: number;
    }>;
}
//# sourceMappingURL=memory-store-qdrant.d.ts.map
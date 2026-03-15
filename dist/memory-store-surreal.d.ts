/**
 * Memory store using SurrealDB.
 */
import { SurrealDatabase } from './surrealdb-client.js';
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
    session_id?: string;
    is_active?: boolean;
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
export interface DedupeCheckResult {
    isDuplicate: boolean;
    similarMemoryId?: number;
    similarity: number;
}
export declare class MemoryStore {
    private db;
    private embedding;
    private episodicMemories;
    private semanticMemories;
    private reflectionMemories;
    private idCounter;
    constructor(db: SurrealDatabase, embedding: EmbeddingService);
    /**
     * Store episodic memory with embedding.
     * Checks for near-duplicate content within the same session.
     */
    storeEpisodic(sessionId: string, content: string, importance?: number): Promise<number>;
    /**
     * Check if content is a near-duplicate within the same session.
     */
    private checkDuplicateInSession;
    /**
     * Store semantic memory with embedding.
     */
    storeSemantic(content: string, importance?: number, sessionId?: string): Promise<number>;
    /**
     * Check if content is a near-duplicate of existing memory.
     */
    private checkDuplicate;
    /**
     * Search memories by vector similarity.
     */
    search(embedding: number[], topK?: number, threshold?: number, memoryType?: string, includeSuperseded?: boolean, sessionId?: string): Promise<MemoryWithSimilarity[]>;
    /**
     * Get semantic memories with optional session filtering.
     */
    getSemantic(limit?: number, sessionId?: string): Promise<SemanticMemory[]>;
    /**
     * Get reflection memories with optional session filtering.
     */
    getReflection(limit?: number, sessionId?: string): Promise<ReflectionMemory[]>;
    /**
     * Add reflection memory.
     */
    addReflection(summary: string, importance?: number, sessionId?: string): Promise<number>;
    /**
     * Increment access count for a memory.
     */
    incrementAccess(memoryId: number, type: 'episodic' | 'semantic' | 'reflection'): Promise<void>;
    /**
     * Mark a memory as superseded.
     */
    markAsSuperseded(memoryId: number, metadata: {
        superseded_by?: number;
        is_active?: boolean;
    }): Promise<void>;
    /**
     * Get memory statistics.
     */
    getStats(): Promise<{
        episodic_count: number;
        semantic_count: number;
        reflection_count: number;
        total_count: number;
    }>;
    /**
     * Enqueue storage operation for async processing.
     */
    enqueueStorage(operation: () => Promise<void>): void;
}
//# sourceMappingURL=memory-store-surreal.d.ts.map
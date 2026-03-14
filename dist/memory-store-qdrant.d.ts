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
    private storageQueue;
    private processingQueue;
    constructor(db: QdrantDatabase, embedding: EmbeddingService);
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
     * Checks for near-duplicate content before storing.
     */
    storeSemantic(content: string, importance?: number): Promise<number>;
    /**
     * Check if content is a near-duplicate of existing memory.
     * Uses vector similarity with high threshold (0.95).
     */
    private checkDuplicate;
    /**
     * Search memories by vector similarity.
     * Filters out superseded memories by default.
     * @param sessionId - Optional session ID for session isolation
     */
    search(embedding: number[], topK?: number, threshold?: number, memoryType?: string, includeSuperseded?: boolean, sessionId?: string): Promise<MemoryWithSimilarity[]>;
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
     * Increment access count for a memory (also updates Qdrant payload).
     */
    incrementAccess(memoryId: number, type: 'episodic' | 'semantic' | 'reflection'): Promise<void>;
    /**
     * Mark a memory as superseded (replaced by a newer memory).
     * Does not delete - just adds metadata tags for retrieval filtering.
     */
    markAsSuperseded(memoryId: number, metadata: {
        superseded_by?: number;
        is_active?: boolean;
    }): Promise<void>;
    /**
     * Get payload for a memory from Qdrant.
     */
    private getPayload;
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
     * Add a storage task to the async queue.
     * Returns immediately without waiting for completion.
     */
    enqueueStorage(task: () => Promise<void>): void;
    /**
     * Process the storage queue asynchronously with retry support.
     */
    private processStorageQueue;
    /**
     * Execute a task with retry support (max 3 attempts).
     */
    private executeWithRetry;
    /**
     * Get current queue length.
     */
    getQueueLength(): number;
}
//# sourceMappingURL=memory-store-qdrant.d.ts.map
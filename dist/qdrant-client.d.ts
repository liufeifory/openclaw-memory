/**
 * Qdrant Client wrapper
 */
export interface QdrantConfig {
    url: string;
    port?: number;
    apiKey?: string;
}
export interface MigrationResult {
    success: boolean;
    migrated: boolean;
    changes: string[];
}
export declare class QdrantDatabase {
    private client;
    private initialized;
    private readonly maxRetries;
    private readonly baseDelayMs;
    constructor(config: QdrantConfig);
    initialize(): Promise<MigrationResult>;
    /**
     * Execute an async operation with retry support.
     * Uses exponential backoff: 1s, 2s, 4s...
     */
    private executeWithRetry;
    upsert(id: number, embedding: number[], payload: Record<string, any>, options?: {
        checkVersion?: boolean;
    }): Promise<{
        success: boolean;
        reason?: string;
    }>;
    /**
     * Search using BM25 (keyword-based full-text search).
     */
    searchBM25(query: string, limit?: number, filter?: Record<string, any>): Promise<Array<{
        id: number;
        score: number;
        payload: Record<string, any>;
    }>>;
    /**
     * Hybrid search: combine BM25 and vector search with reciprocal rank fusion.
     */
    searchHybrid(query: string, embedding: number[], limit?: number, filter?: Record<string, any>, bm25Weight?: number): Promise<Array<{
        id: number;
        score: number;
        payload: Record<string, any>;
        bm25Score?: number;
        vectorScore?: number;
    }>>;
    /**
     * Build sparse vector from tokens for BM25.
     */
    private buildSparseVector;
    /**
     * Simple hash function for tokens.
     */
    private hashToken;
    /**
     * Search using vector similarity.
     */
    search(embedding: number[], limit?: number, filter?: Record<string, any>): Promise<Array<{
        id: number;
        score: number;
        payload: Record<string, any>;
    }>>;
    /**
     * Get a single memory by ID.
     */
    get(id: number): Promise<{
        id: number;
        payload: Record<string, any>;
    } | null>;
    /**
     * Update payload for an existing memory.
     * Preserves existing fields that are not in the new payload.
     * @param id - Memory ID
     * @param payload - New payload fields to merge
     * @param options.checkVersion - If true, only update if existing version is older
     */
    updatePayload(id: number, payload: Record<string, any>, options?: {
        checkVersion?: boolean;
    }): Promise<{
        success: boolean;
        reason?: string;
    }>;
    /**
     * Scroll through memories with optional filter.
     * Use limit: 100 for each batch, use offset for pagination.
     */
    scroll(filter?: Record<string, any>, limit?: number, offset?: number): Promise<Array<{
        id: number;
        payload: Record<string, any>;
    }>>;
    private buildFilter;
    delete(id: number): Promise<void>;
    /**
     * Hierarchical search: Reflection -> Semantic -> Episodic.
     * Returns memories organized by hierarchy level.
     */
    searchHierarchical(embedding: number[], filter?: Record<string, any>, reflectionLimit?: number, semanticLimit?: number, episodicLimit?: number): Promise<{
        reflections: Array<{
            id: number;
            score: number;
            payload: Record<string, any>;
        }>;
        semantics: Array<{
            id: number;
            score: number;
            payload: Record<string, any>;
        }>;
        episodic: Array<{
            id: number;
            score: number;
            payload: Record<string, any>;
        }>;
    }>;
    count(): Promise<number>;
    getStats(): Promise<{
        total_points: number;
        collection_name: string;
    }>;
    /**
     * Get current schema version.
     */
    getSchemaVersion(): Promise<number>;
    /**
     * Store schema version metadata.
     */
    storeSchemaVersion(): Promise<void>;
    /**
     * Check if collection exists.
     */
    collectionExists(): Promise<boolean>;
    /**
     * Check if payload index exists.
     */
    indexExists(fieldName: string): Promise<boolean>;
    /**
     * Create payload index.
     */
    createPayloadIndex(fieldName: string): Promise<void>;
}
export declare const MemoryType: {
    readonly EPISODIC: "episodic";
    readonly SEMANTIC: "semantic";
    readonly REFLECTION: "reflection";
};
//# sourceMappingURL=qdrant-client.d.ts.map
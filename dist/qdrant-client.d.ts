/**
 * Qdrant Client wrapper
 */
export interface QdrantConfig {
    url: string;
    port?: number;
    apiKey?: string;
}
export declare class QdrantDatabase {
    private client;
    private initialized;
    constructor(config: QdrantConfig);
    initialize(): Promise<void>;
    upsert(id: number, embedding: number[], payload: Record<string, any>): Promise<void>;
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
     */
    updatePayload(id: number, payload: Record<string, any>): Promise<void>;
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
    count(): Promise<number>;
    getStats(): Promise<{
        total_points: number;
        collection_name: string;
    }>;
}
export declare const MemoryType: {
    readonly EPISODIC: "episodic";
    readonly SEMANTIC: "semantic";
    readonly REFLECTION: "reflection";
};
//# sourceMappingURL=qdrant-client.d.ts.map
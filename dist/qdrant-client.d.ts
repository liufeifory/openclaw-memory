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
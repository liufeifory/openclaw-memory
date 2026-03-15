/**
 * SurrealDB Client wrapper - SurrealDB 2.x compatible
 */
export interface SurrealConfig {
    url: string;
    namespace: string;
    database: string;
    username: string;
    password: string;
}
export declare const GRAPH_PROTECTION: {
    MIN_MENTION_COUNT: number;
    MAX_MEMORY_LINKS: number;
    TTL_DAYS: number;
    PRUNE_INTERVAL_DAYS: number;
};
export interface MigrationResult {
    success: boolean;
    migrated: boolean;
    changes: string[];
}
export declare const MemoryType: {
    readonly EPISODIC: "episodic";
    readonly SEMANTIC: "semantic";
    readonly REFLECTION: "reflection";
};
export declare class SurrealDatabase {
    private client;
    private initialized;
    private config;
    private readonly maxRetries;
    private readonly baseDelayMs;
    constructor(config: SurrealConfig);
    initialize(): Promise<MigrationResult>;
    private createSchema;
    query(sql: string): Promise<any>;
    private executeWithRetry;
    upsert(id: number, embedding: number[], payload: Record<string, any>, options?: {
        checkVersion?: boolean;
    }): Promise<{
        success: boolean;
        reason?: string;
    }>;
    search(embedding: number[], limit?: number, filter?: Record<string, any>): Promise<Array<{
        id: number;
        score: number;
        payload: Record<string, any>;
    }>>;
    searchHybrid(query: string, embedding: number[], limit?: number, filter?: Record<string, any>, bm25Weight?: number): Promise<Array<{
        id: number;
        score: number;
        payload: Record<string, any>;
    }>>;
    get(id: number): Promise<{
        id: number;
        payload: Record<string, any>;
    } | null>;
    updatePayload(id: number, payload: Record<string, any>, options?: {
        checkVersion?: boolean;
    }): Promise<{
        success: boolean;
        reason?: string;
    }>;
    scroll(filter?: Record<string, any>, limit?: number, offset?: number): Promise<Array<{
        id: number;
        payload: Record<string, any>;
    }>>;
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
    private queryType;
    deleteMemories(ids: number[]): Promise<void>;
    count(): Promise<number>;
    getStats(): Promise<{
        total_points: number;
        collection_name: string;
    }>;
    getSchemaVersion(): Promise<number>;
    storeSchemaVersion(): Promise<void>;
    private extractIdFromRecord;
    private toPayload;
    close(): Promise<void>;
}
//# sourceMappingURL=surrealdb-client.d.ts.map
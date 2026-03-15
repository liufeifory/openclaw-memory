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
export interface EntityStats {
    total_entities: number;
    by_type: Record<string, number>;
    total_links: number;
}
export interface LinkedMemory {
    id: number;
    content?: string;
    type?: string;
    similarity?: number;
    weight?: number;
    created_at?: string;
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
    /**
     * 1. upsertEntity - Create or get entity (ON DUPLICATE KEY UPDATE mode)
     * Returns entity ID
     */
    upsertEntity(name: string, type: string): Promise<number>;
    /**
     * 2. linkMemoryEntity - Create memory-entity edge
     * Includes Super Node frozen check
     */
    linkMemoryEntity(memoryId: number, entityId: number, relevanceScore: number): Promise<void>;
    /**
     * 3. searchByEntity - Retrieve memories associated with an entity (graph traversal)
     */
    searchByEntity(entityId: number, limit?: number): Promise<Array<LinkedMemory>>;
    /**
     * 4. searchByAssociation - Second-degree association search
     * Find memories related to a seed memory through shared entities
     */
    searchByAssociation(seedMemoryId: number, limit?: number): Promise<Array<LinkedMemory>>;
    /**
     * 5. getEntityStats - Get entity statistics
     * Returns total entities, count by type, and total links
     */
    getEntityStats(): Promise<EntityStats>;
    close(): Promise<void>;
}
//# sourceMappingURL=surrealdb-client.d.ts.map
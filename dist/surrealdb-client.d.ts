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
declare const MEMORY_TABLE = "memory";
declare const ENTITY_TABLE = "entity";
declare const ENTITY_RELATION_TABLE = "entity_relation";
declare const DOCUMENTS_TABLE = "documents";
declare const DOCUMENT_IMPORT_STATE_TABLE = "document_import_state";
declare const TOPIC_TABLE = "topic";
declare const TOPIC_MEMORY_TABLE = "topic_memory";
declare const ENTITY_ALIAS_TABLE = "entity_alias";
declare const TOPIC_SOFT_LIMIT = 400;
declare const TOPIC_HARD_LIMIT = 500;
export { TOPIC_TABLE, TOPIC_MEMORY_TABLE, ENTITY_ALIAS_TABLE, TOPIC_SOFT_LIMIT, TOPIC_HARD_LIMIT, ENTITY_RELATION_TABLE, MEMORY_TABLE, ENTITY_TABLE, DOCUMENTS_TABLE, DOCUMENT_IMPORT_STATE_TABLE };
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
    private readonly maxDelayMs;
    constructor(config: SurrealConfig);
    /**
     * Ensure we have a valid connection to SurrealDB.
     * Reconnects if connection is lost.
     */
    private ensureConnected;
    initialize(): Promise<MigrationResult>;
    private createSchema;
    query(sql: string, params?: Record<string, any>): Promise<any>;
    /**
     * Raw query execution with automatic re-authentication on permission errors.
     * This is the low-level method that all query operations should use.
     */
    private executeQuery;
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
    private extractStringIdFromRecord;
    /**
     * Extract numeric ID from Record ID string (e.g., 'entity:123' -> 123)
     */
    private extractIdFromRecordId;
    private toPayload;
    /**
     * 1. upsertEntity - Create or get entity (ON DUPLICATE KEY UPDATE mode)
     * Returns entity ID
     */
    upsertEntity(name: string, type: string): Promise<string>;
    /**
     * 2. linkMemoryEntity - Create memory-entity edge
     * Includes Super Node frozen check and Topic creation trigger
     */
    linkMemoryEntity(memoryId: number, entityId: string | number, relevanceScore: number, topicIndexer?: any): Promise<void>;
    /**
     * 3. searchByEntity - Retrieve memories associated with an entity (graph traversal)
     */
    searchByEntity(entityId: string | number, limit?: number): Promise<Array<LinkedMemory>>;
    /**
     * 4. searchByAssociation - Second-degree association search
     * Find memories related to a seed memory through shared entities
     */
    searchByAssociation(seedMemoryId: number, limit?: number): Promise<Array<LinkedMemory>>;
    /**
     * Extract result from SurrealDB query response
     */
    private extractResult;
    /**
     * Extract string ID from various formats
     */
    private extractStringId;
    /**
     * Extract numeric ID from various formats
     */
    private extractId;
    /**
     * Get memories by entity
     */
    getMemoriesByEntity(entityId: number | string, limit?: number): Promise<LinkedMemory[]>;
    /**
     * 5. getGlobalEntityStats - Get global entity statistics
     * Returns total entities, count by type, and total links
     */
    getGlobalEntityStats(): Promise<EntityStats>;
    /**
     * 6. loadKnownEntities - Load all entities from database for caching
     * Used by EntityExtractor to populate the known entity cache
     */
    loadKnownEntities(limit?: number): Promise<Array<{
        name: string;
        confidence: number;
    }>>;
    /**
     * Upsert a topic record
     * @param name - Topic name
     * @param description - Topic description (optional)
     * @param parentEntityId - Parent entity ID (e.g., "entity:123" or 123)
     * @returns Topic ID
     */
    upsertTopic(name: string, description: string | null, parentEntityId: string | number | null): Promise<string>;
    /**
     * Get topic by ID
     * @param topicId - Topic ID
     * @returns Topic record or null
     */
    getTopicById(topicId: string): Promise<any>;
    /**
     * Get topics by parent entity ID
     * @param entityId - Entity ID (e.g., "entity:123" or 123)
     * @returns Array of topics
     */
    getTopicsByEntity(entityId: string | number): Promise<any[]>;
    /**
     * Delete a topic
     * @param topicId - Topic ID
     */
    deleteTopic(topicId: string | number): Promise<void>;
    /**
     * Link topic to memory
     * @param topicId - Topic ID
     * @param memoryId - Memory ID
     * @param relevanceScore - Relevance score (0-1)
     */
    linkTopicMemory(topicId: string, memoryId: number, relevanceScore?: number): Promise<void>;
    /**
     * Get memories linked to a topic
     * @param topicId - Topic ID
     * @param limit - Maximum number of memories to return
     * @returns Array of linked memories
     */
    getMemoriesByTopic(topicId: string, limit?: number): Promise<LinkedMemory[]>;
    /**
     * Get memory payload including embedding by memory ID
     * @param memoryId - Memory ID
     * @returns Memory payload with embedding
     */
    getMemoryPayload(memoryId: number): Promise<{
        content: string;
        embedding?: number[];
        type?: string;
    } | null>;
    close(): Promise<void>;
    /**
     * Add an alias for an entity
     * @param alias - The alias name
     * @param entityId - Entity ID (e.g., "entity:123" or 123)
     * @param verified - Whether the alias is verified
     * @param source - Source of the alias ('manual', 'llm', 'user', 'merged')
     * @param createdBy - Creator identifier (optional)
     */
    addAlias(alias: string, entityId: string | number, verified?: boolean, source?: string, createdBy?: string): Promise<void>;
    /**
     * Resolve an alias to its canonical entity ID (with cycle detection and path flattening)
     * User feedback: prevent infinite loops from circular aliases
     * @param alias - The alias to resolve
     * @param visited - Set of visited aliases for cycle detection (internal use)
     * @returns Canonical entity ID or null
     */
    resolveAlias(alias: string, visited?: Set<string>): Promise<string | null>;
    /**
     * Get all aliases for an entity
     * @param entityId - Entity ID
     * @returns Array of alias names
     */
    getAliasesByEntity(entityId: string | number): Promise<string[]>;
    /**
     * Merge two entities (alias -> canonical)
     * User feedback: check threshold after merge and trigger re-clustering if needed
     * @param aliasEntityId - The entity to merge from
     * @param canonicalEntityId - The canonical entity to merge into
     * @param topicIndexer - Optional TopicIndexer for threshold checking
     */
    mergeEntities(aliasEntityId: string, canonicalEntityId: string, topicIndexer?: any): Promise<void>;
    /**
     * Freeze an entity to prevent new edges (Super Node protection)
     * @param entityId - Entity ID
     * @param reason - Reason for freezing
     */
    freezeEntity(entityId: string, reason?: string): Promise<void>;
    /**
     * Check if an entity is frozen
     * @param entityId - Entity ID
     * @returns True if frozen
     */
    isEntityFrozen(entityId: string | number): Promise<boolean>;
    /**
     * Get entity statistics
     * @param entityId - Entity ID
     * @returns Entity statistics
     */
    getEntityStats(entityId: string | number): Promise<{
        memory_count: number;
        topic_count: number;
    }>;
    /**
     * 7. buildEntityCooccurrence - Build entity-entity co-occurrence relationships
     *
     * Algorithm:
     * 1. Find all memories that have multiple entities
     * 2. For each pair of entities in the same memory, increment co-occurrence count
     * 3. Create entity_relation edges for pairs with count >= CO_OCCURRENCE_THRESHOLD
     * 4. Weight = co_occurrence_count / sqrt(entity1_total * entity2_total)
     *
     * @param batchSize - Number of memories to process in one batch (default: 1000)
     * @returns Number of entity relations created
     */
    buildEntityCooccurrence(batchSize?: number): Promise<number>;
    /**
     * 8. searchByMultiDegree - Multi-degree association search
     *
     * Find memories through entity-entity graph traversal:
     * Memory -> Entity -> Entity -> Memory
     *
     * @param seedMemoryId - The seed memory ID
     * @param degree - How many hops to traverse (default: 2 for second-degree)
     * @param maxWeight - Maximum weight threshold for pruning (default: 0.1)
     * @param limit - Maximum number of results to return
     * @returns Associated memories with traversal path info
     */
    searchByMultiDegree(seedMemoryId: number, degree?: number, minWeight?: number, limit?: number): Promise<Array<LinkedMemory & {
        path?: string[];
    }>>;
    /**
     * 9. pruneLowWeightEdges - Remove low-weight entity-entity relations
     *
     * Pruning strategy:
     * - Remove edges with weight < minWeight
     * - Keep edges that are the only connection for an entity
     *
     * @param minWeight - Minimum weight threshold (default: 0.1)
     * @returns Number of edges pruned
     */
    pruneLowWeightEdges(minWeight?: number): Promise<number>;
    /**
     * 10. getRelationStats - Get entity relation statistics
     * @returns Statistics about entity-entity relations
     */
    getRelationStats(): Promise<{
        total_relations: number;
        avg_weight: number;
        max_weight: number;
        min_weight: number;
        by_type: Record<string, number>;
    }>;
    /**
     * Check if a document has been imported
     * @param filePath - Absolute file path
     * @returns Document import state or null if not found
     */
    getDocumentImportState(filePath: string): Promise<{
        id?: string;
        file_path: string;
        file_hash?: string;
        file_size?: number;
        imported_at?: string;
        chunks_count?: number;
        entities_extracted: boolean;
        relations_extracted: boolean;
        status: string;
        error?: string;
    } | null>;
    /**
     * Update or create document import state
     * @param filePath - Absolute file path
     * @param updates - Fields to update
     */
    upsertDocumentImportState(filePath: string, updates: {
        file_hash?: string;
        file_size?: number;
        chunks_count?: number;
        entities_extracted?: boolean;
        relations_extracted?: boolean;
        status?: 'pending' | 'importing' | 'imported' | 'extracting_entities' | 'extracting_relations' | 'completed' | 'error';
        error?: string;
    }): Promise<void>;
    /**
     * Get documents pending import or extraction
     * @param status - Filter by status
     * @returns List of pending documents
     */
    getPendingDocuments(status?: string): Promise<Array<{
        file_path: string;
        file_size?: number;
        chunks_count?: number;
        entities_extracted: boolean;
        relations_extracted: boolean;
        status: string;
    }>>;
}
//# sourceMappingURL=surrealdb-client.d.ts.map
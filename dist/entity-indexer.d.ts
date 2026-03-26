/**
 * Entity Indexer - Graph Explosion Protection
 *
 * Features:
 * 1. Entity Frequency Filtering - MIN_MENTION_COUNT = 3
 * 2. Super Node Freezing - MAX_MEMORY_LINKS = 500
 * 3. TTL Pruning - TTL_DAYS = 90, PRUNE_INTERVAL_DAYS = 7
 * 4. Write Backpressure - Dynamic index interval (5-60 seconds) based on queue + system load
 * 5. Alias Merging - Detect and merge aliases to canonical names
 *
 * Uses GRAPH_PROTECTION constants from surrealdb-client.ts
 */
import { SurrealDatabase } from './surrealdb-client.js';
import { EntityExtractor } from './entity-extractor.js';
/**
 * Indexer statistics
 */
export interface IndexerStats {
    queueSize: number;
    totalIndexed: number;
    totalFrozen: number;
    totalPruned: number;
    totalMerged: number;
    totalRelationsBuilt: number;
    currentIntervalMs: number;
}
/**
 * Queue item for indexing
 */
export interface QueueItem {
    memoryId: number;
    content: string;
    addedAt: number;
    retryCount: number;
}
/**
 * Entity Indexer with graph explosion protection
 */
export declare class EntityIndexer {
    private queue;
    private processing;
    private totalIndexed;
    private totalFrozen;
    private totalPruned;
    private totalMerged;
    private totalRelationsBuilt;
    private entityMentions;
    private aliasPairs;
    private currentIndexIntervalMs;
    private readonly minIntervalMs;
    private readonly maxIntervalMs;
    private readonly pressureThreshold;
    private readonly memoryThreshold;
    private readonly cpuThreshold;
    private readonly ttlDays;
    private readonly pruneIntervalDays;
    private db;
    private extractor;
    constructor(db?: SurrealDatabase);
    /**
     * Set database client
     */
    setDatabase(db: SurrealDatabase): void;
    /**
     * Add an alias pair for merging
     */
    addAliasPair(alias: string, canonical: string): void;
    /**
     * 1. queueForIndexing - Add memory to indexing queue
     */
    queueForIndexing(memoryId: number, content: string): void;
    /**
     * Track entity mentions for frequency filtering
     */
    private trackEntityMentions;
    /**
     * 2. checkEntityFrequency - Check if entity meets minimum mention count
     * Returns the current mention count for the entity
     */
    checkEntityFrequency(entityId: string): Promise<number>;
    /**
     * 3. checkSuperNode - Check if entity should be frozen (Super Node protection)
     * Returns true if entity is frozen (or should be frozen)
     */
    checkSuperNode(entityId: string): Promise<boolean>;
    /**
     * 4. runTTLPruning - Prune entities not accessed in TTL_DAYS
     * Returns number of entities pruned
     */
    runTTLPruning(): Promise<number>;
    /**
     * 5. runAliasMerge - Merge alias entities to canonical names
     * Returns number of aliases merged
     */
    runAliasMerge(): Promise<number>;
    /**
     * Transfer links from one entity to another
     */
    private transferEntityLinks;
    /**
     * Simulate high pressure for testing backpressure
     */
    simulateHighPressure(): void;
    /**
     * Get current index interval
     */
    getCurrentIndexInterval(): number;
    /**
     * Get system memory usage (0-1)
     */
    private getMemoryUsage;
    /**
     * Get system CPU load average (0-1, normalized)
     * Uses 1-minute load average on Unix systems
     */
    private getCPULoad;
    /**
     * Adjust backpressure based on queue size AND system load
     * Multi-factor backpressure:
     * - Queue size > threshold: increase interval
     * - Memory usage > 80%: increase interval
     * - CPU load > 70%: increase interval
     */
    private adjustBackpressure;
    /**
     * Get EntityExtractor instance (for loading known entities cache)
     */
    getExtractor(): EntityExtractor;
    /**
     * 6. processQueue - Process indexing queue in background
     */
    processQueue(): Promise<void>;
    /**
     * Process a single queue item
     */
    private processItem;
    private backgroundInterval?;
    /**
     * Start background queue processor
     */
    private startBackgroundProcessor;
    private ttlPruningInterval?;
    /**
     * Start TTL pruning scheduler (runs every PRUNE_INTERVAL_DAYS)
     */
    private startTTLPruningScheduler;
    private cooccurrenceInterval?;
    /**
     * Start co-occurrence builder scheduler (Stage 2)
     * Runs every 1 day to build entity-entity relationships
     */
    private startCooccurrenceScheduler;
    /**
     * Build entity co-occurrence relationships (Stage 2)
     * Delegates to SurrealDatabase.buildEntityCooccurrence()
     */
    buildEntityCooccurrence(): Promise<number>;
    /**
     * Prune low-weight entity-entity edges (Stage 2)
     * Delegates to SurrealDatabase.pruneLowWeightEdges()
     */
    pruneLowWeightEdges(minWeight?: number): Promise<number>;
    /**
     * Multi-degree association search (Stage 2)
     * Delegates to SurrealDatabase.searchByMultiDegree()
     */
    searchByMultiDegree(seedMemoryId: number, degree?: number, minWeight?: number, limit?: number): Promise<any[]>;
    /**
     * Get relation statistics (Stage 2)
     */
    getRelationStats(): Promise<any>;
    /**
     * Get indexer statistics
     */
    getStats(): IndexerStats;
    /**
     * Clear the indexing queue
     */
    clearQueue(): void;
    /**
     * Reset statistics
     */
    resetStats(): void;
    /**
     * Utility: sleep for milliseconds
     */
    private sleep;
    /**
     * Utility: extract numeric ID from various ID formats
     */
    private extractId;
    /**
     * Utility: extract string ID from various ID formats
     */
    private extractStringId;
    private readonly relationClassifierIntervalMs;
    private readonly relationClassifierBatchSize;
    private totalClassified;
    private relationClassifierInterval?;
    /**
     * Start relation classifier scheduler
     * Runs every 6 hours to classify co_occurs relations using LLM
     */
    private startRelationClassifierScheduler;
    /**
     * Classify entity relations using LLM
     * Queries all co_occurs relations and classifies them with semantic types
     *
     * @returns Number of successfully classified relations
     */
    classifyEntityRelations(): Promise<number>;
    /**
     * Get entity by ID
     */
    private getEntityById;
    /**
     * Get memory snippets with context window
     * Uses diverse sampling to ensure variety from different documents/time periods
     */
    private getMemorySnippets;
    /**
     * Build relation classification prompt for LLM
     */
    private buildRelationClassificationPrompt;
    /**
     * Parse LLM classification response
     */
    private parseClassificationResponse;
    /**
     * Update relation with classification result
     * Handles direction reversal and source-based direction healing
     */
    private updateRelationClassification;
    /**
     * Helper: extract array from SurrealDB result
     */
    private extractResultArray;
    /**
     * Helper: extract result ID
     */
    private extractResultId;
    /**
     * Dispose - clear all background intervals
     */
    dispose(): void;
}
//# sourceMappingURL=entity-indexer.d.ts.map
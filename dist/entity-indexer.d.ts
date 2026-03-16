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
/**
 * Indexer statistics
 */
export interface IndexerStats {
    queueSize: number;
    totalIndexed: number;
    totalFrozen: number;
    totalPruned: number;
    totalMerged: number;
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
     * 6. processQueue - Process indexing queue in background
     */
    processQueue(): Promise<void>;
    /**
     * Process a single queue item
     */
    private processItem;
    /**
     * Start background queue processor
     */
    private startBackgroundProcessor;
    /**
     * Start TTL pruning scheduler (runs every PRUNE_INTERVAL_DAYS)
     */
    private startTTLPruningScheduler;
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
}
//# sourceMappingURL=entity-indexer.d.ts.map
/**
 * TopicIndexer - Background task scheduler for Topic creation and management
 *
 * Features:
 * - Shadow update strategy (atomic topic switching)
 * - Noise filtering with Archive topic
 * - Idle task scheduler for resource efficiency
 * - Priority queue for urgent topic creation
 */
import { SurrealDatabase } from './surrealdb-client.js';
import { EmbeddingService } from './embedding.js';
export declare class TopicIndexer {
    private queue;
    private processing;
    private db;
    private embedding;
    totalTopicsCreated: number;
    totalMemoriesClustered: number;
    totalNoiseArchived: number;
    constructor(db?: SurrealDatabase, embedding?: EmbeddingService);
    /**
     * Initialize with dependencies
     */
    init(db: SurrealDatabase, embedding: EmbeddingService): void;
    /**
     * Start background scheduler for periodic scanning
     * User feedback: Idle Task scheduler for 16GB M4 resource efficiency
     */
    startScheduler(): void;
    /**
     * Scan database for potential Super Nodes
     */
    private scanPotentialSuperNodes;
    /**
     * Process queue of pending topic creation tasks
     */
    private processQueue;
    /**
     * Process idle tasks (heavy clustering, re-clustering)
     * User feedback: run heavy tasks only when system is idle
     */
    private processIdleTasks;
    /**
     * Enqueue topic creation for an entity
     */
    enqueueTopicCreation(entityId: string): Promise<void>;
    /**
     * Enqueue topic creation with priority (jump to front of queue)
     * User feedback: Alias merge threshold collision handling
     */
    enqueuePriorityTopicCreation(entityId: string): Promise<void>;
    /**
     * Auto-create topics for a Super Node entity
     * User feedback: Shadow update strategy - atomic topic switching
     */
    autoCreateTopicsForSuperNode(entityId: string): Promise<void>;
    /**
     * Stage 1: Cluster memories by embedding similarity
     * User feedback: filter out noise memories that are too far from cluster centers
     */
    private clusterMemoriesByEmbedding;
    /**
     * Stage 2: Name topics using LLM
     * Placeholder - would call actual LLM service
     */
    private nameTopics;
    /**
     * Compute cosine similarity between two vectors
     */
    private cosineSimilarity;
    /**
     * Incremental mount - attach new memory to nearest topic without re-clustering
     * User feedback: avoid expensive re-clustering on every new memory
     * User feedback #6: During clustering window, new memories mount to Entity directly
     */
    incrementalMountMemory(entityId: string, memoryId: number, memoryEmbedding: number[]): Promise<string | null>;
    /**
     * Compute topic centroid from linked memories
     */
    private computeTopicCentroid;
    /**
     * Get statistics
     */
    getStats(): {
        queueLength: number;
        processing: boolean;
        totalTopicsCreated: number;
        totalMemoriesClustered: number;
        totalNoiseArchived: number;
    };
}
//# sourceMappingURL=topic-indexer.d.ts.map
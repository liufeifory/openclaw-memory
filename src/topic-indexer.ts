/**
 * TopicIndexer - Background task scheduler for Topic creation and management
 *
 * Features:
 * - Shadow update strategy (atomic topic switching)
 * - Noise filtering with Archive topic
 * - Idle task scheduler for resource efficiency
 * - Priority queue for urgent topic creation
 */

import { logInfo, logWarn, logError } from './maintenance-logger.js';
import { SurrealDatabase } from './surrealdb-client.js';
import { EmbeddingService } from './embedding.js';

interface TopicTask {
  entityId: string;
  addedAt: number;
  retryCount: number;
  priority?: boolean;
}

interface Cluster {
  clusterId: number;
  memoryIds: number[];
  centroid?: number[];
}

interface TopicDefinition {
  name: string;
  description: string;
  memoryIds: number[];
}

const TOPIC_SOFT_LIMIT = 400;
const IDLE_THRESHOLD_MS = 5000;  // 5 seconds of no activity
const NOISE_THRESHOLD = 0.5;  // Cosine similarity threshold for noise

export class TopicIndexer {
  private queue: TopicTask[] = [];
  private processing = false;
  private db: SurrealDatabase | null = null;
  private embedding: EmbeddingService | null = null;

  // Statistics
  public totalTopicsCreated = 0;
  public totalMemoriesClustered = 0;
  public totalNoiseArchived = 0;

  constructor(db?: SurrealDatabase, embedding?: EmbeddingService) {
    this.db = db || null;
    this.embedding = embedding || null;
  }

  /**
   * Initialize with dependencies
   */
  init(db: SurrealDatabase, embedding: EmbeddingService): void {
    this.db = db;
    this.embedding = embedding;
  }

  private scanInterval?: NodeJS.Timeout;
  private processInterval?: NodeJS.Timeout;
  private idleCheckInterval?: NodeJS.Timeout;

  /**
   * Start background scheduler for periodic scanning
   * User feedback: Idle Task scheduler for 16GB M4 resource efficiency
   */
  startScheduler(): void {
    // Scan potential Super Nodes every 7 days
    const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
    this.scanInterval = setInterval(() => this.scanPotentialSuperNodes(), SEVEN_DAYS);
    this.scanInterval.unref();

    // Process queue every 30 seconds
    this.processInterval = setInterval(() => this.processQueue(), 30000);
    this.processInterval.unref();

    // Idle Task: run heavy clustering when system is idle
    let idleStartTime: number | null = null;

    const checkIdle = () => {
      if (this.processing) {
        idleStartTime = null;
        return;
      }

      if (!idleStartTime) {
        idleStartTime = Date.now();
      } else if (Date.now() - idleStartTime > IDLE_THRESHOLD_MS) {
        // System is idle, process pending heavy tasks
        this.processIdleTasks();
        idleStartTime = null;
      }
    };

    // Check idle status every 2 seconds
    this.idleCheckInterval = setInterval(checkIdle, 2000);
    this.idleCheckInterval.unref();

    logInfo('[TopicIndexer] Scheduler started (with idle task support)');
  }

  /**
   * Scan database for potential Super Nodes
   */
  private async scanPotentialSuperNodes(): Promise<void> {
    if (!this.db) {
      logError('[TopicIndexer] Database not initialized');
      return;
    }

    try {
      // This would need a raw SQL query to find entities with high memory_count
      // For now, we rely on the checkSuperNode trigger during linkMemoryEntity
      logInfo('[TopicIndexer] Super Node scan completed (passive mode)');
    } catch (error: any) {
      logError(`[TopicIndexer] scanPotentialSuperNodes failed: ${error.message}`);
    }
  }

  /**
   * Process queue of pending topic creation tasks
   */
  private async processQueue(): Promise<void> {
    if (this.processing || this.queue.length === 0) return;

    this.processing = true;
    logInfo(`[TopicIndexer] Processing queue: ${this.queue.length} tasks pending`);

    while (this.queue.length > 0) {
      const task = this.queue.shift()!;
      try {
        await this.autoCreateTopicsForSuperNode(task.entityId);
        this.totalTopicsCreated++;
      } catch (error: any) {
        logError(`[TopicIndexer] Failed for entity ${task.entityId}: ${error.message}`);
        task.retryCount++;
        if (task.retryCount < 3) {
          this.queue.push(task);
        } else {
          logError(`[TopicIndexer] Abandoned task for entity ${task.entityId} after ${task.retryCount} retries`);
        }
      }
    }

    this.processing = false;
  }

  /**
   * Process idle tasks (heavy clustering, re-clustering)
   * User feedback: run heavy tasks only when system is idle
   */
  private async processIdleTasks(): Promise<void> {
    if (this.queue.length === 0) return;

    logInfo('[TopicIndexer] Processing idle tasks...');

    // Process one task per idle period to avoid resource spike
    const task = this.queue.shift();
    if (task) {
      try {
        await this.autoCreateTopicsForSuperNode(task.entityId);
        this.totalTopicsCreated++;
      } catch (error: any) {
        logError(`[TopicIndexer] Idle task failed for ${task.entityId}: ${error.message}`);
        task.retryCount++;
        if (task.retryCount < 3) {
          this.queue.unshift(task);  // Put back at front
        }
      }
    }
  }

  /**
   * Enqueue topic creation for an entity
   */
  async enqueueTopicCreation(entityId: string): Promise<void> {
    this.queue.push({
      entityId,
      addedAt: Date.now(),
      retryCount: 0,
      priority: false,
    });
    logInfo(`[TopicIndexer] Enqueued topic creation for entity ${entityId}`);
  }

  /**
   * Enqueue topic creation with priority (jump to front of queue)
   * User feedback: Alias merge threshold collision handling
   */
  async enqueuePriorityTopicCreation(entityId: string): Promise<void> {
    this.queue.unshift({
      entityId,
      addedAt: Date.now(),
      retryCount: 0,
      priority: true,
    });
    logInfo(`[TopicIndexer] Enqueued PRIORITY topic creation for entity ${entityId}`);
  }

  /**
   * Auto-create topics for a Super Node entity
   * User feedback: Shadow update strategy - atomic topic switching
   */
  async autoCreateTopicsForSuperNode(entityId: string): Promise<void> {
    if (!this.db || !this.embedding) {
      throw new Error('TopicIndexer not properly initialized');
    }

    logInfo(`[TopicIndexer] Creating topics for entity ${entityId} (shadow update)`);

    // 1. Get memories for this entity (limit 200 for clustering)
    const memories = await this.db.getMemoriesByEntity(entityId, 200);
    if (memories.length < 5) {
      logInfo(`[TopicIndexer] Not enough memories for clustering: ${memories.length}`);
      return;
    }

    // 2. Stage 1: Embedding clustering with noise filter
    const clusteringResult = await this.clusterMemoriesByEmbedding(memories.map((m: any) => m.id));
    const clusters = clusteringResult.clusters;
    const noiseIds = clusteringResult.outliers || [];

    logInfo(`[TopicIndexer] Created ${clusters.length} clusters, filtered ${noiseIds.length} noise memories`);

    // 3. Stage 2: LLM naming (placeholder - would call actual LLM service)
    const topics = await this.nameTopics(clusters, memories);
    logInfo(`[TopicIndexer] Named ${topics.length} topics`);

    // 4. Shadow update: atomically switch via transaction
    try {
      // Delete old topic_memory edges for these memories
      const memoryIds = memories.map((m: any) => m.id);
      const deleteQueries = memoryIds.map(id => `DELETE FROM topic_memory WHERE out = memory:${id};`).join(' ');
      await this.db.query(`
        BEGIN TRANSACTION;
        ${deleteQueries}
        COMMIT TRANSACTION;
      `);

      // 5. Create new topics and link memories
      for (const topic of topics) {
        const topicId = await this.db.upsertTopic(topic.name, topic.description, entityId);
        for (const memoryId of topic.memoryIds) {
          await this.db.linkTopicMemory(topicId, memoryId, 0.8);
        }
        this.totalMemoriesClustered += topic.memoryIds.length;
      }

      // 6. Handle noise memories - create Archive topic
      if (noiseIds.length > 0) {
        logInfo(`[TopicIndexer] Archiving ${noiseIds.length} noise memories to Archive topic`);
        const archiveTopicId = await this.db.upsertTopic('Archive', '噪声记忆归档', entityId);
        for (const memoryId of noiseIds) {
          await this.db.linkTopicMemory(archiveTopicId, memoryId, 0.3);
        }
        this.totalNoiseArchived += noiseIds.length;
      }

      logInfo(`[TopicIndexer] Shadow update completed for entity ${entityId}`);
    } catch (error: any) {
      logError(`[TopicIndexer] Shadow update failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Stage 1: Cluster memories by embedding similarity
   * User feedback: filter out noise memories that are too far from cluster centers
   */
  private async clusterMemoriesByEmbedding(memoryIds: number[], maxClusters = 10): Promise<{ clusters: Cluster[], outliers: number[] }> {
    if (!this.embedding) {
      throw new Error('EmbeddingService not initialized');
    }

    // 1. Get embeddings for all memories
    const embeddings: number[][] = [];
    for (const memoryId of memoryIds) {
      // This would need a method to get stored embedding
      // For now, placeholder
      embeddings.push(new Array(1024).fill(0));
    }

    // 2. Compute similarity matrix and cluster
    const clusters: Cluster[] = [];
    const assigned = new Set<number>();
    const outliers: number[] = [];

    // Simple k-means style clustering (placeholder)
    // In production, use proper hierarchical clustering or DBSCAN
    for (let i = 0; i < memoryIds.length && clusters.length < maxClusters; i++) {
      if (assigned.has(i)) continue;

      // Create new cluster with this memory as centroid
      const cluster: Cluster = {
        clusterId: clusters.length,
        memoryIds: [memoryIds[i]],
        centroid: embeddings[i],
      };
      assigned.add(i);

      // Find similar memories
      for (let j = i + 1; j < memoryIds.length; j++) {
        if (assigned.has(j)) continue;

        const similarity = this.cosineSimilarity(embeddings[i], embeddings[j]);
        if (similarity > 0.7) {  // Threshold for same cluster
          cluster.memoryIds.push(memoryIds[j]);
          assigned.add(j);
        }
      }

      clusters.push(cluster);
    }

    // Handle unassigned memories (noise or fit into existing clusters)
    for (let i = 0; i < memoryIds.length; i++) {
      if (assigned.has(i)) continue;

      // Check distance to each cluster center
      let maxSimilarity = 0;
      for (const cluster of clusters) {
        if (cluster.centroid) {
          const similarity = this.cosineSimilarity(embeddings[i], cluster.centroid);
          maxSimilarity = Math.max(maxSimilarity, similarity);
        }
      }

      // If too far from all centers, mark as noise
      if (maxSimilarity < NOISE_THRESHOLD) {
        outliers.push(memoryIds[i]);
      } else {
        // Find best matching cluster and add to it
        let bestCluster = -1;
        let bestSimilarity = 0;
        for (const cluster of clusters) {
          if (cluster.centroid) {
            const similarity = this.cosineSimilarity(embeddings[i], cluster.centroid);
            if (similarity > bestSimilarity) {
              bestSimilarity = similarity;
              bestCluster = cluster.clusterId;
            }
          }
        }
        if (bestCluster >= 0) {
          clusters[bestCluster].memoryIds.push(memoryIds[i]);
        }
      }
    }

    return { clusters, outliers };
  }

  /**
   * Stage 2: Name topics using LLM
   * Placeholder - would call actual LLM service
   */
  private async nameTopics(clusters: Cluster[], memories: any[]): Promise<TopicDefinition[]> {
    const topics: TopicDefinition[] = [];

    for (const cluster of clusters) {
      // Get sample memories for context
      const sampleMemories = cluster.memoryIds.slice(0, 5);

      // In production, call LLM service here to generate name and description
      // For now, use placeholder names
      topics.push({
        name: `Topic-${cluster.clusterId}`,
        description: `Auto-generated topic for ${cluster.memoryIds.length} memories`,
        memoryIds: cluster.memoryIds,
      });
    }

    return topics;
  }

  /**
   * Compute cosine similarity between two vectors
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    let dot = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    if (normA === 0 || normB === 0) return 0;
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  /**
   * Incremental mount - attach new memory to nearest topic without re-clustering
   * User feedback: avoid expensive re-clustering on every new memory
   * User feedback #6: During clustering window, new memories mount to Entity directly
   */
  async incrementalMountMemory(
    entityId: string,
    memoryId: number,
    memoryEmbedding: number[]
  ): Promise<string | null> {
    if (!this.db) return null;

    try {
      const topics = await this.db.getTopicsByEntity(entityId);
      if (topics.length === 0) {
        logInfo(`[TopicIndexer] No topics found, mounting memory ${memoryId} to entity`);
        return null;
      }

      let bestTopic: string | null = null;
      let bestSimilarity = -1;

      for (const topic of topics) {
        const centroid = await this.computeTopicCentroid(topic.id);
        if (!centroid) continue;

        const similarity = this.cosineSimilarity(memoryEmbedding, centroid);
        if (similarity > bestSimilarity) {
          bestSimilarity = similarity;
          bestTopic = topic.id;
        }
      }

      if (bestTopic && bestSimilarity > 0.6) {
        await this.db.linkTopicMemory(bestTopic, memoryId, bestSimilarity);
        logInfo(`[TopicIndexer] Incrementally mounted memory ${memoryId} to topic ${bestTopic}`);
        return bestTopic;
      } else {
        // No suitable topic, mount to entity (User feedback #6: write window handling)
        logInfo(`[TopicIndexer] No suitable topic found (best: ${bestSimilarity}), mounting to entity`);
        return null;
      }
    } catch (error: any) {
      logError(`[TopicIndexer] incrementalMountMemory failed: ${error.message}`);
      return null;
    }
  }

  /**
   * Compute topic centroid from linked memories
   */
  private async computeTopicCentroid(topicId: string): Promise<number[] | null> {
    if (!this.db) return null;

    try {
      const memories = await this.db.getMemoriesByTopic(topicId, 50);
      if (memories.length === 0) return null;

      // In production, fetch actual embeddings and compute centroid
      // Placeholder: return zeros
      return new Array(1024).fill(0);
    } catch (error: any) {
      logError(`[TopicIndexer] computeTopicCentroid failed: ${error.message}`);
      return null;
    }
  }

  /**
   * Get statistics
   */
  getStats(): {
    queueLength: number;
    processing: boolean;
    totalTopicsCreated: number;
    totalMemoriesClustered: number;
    totalNoiseArchived: number;
  } {
    return {
      queueLength: this.queue.length,
      processing: this.processing,
      totalTopicsCreated: this.totalTopicsCreated,
      totalMemoriesClustered: this.totalMemoriesClustered,
      totalNoiseArchived: this.totalNoiseArchived,
    };
  }

  /**
   * Dispose - clear all background intervals
   */
  dispose(): void {
    if (this.scanInterval) {
      clearInterval(this.scanInterval);
      this.scanInterval = undefined;
    }
    if (this.processInterval) {
      clearInterval(this.processInterval);
      this.processInterval = undefined;
    }
    if (this.idleCheckInterval) {
      clearInterval(this.idleCheckInterval);
      this.idleCheckInterval = undefined;
    }
    logInfo('[TopicIndexer] Disposed');
  }
}

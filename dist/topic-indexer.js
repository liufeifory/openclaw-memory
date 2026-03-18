/**
 * TopicIndexer - Background task scheduler for Topic creation and management
 *
 * Features:
 * - Shadow update strategy (atomic topic switching)
 * - Noise filtering with Archive topic
 * - Idle task scheduler for resource efficiency
 * - Priority queue for urgent topic creation
 */
const TOPIC_SOFT_LIMIT = 400;
const IDLE_THRESHOLD_MS = 5000; // 5 seconds of no activity
const NOISE_THRESHOLD = 0.5; // Cosine similarity threshold for noise
export class TopicIndexer {
    queue = [];
    processing = false;
    db = null;
    embedding = null;
    // Statistics
    totalTopicsCreated = 0;
    totalMemoriesClustered = 0;
    totalNoiseArchived = 0;
    constructor(db, embedding) {
        this.db = db || null;
        this.embedding = embedding || null;
    }
    /**
     * Initialize with dependencies
     */
    init(db, embedding) {
        this.db = db;
        this.embedding = embedding;
    }
    /**
     * Start background scheduler for periodic scanning
     * User feedback: Idle Task scheduler for 16GB M4 resource efficiency
     */
    startScheduler() {
        // Scan potential Super Nodes every 7 days
        const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
        setInterval(() => this.scanPotentialSuperNodes(), SEVEN_DAYS);
        // Process queue every 30 seconds
        setInterval(() => this.processQueue(), 30000);
        // Idle Task: run heavy clustering when system is idle
        let idleStartTime = null;
        const checkIdle = () => {
            if (this.processing) {
                idleStartTime = null;
                return;
            }
            if (!idleStartTime) {
                idleStartTime = Date.now();
            }
            else if (Date.now() - idleStartTime > IDLE_THRESHOLD_MS) {
                // System is idle, process pending heavy tasks
                this.processIdleTasks();
                idleStartTime = null;
            }
        };
        // Check idle status every 2 seconds
        setInterval(checkIdle, 2000);
        console.log('[TopicIndexer] Scheduler started (with idle task support)');
    }
    /**
     * Scan database for potential Super Nodes
     */
    async scanPotentialSuperNodes() {
        if (!this.db) {
            console.error('[TopicIndexer] Database not initialized');
            return;
        }
        try {
            // This would need a raw SQL query to find entities with high memory_count
            // For now, we rely on the checkSuperNode trigger during linkMemoryEntity
            console.log('[TopicIndexer] Super Node scan completed (passive mode)');
        }
        catch (error) {
            console.error('[TopicIndexer] scanPotentialSuperNodes failed:', error.message);
        }
    }
    /**
     * Process queue of pending topic creation tasks
     */
    async processQueue() {
        if (this.processing || this.queue.length === 0)
            return;
        this.processing = true;
        console.log(`[TopicIndexer] Processing queue: ${this.queue.length} tasks pending`);
        while (this.queue.length > 0) {
            const task = this.queue.shift();
            try {
                await this.autoCreateTopicsForSuperNode(task.entityId);
                this.totalTopicsCreated++;
            }
            catch (error) {
                console.error(`[TopicIndexer] Failed for entity ${task.entityId}:`, error.message);
                task.retryCount++;
                if (task.retryCount < 3) {
                    this.queue.push(task);
                }
                else {
                    console.error(`[TopicIndexer] Abandoned task for entity ${task.entityId} after ${task.retryCount} retries`);
                }
            }
        }
        this.processing = false;
    }
    /**
     * Process idle tasks (heavy clustering, re-clustering)
     * User feedback: run heavy tasks only when system is idle
     */
    async processIdleTasks() {
        if (this.queue.length === 0)
            return;
        console.log('[TopicIndexer] Processing idle tasks...');
        // Process one task per idle period to avoid resource spike
        const task = this.queue.shift();
        if (task) {
            try {
                await this.autoCreateTopicsForSuperNode(task.entityId);
                this.totalTopicsCreated++;
            }
            catch (error) {
                console.error(`[TopicIndexer] Idle task failed for ${task.entityId}:`, error.message);
                task.retryCount++;
                if (task.retryCount < 3) {
                    this.queue.unshift(task); // Put back at front
                }
            }
        }
    }
    /**
     * Enqueue topic creation for an entity
     */
    async enqueueTopicCreation(entityId) {
        this.queue.push({
            entityId,
            addedAt: Date.now(),
            retryCount: 0,
            priority: false,
        });
        console.log(`[TopicIndexer] Enqueued topic creation for entity ${entityId}`);
    }
    /**
     * Enqueue topic creation with priority (jump to front of queue)
     * User feedback: Alias merge threshold collision handling
     */
    async enqueuePriorityTopicCreation(entityId) {
        this.queue.unshift({
            entityId,
            addedAt: Date.now(),
            retryCount: 0,
            priority: true,
        });
        console.log(`[TopicIndexer] Enqueued PRIORITY topic creation for entity ${entityId}`);
    }
    /**
     * Auto-create topics for a Super Node entity
     * User feedback: Shadow update strategy - atomic topic switching
     */
    async autoCreateTopicsForSuperNode(entityId) {
        if (!this.db || !this.embedding) {
            throw new Error('TopicIndexer not properly initialized');
        }
        console.log(`[TopicIndexer] Creating topics for entity ${entityId} (shadow update)`);
        // 1. Get memories for this entity (limit 200 for clustering)
        const memories = await this.db.getMemoriesByEntity(entityId, 200);
        if (memories.length < 5) {
            console.log(`[TopicIndexer] Not enough memories for clustering: ${memories.length}`);
            return;
        }
        // 2. Stage 1: Embedding clustering with noise filter
        const clusteringResult = await this.clusterMemoriesByEmbedding(memories.map((m) => m.id));
        const clusters = clusteringResult.clusters;
        const noiseIds = clusteringResult.outliers || [];
        console.log(`[TopicIndexer] Created ${clusters.length} clusters, filtered ${noiseIds.length} noise memories`);
        // 3. Stage 2: LLM naming (placeholder - would call actual LLM service)
        const topics = await this.nameTopics(clusters, memories);
        console.log(`[TopicIndexer] Named ${topics.length} topics`);
        // 4. Shadow update: atomically switch via transaction
        try {
            // Delete old topic_memory edges for these memories
            const memoryIds = memories.map((m) => m.id);
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
                console.log(`[TopicIndexer] Archiving ${noiseIds.length} noise memories to Archive topic`);
                const archiveTopicId = await this.db.upsertTopic('Archive', '噪声记忆归档', entityId);
                for (const memoryId of noiseIds) {
                    await this.db.linkTopicMemory(archiveTopicId, memoryId, 0.3);
                }
                this.totalNoiseArchived += noiseIds.length;
            }
            console.log(`[TopicIndexer] Shadow update completed for entity ${entityId}`);
        }
        catch (error) {
            console.error(`[TopicIndexer] Shadow update failed:`, error.message);
            throw error;
        }
    }
    /**
     * Stage 1: Cluster memories by embedding similarity
     * User feedback: filter out noise memories that are too far from cluster centers
     */
    async clusterMemoriesByEmbedding(memoryIds, maxClusters = 10) {
        if (!this.embedding) {
            throw new Error('EmbeddingService not initialized');
        }
        // 1. Get embeddings for all memories
        const embeddings = [];
        for (const memoryId of memoryIds) {
            // This would need a method to get stored embedding
            // For now, placeholder
            embeddings.push(new Array(1024).fill(0));
        }
        // 2. Compute similarity matrix and cluster
        const clusters = [];
        const assigned = new Set();
        const outliers = [];
        // Simple k-means style clustering (placeholder)
        // In production, use proper hierarchical clustering or DBSCAN
        for (let i = 0; i < memoryIds.length && clusters.length < maxClusters; i++) {
            if (assigned.has(i))
                continue;
            // Create new cluster with this memory as centroid
            const cluster = {
                clusterId: clusters.length,
                memoryIds: [memoryIds[i]],
                centroid: embeddings[i],
            };
            assigned.add(i);
            // Find similar memories
            for (let j = i + 1; j < memoryIds.length; j++) {
                if (assigned.has(j))
                    continue;
                const similarity = this.cosineSimilarity(embeddings[i], embeddings[j]);
                if (similarity > 0.7) { // Threshold for same cluster
                    cluster.memoryIds.push(memoryIds[j]);
                    assigned.add(j);
                }
            }
            clusters.push(cluster);
        }
        // Handle unassigned memories (noise or fit into existing clusters)
        for (let i = 0; i < memoryIds.length; i++) {
            if (assigned.has(i))
                continue;
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
            }
            else {
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
    async nameTopics(clusters, memories) {
        const topics = [];
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
    cosineSimilarity(a, b) {
        let dot = 0;
        let normA = 0;
        let normB = 0;
        for (let i = 0; i < a.length; i++) {
            dot += a[i] * b[i];
            normA += a[i] * a[i];
            normB += b[i] * b[i];
        }
        if (normA === 0 || normB === 0)
            return 0;
        return dot / (Math.sqrt(normA) * Math.sqrt(normB));
    }
    /**
     * Incremental mount - attach new memory to nearest topic without re-clustering
     * User feedback: avoid expensive re-clustering on every new memory
     * User feedback #6: During clustering window, new memories mount to Entity directly
     */
    async incrementalMountMemory(entityId, memoryId, memoryEmbedding) {
        if (!this.db)
            return null;
        try {
            const topics = await this.db.getTopicsByEntity(entityId);
            if (topics.length === 0) {
                console.log(`[TopicIndexer] No topics found, mounting memory ${memoryId} to entity`);
                return null;
            }
            let bestTopic = null;
            let bestSimilarity = -1;
            for (const topic of topics) {
                const centroid = await this.computeTopicCentroid(topic.id);
                if (!centroid)
                    continue;
                const similarity = this.cosineSimilarity(memoryEmbedding, centroid);
                if (similarity > bestSimilarity) {
                    bestSimilarity = similarity;
                    bestTopic = topic.id;
                }
            }
            if (bestTopic && bestSimilarity > 0.6) {
                await this.db.linkTopicMemory(bestTopic, memoryId, bestSimilarity);
                console.log(`[TopicIndexer] Incrementally mounted memory ${memoryId} to topic ${bestTopic}`);
                return bestTopic;
            }
            else {
                // No suitable topic, mount to entity (User feedback #6: write window handling)
                console.log(`[TopicIndexer] No suitable topic found (best: ${bestSimilarity}), mounting to entity`);
                return null;
            }
        }
        catch (error) {
            console.error('[TopicIndexer] incrementalMountMemory failed:', error.message);
            return null;
        }
    }
    /**
     * Compute topic centroid from linked memories
     */
    async computeTopicCentroid(topicId) {
        if (!this.db)
            return null;
        try {
            const memories = await this.db.getMemoriesByTopic(topicId, 50);
            if (memories.length === 0)
                return null;
            // In production, fetch actual embeddings and compute centroid
            // Placeholder: return zeros
            return new Array(1024).fill(0);
        }
        catch (error) {
            console.error('[TopicIndexer] computeTopicCentroid failed:', error.message);
            return null;
        }
    }
    /**
     * Get statistics
     */
    getStats() {
        return {
            queueLength: this.queue.length,
            processing: this.processing,
            totalTopicsCreated: this.totalTopicsCreated,
            totalMemoriesClustered: this.totalMemoriesClustered,
            totalNoiseArchived: this.totalNoiseArchived,
        };
    }
}
//# sourceMappingURL=topic-indexer.js.map
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

import { SurrealDatabase, GRAPH_PROTECTION } from './surrealdb-client.js';
import { EntityExtractor, ExtractedEntity } from './entity-extractor.js';
import * as os from 'os';

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
 * Entity mention record for frequency tracking
 */
interface EntityMention {
  entityId: string;
  memoryId: number;
  timestamp: number;
}

/**
 * Alias pair for merging
 */
interface AliasPair {
  alias: string;
  canonical: string;
}

/**
 * Entity Indexer with graph explosion protection
 */
export class EntityIndexer {
  private queue: QueueItem[] = [];
  private processing = false;
  private totalIndexed = 0;
  private totalFrozen = 0;
  private totalPruned = 0;
  private totalMerged = 0;

  // Entity mention tracking for frequency filtering
  private entityMentions: Map<string, EntityMention[]> = new Map();

  // Alias pairs for merging
  private aliasPairs: AliasPair[] = [];

  // Backpressure control
  private currentIndexIntervalMs: number = 5000;  // Base: 5 seconds
  private readonly minIntervalMs: number = 5000;   // 5 seconds
  private readonly maxIntervalMs: number = 60000;  // 60 seconds
  private readonly pressureThreshold: number = 100;  // Queue size threshold for pressure

  // System monitoring for backpressure
  private readonly memoryThreshold: number = 0.8;  // 80% memory usage
  private readonly cpuThreshold: number = 0.7;     // 70% CPU usage (simulated via load average)

  // TTL configuration
  private readonly ttlDays: number = GRAPH_PROTECTION.TTL_DAYS;
  private readonly pruneIntervalDays: number = GRAPH_PROTECTION.PRUNE_INTERVAL_DAYS;

  // Database client (lazy initialized)
  private db: SurrealDatabase | null = null;

  // Entity extractor for processing queue items
  private extractor: EntityExtractor;

  constructor(db?: SurrealDatabase) {
    this.db = db || null;
    this.extractor = new EntityExtractor();

    // Start background queue processor
    this.startBackgroundProcessor();

    // Start TTL pruning scheduler
    this.startTTLPruningScheduler();
  }

  /**
   * Set database client
   */
  setDatabase(db: SurrealDatabase): void {
    this.db = db;
  }

  /**
   * Add an alias pair for merging
   */
  addAliasPair(alias: string, canonical: string): void {
    this.aliasPairs.push({ alias, canonical });
  }

  /**
   * 1. queueForIndexing - Add memory to indexing queue
   */
  queueForIndexing(memoryId: number, content: string): void {
    const queueItem: QueueItem = {
      memoryId,
      content,
      addedAt: Date.now(),
      retryCount: 0,
    };

    this.queue.push(queueItem);

    // Extract entities and track mentions for frequency filtering
    this.trackEntityMentions(memoryId, content);

    console.log(`[EntityIndexer] Queued memory ${memoryId} for indexing (queue size: ${this.queue.length})`);
  }

  /**
   * Track entity mentions for frequency filtering
   */
  private trackEntityMentions(memoryId: number, content: string): void {
    // Use regex extraction for quick mention tracking (no LLM)
    const entities = this.extractor.layer1_RegexMatch(content);

    for (const entity of entities) {
      const entityId = entity.name.toLowerCase();

      if (!this.entityMentions.has(entityId)) {
        this.entityMentions.set(entityId, []);
      }

      const mentions = this.entityMentions.get(entityId)!;
      mentions.push({
        entityId,
        memoryId,
        timestamp: Date.now(),
      });

      // Keep only recent mentions (last 24 hours) to prevent memory bloat
      const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
      const recentMentions = mentions.filter(m => m.timestamp > oneDayAgo);
      this.entityMentions.set(entityId, recentMentions);
    }
  }

  /**
   * 2. checkEntityFrequency - Check if entity meets minimum mention count
   * Returns the current mention count for the entity
   */
  async checkEntityFrequency(entityId: string): Promise<number> {
    const mentions = this.entityMentions.get(entityId.toLowerCase());

    if (!mentions) {
      return 0;
    }

    return mentions.length;
  }

  /**
   * 3. checkSuperNode - Check if entity should be frozen (Super Node protection)
   * Returns true if entity is frozen (or should be frozen)
   */
  async checkSuperNode(entityId: string): Promise<boolean> {
    if (!this.db) {
      // Without DB, use mention count as proxy
      const mentionCount = await this.checkEntityFrequency(entityId);
      // If mentions exceed threshold, consider it a potential super node
      return mentionCount >= GRAPH_PROTECTION.MAX_MEMORY_LINKS;
    }

    try {
      // Query entity's current link count from database
      const entityRecordId = `entity:${entityId}`;
      const result = await this.db.query(
        `SELECT relation_count, is_frozen FROM ${entityRecordId}`
      );

      let data: any[] = [];
      if (Array.isArray(result) && result.length > 0) {
        if (Array.isArray(result[0])) {
          data = result[0] || [];
        } else if ((result as any)[0]?.result) {
          data = (result as any)[0].result || [];
        }
      }

      if (data && data.length > 0) {
        const relationCount = data[0].relation_count || 0;
        const isFrozen = data[0].is_frozen || false;

        // Already frozen
        if (isFrozen) {
          return true;
        }

        // Check if should be frozen
        if (relationCount >= GRAPH_PROTECTION.MAX_MEMORY_LINKS) {
          // Actually freeze the entity
          await this.db.query(
            `UPDATE ${entityRecordId} SET is_frozen = true WHERE is_frozen = false`
          );
          console.log(`[EntityIndexer] Frozen super node "${entityId}" (relation_count: ${relationCount})`);
          return true;
        }

        return false;
      }

      return false;
    } catch (error: any) {
      console.error(`[EntityIndexer] checkSuperNode failed for ${entityId}:`, error.message);
      return false;
    }
  }

  /**
   * 4. runTTLPruning - Prune entities not accessed in TTL_DAYS
   * Returns number of entities pruned
   */
  async runTTLPruning(): Promise<number> {
    if (!this.db) {
      console.log('[EntityIndexer] TTL Pruning skipped: no database connection');
      return 0;
    }

    try {
      const ttlDate = new Date();
      ttlDate.setDate(ttlDate.getDate() - this.ttlDays);
      const ttlISOString = ttlDate.toISOString();

      // Step 1: Mark entities as inactive (not accessed since TTL date)
      const markSql = `UPDATE entity SET is_active = false WHERE last_accessed < '${ttlISOString}' AND is_active = true`;
      const markResult = await this.db.query(markSql);

      let markedCount = 0;
      if (Array.isArray(markResult) && markResult.length > 0) {
        if (Array.isArray(markResult[0])) {
          markedCount = markResult[0].length;
        } else if ((markResult as any)[0]?.result) {
          markedCount = (markResult as any)[0].result?.length || 0;
        }
      }

      // Step 2: Actually DELETE inactive entities (hard delete)
      const deleteSql = `DELETE FROM entity WHERE is_active = false AND last_accessed < '${ttlISOString}'`;
      const deleteResult = await this.db.query(deleteSql);

      let deletedCount = 0;
      if (Array.isArray(deleteResult) && deleteResult.length > 0) {
        if (Array.isArray(deleteResult[0])) {
          deletedCount = deleteResult[0].length;
        } else if ((deleteResult as any)[0]?.result) {
          deletedCount = (deleteResult as any)[0].result?.length || 0;
        }
      }

      this.totalPruned += deletedCount;
      console.log(`[EntityIndexer] TTL Pruning: marked ${markedCount} inactive, deleted ${deletedCount} entities older than ${this.ttlDays} days`);

      return deletedCount;
    } catch (error: any) {
      console.error('[EntityIndexer] TTL Pruning failed:', error.message);
      return 0;
    }
  }

  /**
   * 5. runAliasMerge - Merge alias entities to canonical names
   * Returns number of aliases merged
   */
  async runAliasMerge(): Promise<number> {
    if (!this.db || this.aliasPairs.length === 0) {
      console.log('[EntityIndexer] Alias Merge skipped: no database or alias pairs');
      return 0;
    }

    let mergedCount = 0;

    try {
      for (const { alias, canonical } of this.aliasPairs) {
        // Find alias entity
        const aliasResult = await this.db.query(
          `SELECT * FROM entity WHERE name = '${alias}' LIMIT 1`
        );

        let aliasData: any[] = [];
        if (Array.isArray(aliasResult) && aliasResult.length > 0) {
          if (Array.isArray(aliasResult[0])) {
            aliasData = aliasResult[0] || [];
          } else if ((aliasResult as any)[0]?.result) {
            aliasData = (aliasResult as any)[0].result || [];
          }
        }

        if (aliasData.length === 0) {
          continue;  // Alias entity not found
        }

        const aliasEntity = aliasData[0];
        const aliasId = this.extractId(aliasEntity.id);

        // Skip if alias already has canonical_id (already merged)
        if (aliasEntity.canonical_id) {
          console.log(`[EntityIndexer] Alias "${alias}" already merged to canonical_id ${aliasEntity.canonical_id}, skipping`);
          continue;
        }

        // Find or create canonical entity
        const canonicalResult = await this.db.query(
          `SELECT * FROM entity WHERE name = '${canonical}' LIMIT 1`
        );

        let canonicalData: any[] = [];
        if (Array.isArray(canonicalResult) && canonicalResult.length > 0) {
          if (Array.isArray(canonicalResult[0])) {
            canonicalData = canonicalResult[0] || [];
          } else if ((canonicalResult as any)[0]?.result) {
            canonicalData = (canonicalResult as any)[0].result || [];
          }
        }

        let canonicalId: number;
        if (canonicalData.length > 0) {
          canonicalId = this.extractId(canonicalData[0].id);
        } else {
          // Create canonical entity
          canonicalId = await this.db.upsertEntity(canonical, 'merged');
        }

        // Transfer links from alias to canonical
        await this.transferEntityLinks(aliasId, canonicalId);

        // Mark alias as merged (set canonical_id, don't delete)
        await this.db.query(
          `UPDATE entity:${aliasId} SET canonical_id = ${canonicalId}, is_active = false`
        );

        mergedCount++;
        this.totalMerged += mergedCount;

        console.log(`[EntityIndexer] Merged alias "${alias}" -> "${canonical}" (canonical_id: ${canonicalId})`);
      }

      return mergedCount;
    } catch (error: any) {
      console.error('[EntityIndexer] Alias Merge failed:', error.message);
      return 0;
    }
  }

  /**
   * Transfer links from one entity to another
   */
  private async transferEntityLinks(fromEntityId: number, toEntityId: number): Promise<void> {
    if (!this.db) return;

    try {
      // Update memory_entity edges to point to new entity
      const sql = `UPDATE memory_entity SET entity = entity:${toEntityId} WHERE entity = entity:${fromEntityId}`;
      await this.db.query(sql);
    } catch (error: any) {
      console.error('[EntityIndexer] transferEntityLinks failed:', error.message);
    }
  }

  /**
   * Simulate high pressure for testing backpressure
   */
  simulateHighPressure(): void {
    // Artificially increase queue size to trigger backpressure
    for (let i = 0; i < this.pressureThreshold + 10; i++) {
      this.queue.push({
        memoryId: i,
        content: `Test content ${i}`,
        addedAt: Date.now(),
        retryCount: 0,
      });
    }
    this.adjustBackpressure();
  }

  /**
   * Get current index interval
   */
  getCurrentIndexInterval(): number {
    return this.currentIndexIntervalMs;
  }

  /**
   * Get system memory usage (0-1)
   */
  private getMemoryUsage(): number {
    const total = os.totalmem();
    const free = os.freemem();
    const used = total - free;
    return used / total;
  }

  /**
   * Get system CPU load average (0-1, normalized)
   * Uses 1-minute load average on Unix systems
   */
  private getCPULoad(): number {
    const cpus = os.cpus();
    const loads = os.loadavg();

    // Use 1-minute load average, normalized by CPU count
    const oneMinLoad = loads[0];
    const normalizedLoad = oneMinLoad / cpus.length;

    // Cap at 1.0 (100% utilization)
    return Math.min(normalizedLoad, 1.0);
  }

  /**
   * Adjust backpressure based on queue size AND system load
   * Multi-factor backpressure:
   * - Queue size > threshold: increase interval
   * - Memory usage > 80%: increase interval
   * - CPU load > 70%: increase interval
   */
  private adjustBackpressure(): void {
    const queueSize = this.queue.length;
    const memoryUsage = this.getMemoryUsage();
    const cpuLoad = this.getCPULoad();

    // Calculate pressure factors (0-1 scale)
    const queuePressure = queueSize > this.pressureThreshold * 2
      ? 1.0
      : queueSize > this.pressureThreshold
        ? (queueSize - this.pressureThreshold) / this.pressureThreshold
        : 0;

    const memoryPressure = memoryUsage > this.memoryThreshold
      ? (memoryUsage - this.memoryThreshold) / (1 - this.memoryThreshold)
      : 0;

    const cpuPressure = cpuLoad > this.cpuThreshold
      ? (cpuLoad - this.cpuThreshold) / (1 - this.cpuThreshold)
      : 0;

    // Take maximum pressure from all factors
    const maxPressure = Math.max(queuePressure, memoryPressure, cpuPressure);

    // Scale interval based on maximum pressure
    if (maxPressure >= 1.0) {
      this.currentIndexIntervalMs = this.maxIntervalMs;
    } else if (maxPressure > 0) {
      this.currentIndexIntervalMs = Math.min(
        this.maxIntervalMs,
        this.minIntervalMs + (this.maxIntervalMs - this.minIntervalMs) * maxPressure
      );
    } else {
      this.currentIndexIntervalMs = this.minIntervalMs;
    }

    console.log(
      `[EntityIndexer] Backpressure adjusted interval to ${this.currentIndexIntervalMs}ms ` +
      `(queue: ${queueSize}, memory: ${(memoryUsage * 100).toFixed(1)}%, CPU: ${(cpuLoad * 100).toFixed(1)}%)`
    );
  }

  /**
   * 6. processQueue - Process indexing queue in background
   */
  async processQueue(): Promise<void> {
    if (this.processing || this.queue.length === 0) {
      return;
    }

    this.processing = true;

    try {
      while (this.queue.length > 0) {
        const item = this.queue.shift()!;

        try {
          await this.processItem(item);
          this.totalIndexed++;
        } catch (error: any) {
          console.error(`[EntityIndexer] Failed to process item ${item.memoryId}:`, error.message);

          // Retry logic
          if (item.retryCount < 3) {
            item.retryCount++;
            this.queue.push(item);
          }
        }

        // Apply backpressure delay
        await this.sleep(this.currentIndexIntervalMs);
      }
    } finally {
      this.processing = false;
      this.adjustBackpressure();
    }
  }

  /**
   * Process a single queue item
   */
  private async processItem(item: QueueItem): Promise<void> {
    if (!this.db) {
      throw new Error('Database not connected');
    }

    // Extract entities from content
    const entities = await this.extractor.extract(item.content);

    if (entities.length === 0) {
      return;  // No entities to index
    }

    for (const entity of entities) {
      // Check entity frequency
      const frequency = await this.checkEntityFrequency(entity.name);

      if (frequency < GRAPH_PROTECTION.MIN_MENTION_COUNT) {
        console.log(`[EntityIndexer] Skipping "${entity.name}": frequency ${frequency} < ${GRAPH_PROTECTION.MIN_MENTION_COUNT}`);
        continue;
      }

      // Check if entity is a super node
      const isSuperNode = await this.checkSuperNode(entity.name);

      if (isSuperNode) {
        console.log(`[EntityIndexer] Skipping "${entity.name}": entity is frozen (super node)`);
        this.totalFrozen++;
        continue;
      }

      // Upsert entity and create link
      const entityId = await this.db.upsertEntity(entity.name, entity.source || 'unknown');

      await this.db.linkMemoryEntity(
        item.memoryId,
        entityId,
        entity.confidence
      );

      console.log(`[EntityIndexer] Indexed entity "${entity.name}" (${entityId}) for memory ${item.memoryId}`);
    }

    // Mark memory as indexed
    await this.db.query(
      `UPDATE memory:${item.memoryId} SET is_indexed = true`
    );
  }

  /**
   * Start background queue processor
   */
  private startBackgroundProcessor(): void {
    setInterval(async () => {
      if (!this.processing && this.queue.length > 0) {
        this.processQueue().catch(console.error);
      }
    }, this.currentIndexIntervalMs);
  }

  /**
   * Start TTL pruning scheduler (runs every PRUNE_INTERVAL_DAYS)
   */
  private startTTLPruningScheduler(): void {
    const pruneIntervalMs = this.pruneIntervalDays * 24 * 60 * 60 * 1000;

    setInterval(async () => {
      await this.runTTLPruning().catch(console.error);
    }, pruneIntervalMs);

    console.log(`[EntityIndexer] TTL Pruning scheduled every ${this.pruneIntervalDays} days`);
  }

  /**
   * Get indexer statistics
   */
  getStats(): IndexerStats {
    return {
      queueSize: this.queue.length,
      totalIndexed: this.totalIndexed,
      totalFrozen: this.totalFrozen,
      totalPruned: this.totalPruned,
      totalMerged: this.totalMerged,
      currentIntervalMs: this.currentIndexIntervalMs,
    };
  }

  /**
   * Clear the indexing queue
   */
  clearQueue(): void {
    this.queue = [];
    console.log('[EntityIndexer] Queue cleared');
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.totalIndexed = 0;
    this.totalFrozen = 0;
    this.totalPruned = 0;
    this.totalMerged = 0;
    console.log('[EntityIndexer] Stats reset');
  }

  /**
   * Utility: sleep for milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Utility: extract numeric ID from various ID formats
   */
  private extractId(id: any): number {
    if (typeof id === 'number') {
      return id;
    }
    if (typeof id === 'string') {
      const parts = id.split(':');
      return parseInt(parts[parts.length - 1], 10);
    }
    if (id && typeof id === 'object' && id.id !== undefined) {
      return this.extractId(id.id);
    }
    return 0;
  }
}

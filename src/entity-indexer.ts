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

import { SurrealDatabase, GRAPH_PROTECTION, ENTITY_RELATION_TABLE, MEMORY_TABLE, ENTITY_TABLE } from './surrealdb-client.js';
import { EntityExtractor, ExtractedEntity } from './entity-extractor.js';
import { extractContextWindow, diverseSample } from './context-window.js';
import { logInfo, logWarn, logError } from './maintenance-logger.js';
import { LLMClient } from './llm-client.js';
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
  totalRelationsBuilt: number;  // Stage 2: entity-entity relations
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
  private totalRelationsBuilt = 0;  // Stage 2: entity-entity relations

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
    // Create a minimal LLMClient for EntityExtractor (can be null for extraction-only mode)
    const minimalClient = new LLMClient({ localEndpoint: 'http://localhost:8082' });
    this.extractor = new EntityExtractor(minimalClient);

    // Start background queue processor
    this.startBackgroundProcessor();

    // Start TTL pruning scheduler
    this.startTTLPruningScheduler();

    // Start co-occurrence builder scheduler (Stage 2)
    this.startCooccurrenceScheduler();

    // Start relation classifier scheduler (Stage 2: LLM classification)
    this.startRelationClassifierScheduler();
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
          logInfo(`Frozen super node "${entityId}" (relation_count: ${relationCount})`);
          return true;
        }

        return false;
      }

      return false;
    } catch (error: any) {
      return false;
    }
  }

  /**
   * 4. runTTLPruning - Prune entities not accessed in TTL_DAYS
   * Returns number of entities pruned
   */
  async runTTLPruning(): Promise<number> {
    if (!this.db) {
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
      logInfo(`TTL Pruning: marked ${markedCount} inactive, deleted ${deletedCount} entities older than ${this.ttlDays} days`);

      return deletedCount;
    } catch (error: any) {
      logError(`TTL Pruning failed: ${error.message}`);
      return 0;
    }
  }

  /**
   * 5. runAliasMerge - Merge alias entities to canonical names
   * Returns number of aliases merged
   */
  async runAliasMerge(): Promise<number> {
    if (!this.db || this.aliasPairs.length === 0) {
      logWarn('Alias Merge skipped: no database or alias pairs');
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
        const aliasId = this.extractStringId(aliasEntity.id);

        // Skip if alias already has canonical_id (already merged)
        if (aliasEntity.canonical_id) {
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

        let canonicalId: string;
        if (canonicalData.length > 0) {
          canonicalId = this.extractStringId(canonicalData[0].id);
        } else {
          // Create canonical entity
          canonicalId = await this.db.upsertEntity(canonical, 'merged');
        }

        // Transfer links from alias to canonical
        await this.transferEntityLinks(aliasId, canonicalId);

        // Mark alias as merged (set canonical_id, don't delete)
        const canonicalRecordId = `entity:${canonicalId}`;
        await this.db.query(
          `UPDATE entity:${aliasId} SET canonical_id = '${canonicalRecordId}', is_active = false`
        );

        mergedCount++;
        this.totalMerged += mergedCount;
      }

      return mergedCount;
    } catch (error: any) {
      return 0;
    }
  }

  /**
   * Transfer links from one entity to another
   */
  private async transferEntityLinks(fromEntityId: string, toEntityId: string): Promise<void> {
    if (!this.db) return;

    try {
      // Update memory_entity edges to point to new entity
      const sql = `UPDATE memory_entity SET entity = '${toEntityId}' WHERE entity = '${fromEntityId}'`;
      await this.db.query(sql);
    } catch (error: any) {
      // Silently ignore
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

    logInfo(
      `Backpressure adjusted interval to ${this.currentIndexIntervalMs}ms ` +
      `(queue: ${queueSize}, memory: ${(memoryUsage * 100).toFixed(1)}%, CPU: ${(cpuLoad * 100).toFixed(1)}%)`
    );
  }

  /**
   * Get EntityExtractor instance (for loading known entities cache)
   */
  getExtractor(): EntityExtractor {
    return this.extractor;
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
        continue;
      }

      // Check if entity is a super node
      const isSuperNode = await this.checkSuperNode(entity.name);

      if (isSuperNode) {
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
    }

    // Mark memory as indexed
    await this.db.query(
      `UPDATE memory:${item.memoryId} SET is_indexed = true`
    );
  }

  private backgroundInterval?: NodeJS.Timeout;

  /**
   * Start background queue processor
   */
  private startBackgroundProcessor(): void {
    this.backgroundInterval = setInterval(async () => {
      if (!this.processing && this.queue.length > 0) {
        this.processQueue().catch(console.error);
      }
    }, this.currentIndexIntervalMs);
    this.backgroundInterval.unref();
  }

  private ttlPruningInterval?: NodeJS.Timeout;

  /**
   * Start TTL pruning scheduler (runs every PRUNE_INTERVAL_DAYS)
   */
  private startTTLPruningScheduler(): void {
    const pruneIntervalMs = this.pruneIntervalDays * 24 * 60 * 60 * 1000;

    this.ttlPruningInterval = setInterval(async () => {
      await this.runTTLPruning().catch(console.error);
    }, pruneIntervalMs);
    this.ttlPruningInterval.unref();

    logInfo(`TTL Pruning scheduled every ${this.pruneIntervalDays} days`);
  }

  private cooccurrenceInterval?: NodeJS.Timeout;

  /**
   * Start co-occurrence builder scheduler (Stage 2)
   * Runs every 7 days to build entity-entity relationships
   */
  private startCooccurrenceScheduler(): void {
    const cooccurrenceIntervalMs = 7 * 24 * 60 * 60 * 1000;  // 7 days

    this.cooccurrenceInterval = setInterval(async () => {
      await this.buildEntityCooccurrence().catch(console.error);
    }, cooccurrenceIntervalMs);
    this.cooccurrenceInterval.unref();

    logInfo(`Co-occurrence builder scheduled every 7 days`);
  }

  /**
   * Build entity co-occurrence relationships (Stage 2)
   * Delegates to SurrealDatabase.buildEntityCooccurrence()
   */
  async buildEntityCooccurrence(): Promise<number> {
    if (!this.db) {
      logWarn('Skip co-occurrence build: no database connection');
      return 0;
    }

    try {
      const relationsBuilt = await this.db.buildEntityCooccurrence(1000);
      this.totalRelationsBuilt += relationsBuilt;
      logInfo(`Built ${relationsBuilt} entity relations`);
      return relationsBuilt;
    } catch (error: any) {
      logError(`buildEntityCooccurrence failed: ${error.message}`);
      return 0;
    }
  }

  /**
   * Prune low-weight entity-entity edges (Stage 2)
   * Delegates to SurrealDatabase.pruneLowWeightEdges()
   */
  async pruneLowWeightEdges(minWeight: number = 0.1): Promise<number> {
    if (!this.db) {
      logWarn('Skip edge pruning: no database connection');
      return 0;
    }

    try {
      const pruned = await this.db.pruneLowWeightEdges(minWeight);
      logInfo(`Pruned ${pruned} low-weight entity relations`);
      return pruned;
    } catch (error: any) {
      logError(`pruneLowWeightEdges failed: ${error.message}`);
      return 0;
    }
  }

  /**
   * Multi-degree association search (Stage 2)
   * Delegates to SurrealDatabase.searchByMultiDegree()
   */
  async searchByMultiDegree(
    seedMemoryId: number,
    degree: number = 2,
    minWeight: number = 0.1,
    limit: number = 20
  ): Promise<any[]> {
    if (!this.db) {
      return [];
    }

    try {
      return await this.db.searchByMultiDegree(seedMemoryId, degree, minWeight, limit);
    } catch (error: any) {
      return [];
    }
  }

  /**
   * Get relation statistics (Stage 2)
   */
  async getRelationStats(): Promise<any> {
    if (!this.db) {
      return { total_relations: 0, avg_weight: 0, max_weight: 0, min_weight: 0, by_type: {} };
    }

    try {
      return await this.db.getRelationStats();
    } catch (error: any) {
      return { total_relations: 0, avg_weight: 0, max_weight: 0, min_weight: 0, by_type: {} };
    }
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
      totalRelationsBuilt: this.totalRelationsBuilt,
      currentIntervalMs: this.currentIndexIntervalMs,
    };
  }

  /**
   * Clear the indexing queue
   */
  clearQueue(): void {
    this.queue = [];
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.totalIndexed = 0;
    this.totalFrozen = 0;
    this.totalPruned = 0;
    this.totalMerged = 0;
    this.totalRelationsBuilt = 0;
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

  /**
   * Utility: extract string ID from various ID formats
   */
  private extractStringId(id: any): string {
    if (typeof id === 'string') {
      const parts = id.split(':');
      return parts[parts.length - 1];
    }
    if (typeof id === 'number') {
      return String(id);
    }
    if (id && typeof id === 'object' && id.id !== undefined) {
      return this.extractStringId(id.id);
    }
    return String(id);
  }

  // ==================== Stage 2: LLM Relation Classification ====================

  private readonly relationClassifierIntervalMs: number = 6 * 60 * 60 * 1000;  // 6 hours
  private readonly relationClassifierBatchSize: number = 100;  // Per batch
  private totalClassified = 0;  // Tracking total classified relations
  private relationClassifierInterval?: NodeJS.Timeout;

  /**
   * Start relation classifier scheduler
   * Runs every 6 hours to classify co_occurs relations using LLM
   */
  private startRelationClassifierScheduler(): void {
    // Check CPU load before running - backpressure aware
    const checkLoadAndRun = async () => {
      const load = os.loadavg();
      const loadAvg = load[0];  // 1-minute load average

      // Skip if system is under heavy load
      if (loadAvg > this.cpuThreshold) {
        logWarn(`Skip relation classification: high CPU load (${loadAvg.toFixed(2)})`);
        return;
      }

      await this.classifyEntityRelations().catch(console.error);
    };

    this.relationClassifierInterval = setInterval(checkLoadAndRun, this.relationClassifierIntervalMs);
    this.relationClassifierInterval.unref();

    logInfo(`Relation classifier scheduled every 6 hours (CPU threshold: ${this.cpuThreshold})`);
  }

  /**
   * Classify entity relations using LLM
   * Queries all co_occurs relations and classifies them with semantic types
   *
   * @returns Number of successfully classified relations
   */
  async classifyEntityRelations(): Promise<number> {
    if (!this.db) {
      logWarn('Skip relation classification: no database');
      return 0;
    }

    try {
      // Step 1: Query unclassified relations
      const unclassifiedSql = `
        SELECT * FROM ${ENTITY_RELATION_TABLE}
        WHERE relation_type = 'co_occurs' OR is_manual_refined = false
        ORDER BY created_at ASC
        LIMIT ${this.relationClassifierBatchSize}
      `;

      const unclassifiedResult = await this.db.query(unclassifiedSql);

      const relations = this.extractResultArray(unclassifiedResult);

      if (relations.length === 0) {
        logInfo('No unclassified relations found');
        return 0;
      }

      logInfo(`Found ${relations.length} relations to classify`);

      let classified = 0;

      for (const relation of relations) {
        try {
          // Step 2: Get entity A and B info
          const inEntityId = this.extractId(relation.in);
          const outEntityId = this.extractId(relation.out);

          const entityA = await this.getEntityById(inEntityId);
          const entityB = await this.getEntityById(outEntityId);

          if (!entityA || !entityB) {
            logWarn(`Skip relation ${relation.id}: entity not found (may be pruned)`);
            continue;
          }

          // Step 3: Get co-occurrence memory snippets with context window
          const memoryIds = relation.evidence_memory_ids || [];
          const memorySnippets = await this.getMemorySnippets(memoryIds.slice(0, 3), [entityA.name, entityB.name]);

          // Step 4: Build LLM prompt
          const prompt = this.buildRelationClassificationPrompt(
            entityA.name, entityA.entity_type || 'unknown',
            entityB.name, entityB.entity_type || 'unknown',
            relation.weight || 1.0,
            memorySnippets
          );

          // Step 5: Call LLM with timeout using EntityExtractor's client
          const llmResult = await this.extractor.completeJson<{ type: string; confidence: number }>(
            prompt,
            'entity-indexer',
            { temperature: 0.3, maxTokens: 100 }
          );

          // Step 6: Parse and validate response
          const classification = this.parseClassificationResponse(llmResult);

          // Step 7: Update relation with classification
          await this.updateRelationClassification(relation, classification);

          classified++;

        } catch (error: any) {
          logError(`Failed to classify relation ${relation.id}: ${error.message}`);
          // Continue to next relation
        }
      }

      this.totalClassified += classified;
      logInfo(`Classified ${classified} relations (total: ${this.totalClassified})`);
      return classified;

    } catch (error: any) {
      logError(`Relation classification failed: ${error.message}`);
      return 0;
    }
  }

  /**
   * Get entity by ID
   */
  private async getEntityById(entityId: number): Promise<{ name: string; entity_type?: string } | null> {
    try {
      if (!this.db) return null;
      const result = await this.db.query(
        `SELECT name, entity_type FROM ${ENTITY_TABLE}:${entityId}`
      );
      const entities = this.extractResultArray(result);
      return entities.length > 0 ? entities[0] : null;
    } catch {
      return null;
    }
  }

  /**
   * Get memory snippets with context window
   * Uses diverse sampling to ensure variety from different documents/time periods
   */
  private async getMemorySnippets(memoryIds: number[], entities: string[]): Promise<string[]> {
    if (!this.db || memoryIds.length === 0) {
      return [];
    }

    try {
      // Query all memories with metadata for diverse sampling
      const idsStr = memoryIds.map(id => `'${id}'`).join(', ');
      const result = await this.db.query(
        `SELECT content, created_at, document_id FROM ${MEMORY_TABLE} WHERE id IN [${idsStr}] ORDER BY created_at ASC`
      );

      const memories = this.extractResultArray(result);

      if (memories.length === 0) {
        return [];
      }

      // Use diverse sampling to select memories from different documents/time periods
      const sampledMemories = diverseSample(memories, 3);

      const snippets: string[] = [];
      for (const memory of sampledMemories) {
        if (memory.content) {
          // Use context window extraction
          const windows = extractContextWindow(memory.content, entities, {
            windowSize: 100,
            maxSnippets: 1
          });
          snippets.push(...windows);
        }
      }

      return snippets.slice(0, 3);

    } catch (error: any) {
      return [];
    }
  }

  /**
   * Build relation classification prompt for LLM
   */
  private buildRelationClassificationPrompt(
    entityAName: string,
    entityAType: string,
    entityBName: string,
    entityBType: string,
    cooccurrenceCount: number,
    memorySnippets: string[]
  ): string {
    const snippetsText = memorySnippets.map((s, i) => `${i + 1}. "${s.substring(0, 200)}"`).join('\n');

    return `你是一名知识图谱关系分类专家。根据以下实体信息和共现上下文，
选择最合适的关系类型。

## 实体 A（in）
- 名称：${entityAName}
- 类型：${entityAType}

## 实体 B（out）
- 名称：${entityBName}
- 类型：${entityBType}

## 共现信息
- 共现次数：${cooccurrenceCount}

## 共现的 Memory 片段（前 3 条，每条约 200 字窗口）
${snippetsText}

## 可选关系类型
- causes: 因果关系（A 导致 B）
- used_for: 用途关系（A 用于 B）
- member_of: 成员关系（A 属于 B 的组成部分）
- located_in: 位置关系（A 位于 B 的范围内）
- created_by: 创建关系（A 由 B 创建）
- related_to: 通用关联（有语义关联但无法归类）
- no_logical_relation: 无逻辑关系（仅偶然共现，无语义关联）

## 方向性说明
- 默认关系方向：A → B
- 如果实际关系是 B → A（如"B 创建了 A"），请设置 reverse_direction = true
- 或者返回 source 字段指定关系的源实体（如"Facebook"表示 Facebook -> created_by -> React）

## 输出格式
严格返回 JSON 格式：
{
  "relation_type": "<选择的类型>",
  "confidence": <0.0-1.0>,
  "reasoning": "<简短解释，50 字以内>",
  "reverse_direction": <true/false>,
  "source": "<实体名称，关系的源头>"
}

JSON:`;
  }

  /**
   * Parse LLM classification response
   */
  private parseClassificationResponse(llmResult: any): {
    relation_type: string;
    confidence: number;
    reasoning: string;
    reverse_direction: boolean;
    source?: string;  // New: source entity for direction healing
  } {
    const VALID_TYPES = [
      'causes', 'used_for', 'member_of', 'located_in',
      'created_by', 'related_to', 'no_logical_relation'
    ];

    try {
      // Try to extract JSON from response
      let output = llmResult.content || llmResult.generated_text || '';

      // Try to find JSON object
      const jsonMatch = output.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        output = jsonMatch[0];
      }

      const parsed = JSON.parse(output);

      let relationType = parsed.relation_type || 'related_to';
      let confidence = typeof parsed.confidence === 'number' ? parsed.confidence : 0.5;
      let reasoning = parsed.reasoning || '';
      let reverseDirection = parsed.reverse_direction === true;
      let source = parsed.source;  // New: source entity name

      // Validate relation type
      if (!VALID_TYPES.includes(relationType)) {
        relationType = 'related_to';
      }

      // Normalize confidence
      confidence = Math.max(0, Math.min(1, confidence));

      return { relation_type: relationType, confidence, reasoning, reverse_direction: reverseDirection, source };

    } catch {
      // Default fallback
      return {
        relation_type: 'related_to',
        confidence: 0.5,
        reasoning: 'Parse failed, using default',
        reverse_direction: false,
        source: undefined
      };
    }
  }

  /**
   * Update relation with classification result
   * Handles direction reversal and source-based direction healing
   */
  private async updateRelationClassification(
    relation: any,
    classification: {
      relation_type: string;
      confidence: number;
      reasoning: string;
      reverse_direction: boolean;
      source?: string;
    }
  ): Promise<void> {
    if (!this.db) {
      return;
    }

    const { relation_type, confidence, reasoning, reverse_direction, source } = classification;

    // Get current relation's "in" entity name for direction comparison
    const currentInId = this.extractId(relation.in);
    let needsDirectionCorrection = reverse_direction;

    // New: Check if source field indicates different direction
    if (source) {
      // Get entity names to compare with source
      const inEntity = await this.getEntityById(currentInId);
      const outEntity = await this.getEntityById(this.extractId(relation.out));

      // If source matches "out" entity, the direction should be reversed
      if (inEntity && outEntity) {
        if (source.toLowerCase() === outEntity.name.toLowerCase()) {
          needsDirectionCorrection = true;
        }
      }
    }

    if (needsDirectionCorrection) {
      // Delete old relation and create reverse
      const relationId = this.extractId(relation.id);
      const deleteSql = `DELETE ${ENTITY_RELATION_TABLE}:${relationId}`;
      await this.db.query(deleteSql);

      const createSql = `
        RELATE ${this.extractResultId(relation.out)}->${ENTITY_RELATION_TABLE}->${this.extractResultId(relation.in)}
        SET
          relation_type = '${relation_type}',
          confidence = ${confidence},
          reasoning = '${reasoning.replace(/'/g, "\\'")}',
          is_manual_refined = true,
          evidence_memory_ids = ${JSON.stringify(relation.evidence_memory_ids || [])},
          weight = ${relation.weight || 1.0},
          source = ${source ? `'${source.replace(/'/g, "\\'")}'` : 'NULL'},
          updated_at = time::now()
      `;

      await this.db.query(createSql);
    } else {
      // Update existing relation
      const updateSql = `
        UPDATE ${ENTITY_RELATION_TABLE}:${this.extractId(relation.id)}
        SET
          relation_type = '${relation_type}',
          confidence = ${confidence},
          reasoning = '${reasoning.replace(/'/g, "\\'")}',
          is_manual_refined = true,
          source = ${source ? `'${source.replace(/'/g, "\\'")}'` : 'NULL'},
          updated_at = time::now()
      `;

      await this.db.query(updateSql);
    }
  }

  /**
   * Helper: extract array from SurrealDB result
   */
  private extractResultArray(result: any): any[] {
    if (Array.isArray(result)) {
      if (result.length > 0 && Array.isArray(result[0])) {
        return result[0];
      }
      if ((result as any)[0]?.result && Array.isArray((result as any)[0].result)) {
        return (result as any)[0].result;
      }
      return result;
    }
    return [];
  }

  /**
   * Helper: extract result ID
   */
  private extractResultId(id: any): string {
    if (typeof id === 'string') return id;
    if (id && typeof id === 'object' && id.tb && id.id) {
      return `${id.tb}:${id.id}`;
    }
    return `entity:${id}`;
  }

  /**
   * Dispose - clear all background intervals
   */
  dispose(): void {
    if (this.backgroundInterval) {
      clearInterval(this.backgroundInterval);
      this.backgroundInterval = undefined;
    }
    if (this.ttlPruningInterval) {
      clearInterval(this.ttlPruningInterval);
      this.ttlPruningInterval = undefined;
    }
    if (this.cooccurrenceInterval) {
      clearInterval(this.cooccurrenceInterval);
      this.cooccurrenceInterval = undefined;
    }
    if (this.relationClassifierInterval) {
      clearInterval(this.relationClassifierInterval);
      this.relationClassifierInterval = undefined;
    }
    logInfo('[EntityIndexer] Disposed');
  }
}

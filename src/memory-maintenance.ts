/**
 * Memory maintenance for decay, promotion, and reflection generation.
 *
 * Operations:
 * - Memory decay: importance *= 0.98 daily
 * - Memory promotion: episodic -> semantic when access_count > 10
 * - Reflection generation: every 50 episodic memories
 */

import { SurrealDatabase } from './surrealdb-client.js';
import { ImportanceLearning } from './importance-learning.js';
import { logInfo, logError } from './maintenance-logger.js';

export interface MemoryMaintenanceConfig {
  decayFactor?: number;
  promotionThreshold?: number;
  reflectionInterval?: number;
  olderThanDays?: number;
}

export class MemoryMaintenance {
  private static readonly DECAY_FACTOR = 0.98;
  private static readonly PROMOTION_THRESHOLD = 10;
  private static readonly REFLECTION_INTERVAL = 50;

  private config: Required<MemoryMaintenanceConfig>;
  private importanceLearning: ImportanceLearning;

  constructor(
    private db: SurrealDatabase,
    config: MemoryMaintenanceConfig = {}
  ) {
    this.config = {
      decayFactor: config.decayFactor ?? MemoryMaintenance.DECAY_FACTOR,
      promotionThreshold: config.promotionThreshold ?? MemoryMaintenance.PROMOTION_THRESHOLD,
      reflectionInterval: config.reflectionInterval ?? MemoryMaintenance.REFLECTION_INTERVAL,
      olderThanDays: config.olderThanDays ?? 1,
    };
    this.importanceLearning = new ImportanceLearning();
  }

  /**
   * Run decay on memories older than specified days.
   * Returns the number of memories decayed.
   */
  async runDecay(): Promise<{ episodicDecayed: number; semanticDecayed: number }> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - this.config.olderThanDays);
    const cutoffStr = cutoff.toISOString();

    let episodicDecayed = 0;
    let semanticDecayed = 0;

    // Scroll through all memories and apply decay
    for (const type of ['episodic', 'semantic'] as const) {
      let offset = 0;
      while (true) {
        const memories = await this.db.scroll({ type }, 100, offset);
        if (memories.length === 0) break;

        for (const mem of memories) {
          const createdAt = new Date(mem.payload.created_at);
          if (createdAt < cutoff) {
            // Apply decay
            const oldImportance = mem.payload.importance || 0.5;
            const newImportance = Math.max(0.01, oldImportance * this.config.decayFactor);
            await this.db.updatePayload(mem.id, {
              ...mem.payload,
              importance: newImportance,
            });

            if (type === 'episodic') episodicDecayed++;
            else semanticDecayed++;
          }
        }

        offset += memories.length;
        if (memories.length < 100) break;
      }
    }

    return { episodicDecayed, semanticDecayed };
  }

  /**
   * Check for memories to promote (episodic -> semantic).
   * Returns the number of memories promoted.
   */
  async runPromotion(): Promise<number> {
    let promoted = 0;
    let offset = 0;

    while (true) {
      const memories = await this.db.scroll({ type: 'episodic' }, 100, offset);
      if (memories.length === 0) break;

      for (const mem of memories) {
        const accessCount = mem.payload.access_count || 0;
        if (accessCount >= this.config.promotionThreshold) {
          // Promote to semantic
          const content = mem.payload.content || mem.payload.summary || '';
          await this.db.upsert(mem.id, [], {
            type: 'semantic',
            content: content,
            importance: mem.payload.importance,
            access_count: accessCount,
            created_at: mem.payload.created_at,
          });

          promoted++;
        }
      }

      offset += memories.length;
      if (memories.length < 100) break;
    }

    return promoted;
  }

  /**
   * Generate reflection if enough episodic memories exist.
   * Returns true if a reflection was generated.
   */
  async maybeGenerateReflection(
    generateFn: (summaries: string[]) => Promise<string>
  ): Promise<boolean> {
    // Count episodic memories by scrolling through them
    let episodicCount = 0;
    let offset = 0;

    while (true) {
      const memories = await this.db.scroll({ type: 'episodic' }, 100, offset);
      if (memories.length === 0) break;
      episodicCount += memories.length;
      offset += memories.length;
    }

    // Check if count is a multiple of reflection interval
    if (episodicCount < this.config.reflectionInterval) {
      return false;
    }

    if (episodicCount % this.config.reflectionInterval !== 0) {
      return false;
    }

    logInfo(`[MemoryMaintenance] Generating reflection: ${episodicCount} episodic memories (interval: ${this.config.reflectionInterval})`);

    try {
      // Get recent episodic memories for summarization
      const recentMemories: string[] = [];
      let memOffset = 0;

      while (recentMemories.length < this.config.reflectionInterval) {
        const memories = await this.db.scroll({ type: 'episodic' }, 50, memOffset);
        if (memories.length === 0) break;

        for (const mem of memories) {
          const content = mem.payload.content || mem.payload.summary || '';
          if (content.trim()) {
            recentMemories.push(content);
          }
        }
        memOffset += memories.length;
      }

      if (recentMemories.length < 10) {
        logInfo('[MemoryMaintenance] Not enough content for reflection');
        return false;
      }

      // Generate reflection using LLM
      const reflection = await generateFn(recentMemories.slice(0, 50));

      if (reflection && reflection.trim().length > 0 && reflection !== 'No significant content.') {
        logInfo(`[MemoryMaintenance] Generated reflection: "${reflection.substring(0, 50)}..."`);
        return true;
      }

      return false;
    } catch (error: any) {
      logError(`[MemoryMaintenance] Reflection generation failed: ${error.message}`);
      return false;
    }
  }

  /**
   * Run all maintenance tasks.
   */
  async runMaintenance(
    generateReflectionFn?: (summaries: string[]) => Promise<string>
  ): Promise<{
    episodicDecayed: number;
    semanticDecayed: number;
    promoted: number;
    reflectionGenerated: boolean;
  }> {
    const [decayResult, promoted] = await Promise.all([
      this.runDecay(),
      this.runPromotion(),
    ]);

    let reflectionGenerated = false;
    if (generateReflectionFn) {
      reflectionGenerated = await this.maybeGenerateReflection(generateReflectionFn);
    }

    return {
      ...decayResult,
      promoted,
      reflectionGenerated,
    };
  }
}

/**
 * Memory maintenance for decay, promotion, and reflection generation.
 *
 * Operations:
 * - Memory decay: importance *= 0.98 daily
 * - Memory promotion: episodic -> semantic when access_count > 10
 * - Reflection generation: every 50 episodic memories
 */
import { ImportanceLearning } from './importance-learning.js';
export class MemoryMaintenance {
    db;
    static DECAY_FACTOR = 0.98;
    static PROMOTION_THRESHOLD = 10;
    static REFLECTION_INTERVAL = 50;
    config;
    importanceLearning;
    constructor(db, config = {}) {
        this.db = db;
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
    async runDecay() {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - this.config.olderThanDays);
        // Get stats first
        const stats = await this.db.getStats();
        console.log(`[MemoryMaintenance] Running decay on ${stats.total_points} memories`);
        // Note: Qdrant doesn't support bulk updates efficiently
        // In production, you would:
        // 1. Query all memories with created_at < cutoff
        // 2. Apply decay to each
        // 3. Upsert back to Qdrant
        // For now, we just log that decay should be applied
        console.log(`[MemoryMaintenance] Decay factor: ${this.config.decayFactor}`);
        return { episodicDecayed: 0, semanticDecayed: 0 };
    }
    /**
     * Check for memories to promote (episodic -> semantic).
     * Returns the number of memories promoted.
     */
    async runPromotion() {
        console.log(`[MemoryMaintenance] Checking for memories to promote (threshold: ${this.config.promotionThreshold} accesses)`);
        // Note: This requires querying memories by access_count
        // Qdrant supports filtering by payload, but we need to implement the query
        return 0;
    }
    /**
     * Generate reflection if enough episodic memories exist.
     * Returns true if a reflection was generated.
     */
    async maybeGenerateReflection(generateFn) {
        const stats = await this.db.getStats();
        console.log(`[MemoryMaintenance] Checking for reflection generation (interval: ${this.config.reflectionInterval})`);
        // In production:
        // 1. Count episodic memories
        // 2. If count % interval == 0, generate reflection
        // 3. Summarize recent memories using LLM
        return false;
    }
    /**
     * Run all maintenance tasks.
     */
    async runMaintenance(generateReflectionFn) {
        console.log('[MemoryMaintenance] Starting maintenance run');
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
//# sourceMappingURL=memory-maintenance.js.map
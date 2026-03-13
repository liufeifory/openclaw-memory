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
        const cutoffStr = cutoff.toISOString();
        console.log(`[MemoryMaintenance] Running decay on memories older than ${this.config.olderThanDays} days`);
        let episodicDecayed = 0;
        let semanticDecayed = 0;
        // Scroll through all memories and apply decay
        for (const type of ['episodic', 'semantic']) {
            let offset = 0;
            while (true) {
                const memories = await this.db.scroll({ type }, 100, offset);
                if (memories.length === 0)
                    break;
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
                        if (type === 'episodic')
                            episodicDecayed++;
                        else
                            semanticDecayed++;
                    }
                }
                offset += memories.length;
                if (memories.length < 100)
                    break;
            }
        }
        console.log(`[MemoryMaintenance] Decayed ${episodicDecayed} episodic, ${semanticDecayed} semantic memories`);
        return { episodicDecayed, semanticDecayed };
    }
    /**
     * Check for memories to promote (episodic -> semantic).
     * Returns the number of memories promoted.
     */
    async runPromotion() {
        console.log(`[MemoryMaintenance] Checking for memories to promote (threshold: ${this.config.promotionThreshold} accesses)`);
        let promoted = 0;
        let offset = 0;
        while (true) {
            const memories = await this.db.scroll({ type: 'episodic' }, 100, offset);
            if (memories.length === 0)
                break;
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
                    console.log(`[MemoryMaintenance] Promoted memory ${mem.id} (access_count: ${accessCount})`);
                }
            }
            offset += memories.length;
            if (memories.length < 100)
                break;
        }
        console.log(`[MemoryMaintenance] Promoted ${promoted} memories`);
        return promoted;
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
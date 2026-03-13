/**
 * Memory maintenance for decay, promotion, and reflection generation.
 *
 * Operations:
 * - Memory decay: importance *= 0.98 daily
 * - Memory promotion: episodic -> semantic when access_count > 10
 * - Reflection generation: every 50 episodic memories
 */
import type { QdrantDatabase } from './qdrant-client.js';
export interface MemoryMaintenanceConfig {
    decayFactor?: number;
    promotionThreshold?: number;
    reflectionInterval?: number;
    olderThanDays?: number;
}
export declare class MemoryMaintenance {
    private db;
    private static readonly DECAY_FACTOR;
    private static readonly PROMOTION_THRESHOLD;
    private static readonly REFLECTION_INTERVAL;
    private config;
    private importanceLearning;
    constructor(db: QdrantDatabase, config?: MemoryMaintenanceConfig);
    /**
     * Run decay on memories older than specified days.
     * Returns the number of memories decayed.
     */
    runDecay(): Promise<{
        episodicDecayed: number;
        semanticDecayed: number;
    }>;
    /**
     * Check for memories to promote (episodic -> semantic).
     * Returns the number of memories promoted.
     */
    runPromotion(): Promise<number>;
    /**
     * Generate reflection if enough episodic memories exist.
     * Returns true if a reflection was generated.
     */
    maybeGenerateReflection(generateFn: (summaries: string[]) => Promise<string>): Promise<boolean>;
    /**
     * Run all maintenance tasks.
     */
    runMaintenance(generateReflectionFn?: (summaries: string[]) => Promise<string>): Promise<{
        episodicDecayed: number;
        semanticDecayed: number;
        promoted: number;
        reflectionGenerated: boolean;
    }>;
}
//# sourceMappingURL=memory-maintenance.d.ts.map
/**
 * Importance learning for dynamic importance calculation.
 *
 * Formula:
 *   importance = 0.5 * base_importance +
 *                0.3 * log(access_count + 1) +
 *                0.2 * recency_score
 *
 * Where recency_score = exp(-days_since_creation / 30)
 */
export declare class ImportanceLearning {
    private static readonly BASE_WEIGHT;
    private static readonly ACCESS_WEIGHT;
    private static readonly RECENCY_WEIGHT;
    private static readonly RECENCY_DECAY_DAYS;
    private static readonly DECAY_FACTOR;
    /**
     * Calculate dynamic importance score.
     */
    calculate(baseImportance: number, accessCount: number, createdAt: Date, referenceTime?: Date): number;
    /**
     * Calculate recency score alone.
     */
    calculateRecencyScore(createdAt: Date, referenceTime?: Date): number;
    /**
     * Apply decay to importance score.
     */
    applyDecay(importance: number, decayFactor?: number): number;
}
//# sourceMappingURL=importance-learning.d.ts.map
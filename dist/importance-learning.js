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
export class ImportanceLearning {
    // Weights for importance calculation
    static BASE_WEIGHT = 0.5;
    static ACCESS_WEIGHT = 0.3;
    static RECENCY_WEIGHT = 0.2;
    // Recency decay constant (days)
    static RECENCY_DECAY_DAYS = 30;
    // Decay factor (daily)
    static DECAY_FACTOR = 0.98;
    /**
     * Calculate dynamic importance score.
     */
    calculate(baseImportance, accessCount, createdAt, referenceTime = new Date()) {
        // Calculate recency score
        const daysSinceCreation = (referenceTime.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24);
        const recencyScore = Math.exp(-daysSinceCreation / ImportanceLearning.RECENCY_DECAY_DAYS);
        // Calculate access score (normalized)
        const accessScore = Math.log(accessCount + 1);
        // Combine scores with weights
        const importance = ImportanceLearning.BASE_WEIGHT * baseImportance +
            ImportanceLearning.ACCESS_WEIGHT * accessScore +
            ImportanceLearning.RECENCY_WEIGHT * recencyScore;
        // Normalize to 0.0-1.0 range
        return Math.max(0.0, Math.min(1.0, importance));
    }
    /**
     * Calculate recency score alone.
     */
    calculateRecencyScore(createdAt, referenceTime = new Date()) {
        const daysSinceCreation = (referenceTime.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24);
        return Math.exp(-daysSinceCreation / ImportanceLearning.RECENCY_DECAY_DAYS);
    }
    /**
     * Apply decay to importance score.
     */
    applyDecay(importance, decayFactor = ImportanceLearning.DECAY_FACTOR) {
        return Math.max(0.0, importance * decayFactor);
    }
}
//# sourceMappingURL=importance-learning.js.map
/**
 * Conflict Detector using Llama-3.2-1B-Instruct
 *
 * Detects contradictory memories and marks old ones as deprecated.
 */
export interface ConflictResult {
    isConflict: boolean;
    oldMemoryId?: number;
    reason: string;
}
export declare class ConflictDetector {
    private endpoint;
    constructor(endpoint?: string);
    /**
     * Check if new content conflicts with existing memories.
     * @param newContent - The new memory content
     * @param similarMemories - Memories with high vector similarity
     * @returns Conflict detection result
     */
    detectConflict(newContent: string, similarMemories: Array<{
        id: number;
        content: string;
        type: string;
    }>): Promise<ConflictResult>;
    /**
     * Check pairwise conflict between two statements.
     */
    private checkPairwise;
}
//# sourceMappingURL=conflict-detector.d.ts.map
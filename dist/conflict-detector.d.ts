/**
 * Conflict Detector using Llama-3.2-1B-Instruct
 *
 * Detects contradictory memories and marks old ones with superseded_by tag.
 */
import { LLMLimiter } from './llm-limiter.js';
export interface ConflictResult {
    isConflict: boolean;
    oldMemoryId?: number;
    reason: string;
    supersededBy?: number;
}
export declare class ConflictDetector {
    private endpoint;
    private limiter;
    constructor(endpoint?: string, limiter?: LLMLimiter);
    /**
     * Check if new content conflicts with existing memories.
     * @param newContent - The new memory content
     * @param similarMemories - Memories with high vector similarity
     * @param storeMemory - Optional function to store/update memory metadata
     * @returns Conflict detection result
     */
    detectConflict(newContent: string, similarMemories: Array<{
        id: number;
        content: string;
        type: string;
    }>, storeMemory?: (memoryId: number, metadata: {
        superseded_by?: number;
        is_active?: boolean;
    }) => Promise<void>): Promise<ConflictResult>;
    /**
     * Check pairwise conflict between two statements.
     */
    private checkPairwise;
}
//# sourceMappingURL=conflict-detector.d.ts.map
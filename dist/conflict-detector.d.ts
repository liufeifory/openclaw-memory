/**
 * Conflict Detector using LLM
 *
 * Detects contradictory memories and marks old ones with superseded_by tag.
 * Uses local 7B model by default (high-frequency task).
 */
import { LLMLimiter } from './llm-limiter.js';
import { LLMClient } from './llm-client.js';
export interface ConflictResult {
    isConflict: boolean;
    oldMemoryId?: number;
    reason: string;
    supersededBy?: number;
}
export declare class ConflictDetector {
    private client;
    private limiter;
    constructor(client: LLMClient, limiter?: LLMLimiter);
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
     * Uses LLM for semantic analysis with keyword-based fallback.
     */
    private checkPairwise;
    /**
     * Keyword-based fallback conflict detection.
     */
    private checkKeywordConflict;
}
//# sourceMappingURL=conflict-detector.d.ts.map
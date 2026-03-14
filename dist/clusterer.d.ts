/**
 * Semantic Clusterer for Memory Merging
 *
 * Clusters semantically similar memories (similarity > 0.9) and merges them
 * into permanent facts during idle time.
 *
 * Features:
 * - Async worker (non-blocking)
 * - source_ids tracking for traceability
 * - Fidelity preservation (no over-generalization)
 * - Conflict detection via conflict-detector.ts
 */
import { LLMLimiter } from './llm-limiter.js';
export interface ClusteredMemory {
    theme: string;
    memoryIndices: number[];
    memories: string[];
}
export interface MergeResult {
    mergedContent: string | null;
    entities: string[];
    confidence: number;
    reason: string;
}
export interface ClusterResult {
    clusters: ClusteredMemory[];
    totalMemories: number;
    clusteredCount: number;
}
export declare class SemanticClusterer {
    private endpoint;
    private limiter;
    private conflictDetector;
    private entityPatterns;
    constructor(endpoint?: string, limiter?: LLMLimiter);
    /**
     * Cluster memories by semantic similarity.
     * Only clusters memories with similarity > 0.9.
     */
    cluster(memories: Array<{
        id: number;
        content: string;
    }>): Promise<ClusterResult>;
    /**
     * Merge a cluster of similar memories into one permanent fact.
     * Extracts entities first to ensure preservation.
     */
    mergeCluster(cluster: ClusteredMemory, existingMergedMemories?: Array<{
        id: number;
        content: string;
    }>): Promise<MergeResult>;
    /**
     * Parse cluster JSON from LLM output.
     */
    private parseClusters;
    /**
     * Extract technical entities from memories using regex patterns.
     * Used to preserve entities during summarization.
     */
    private extractEntities;
    /**
     * Parse merge result JSON from LLM output.
     */
    private parseMergeResult;
    /**
     * Run clustering in background (async worker).
     * Non-blocking - processes memories during idle time.
     */
    runIdleClustering(getMemories: () => Promise<Array<{
        id: number;
        content: string;
    }>>, onClusterMerged: (result: {
        theme: string;
        mergedContent: string;
        sourceIds: number[];
    }) => Promise<void>): Promise<void>;
}
//# sourceMappingURL=clusterer.d.ts.map
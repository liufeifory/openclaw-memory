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
import { LLMClient } from './llm-client.js';
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
export interface HierarchicalMemory {
    level: 1 | 2 | 3;
    id: number;
    content: string;
    importance: number;
    similarity?: number;
    children?: HierarchicalMemory[];
}
export interface HierarchyConfig {
    episodicThreshold: number;
    semanticThreshold: number;
    reflectionThreshold: number;
}
export declare class SemanticClusterer {
    private client;
    private limiter;
    private conflictDetector;
    private entityPatterns;
    constructor(client: LLMClient, limiter?: LLMLimiter);
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
    mergeCluster(cluster: ClusteredMemory, _existingMergedMemories?: Array<{
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
     * Limits to top 100 memories to avoid O(N²) performance issues.
     */
    runIdleClustering(getMemories: () => Promise<Array<{
        id: number;
        content: string;
    }>>, onClusterMerged: (result: {
        theme: string;
        mergedContent: string;
        sourceIds: number[];
    }) => Promise<void>, options?: {
        timeoutMs?: number;
        maxMemories?: number;
    }): Promise<{
        completed: boolean;
        reason?: string;
    }>;
    /**
     * Build hierarchical memory tree from retrieved memories.
     * Level 1: Episodic memories (specific events)
     * Level 2: Semantic memories (general facts)
     * Level 3: Reflection memories (themes/summaries)
     */
    buildHierarchy(memories: Array<{
        id: number;
        content: string;
        type: string;
        importance: number;
        similarity?: number;
    }>, config?: HierarchyConfig): HierarchicalMemory[];
    /**
     * Simple text similarity for hierarchy building (Jaccard similarity).
     */
    private textSimilarity;
}
//# sourceMappingURL=clusterer.d.ts.map
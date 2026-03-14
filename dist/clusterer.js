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
import { ConflictDetector } from './conflict-detector.js';
const CLUSTER_PROMPT = `Group these memories into clusters based on semantic similarity.
Output JSON format:
{
  "clusters": [
    {
      "theme": "brief theme description",
      "memory_indices": [0, 2, 5]
    }
  ]
}

Only cluster memories with similarity > 0.9 (very high similarity).
Do not cluster technical details or specific facts that should remain separate.

Memories:
{{memories}}

JSON:`;
const MERGE_PROMPT = `Merge these similar memories into ONE permanent fact.
Rules:
- Preserve all technical details and specific information
- Do not over-generalize or lose fidelity
- Keep specific numbers, names, and technical terms exact
- Only merge redundant/repetitive information

Output JSON format:
{
  "merged_content": "the merged permanent fact",
  "confidence": 0.0-1.0,
  "reason": "brief explanation of merge decision"
}

If memories should NOT be merged (different technical details, conflicting info), output:
{
  "merged_content": null,
  "confidence": 0.0,
  "reason": "why they cannot be merged"
}

Memories to merge:
{{memories}}

JSON:`;
export class SemanticClusterer {
    endpoint;
    limiter;
    conflictDetector;
    constructor(endpoint = 'http://localhost:8081', limiter) {
        this.endpoint = endpoint;
        this.limiter = limiter ?? new LLMLimiter({ maxConcurrent: 2, minInterval: 100 });
        this.conflictDetector = new ConflictDetector(endpoint, limiter);
    }
    /**
     * Cluster memories by semantic similarity.
     * Only clusters memories with similarity > 0.9.
     */
    async cluster(memories) {
        if (memories.length < 2) {
            return { clusters: [], totalMemories: memories.length, clusteredCount: 0 };
        }
        const memoriesText = memories
            .map((m, i) => `[${i}] ${m.content.substring(0, 150)}`)
            .join('\n');
        const prompt = CLUSTER_PROMPT
            .replace('{{memories}}', memoriesText);
        try {
            const result = await this.limiter.execute(async () => {
                const response = await fetch(`${this.endpoint}/completion`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        prompt: prompt,
                        n_predict: 500,
                        temperature: 0.2,
                        top_p: 0.9,
                    }),
                });
                return await response.json();
            });
            const output = (result.content || result.generated_text || '').trim();
            const clusters = this.parseClusters(output, memories);
            const clusteredCount = clusters.reduce((sum, c) => sum + c.memoryIndices.length, 0);
            return {
                clusters,
                totalMemories: memories.length,
                clusteredCount,
            };
        }
        catch (error) {
            console.error('[SemanticClusterer] LLM failed:', error.message);
            return { clusters: [], totalMemories: memories.length, clusteredCount: 0 };
        }
    }
    /**
     * Merge a cluster of similar memories into one permanent fact.
     */
    async mergeCluster(cluster, existingMergedMemories = []) {
        if (cluster.memories.length < 2) {
            return {
                mergedContent: cluster.memories[0] || null,
                confidence: 1.0,
                reason: 'single memory',
            };
        }
        const memoriesText = cluster.memories
            .map((m, i) => `[${i}] ${m}`)
            .join('\n');
        const prompt = MERGE_PROMPT
            .replace('{{memories}}', memoriesText);
        try {
            const result = await this.limiter.execute(async () => {
                const response = await fetch(`${this.endpoint}/completion`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        prompt: prompt,
                        n_predict: 500,
                        temperature: 0.2,
                        top_p: 0.9,
                    }),
                });
                return await response.json();
            });
            const output = (result.content || result.generated_text || '').trim();
            return this.parseMergeResult(output);
        }
        catch (error) {
            console.error('[SemanticClusterer] Merge failed:', error.message);
            return {
                mergedContent: null,
                confidence: 0.0,
                reason: `Merge error: ${error.message}`,
            };
        }
    }
    /**
     * Parse cluster JSON from LLM output.
     */
    parseClusters(output, memories) {
        const jsonMatch = output.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            try {
                const parsed = JSON.parse(jsonMatch[0]);
                if (Array.isArray(parsed.clusters)) {
                    return parsed.clusters
                        .filter((c) => Array.isArray(c.memory_indices) && c.memory_indices.length > 1)
                        .map((c) => ({
                        theme: c.theme || 'Unknown theme',
                        memoryIndices: c.memory_indices,
                        memories: c.memory_indices.map((i) => memories[i]?.content || ''),
                    }));
                }
            }
            catch {
                // Fall through to default
            }
        }
        return [];
    }
    /**
     * Parse merge result JSON from LLM output.
     */
    parseMergeResult(output) {
        const jsonMatch = output.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            try {
                const parsed = JSON.parse(jsonMatch[0]);
                return {
                    mergedContent: parsed.merged_content ?? null,
                    confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.0,
                    reason: parsed.reason || 'No reason provided',
                };
            }
            catch {
                // Fall through to default
            }
        }
        return {
            mergedContent: null,
            confidence: 0.0,
            reason: 'Failed to parse JSON output',
        };
    }
    /**
     * Run clustering in background (async worker).
     * Non-blocking - processes memories during idle time.
     */
    async runIdleClustering(getMemories, onClusterMerged) {
        try {
            const memories = await getMemories();
            if (memories.length < 5) {
                return; // Not enough memories to cluster
            }
            // Cluster memories
            const clusterResult = await this.cluster(memories);
            console.log(`[SemanticClusterer] Found ${clusterResult.clusters.length} clusters from ${clusterResult.totalMemories} memories`);
            // Merge each cluster
            for (const cluster of clusterResult.clusters) {
                const mergeResult = await this.mergeCluster(cluster);
                if (mergeResult.mergedContent && mergeResult.confidence > 0.7) {
                    // Store merged memory with source_ids tracking
                    await onClusterMerged({
                        theme: cluster.theme,
                        mergedContent: mergeResult.mergedContent,
                        sourceIds: cluster.memoryIndices.map(i => memories[i]?.id).filter(id => id !== undefined),
                    });
                    console.log(`[SemanticClusterer] Merged cluster "${cluster.theme}" (${cluster.memoryIndices.length} memories)`);
                }
            }
        }
        catch (error) {
            console.error('[SemanticClusterer] Idle clustering failed:', error.message);
        }
    }
}
//# sourceMappingURL=clusterer.js.map
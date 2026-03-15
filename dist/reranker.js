/**
 * Reranker using Llama-3.2-1B-Instruct
 *
 * Reranks vector search results based on query relevance.
 * Features:
 * - Dynamic Top-K: Retrieves K=20, filters by score threshold
 * - Diversity Re-ranking: Penalizes highly similar top results
 */
import { LLMLimiter } from './llm-limiter.js';
const RERANK_PROMPT = `Rank these memory snippets by relevance to the query.
Output ONLY the indices in order (0-based), most relevant first.

Query: {{query}}

Memories:
{{memories}}

Ranking (indices only, e.g., "2 0 1"): `;
const DIVERSITY_PENALTY = 0.15; // Penalty for duplicate content
const CLUSTER_DIVERSITY_PENALTY = 0.2; // Penalty for same-cluster results
const SCORE_THRESHOLD = 0.7; // Minimum score to keep result
const INITIAL_K = 30; // Initial retrieval count (high recall, increased from 20 for better coverage)
export { INITIAL_K, SCORE_THRESHOLD, DIVERSITY_PENALTY, CLUSTER_DIVERSITY_PENALTY };
export class Reranker {
    endpoint;
    limiter;
    defaultOptions;
    constructor(endpoint = 'http://localhost:8081', limiter) {
        this.endpoint = endpoint;
        this.limiter = limiter ?? new LLMLimiter({ maxConcurrent: 2, minInterval: 100 });
        this.defaultOptions = {
            topK: 5,
            threshold: SCORE_THRESHOLD,
            enableDiversity: true,
        };
    }
    /**
     * Rerank search results by relevance.
     * Features:
     * - Dynamic Top-K: Retrieves K=20, filters by score threshold
     * - Diversity Re-ranking: Penalizes semantically similar results
     * @param query - The search query
     * @param results - Array of search results
     * @param options - Rerank options
     * @returns Reranked results filtered by threshold
     */
    async rerank(query, results, options) {
        const opts = { ...this.defaultOptions, ...options };
        if (results.length === 0) {
            return [];
        }
        if (results.length <= 1) {
            const score = results[0].similarity ?? results[0].score ?? 0.5;
            return score >= opts.threshold
                ? [{ ...results[0], score }]
                : [];
        }
        // Take top INITIAL_K for reranking (high recall)
        const topResults = results.slice(0, INITIAL_K);
        const memoriesText = topResults
            .map((r, i) => `[${i}] [${r.type}] ${r.content.substring(0, 100)}`)
            .join('\n');
        const prompt = RERANK_PROMPT
            .replace('{{query}}', query)
            .replace('{{memories}}', memoriesText);
        try {
            const result = await this.limiter.execute(async () => {
                const response = await fetch(`${this.endpoint}/completion`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        prompt: prompt,
                        n_predict: 50,
                        temperature: 0.1,
                        top_p: 0.9,
                    }),
                });
                return await response.json();
            });
            const output = (result.content || result.generated_text || '').toString().trim();
            const rankedIndices = this.parseRanking(output, topResults.length);
            // Assign initial scores based on rank
            let ranked = rankedIndices.map((originalIndex, rank) => {
                const original = topResults[originalIndex];
                return {
                    id: original.id,
                    content: original.content,
                    score: 1.0 - (rank * 0.05), // gentler decay: Rank 0=1.0, Rank 1=0.95, etc.
                    type: original.type,
                    similarity: original.similarity ?? original.score ?? 0.5,
                    importance: original.importance,
                    created_at: original.created_at,
                    access_count: original.access_count,
                };
            });
            // Apply diversity penalty if enabled
            if (opts.enableDiversity) {
                ranked = this.applyDiversityPenalty(ranked);
            }
            // Filter by threshold and limit to topK
            return ranked
                .filter(r => r.score >= opts.threshold)
                .slice(0, opts.topK);
        }
        catch (error) {
            console.error('[Reranker] LLM failed, using original scores:', error.message);
            // Return original results filtered by threshold
            return topResults
                .map(r => ({
                ...r,
                score: r.similarity ?? r.score ?? 0.5,
            }))
                .filter(r => r.score >= opts.threshold)
                .slice(0, opts.topK);
        }
    }
    /**
     * Apply diversity penalty to reduce duplicate content in top results.
     * Penalizes both semantically similar content AND same-cluster results.
     */
    applyDiversityPenalty(results) {
        if (results.length <= 1)
            return results;
        const penalized = [];
        const usedContents = [];
        const usedClusters = new Set();
        for (const result of results) {
            let penalty = 0;
            const contentLower = result.content.toLowerCase();
            // Check text similarity against already selected top results
            for (const used of usedContents) {
                if (this.isContentSimilar(contentLower, used)) {
                    penalty += DIVERSITY_PENALTY;
                }
            }
            // Check cluster diversity (stronger penalty)
            if (result.cluster_id && usedClusters.has(result.cluster_id)) {
                penalty += CLUSTER_DIVERSITY_PENALTY;
            }
            // Apply penalty
            const penalizedResult = {
                ...result,
                score: Math.max(0, result.score - penalty),
            };
            penalized.push(penalizedResult);
            // Track content and cluster for diversity checking (only track top results)
            if (usedContents.length < 5) {
                usedContents.push(contentLower);
            }
            if (result.cluster_id) {
                usedClusters.add(result.cluster_id);
            }
        }
        // Re-sort by penalized scores
        return penalized.sort((a, b) => b.score - a.score);
    }
    /**
     * Check if two content strings are semantically similar (simple heuristic).
     */
    isContentSimilar(a, b) {
        // Extract key words (simple tokenization)
        const wordsA = new Set(a.split(/\s+/).filter(w => w.length > 3));
        const wordsB = new Set(b.split(/\s+/).filter(w => w.length > 3));
        // Calculate Jaccard similarity
        const intersection = [...wordsA].filter(w => wordsB.has(w)).length;
        const union = new Set([...wordsA, ...wordsB]).size;
        if (union === 0)
            return false;
        const similarity = intersection / union;
        return similarity > 0.5; // Threshold for "similar"
    }
    /**
     * Parse ranking indices from LLM output.
     */
    parseRanking(output, maxItems) {
        // Extract numbers from output
        const numbers = output.match(/\d+/g);
        if (numbers) {
            const indices = numbers
                .map(n => parseInt(n, 10))
                .filter(n => n >= 0 && n < maxItems);
            // Remove duplicates while preserving order
            const unique = [...new Set(indices)];
            // Add missing indices
            for (let i = 0; i < maxItems; i++) {
                if (!unique.includes(i)) {
                    unique.push(i);
                }
            }
            return unique;
        }
        // Default: return original order
        return Array.from({ length: maxItems }, (_, i) => i);
    }
}
//# sourceMappingURL=reranker.js.map
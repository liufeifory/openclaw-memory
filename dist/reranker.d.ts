/**
 * Reranker using Llama-3.2-1B-Instruct
 *
 * Reranks vector search results based on query relevance.
 * Features:
 * - Dynamic Top-K: Retrieves K=20, filters by score threshold
 * - Diversity Re-ranking: Penalizes highly similar top results
 */
import { LLMLimiter } from './llm-limiter.js';
declare const DIVERSITY_PENALTY = 0.15;
declare const CLUSTER_DIVERSITY_PENALTY = 0.2;
declare const SCORE_THRESHOLD = 0.7;
declare const INITIAL_K = 30;
export { INITIAL_K, SCORE_THRESHOLD, DIVERSITY_PENALTY, CLUSTER_DIVERSITY_PENALTY };
export interface RerankResult {
    id: number;
    content: string;
    score: number;
    type: string;
    similarity?: number;
    importance?: number;
    created_at?: Date;
    access_count?: number;
    cluster_id?: string;
}
export interface RerankInput {
    id: number;
    content: string;
    type: string;
    score?: number;
    similarity?: number;
    importance?: number;
    created_at?: Date;
    access_count?: number;
    cluster_id?: string;
}
export interface RerankConfig {
    topK?: number;
    threshold?: number;
    enableDiversity?: boolean;
}
export declare class Reranker {
    private endpoint;
    private limiter;
    private defaultOptions;
    constructor(endpoint?: string, limiter?: LLMLimiter);
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
    rerank(query: string, results: RerankInput[], options?: RerankConfig): Promise<RerankResult[]>;
    /**
     * Apply diversity penalty to reduce duplicate content in top results.
     * Penalizes both semantically similar content AND same-cluster results.
     */
    private applyDiversityPenalty;
    /**
     * Check if two content strings are semantically similar (simple heuristic).
     */
    private isContentSimilar;
    /**
     * Parse ranking indices from LLM output.
     */
    private parseRanking;
}
//# sourceMappingURL=reranker.d.ts.map
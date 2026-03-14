/**
 * Reranker using Llama-3.2-1B-Instruct
 *
 * Reranks vector search results based on query relevance.
 */
import { LLMLimiter } from './llm-limiter.js';
export interface RerankResult {
    id: number;
    content: string;
    score: number;
    type: string;
    similarity?: number;
    importance?: number;
    created_at?: Date;
    access_count?: number;
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
}
export declare class Reranker {
    private endpoint;
    private limiter;
    constructor(endpoint?: string, limiter?: LLMLimiter);
    /**
     * Rerank search results by relevance.
     * @param query - The search query
     * @param results - Array of search results with id, content, score
     * @returns Reranked results with new relevance scores
     */
    rerank(query: string, results: RerankInput[]): Promise<RerankResult[]>;
    /**
     * Parse ranking indices from LLM output.
     */
    private parseRanking;
}
//# sourceMappingURL=reranker.d.ts.map
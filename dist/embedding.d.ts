/**
 * Embedding service using llama.cpp HTTP endpoint.
 * Supports BGE-style task_type parameter for query/document distinction.
 */
export interface EmbeddingResponse {
    embedding: number[];
}
export type EmbeddingTaskType = 'query' | 'document' | 'search_query' | 'passage';
export declare class EmbeddingService {
    private endpoint;
    private cache;
    private readonly CACHE_LIMIT;
    constructor(endpoint?: string);
    /**
     * Generate embedding for text.
     * @param text - The text to embed
     * @param taskType - Optional task type for BGE-style models (query vs document)
     */
    embed(text: string, taskType?: EmbeddingTaskType): Promise<number[]>;
    /**
     * Store embedding in LRU cache
     */
    private setCache;
    /**
     * Normalize embedding vector to unit length for cosine similarity.
     */
    private normalize;
}
//# sourceMappingURL=embedding.d.ts.map
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
    constructor(endpoint?: string);
    /**
     * Generate embedding for text.
     * @param text - The text to embed
     * @param taskType - Optional task type for BGE-style models (query vs document)
     */
    embed(text: string, taskType?: EmbeddingTaskType): Promise<number[]>;
    /**
     * Normalize embedding vector to unit length for cosine similarity.
     */
    private normalize;
}
//# sourceMappingURL=embedding.d.ts.map
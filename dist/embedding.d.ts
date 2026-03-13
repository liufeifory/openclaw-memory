/**
 * Embedding service using llama.cpp HTTP endpoint.
 */
export interface EmbeddingResponse {
    embedding: number[];
}
export declare class EmbeddingService {
    private endpoint;
    constructor(endpoint?: string);
    embed(text: string): Promise<number[]>;
    /**
     * Normalize embedding vector to unit length for cosine similarity.
     */
    private normalize;
}
//# sourceMappingURL=embedding.d.ts.map
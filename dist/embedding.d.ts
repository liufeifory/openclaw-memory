/**
 * Embedding service supporting multiple backends:
 * - llama.cpp HTTP endpoint (legacy)
 * - OpenAI-compatible API (oMLX, vLLM, etc.)
 */
import type { EmbeddingConfig } from './config.js';
export type { EmbeddingConfig } from './config.js';
export interface EmbeddingResponse {
    embedding: number[];
}
export type EmbeddingTaskType = 'query' | 'document' | 'search_query' | 'passage';
export declare class EmbeddingService {
    private endpoint;
    private model?;
    private apiKey?;
    private apiType;
    private cache;
    private readonly CACHE_LIMIT;
    constructor(config: EmbeddingConfig | string);
    /**
     * Detect API type from endpoint URL
     */
    private detectApiType;
    /**
     * Generate embedding for text.
     * @param text - The text to embed
     * @param taskType - Optional task type for BGE-style models (query vs document)
     */
    embed(text: string, taskType?: EmbeddingTaskType): Promise<number[]>;
    /**
     * Embed using OpenAI-compatible API (oMLX, vLLM, etc.)
     */
    private embedOpenAI;
    /**
     * Embed using llama.cpp HTTP API (legacy)
     */
    private embedLlama;
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
/* eslint-disable @typescript-eslint/no-explicit-any -- External API response types vary by provider */
/**
 * Embedding service supporting multiple backends:
 * - llama.cpp HTTP endpoint (legacy)
 * - OpenAI-compatible API (oMLX, vLLM, etc.)
 */

import { logWarn, logInfo, logError } from './maintenance-logger.js';
import type { EmbeddingConfig } from './config.js';

// Re-export EmbeddingConfig from config.ts for backward compatibility
export type { EmbeddingConfig } from './config.js';

export interface EmbeddingResponse {
  embedding: number[];
}

export type EmbeddingTaskType = 'query' | 'document' | 'search_query' | 'passage';

export class EmbeddingService {
  private endpoint: string;
  private model?: string;
  private apiKey?: string;
  private apiType: 'llama' | 'openai';
  private cache = new Map<string, number[]>();
  private readonly CACHE_LIMIT = 1000;  // LRU cache limit

  constructor(config: EmbeddingConfig | string) {
    // Support both new (object) and legacy (string) format
    if (typeof config === 'string') {
      // Legacy: just endpoint string
      this.endpoint = config;
      this.apiType = 'llama';
      logWarn('[EmbeddingService] Using legacy string config, consider using EmbeddingConfig object');
    } else {
      // New: config object
      this.endpoint = config.endpoint;
      this.model = config.model;
      this.apiKey = config.apiKey;
      this.apiType = this.detectApiType(config.endpoint);
    }

    if (!this.endpoint) {
      throw new Error('Embedding endpoint is required');
    }
  }

  /**
   * Detect API type from endpoint URL
   */
  private detectApiType(endpoint: string): 'llama' | 'openai' {
    // OpenAI-compatible endpoints typically include /v1/ in the path
    if (endpoint.includes('/v1/')) {
      return 'openai';
    }
    return 'llama';
  }

  /**
   * Generate embedding for text.
   * @param text - The text to embed
   * @param taskType - Optional task type for BGE-style models (query vs document)
   */
  async embed(text: string, taskType?: EmbeddingTaskType): Promise<number[]> {
    // Add task type prefix for BGE-style models
    let inputText = text;
    if (taskType) {
      const prefixes: Record<EmbeddingTaskType, string> = {
        'query': 'Represent the query for retrieving relevant documents: ',
        'document': 'Represent the document for retrieval: ',
        'search_query': 'Represent the search query for retrieving documents: ',
        'passage': 'Represent the passage for retrieval: ',
      };
      inputText = prefixes[taskType] + text;
    }

    // Check cache first
    const cacheKey = inputText;
    const cachedEmbedding = this.cache.get(cacheKey);
    if (cachedEmbedding) {
      logInfo(`[embedding] Cache hit for: "${text.substring(0, 30)}..."`);
      return cachedEmbedding;
    }

    if (this.apiType === 'openai') {
      return this.embedOpenAI(inputText, cacheKey);
    } else {
      return this.embedLlama(inputText, cacheKey);
    }
  }

  /**
   * Embed using OpenAI-compatible API (oMLX, vLLM, etc.)
   */
  private async embedOpenAI(text: string, cacheKey: string): Promise<number[]> {
    const url = this.endpoint.includes('/v1/embeddings')
      ? this.endpoint
      : `${this.endpoint.replace(/\/$/, '')}/v1/embeddings`;

    logInfo(`[embedding] OpenAI API: ${url}`);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    const body: any = {
      input: text,
      model: this.model || 'bge-m3',
    };

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        logError(`[embedding] OpenAI API error ${response.status}: ${errorText}`);
        return [];
      }

      const result: any = await response.json();

      // OpenAI format: {data: [{embedding: [...]}], model: "..."}
      const embedding = result.data?.[0]?.embedding;
      if (!embedding || !Array.isArray(embedding)) {
        logError(`[embedding] Invalid OpenAI response format`);
        return [];
      }

      const normalized = this.normalize(embedding);
      this.setCache(cacheKey, normalized);
      return normalized;
    } catch (error: any) {
      logError(`[embedding] OpenAI API error: ${error.message}`);
      return [];
    }
  }

  /**
   * Embed using llama.cpp HTTP API (legacy)
   */
  private async embedLlama(text: string, cacheKey: string): Promise<number[]> {
    logInfo(`[embedding] Llama API: ${this.endpoint}/embedding`);

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);

      const response = await fetch(`${this.endpoint}/embedding`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: text }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      logInfo(`[embedding] HTTP response status: ${response.status} ${response.statusText}`);

      if (!response.ok) {
        logWarn(`[embedding] HTTP error: ${response.status} ${response.statusText}`);
        return [];
      }

      const result: any = await response.json();
      logInfo(`[embedding] Response type: ${Array.isArray(result) ? 'array' : typeof result}`);

      // Handle nested array format from llama.cpp
      // Format: [{index: 0, embedding: [[...]]}]
      if (Array.isArray(result)) {
        let emb = result[0]?.embedding;
        logInfo(`[embedding] Array format, embedding exists: ${!!emb}, length: ${Array.isArray(emb) ? emb.length : 'N/A'}`);
        // Unwrap nested arrays (could be [[[...]]] or [[...]])
        while (Array.isArray(emb) && Array.isArray(emb[0])) {
          emb = emb[0];
        }
        const unwrapped = emb || [];
        logInfo(`[embedding] Unwrapped length: ${unwrapped.length}, first value: ${unwrapped[0]}`);
        const normalized = this.normalize(unwrapped);
        this.setCache(cacheKey, normalized);
        return normalized;
      }

      // Format: {embedding: [[...]]}
      logInfo(`[embedding] Object format, embedding exists: ${!!result.embedding}`);
      let emb = result.embedding;
      while (Array.isArray(emb) && Array.isArray(emb[0])) {
        emb = emb[0];
      }
      const unwrapped = emb || [];
      logInfo(`[embedding] Unwrapped length: ${unwrapped.length}, first value: ${unwrapped[0]}`);
      const normalized = this.normalize(unwrapped);
      this.setCache(cacheKey, normalized);
      return normalized;
    } catch (error: any) {
      if (error.name === 'AbortError') {
        logError('[embedding] Fetch timeout after 30000ms (llama-server may be cold starting)');
      } else {
        logError(`[embedding] Fetch error: ${error.message}`);
        if (error.stack) {
          logError(`[embedding] Stack trace: ${error.stack}`);
        }
      }
      logWarn('[embedding] Returning empty embedding due to fetch failure');
      return [];
    }
  }

  /**
   * Store embedding in LRU cache
   */
  private setCache(text: string, embedding: number[]): void {
    if (this.cache.size >= this.CACHE_LIMIT) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) this.cache.delete(firstKey);
    }
    this.cache.set(text, embedding);
  }

  /**
   * Normalize embedding vector to unit length for cosine similarity.
   */
  private normalize(vector: number[]): number[] {
    if (!vector || vector.length === 0) {
      logWarn('[embedding] Empty or undefined vector received');
      return vector || [];
    }
    const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
    if (magnitude === 0) return vector;
    return vector.map(v => v / magnitude);
  }
}

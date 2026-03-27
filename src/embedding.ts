/**
 * Embedding service using llama.cpp HTTP endpoint.
 * Supports BGE-style task_type parameter for query/document distinction.
 */

import { logWarn, logInfo, logError } from './maintenance-logger.js';

export interface EmbeddingResponse {
  embedding: number[];
}

export type EmbeddingTaskType = 'query' | 'document' | 'search_query' | 'passage';

export class EmbeddingService {
  private endpoint: string;
  private cache = new Map<string, number[]>();
  private readonly CACHE_LIMIT = 1000;  // LRU cache limit

  constructor(endpoint: string = 'http://localhost:8080') {
    this.endpoint = endpoint;
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
    if (this.cache.has(cacheKey)) {
      logInfo(`[embedding] Cache hit for: "${text.substring(0, 30)}..."`);
      return this.cache.get(cacheKey)!;
    }

    logInfo(`[embedding] Calling ${this.endpoint}/embedding with text: "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"`);

    try {
      // Add 30 second timeout for embedding requests (handles llama-server cold start)
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);

      const response = await fetch(`${this.endpoint}/embedding`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: inputText }),
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
      }
      return [];
    }
  }

  /**
   * Store embedding in LRU cache
   */
  private setCache(text: string, embedding: number[]): void {
    if (this.cache.size >= this.CACHE_LIMIT) {
      // Remove oldest entry (first key)
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

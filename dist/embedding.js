/**
 * Embedding service supporting multiple backends:
 * - llama.cpp HTTP endpoint (legacy)
 * - OpenAI-compatible API (oMLX, vLLM, etc.)
 */
import { logWarn, logInfo, logError } from './maintenance-logger.js';
export class EmbeddingService {
    endpoint;
    model;
    apiKey;
    apiType;
    cache = new Map();
    CACHE_LIMIT = 1000; // LRU cache limit
    constructor(config) {
        // Support both new (object) and legacy (string) format
        if (typeof config === 'string') {
            // Legacy: just endpoint string
            this.endpoint = config;
            this.apiType = 'llama';
            logWarn('[EmbeddingService] Using legacy string config, consider using EmbeddingConfig object');
        }
        else {
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
    detectApiType(endpoint) {
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
    async embed(text, taskType) {
        // Add task type prefix for BGE-style models
        let inputText = text;
        if (taskType) {
            const prefixes = {
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
            return this.cache.get(cacheKey);
        }
        if (this.apiType === 'openai') {
            return this.embedOpenAI(inputText, cacheKey);
        }
        else {
            return this.embedLlama(inputText, cacheKey);
        }
    }
    /**
     * Embed using OpenAI-compatible API (oMLX, vLLM, etc.)
     */
    async embedOpenAI(text, cacheKey) {
        const url = this.endpoint.includes('/v1/embeddings')
            ? this.endpoint
            : `${this.endpoint.replace(/\/$/, '')}/v1/embeddings`;
        logInfo(`[embedding] OpenAI API: ${url}`);
        const headers = {
            'Content-Type': 'application/json',
        };
        if (this.apiKey) {
            headers['Authorization'] = `Bearer ${this.apiKey}`;
        }
        const body = {
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
            const result = await response.json();
            // OpenAI format: {data: [{embedding: [...]}], model: "..."}
            const embedding = result.data?.[0]?.embedding;
            if (!embedding || !Array.isArray(embedding)) {
                logError(`[embedding] Invalid OpenAI response format`);
                return [];
            }
            const normalized = this.normalize(embedding);
            this.setCache(cacheKey, normalized);
            return normalized;
        }
        catch (error) {
            logError(`[embedding] OpenAI API error: ${error.message}`);
            return [];
        }
    }
    /**
     * Embed using llama.cpp HTTP API (legacy)
     */
    async embedLlama(text, cacheKey) {
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
            const result = await response.json();
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
        }
        catch (error) {
            if (error.name === 'AbortError') {
                logError('[embedding] Fetch timeout after 30000ms (llama-server may be cold starting)');
            }
            else {
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
    setCache(text, embedding) {
        if (this.cache.size >= this.CACHE_LIMIT) {
            const firstKey = this.cache.keys().next().value;
            if (firstKey)
                this.cache.delete(firstKey);
        }
        this.cache.set(text, embedding);
    }
    /**
     * Normalize embedding vector to unit length for cosine similarity.
     */
    normalize(vector) {
        if (!vector || vector.length === 0) {
            logWarn('[embedding] Empty or undefined vector received');
            return vector || [];
        }
        const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
        if (magnitude === 0)
            return vector;
        return vector.map(v => v / magnitude);
    }
}
//# sourceMappingURL=embedding.js.map
/**
 * Embedding service using llama.cpp HTTP endpoint.
 * Supports BGE-style task_type parameter for query/document distinction.
 */
import { logWarn, logInfo, logError } from './maintenance-logger.js';
export class EmbeddingService {
    endpoint;
    constructor(endpoint = 'http://localhost:8080') {
        this.endpoint = endpoint;
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
        logInfo(`[embedding] Calling ${this.endpoint}/embedding with text: "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"`);
        try {
            // Add 5 second timeout for embedding requests
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);
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
                return this.normalize(unwrapped);
            }
            // Format: {embedding: [[...]]}
            logInfo(`[embedding] Object format, embedding exists: ${!!result.embedding}`);
            let emb = result.embedding;
            while (Array.isArray(emb) && Array.isArray(emb[0])) {
                emb = emb[0];
            }
            const unwrapped = emb || [];
            logInfo(`[embedding] Unwrapped length: ${unwrapped.length}, first value: ${unwrapped[0]}`);
            return this.normalize(unwrapped);
        }
        catch (error) {
            if (error.name === 'AbortError') {
                logError('[embedding] Fetch timeout after 5000ms');
            }
            else {
                logError(`[embedding] Fetch error: ${error.message}`);
            }
            return [];
        }
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
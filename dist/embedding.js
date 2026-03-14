/**
 * Embedding service using llama.cpp HTTP endpoint.
 * Supports BGE-style task_type parameter for query/document distinction.
 */
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
        const response = await fetch(`${this.endpoint}/embedding`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ input: inputText }),
        });
        const result = await response.json();
        // Handle nested array format from llama.cpp
        if (Array.isArray(result)) {
            let emb = result[0]?.embedding;
            if (Array.isArray(emb) && Array.isArray(emb[0])) {
                emb = emb[0]; // Unwrap nested array
            }
            else if (Array.isArray(emb)) {
                // Already flat array
            }
            return this.normalize(emb);
        }
        let emb = result.embedding;
        if (Array.isArray(emb) && Array.isArray(emb[0])) {
            emb = emb[0];
        }
        return this.normalize(emb);
    }
    /**
     * Normalize embedding vector to unit length for cosine similarity.
     */
    normalize(vector) {
        const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
        if (magnitude === 0)
            return vector;
        return vector.map(v => v / magnitude);
    }
}
//# sourceMappingURL=embedding.js.map
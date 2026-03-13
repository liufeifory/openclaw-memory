/**
 * Embedding service using llama.cpp HTTP endpoint.
 */
export class EmbeddingService {
    endpoint;
    constructor(endpoint = 'http://localhost:8080') {
        this.endpoint = endpoint;
    }
    async embed(text) {
        const response = await fetch(`${this.endpoint}/embedding`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ input: text }),
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
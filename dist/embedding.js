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
                return emb[0]; // Unwrap nested array
            }
            return emb;
        }
        let emb = result.embedding;
        if (Array.isArray(emb) && Array.isArray(emb[0])) {
            return emb[0];
        }
        return emb;
    }
}
//# sourceMappingURL=embedding.js.map
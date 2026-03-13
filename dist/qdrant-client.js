/**
 * Qdrant Client wrapper
 */
import { QdrantClient } from '@qdrant/js-client-rest';
const COLLECTION_NAME = 'openclaw_memories';
const VECTOR_SIZE = 1024; // BGE-M3 embedding dimension
export class QdrantDatabase {
    client;
    initialized = false;
    constructor(config) {
        this.client = new QdrantClient({
            url: config.url,
            port: config.port,
            apiKey: config.apiKey,
        });
    }
    async initialize() {
        if (this.initialized)
            return;
        try {
            // Check if collection exists
            const collections = await this.client.getCollections();
            const exists = collections.collections.some(c => c.name === COLLECTION_NAME);
            if (!exists) {
                // Create collection with HNSW index
                await this.client.createCollection(COLLECTION_NAME, {
                    vectors: {
                        size: VECTOR_SIZE,
                        distance: 'Cosine',
                    },
                    optimizers_config: {
                        default_segment_number: 2,
                    },
                    hnsw_config: {
                        m: 16,
                        ef_construct: 100,
                    },
                });
                console.log('[Qdrant] Collection created:', COLLECTION_NAME);
            }
            this.initialized = true;
        }
        catch (error) {
            console.error('[Qdrant] Initialization failed:', error.message);
            throw error;
        }
    }
    async upsert(id, embedding, payload) {
        await this.client.upsert(COLLECTION_NAME, {
            points: [
                {
                    id: id,
                    vector: embedding,
                    payload: {
                        ...payload,
                        memory_type: payload.type || 'episodic',
                    },
                },
            ],
        });
    }
    async search(embedding, limit = 10, filter) {
        const result = await this.client.search(COLLECTION_NAME, {
            vector: embedding,
            limit: limit,
            filter: filter ? this.buildFilter(filter) : undefined,
            with_payload: true,
        });
        return result.map(r => ({
            id: r.id,
            score: r.score,
            payload: r.payload,
        }));
    }
    buildFilter(filter) {
        const conditions = [];
        if (filter.type) {
            conditions.push({
                key: 'memory_type',
                match: { value: filter.type },
            });
        }
        return conditions.length > 0 ? { must: conditions } : undefined;
    }
    async delete(id) {
        await this.client.delete(COLLECTION_NAME, {
            points: [id],
        });
    }
    async count() {
        const result = await this.client.count(COLLECTION_NAME, {});
        return result.count;
    }
    async getStats() {
        const info = await this.client.getCollection(COLLECTION_NAME);
        return {
            total_points: info.points_count || 0,
            collection_name: COLLECTION_NAME,
        };
    }
}
export const MemoryType = {
    EPISODIC: 'episodic',
    SEMANTIC: 'semantic',
    REFLECTION: 'reflection',
};
//# sourceMappingURL=qdrant-client.js.map
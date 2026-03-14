/**
 * Qdrant Client wrapper
 */
import { QdrantClient } from '@qdrant/js-client-rest';
const COLLECTION_NAME = 'openclaw_memories';
const VECTOR_SIZE = 1024; // BGE-M3 embedding dimension
const SCHEMA_VERSION = 1;
export class QdrantDatabase {
    client;
    initialized = false;
    // Retry configuration
    maxRetries = 3;
    baseDelayMs = 1000; // 1s base delay for exponential backoff
    constructor(config) {
        this.client = new QdrantClient({
            url: config.url,
            port: config.port,
            apiKey: config.apiKey,
        });
    }
    async initialize() {
        if (this.initialized)
            return { success: true, migrated: false, changes: [] };
        const result = { success: true, migrated: false, changes: [] };
        try {
            // Check if collection exists (with retry)
            const collections = await this.executeWithRetry(async () => {
                return await this.client.getCollections();
            }, 'getCollections');
            const exists = collections.collections.some(c => c.name === COLLECTION_NAME);
            if (!exists) {
                // Create collection with HNSW index (with retry)
                await this.executeWithRetry(async () => {
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
                }, 'createCollection');
                result.changes.push('Created collection');
                result.migrated = true;
                console.log('[Qdrant] Collection created:', COLLECTION_NAME);
            }
            // Check schema version
            const currentVersion = await this.getSchemaVersion();
            if (currentVersion < SCHEMA_VERSION) {
                await this.storeSchemaVersion();
                result.changes.push(`Schema version: ${currentVersion} -> ${SCHEMA_VERSION}`);
                result.migrated = true;
            }
            this.initialized = true;
        }
        catch (error) {
            result.success = false;
            console.error('[Qdrant] Initialization failed:', error.message);
            throw error;
        }
        return result;
    }
    /**
     * Execute an async operation with retry support.
     * Uses exponential backoff: 1s, 2s, 4s...
     */
    async executeWithRetry(operation, operationName) {
        let lastError = null;
        for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
            try {
                return await operation();
            }
            catch (error) {
                lastError = error;
                console.error(`[Qdrant] ${operationName} failed (attempt ${attempt}/${this.maxRetries}):`, error.message);
                // Wait before retry (exponential backoff)
                if (attempt < this.maxRetries) {
                    const delay = Math.pow(2, attempt - 1) * this.baseDelayMs;
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
        }
        throw new Error(`[Qdrant] ${operationName} failed after ${this.maxRetries} retries: ${lastError?.message}`);
    }
    async upsert(id, embedding, payload, options // If true, only upsert if new version is newer
    ) {
        // Add version and updated_at metadata
        const enhancedPayload = {
            ...payload,
            memory_type: payload.type || 'episodic',
            updated_at: new Date().toISOString(),
            version: payload.version || Date.now(), // Use timestamp as version
        };
        // If checkVersion is enabled, check existing version first
        if (options?.checkVersion) {
            const existing = await this.get(id);
            if (existing && existing.payload.version) {
                if (existing.payload.version >= enhancedPayload.version) {
                    // Existing version is newer or equal, skip upsert
                    return { success: false, reason: 'Existing version is newer' };
                }
            }
        }
        return this.executeWithRetry(async () => {
            await this.client.upsert(COLLECTION_NAME, {
                points: [
                    {
                        id: id,
                        vector: embedding,
                        payload: enhancedPayload,
                    },
                ],
            });
            return { success: true };
        }, 'upsert');
    }
    async search(embedding, limit = 10, filter) {
        return this.executeWithRetry(async () => {
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
        }, 'search');
    }
    /**
     * Get a single memory by ID.
     */
    async get(id) {
        return this.executeWithRetry(async () => {
            const result = await this.client.retrieve(COLLECTION_NAME, {
                ids: [id],
                with_payload: true,
            });
            return result.length > 0
                ? { id: result[0].id, payload: result[0].payload }
                : null;
        }, 'get');
    }
    /**
     * Update payload for an existing memory.
     */
    async updatePayload(id, payload) {
        return this.executeWithRetry(async () => {
            await this.client.setPayload(COLLECTION_NAME, {
                points: [id],
                payload: payload,
            });
        }, 'updatePayload');
    }
    /**
     * Scroll through memories with optional filter.
     * Use limit: 100 for each batch, use offset for pagination.
     */
    async scroll(filter, limit = 100, offset) {
        return this.executeWithRetry(async () => {
            const result = await this.client.scroll(COLLECTION_NAME, {
                limit,
                offset,
                filter: filter ? this.buildFilter(filter) : undefined,
                with_payload: true,
                with_vector: false,
            });
            return result.points.map(p => ({
                id: p.id,
                payload: p.payload,
            }));
        }, 'scroll');
    }
    buildFilter(filter) {
        const conditions = [];
        if (filter.type) {
            conditions.push({
                key: 'memory_type',
                match: { value: filter.type },
            });
        }
        // Session isolation filter
        if (filter.session_id) {
            conditions.push({
                key: 'session_id',
                match: { value: filter.session_id },
            });
        }
        return conditions.length > 0 ? { must: conditions } : undefined;
    }
    async delete(id) {
        return this.executeWithRetry(async () => {
            await this.client.delete(COLLECTION_NAME, {
                points: [id],
            });
        }, 'delete');
    }
    async count() {
        return this.executeWithRetry(async () => {
            const result = await this.client.count(COLLECTION_NAME, {});
            return result.count;
        }, 'count');
    }
    async getStats() {
        return this.executeWithRetry(async () => {
            const info = await this.client.getCollection(COLLECTION_NAME);
            return {
                total_points: info.points_count || 0,
                collection_name: COLLECTION_NAME,
            };
        }, 'getStats');
    }
    /**
     * Get current schema version.
     */
    async getSchemaVersion() {
        try {
            const metadata = await this.get(0);
            return metadata?.payload?.schema_version || 0;
        }
        catch {
            return 0;
        }
    }
    /**
     * Store schema version metadata.
     */
    async storeSchemaVersion() {
        await this.upsert(0, new Array(VECTOR_SIZE).fill(0), {
            type: '_metadata',
            schema_version: SCHEMA_VERSION,
            updated_at: new Date().toISOString(),
        });
    }
    /**
     * Check if collection exists.
     */
    async collectionExists() {
        const collections = await this.client.getCollections();
        return collections.collections.some(c => c.name === COLLECTION_NAME);
    }
    /**
     * Check if payload index exists.
     */
    async indexExists(fieldName) {
        try {
            const info = await this.client.getCollection(COLLECTION_NAME);
            // Access payload schema via index signature
            const schemaInfo = info;
            const indexes = schemaInfo.config?.payload_schema || {};
            return !!indexes[fieldName];
        }
        catch {
            return false;
        }
    }
    /**
     * Create payload index.
     */
    async createPayloadIndex(fieldName) {
        return this.executeWithRetry(async () => {
            await this.client.createPayloadIndex(COLLECTION_NAME, {
                field_name: fieldName,
                field_schema: 'keyword',
            });
        }, 'createPayloadIndex');
    }
}
export const MemoryType = {
    EPISODIC: 'episodic',
    SEMANTIC: 'semantic',
    REFLECTION: 'reflection',
};
//# sourceMappingURL=qdrant-client.js.map
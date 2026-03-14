/**
 * Qdrant Client wrapper
 */
import { QdrantClient } from '@qdrant/js-client-rest';
const COLLECTION_NAME = 'openclaw_memories';
const VECTOR_SIZE = 1024; // BGE-M3 embedding dimension
const SCHEMA_VERSION = 2; // v2: added BM25 and hierarchical memory support
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
                // Create collection with HNSW index and BM25 sparse vector support (with retry)
                await this.executeWithRetry(async () => {
                    await this.client.createCollection(COLLECTION_NAME, {
                        vectors: {
                            size: VECTOR_SIZE,
                            distance: 'Cosine',
                        },
                        // Sparse vector for BM25 (hybrid retrieval)
                        sparse_vectors: {
                            'bm25': {},
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
                result.changes.push('Created collection with BM25 support');
                result.migrated = true;
                console.log('[Qdrant] Collection created:', COLLECTION_NAME);
            }
            // Create BM25 payload index for text search (optional, skip if not supported)
            try {
                const bm25IndexExists = await this.indexExists('content');
                if (!bm25IndexExists) {
                    await this.createPayloadIndex('content');
                    result.changes.push('Created BM25 payload index on content field');
                    result.migrated = true;
                }
            }
            catch (error) {
                console.warn('[Qdrant] BM25 index creation not supported, skipping:', error.message);
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
        // Build sparse vector for BM25 if content exists
        const content = payload.content || payload.text || '';
        const sparseVector = content ? this.buildSparseVectorFromContent(content) : null;
        return this.executeWithRetry(async () => {
            const point = {
                id: id,
                vector: embedding,
                payload: enhancedPayload,
            };
            // Add sparse vector for BM25
            if (sparseVector) {
                point.vectors = {
                    '': embedding, // Dense vector
                    'bm25': sparseVector, // Sparse vector for BM25
                };
                delete point.vector; // Use vectors instead of vector
            }
            await this.client.upsert(COLLECTION_NAME, {
                points: [point],
            });
            return { success: true };
        }, 'upsert');
    }
    /**
     * Build sparse vector from content for BM25.
     */
    buildSparseVectorFromContent(content) {
        const tokens = content.toLowerCase().split(/\s+/).filter(w => w.length > 1);
        const termFreq = new Map();
        for (const token of tokens) {
            termFreq.set(token, (termFreq.get(token) || 0) + 1);
        }
        const indices = [];
        const values = [];
        for (const [token, freq] of termFreq.entries()) {
            indices.push(this.hashToken(token));
            values.push(freq);
        }
        return { indices, values };
    }
    /**
     * Search using BM25 (keyword-based full-text search).
     */
    async searchBM25(query, limit = 10, filter) {
        return this.executeWithRetry(async () => {
            // Tokenize query for BM25
            const tokens = query.toLowerCase().split(/\s+/).filter(w => w.length > 0);
            const sparseVector = this.buildSparseVector(tokens);
            const result = await this.client.search(COLLECTION_NAME, {
                vector: {
                    name: 'bm25',
                    vector: sparseVector,
                },
                limit: limit,
                filter: filter ? this.buildFilter(filter) : undefined,
                with_payload: true,
            });
            return result.map(r => ({
                id: r.id,
                score: r.score,
                payload: r.payload,
            }));
        }, 'searchBM25');
    }
    /**
     * Hybrid search: combine BM25 and vector search with reciprocal rank fusion.
     */
    async searchHybrid(query, embedding, limit = 10, filter, bm25Weight = 0.5 // BM25 weight (0.5 = equal weighting)
    ) {
        // Run both searches in parallel
        const [bm25Results, vectorResults] = await Promise.all([
            this.searchBM25(query, limit * 2, filter),
            this.search(embedding, limit * 2, filter),
        ]);
        // Reciprocal Rank Fusion (RRF)
        const rrfK = 60; // RRF constant
        const scoreMap = new Map();
        // Rank BM25 results
        bm25Results.forEach((r, idx) => {
            scoreMap.set(r.id, {
                bm25Rank: idx + 1,
                vectorRank: Infinity,
                payload: r.payload,
            });
        });
        // Rank vector results and merge
        vectorResults.forEach((r, idx) => {
            const existing = scoreMap.get(r.id);
            if (existing) {
                existing.vectorRank = idx + 1;
            }
            else {
                scoreMap.set(r.id, {
                    bm25Rank: Infinity,
                    vectorRank: idx + 1,
                    payload: r.payload,
                });
            }
        });
        // Calculate RRF scores and sort
        const fusedResults = Array.from(scoreMap.entries())
            .map(([id, ranks]) => ({
            id,
            rrfScore: (ranks.bm25Rank !== Infinity ? 1 / (ranks.bm25Rank + rrfK) : 0) * bm25Weight +
                (ranks.vectorRank !== Infinity ? 1 / (ranks.vectorRank + rrfK) : 0) * (1 - bm25Weight),
            bm25Rank: ranks.bm25Rank,
            vectorRank: ranks.vectorRank,
            payload: ranks.payload,
        }))
            .sort((a, b) => b.rrfScore - a.rrfScore)
            .slice(0, limit);
        return fusedResults.map(r => ({
            id: r.id,
            score: r.rrfScore,
            payload: r.payload,
            bm25Score: r.bm25Rank !== Infinity ? 1 / (r.bm25Rank + rrfK) : 0,
            vectorScore: r.vectorRank !== Infinity ? 1 / (r.vectorRank + rrfK) : 0,
        }));
    }
    /**
     * Build sparse vector from tokens for BM25.
     */
    buildSparseVector(tokens) {
        // Simple term frequency based sparse vector
        const termFreq = new Map();
        for (const token of tokens) {
            termFreq.set(token, (termFreq.get(token) || 0) + 1);
        }
        // Use hash of token as index (simple approach)
        const indices = [];
        const values = [];
        for (const [token, freq] of termFreq.entries()) {
            indices.push(this.hashToken(token));
            values.push(freq);
        }
        return { indices, values };
    }
    /**
     * Simple hash function for tokens.
     */
    hashToken(token) {
        let hash = 0;
        for (let i = 0; i < token.length; i++) {
            const char = token.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32-bit integer
        }
        return Math.abs(hash);
    }
    /**
     * Search using vector similarity.
     */
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
     * Preserves existing fields that are not in the new payload.
     * @param id - Memory ID
     * @param payload - New payload fields to merge
     * @param options.checkVersion - If true, only update if existing version is older
     */
    async updatePayload(id, payload, options) {
        return this.executeWithRetry(async () => {
            // Get existing payload to merge
            const existing = await this.get(id);
            if (!existing) {
                return { success: false, reason: 'Memory not found' };
            }
            // Check version if requested
            if (options?.checkVersion && existing.payload.version) {
                const newVersion = payload.version || Date.now();
                if (existing.payload.version >= newVersion) {
                    return { success: false, reason: 'Existing version is newer' };
                }
            }
            // Merge payloads: preserve existing fields, override with new values
            const mergedPayload = {
                ...existing.payload,
                ...payload,
                updated_at: new Date().toISOString(),
            };
            // Ensure version is preserved or updated
            if (!payload.version) {
                mergedPayload.version = existing.payload.version || Date.now();
            }
            await this.client.setPayload(COLLECTION_NAME, {
                points: [id],
                payload: mergedPayload,
            });
            return { success: true };
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
        // Support both 'type' and 'memory_type' field names
        if (filter.type || filter.memory_type) {
            conditions.push({
                key: 'memory_type',
                match: { value: filter.type || filter.memory_type },
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
    /**
     * Hierarchical search: Reflection -> Semantic -> Episodic.
     * Returns memories organized by hierarchy level.
     */
    async searchHierarchical(embedding, filter, reflectionLimit = 3, semanticLimit = 5, episodicLimit = 10) {
        // Search by memory type separately
        const [reflectionResults, semanticResults, episodicResults] = await Promise.all([
            this.search(embedding, reflectionLimit, { ...filter, type: 'reflection' }),
            this.search(embedding, semanticLimit, { ...filter, type: 'semantic' }),
            this.search(embedding, episodicLimit, { ...filter, type: 'episodic' }),
        ]);
        return {
            reflections: reflectionResults,
            semantics: semanticResults,
            episodic: episodicResults,
        };
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
            // Access payload schema - Qdrant 1.17.0 returns it at root level of result
            const schemaInfo = info;
            // Try both locations: result.payload_schema or result.config.payload_schema
            const indexes = schemaInfo.payload_schema || schemaInfo.config?.payload_schema || {};
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
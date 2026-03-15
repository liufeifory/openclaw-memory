/**
 * SurrealDB Client wrapper - SurrealDB 2.x compatible
 */
import { Surreal, RecordId } from 'surrealdb';
const MEMORY_TABLE = 'memory';
const ENTITY_TABLE = 'entity';
const RELATES_TABLE = 'relates';
const VECTOR_DIMENSION = 1024;
const SCHEMA_VERSION = 1;
export const MemoryType = {
    EPISODIC: 'episodic',
    SEMANTIC: 'semantic',
    REFLECTION: 'reflection',
};
export class SurrealDatabase {
    client = null;
    initialized = false;
    config;
    maxRetries = 3;
    baseDelayMs = 1000;
    constructor(config) {
        this.config = config;
    }
    async initialize() {
        if (this.initialized)
            return { success: true, migrated: false, changes: [] };
        const result = { success: true, migrated: false, changes: [] };
        try {
            await this.executeWithRetry(async () => {
                this.client = new Surreal();
                await this.client.connect(this.config.url);
            }, 'connect');
            await this.executeWithRetry(async () => {
                await this.client.signin({
                    username: this.config.username,
                    password: this.config.password,
                });
            }, 'signin');
            await this.executeWithRetry(async () => {
                await this.client.use({
                    namespace: this.config.namespace,
                    database: this.config.database,
                });
            }, 'use');
            const schemaMigrated = await this.createSchema();
            if (schemaMigrated) {
                result.changes.push('Created schema and indexes');
                result.migrated = true;
            }
            this.initialized = true;
        }
        catch (error) {
            result.success = false;
            console.error('[SurrealDB] Initialization failed:', error.message);
            throw error;
        }
        return result;
    }
    async createSchema() {
        let migrated = false;
        await this.query(`
      DEFINE TABLE IF NOT EXISTS ${MEMORY_TABLE} SCHEMAFULL;
      DEFINE FIELD IF NOT EXISTS type ON TABLE ${MEMORY_TABLE} TYPE string;
      DEFINE FIELD IF NOT EXISTS content ON TABLE ${MEMORY_TABLE} TYPE string;
      DEFINE FIELD IF NOT EXISTS embedding ON TABLE ${MEMORY_TABLE} TYPE array<number>;
      DEFINE FIELD IF NOT EXISTS importance ON TABLE ${MEMORY_TABLE} TYPE float;
      DEFINE FIELD IF NOT EXISTS access_count ON TABLE ${MEMORY_TABLE} TYPE int DEFAULT 0;
      DEFINE FIELD IF NOT EXISTS created_at ON TABLE ${MEMORY_TABLE} TYPE string;
      DEFINE FIELD IF NOT EXISTS session_id ON TABLE ${MEMORY_TABLE} TYPE option<string>;
      DEFINE FIELD IF NOT EXISTS is_active ON TABLE ${MEMORY_TABLE} TYPE bool DEFAULT true;
      DEFINE FIELD IF NOT EXISTS summary ON TABLE ${MEMORY_TABLE} TYPE option<string>;
      DEFINE FIELD IF NOT EXISTS updated_at ON TABLE ${MEMORY_TABLE} TYPE string;
    `);
        console.log('[SurrealDB] Memory table defined');
        try {
            await this.query(`
        DEFINE INDEX IF NOT EXISTS vector_idx ON TABLE ${MEMORY_TABLE}
        FIELDS embedding HNSW DIMENSION ${VECTOR_DIMENSION} DISTANCE COSINE;
      `);
            console.log('[SurrealDB] Vector index created');
            migrated = true;
        }
        catch (error) {
            console.warn('[SurrealDB] Vector index creation failed:', error.message);
        }
        try {
            await this.query(`DEFINE INDEX IF NOT EXISTS type_idx ON TABLE ${MEMORY_TABLE} FIELDS type;`);
            console.log('[SurrealDB] Type index created');
            migrated = true;
        }
        catch (error) {
            console.warn('[SurrealDB] Type index creation failed:', error.message);
        }
        try {
            await this.query(`DEFINE INDEX IF NOT EXISTS session_idx ON TABLE ${MEMORY_TABLE} FIELDS session_id;`);
            console.log('[SurrealDB] Session index created');
            migrated = true;
        }
        catch (error) {
            console.warn('[SurrealDB] Session index creation failed:', error.message);
        }
        await this.query(`
      DEFINE TABLE IF NOT EXISTS ${ENTITY_TABLE} SCHEMAFULL;
      DEFINE FIELD IF NOT EXISTS name ON TABLE ${ENTITY_TABLE} TYPE string;
      DEFINE FIELD IF NOT EXISTS normalized_name ON TABLE ${ENTITY_TABLE} TYPE option<string>;
      DEFINE FIELD IF NOT EXISTS entity_type ON TABLE ${ENTITY_TABLE} TYPE string;
    `);
        console.log('[SurrealDB] Entity table defined');
        await this.query(`
      DEFINE TABLE IF NOT EXISTS ${RELATES_TABLE} SCHEMAFULL;
      DEFINE FIELD IF NOT EXISTS type ON TABLE ${RELATES_TABLE} TYPE string;
      DEFINE FIELD IF NOT EXISTS evidence ON TABLE ${RELATES_TABLE} TYPE array<record<${MEMORY_TABLE}>>;
    `);
        console.log('[SurrealDB] Relates table defined');
        await this.storeSchemaVersion();
        return migrated;
    }
    async query(sql) {
        if (!this.client) {
            throw new Error('[SurrealDB] Client not connected');
        }
        const result = await this.client.query(sql, {});
        return result;
    }
    async executeWithRetry(operation, operationName) {
        let lastError = null;
        for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
            try {
                return await operation();
            }
            catch (error) {
                lastError = error;
                console.error(`[SurrealDB] ${operationName} failed (attempt ${attempt}/${this.maxRetries}):`, error.message);
                if (attempt < this.maxRetries) {
                    const delay = Math.pow(2, attempt - 1) * this.baseDelayMs;
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
        }
        throw new Error(`[SurrealDB] ${operationName} failed after ${this.maxRetries} retries: ${lastError?.message}`);
    }
    async upsert(id, embedding, payload, options) {
        if (!this.client) {
            throw new Error('[SurrealDB] Client not connected');
        }
        const recordId = new RecordId(MEMORY_TABLE, id);
        // Build SET clause for upsert
        const fields = [];
        const params = {};
        fields.push(`type = $type`);
        params.type = payload.type || 'episodic';
        fields.push(`content = $content`);
        params.content = payload.content || '';
        fields.push(`embedding = $embedding`);
        params.embedding = embedding;
        fields.push(`importance = $importance`);
        params.importance = payload.importance || 0.5;
        fields.push(`access_count = $access_count`);
        params.access_count = payload.access_count || 0;
        const now = new Date().toISOString();
        fields.push(`created_at = $created_at`);
        params.created_at = payload.created_at ? String(payload.created_at) : now;
        if (payload.session_id !== undefined) {
            fields.push(`session_id = $session_id`);
            params.session_id = payload.session_id;
        }
        fields.push(`is_active = $is_active`);
        params.is_active = payload.is_active ?? true;
        if (payload.summary !== undefined) {
            fields.push(`summary = $summary`);
            params.summary = payload.summary;
        }
        fields.push(`updated_at = $updated_at`);
        params.updated_at = now;
        const sql = `UPSERT ${String(recordId)} SET ${fields.join(', ')}`;
        console.log('[SurrealDB] Upsert SQL:', sql.substring(0, 200));
        try {
            await this.client.query(sql, params);
            return { success: true };
        }
        catch (error) {
            console.error('[SurrealDB] Upsert failed:', error.message);
            return { success: false, reason: error.message };
        }
    }
    async search(embedding, limit = 10, filter) {
        if (!this.client) {
            throw new Error('[SurrealDB] Client not connected');
        }
        console.log(`[SurrealDB] Search: embedding=${embedding?.length}, filter=${JSON.stringify(filter)}`);
        const conditions = [];
        const params = { query_embedding: embedding, limit };
        if (filter?.type || filter?.memory_type) {
            conditions.push('type = $type');
            params.type = filter.type || filter.memory_type;
        }
        if (filter?.session_id) {
            conditions.push('session_id = $session_id');
            params.session_id = filter.session_id;
        }
        conditions.push('is_active = true');
        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
        const sql = `
      SELECT *, vector::similarity::cosine(embedding, $query_embedding) AS similarity
      FROM ${MEMORY_TABLE}
      ${whereClause}
      ORDER BY similarity DESC
      LIMIT $limit
    `;
        const result = await this.client.query(sql, params);
        // SurrealDB 3.x SDK returns [[records]] format (array of arrays)
        // Check if result[0] is an array (direct data) or an object with result property
        let data = [];
        if (Array.isArray(result) && result.length > 0) {
            if (Array.isArray(result[0])) {
                // SurrealDB 3.x format: [[{id, content, ...}]]
                data = result[0] || [];
            }
            else if (result[0]?.result) {
                // Legacy format: [{result: [{id, content, ...}]}]
                data = result[0].result || [];
            }
        }
        else if (result?.result) {
            // Fallback for object format
            data = result.result || [];
        }
        console.log(`[SurrealDB] Search extracted ${data.length} items`);
        return data.map((r) => ({
            id: this.extractIdFromRecord(r),
            score: r.similarity || 0,
            payload: this.toPayload(r),
        }));
    }
    async searchHybrid(query, embedding, limit = 10, filter, bm25Weight = 0.5) {
        if (!this.client) {
            throw new Error('[SurrealDB] Client not connected');
        }
        const conditions = [];
        const params = {
            query_embedding: embedding,
            query_keyword: query.toLowerCase(),
            limit,
            bm25_weight: bm25Weight,
        };
        if (filter?.type || filter?.memory_type) {
            conditions.push('type = $type');
            params.type = filter.type || filter.memory_type;
        }
        if (filter?.session_id) {
            conditions.push('session_id = $session_id');
            params.session_id = filter.session_id;
        }
        conditions.push('is_active = true');
        const keywordCondition = 'string::lowercase(content) CONTAINS $query_keyword';
        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')} AND ${keywordCondition}` : `WHERE ${keywordCondition}`;
        const sql = `
      SELECT *,
             vector::similarity::cosine(embedding, $query_embedding) AS vector_score,
             (1.0 - $bm25_weight) * vector::similarity::cosine(embedding, $query_embedding)
             + $bm25_weight * 0.5 AS combined_score
      FROM ${MEMORY_TABLE}
      ${whereClause}
      ORDER BY combined_score DESC
      LIMIT $limit
    `;
        const result = await this.client.query(sql, params);
        // SurrealDB 3.x returns [[records]] format
        let data = [];
        if (Array.isArray(result) && result.length > 0) {
            if (Array.isArray(result[0])) {
                data = result[0] || [];
            }
            else if (result[0]?.result) {
                data = result[0].result || [];
            }
        }
        return data.map((r) => ({
            id: this.extractIdFromRecord(r),
            score: r.combined_score || r.vector_score || 0,
            payload: this.toPayload(r),
        }));
    }
    async get(id) {
        if (!this.client) {
            throw new Error('[SurrealDB] Client not connected');
        }
        try {
            const recordId = new RecordId(MEMORY_TABLE, id);
            const result = await this.client.query(`SELECT * FROM ${String(recordId)}`, {});
            // SurrealDB 3.x returns [[record]] format
            let records = [];
            if (Array.isArray(result) && result.length > 0) {
                if (Array.isArray(result[0])) {
                    records = result[0] || [];
                }
                else if (result[0]?.result) {
                    records = result[0].result || [];
                }
            }
            if (records && records.length > 0) {
                return {
                    id,
                    payload: this.toPayload(records[0]),
                };
            }
        }
        catch (error) {
            console.error('[SurrealDB] Get failed:', error.message);
        }
        return null;
    }
    async updatePayload(id, payload, options) {
        if (!this.client) {
            throw new Error('[SurrealDB] Client not connected');
        }
        try {
            const recordId = new RecordId(MEMORY_TABLE, id);
            // Build SET clause for update
            const fields = [];
            const params = {};
            for (const [key, value] of Object.entries(payload)) {
                if (value !== undefined && value !== null) {
                    fields.push(`${key} = $${key}`);
                    params[key] = key === 'created_at' || key === 'updated_at' ? String(value) : value;
                }
            }
            // Use parameterized string instead of time::now() to avoid datetime type coercion issues
            const now = new Date().toISOString();
            fields.push(`updated_at = $updated_at`);
            params.updated_at = now;
            const sql = `UPDATE ${String(recordId)} SET ${fields.join(', ')}`;
            await this.client.query(sql, params);
            return { success: true };
        }
        catch (error) {
            console.error('[SurrealDB] Update payload failed:', error.message);
            return { success: false, reason: error.message };
        }
    }
    async scroll(filter, limit = 100, offset) {
        if (!this.client) {
            throw new Error('[SurrealDB] Client not connected');
        }
        const conditions = [];
        const params = { limit };
        if (filter?.type || filter?.memory_type) {
            conditions.push('type = $type');
            params.type = filter.type || filter.memory_type;
        }
        if (filter?.session_id) {
            conditions.push('session_id = $session_id');
            params.session_id = filter.session_id;
        }
        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
        const sql = `SELECT * FROM ${MEMORY_TABLE} ${whereClause} LIMIT $limit`;
        const result = await this.client.query(sql, params);
        // SurrealDB 3.x returns [[records]] format
        let data = [];
        if (Array.isArray(result) && result.length > 0) {
            if (Array.isArray(result[0])) {
                data = result[0] || [];
            }
            else if (result[0]?.result) {
                data = result[0].result || [];
            }
        }
        return data.map((r) => ({
            id: this.extractIdFromRecord(r),
            payload: this.toPayload(r),
        }));
    }
    async searchHierarchical(embedding, filter, reflectionLimit = 3, semanticLimit = 5, episodicLimit = 10) {
        const params = { query_embedding: embedding };
        const [reflectionResult, semanticResult, episodicResult] = await Promise.all([
            this.queryType('reflection', reflectionLimit, params),
            this.queryType('semantic', semanticLimit, params),
            this.queryType('episodic', episodicLimit, params, filter?.session_id),
        ]);
        return {
            reflections: reflectionResult,
            semantics: semanticResult,
            episodic: episodicResult,
        };
    }
    async queryType(type, limit, params, sessionId) {
        if (!this.client) {
            throw new Error('[SurrealDB] Client not connected');
        }
        const conditions = ['type = $type'];
        const typedParams = { ...params, type, limit };
        if (sessionId) {
            conditions.push('session_id = $session_id');
            typedParams.session_id = sessionId;
        }
        const sql = `
      SELECT *, vector::similarity::cosine(embedding, $query_embedding) AS similarity
      FROM ${MEMORY_TABLE}
      WHERE ${conditions.join(' AND ')}
      ORDER BY similarity DESC
      LIMIT $limit
    `;
        const result = await this.client.query(sql, typedParams);
        // SurrealDB 3.x returns [[records]] format
        let data = [];
        if (Array.isArray(result) && result.length > 0) {
            if (Array.isArray(result[0])) {
                data = result[0] || [];
            }
            else if (result[0]?.result) {
                data = result[0].result || [];
            }
        }
        return data.map((r) => ({
            id: this.extractIdFromRecord(r),
            score: r.similarity || 0,
            payload: this.toPayload(r),
        }));
    }
    async deleteMemories(ids) {
        if (!this.client) {
            throw new Error('[SurrealDB] Client not connected');
        }
        for (const id of ids) {
            const recordId = new RecordId(MEMORY_TABLE, id);
            await this.client.query(`DELETE ${String(recordId)}`, {});
        }
    }
    async count() {
        if (!this.client) {
            return 0;
        }
        try {
            const result = await this.client.query('SELECT count() AS count FROM memory');
            // SurrealDB 3.x returns [[{count: N}]] format
            if (Array.isArray(result) && result.length > 0) {
                if (Array.isArray(result[0]) && result[0].length > 0) {
                    return result[0][0]?.count || 0;
                }
                else if (result[0]?.result?.[0]) {
                    return result[0].result[0].count || 0;
                }
            }
            return 0;
        }
        catch {
            return 0;
        }
    }
    async getStats() {
        const count = await this.count();
        return {
            total_points: count,
            collection_name: MEMORY_TABLE,
        };
    }
    async getSchemaVersion() {
        if (!this.client) {
            return 0;
        }
        try {
            const result = await this.client.query('SELECT schema_version FROM metadata LIMIT 1');
            // SurrealDB 3.x returns [[{schema_version: N}]] format
            if (Array.isArray(result) && result.length > 0) {
                if (Array.isArray(result[0]) && result[0].length > 0) {
                    return result[0][0]?.schema_version || 0;
                }
                else if (result[0]?.result?.[0]) {
                    return result[0].result[0].schema_version || 0;
                }
            }
            return 0;
        }
        catch {
            return 0;
        }
    }
    async storeSchemaVersion() {
        if (!this.client) {
            return;
        }
        try {
            const recordId = new RecordId('metadata', 1);
            await this.client.upsert({
                id: recordId,
                schema_version: SCHEMA_VERSION,
                updated_at: new Date().toISOString(),
            });
        }
        catch (error) {
            console.warn('[SurrealDB] Failed to store schema version:', error.message);
        }
    }
    extractIdFromRecord(record) {
        // Handle RecordId object (SurrealDB 3.x SDK)
        if (record.id && typeof record.id === 'object' && record.id.id !== undefined) {
            return record.id.id;
        }
        // Handle string format "table:id"
        if (typeof record.id === 'string') {
            const parts = record.id.split(':');
            return parseInt(parts[parts.length - 1], 10);
        }
        // Handle numeric id directly
        return record.id || 0;
    }
    toPayload(record) {
        return {
            type: record.type || 'episodic',
            memory_type: record.type || 'episodic',
            content: record.content || '',
            summary: record.summary,
            importance: record.importance || 0.5,
            access_count: record.access_count || 0,
            created_at: record.created_at instanceof Date
                ? record.created_at.toISOString()
                : String(record.created_at),
            session_id: record.session_id,
            is_active: record.is_active ?? true,
            updated_at: record.updated_at instanceof Date
                ? record.updated_at.toISOString()
                : String(record.updated_at),
        };
    }
    async close() {
        if (this.client) {
            await this.client.close();
            this.client = null;
        }
    }
}
//# sourceMappingURL=surrealdb-client.js.map
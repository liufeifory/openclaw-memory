/**
 * SurrealDB Client wrapper - SurrealDB 2.x compatible
 */
import { Surreal, RecordId } from 'surrealdb';
const MEMORY_TABLE = 'memory';
const ENTITY_TABLE = 'entity';
const MEMORY_ENTITY_TABLE = 'memory_entity';
const RELATES_TABLE = 'relates';
const VECTOR_DIMENSION = 1024;
const SCHEMA_VERSION = 1;
export const GRAPH_PROTECTION = {
    MIN_MENTION_COUNT: 3,
    MAX_MEMORY_LINKS: 500,
    TTL_DAYS: 90,
    PRUNE_INTERVAL_DAYS: 7,
};
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
      DEFINE FIELD IF NOT EXISTS is_indexed ON TABLE ${MEMORY_TABLE} TYPE bool DEFAULT false;
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
        try {
            await this.query(`DEFINE INDEX IF NOT EXISTS is_indexed_idx ON TABLE ${MEMORY_TABLE} FIELDS is_indexed;`);
            console.log('[SurrealDB] is_indexed index created');
            migrated = true;
        }
        catch (error) {
            console.warn('[SurrealDB] is_indexed index creation failed:', error.message);
        }
        await this.query(`
      DEFINE TABLE IF NOT EXISTS ${ENTITY_TABLE} SCHEMAFULL;
      DEFINE FIELD IF NOT EXISTS name ON TABLE ${ENTITY_TABLE} TYPE string;
      DEFINE FIELD IF NOT EXISTS normalized_name ON TABLE ${ENTITY_TABLE} TYPE option<string>;
      DEFINE FIELD IF NOT EXISTS entity_type ON TABLE ${ENTITY_TABLE} TYPE string;
      DEFINE FIELD IF NOT EXISTS alias ON TABLE ${ENTITY_TABLE} TYPE option<array<string>>;
      DEFINE FIELD IF NOT EXISTS mention_count ON TABLE ${ENTITY_TABLE} TYPE int DEFAULT 0;
      DEFINE FIELD IF NOT EXISTS relation_count ON TABLE ${ENTITY_TABLE} TYPE int DEFAULT 0;
      DEFINE FIELD IF NOT EXISTS last_accessed ON TABLE ${ENTITY_TABLE} TYPE option<string>;
      DEFINE FIELD IF NOT EXISTS created_at ON TABLE ${ENTITY_TABLE} TYPE string;
      DEFINE FIELD IF NOT EXISTS is_active ON TABLE ${ENTITY_TABLE} TYPE bool DEFAULT true;
      DEFINE FIELD IF NOT EXISTS is_frozen ON TABLE ${ENTITY_TABLE} TYPE bool DEFAULT false;
    `);
        console.log('[SurrealDB] Entity table defined with graph protection fields');
        try {
            await this.query(`DEFINE INDEX IF NOT EXISTS entity_name_idx ON TABLE ${ENTITY_TABLE} FIELDS name;`);
            console.log('[SurrealDB] Entity name index created');
            migrated = true;
        }
        catch (error) {
            console.warn('[SurrealDB] Entity name index creation failed:', error.message);
        }
        try {
            await this.query(`DEFINE INDEX IF NOT EXISTS entity_normalized_idx ON TABLE ${ENTITY_TABLE} FIELDS normalized_name;`);
            console.log('[SurrealDB] Entity normalized_name index created');
            migrated = true;
        }
        catch (error) {
            console.warn('[SurrealDB] Entity normalized_name index creation failed:', error.message);
        }
        await this.query(`
      DEFINE TABLE IF NOT EXISTS ${MEMORY_ENTITY_TABLE} SCHEMAFULL;
      DEFINE FIELD IF NOT EXISTS memory ON TABLE ${MEMORY_ENTITY_TABLE} TYPE record<${MEMORY_TABLE}>;
      DEFINE FIELD IF NOT EXISTS entity ON TABLE ${MEMORY_ENTITY_TABLE} TYPE record<${ENTITY_TABLE}>;
      DEFINE FIELD IF NOT EXISTS relation_type ON TABLE ${MEMORY_ENTITY_TABLE} TYPE string;
      DEFINE FIELD IF NOT EXISTS weight ON TABLE ${MEMORY_ENTITY_TABLE} TYPE float DEFAULT 1.0;
      DEFINE FIELD IF NOT EXISTS created_at ON TABLE ${MEMORY_ENTITY_TABLE} TYPE string;
    `);
        console.log('[SurrealDB] memory_entity edge table defined');
        try {
            await this.query(`DEFINE INDEX IF NOT EXISTS memory_entity_memory_idx ON TABLE ${MEMORY_ENTITY_TABLE} FIELDS memory;`);
            console.log('[SurrealDB] memory_entity memory index created');
            migrated = true;
        }
        catch (error) {
            console.warn('[SurrealDB] memory_entity memory index creation failed:', error.message);
        }
        try {
            await this.query(`DEFINE INDEX IF NOT EXISTS memory_entity_entity_idx ON TABLE ${MEMORY_ENTITY_TABLE} FIELDS entity;`);
            console.log('[SurrealDB] memory_entity entity index created');
            migrated = true;
        }
        catch (error) {
            console.warn('[SurrealDB] memory_entity entity index creation failed:', error.message);
        }
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
    /**
     * 1. upsertEntity - Create or get entity (ON DUPLICATE KEY UPDATE mode)
     * Returns entity ID
     */
    async upsertEntity(name, type) {
        if (!this.client) {
            throw new Error('[SurrealDB] Client not connected');
        }
        const now = new Date().toISOString();
        // First try to find existing entity by name
        const findResult = await this.client.query(`SELECT * FROM ${ENTITY_TABLE} WHERE name = $name LIMIT 1`, { name });
        let data = [];
        if (Array.isArray(findResult) && findResult.length > 0) {
            if (Array.isArray(findResult[0])) {
                data = findResult[0] || [];
            }
            else if (findResult[0]?.result) {
                data = findResult[0].result || [];
            }
        }
        if (data && data.length > 0) {
            // Entity exists, update mention_count and return ID
            const existingId = this.extractIdFromRecord(data[0]);
            await this.client.query(`UPDATE ${ENTITY_TABLE}:${existingId} SET mention_count = mention_count + 1, last_accessed = $created_at`, { created_at: now });
            return existingId;
        }
        // Entity doesn't exist, create new one
        const createSql = `
      CREATE ${ENTITY_TABLE} CONTENT {
        name: $name,
        entity_type: $type,
        mention_count: 1,
        relation_count: 0,
        created_at: $created_at,
        is_active: true,
        is_frozen: false
      }
    `;
        try {
            const result = await this.client.query(createSql, {
                name,
                type,
                created_at: now,
            });
            // Extract the entity ID from result
            let createData = [];
            if (Array.isArray(result) && result.length > 0) {
                if (Array.isArray(result[0])) {
                    createData = result[0] || [];
                }
                else if (result[0]?.result) {
                    createData = result[0].result || [];
                }
            }
            if (createData && createData.length > 0) {
                return this.extractIdFromRecord(createData[0]);
            }
            throw new Error('[SurrealDB] Failed to get entity ID after create');
        }
        catch (error) {
            console.error('[SurrealDB] upsertEntity failed:', error.message);
            throw error;
        }
    }
    /**
     * 2. linkMemoryEntity - Create memory-entity edge
     * Includes Super Node frozen check
     */
    async linkMemoryEntity(memoryId, entityId, relevanceScore) {
        if (!this.client) {
            throw new Error('[SurrealDB] Client not connected');
        }
        // Check if entity is frozen (Super Node protection)
        const entityCheck = await this.client.query(`SELECT is_frozen FROM ${ENTITY_TABLE}:${entityId}`, {});
        let entityData = [];
        if (Array.isArray(entityCheck) && entityCheck.length > 0) {
            if (Array.isArray(entityCheck[0])) {
                entityData = entityCheck[0] || [];
            }
            else if (entityCheck[0]?.result) {
                entityData = entityCheck[0].result || [];
            }
        }
        if (entityData && entityData.length > 0 && entityData[0].is_frozen === true) {
            console.warn(`[SurrealDB] Entity ${entityId} is frozen (Super Node), skipping link`);
            return;
        }
        const now = new Date().toISOString();
        const memoryRecordId = `${MEMORY_TABLE}:${memoryId}`;
        const entityRecordId = `${ENTITY_TABLE}:${entityId}`;
        try {
            // Use INSERT to create the edge (alternative to RELATE for SurrealDB 2.x)
            const sql = `
        INSERT INTO ${MEMORY_ENTITY_TABLE} (
          memory,
          entity,
          relation_type,
          weight,
          created_at
        ) VALUES (
          ${memoryRecordId},
          ${entityRecordId},
          'mentions',
          $weight,
          $created_at
        )
        ON DUPLICATE KEY UPDATE
          weight = $weight,
          created_at = $created_at
      `;
            await this.client.query(sql, {
                weight: relevanceScore,
                created_at: now,
            });
            // Increment entity's relation_count
            await this.client.query(`UPDATE ${ENTITY_TABLE}:${entityId} SET relation_count = relation_count + 1`, {});
        }
        catch (error) {
            console.error('[SurrealDB] linkMemoryEntity failed:', error.message);
            throw error;
        }
    }
    /**
     * 3. searchByEntity - Retrieve memories associated with an entity (graph traversal)
     */
    async searchByEntity(entityId, limit = 10) {
        if (!this.client) {
            throw new Error('[SurrealDB] Client not connected');
        }
        const entityRecordId = `${ENTITY_TABLE}:${entityId}`;
        // Query through memory_entity edge table to find associated memories
        // SurrealDB doesn't support table aliases, use subquery instead
        const sql = `
      SELECT
        memory.id AS id,
        memory.content AS content,
        memory.type AS type,
        memory.created_at AS created_at,
        weight
      FROM ${MEMORY_ENTITY_TABLE}
      WHERE entity = ${entityRecordId}
      ORDER BY weight DESC
      LIMIT $limit
    `;
        try {
            const result = await this.client.query(sql, { limit });
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
                content: r.content,
                type: r.type,
                weight: r.weight,
                created_at: r.created_at,
            }));
        }
        catch (error) {
            console.error('[SurrealDB] searchByEntity failed:', error.message);
            throw error;
        }
    }
    /**
     * 4. searchByAssociation - Second-degree association search
     * Find memories related to a seed memory through shared entities
     */
    async searchByAssociation(seedMemoryId, limit = 10) {
        if (!this.client) {
            throw new Error('[SurrealDB] Client not connected');
        }
        const seedRecordId = `${MEMORY_TABLE}:${seedMemoryId}`;
        // First, find all entities linked to the seed memory
        // Then find other memories linked to those entities (excluding the seed)
        // Use subquery instead of JOIN with alias
        const sql = `
      SELECT
        memory.id AS id,
        memory.content AS content,
        memory.type AS type,
        memory.created_at AS created_at,
        weight
      FROM ${MEMORY_ENTITY_TABLE}
      WHERE entity IN (
        SELECT entity FROM ${MEMORY_ENTITY_TABLE} WHERE memory = ${seedRecordId}
      )
      AND memory != ${seedRecordId}
      ORDER BY weight DESC
      LIMIT $limit
    `;
        try {
            const result = await this.client.query(sql, { limit });
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
                content: r.content,
                type: r.type,
                weight: r.weight,
                created_at: r.created_at,
            }));
        }
        catch (error) {
            console.error('[SurrealDB] searchByAssociation failed:', error.message);
            throw error;
        }
    }
    /**
     * 5. getEntityStats - Get entity statistics
     * Returns total entities, count by type, and total links
     */
    async getEntityStats() {
        if (!this.client) {
            return { total_entities: 0, by_type: {}, total_links: 0 };
        }
        try {
            // Get total entities by selecting all and counting the array length
            const totalResult = await this.client.query(`SELECT * FROM ${ENTITY_TABLE}`, {});
            let totalEntities = 0;
            if (Array.isArray(totalResult) && totalResult.length > 0) {
                if (Array.isArray(totalResult[0])) {
                    totalEntities = totalResult[0].length;
                }
                else if (totalResult[0]?.result) {
                    totalEntities = totalResult[0].result?.length || 0;
                }
            }
            // Get entities by type
            const byTypeResult = await this.client.query(`SELECT entity_type, count(true) AS count FROM ${ENTITY_TABLE} GROUP BY entity_type`, {});
            const byType = {};
            if (Array.isArray(byTypeResult) && byTypeResult.length > 0) {
                let typeData = [];
                if (Array.isArray(byTypeResult[0])) {
                    typeData = byTypeResult[0] || [];
                }
                else if (byTypeResult[0]?.result) {
                    typeData = byTypeResult[0].result || [];
                }
                for (const row of typeData) {
                    if (row.entity_type && row.count) {
                        byType[row.entity_type] = row.count;
                    }
                }
            }
            // Get total links (edges in memory_entity table)
            const linksResult = await this.client.query(`SELECT * FROM ${MEMORY_ENTITY_TABLE}`, {});
            let totalLinks = 0;
            if (Array.isArray(linksResult) && linksResult.length > 0) {
                if (Array.isArray(linksResult[0])) {
                    totalLinks = linksResult[0].length;
                }
                else if (linksResult[0]?.result) {
                    totalLinks = linksResult[0].result?.length || 0;
                }
            }
            return {
                total_entities: totalEntities,
                by_type: byType,
                total_links: totalLinks,
            };
        }
        catch (error) {
            console.error('[SurrealDB] getEntityStats failed:', error.message);
            return { total_entities: 0, by_type: {}, total_links: 0 };
        }
    }
    async close() {
        if (this.client) {
            await this.client.close();
            this.client = null;
        }
    }
}
//# sourceMappingURL=surrealdb-client.js.map
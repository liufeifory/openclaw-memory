/**
 * SurrealDB Client wrapper - SurrealDB 3.x compatible via HTTP API
 */
import { logInfo, logWarn, logError } from './maintenance-logger.js';
// HTTP API client for SurrealDB 3.x
class SurrealHTTPClient {
    baseUrl;
    authHeader;
    namespace;
    database;
    constructor(url, username, password, namespace, database) {
        // Convert ws:// to http:// and strip /rpc suffix if present
        this.baseUrl = url
            .replace('ws://', 'http://')
            .replace('wss://', 'https://')
            .replace(/\/rpc$/, '');
        this.authHeader = 'Basic ' + Buffer.from(username + ':' + password).toString('base64');
        this.namespace = namespace;
        this.database = database;
    }
    async query(sql, params) {
        // Build LET statements for params if provided
        let letStatements = '';
        if (params && Object.keys(params).length > 0) {
            for (const [key, value] of Object.entries(params)) {
                // Serialize value appropriately for SurrealDB
                let serializedValue;
                if (Array.isArray(value)) {
                    // Arrays need to be serialized as JSON-like format
                    serializedValue = JSON.stringify(value);
                }
                else if (typeof value === 'string') {
                    // Strings need quotes
                    serializedValue = `"${value.replace(/"/g, '\\"')}"`;
                }
                else if (typeof value === 'number') {
                    serializedValue = value.toString();
                }
                else if (typeof value === 'boolean') {
                    serializedValue = value ? 'true' : 'false';
                }
                else if (value === null || value === undefined) {
                    serializedValue = 'NONE';
                }
                else {
                    // Objects need JSON serialization
                    serializedValue = JSON.stringify(value);
                }
                letStatements += `LET ${key.startsWith('$') ? key : '$' + key} = ${serializedValue};`;
            }
        }
        // Use text/plain format for SurrealDB 3.x HTTP API
        const fullSql = `USE NS ${this.namespace} DB ${this.database};${letStatements}${sql}${sql.endsWith(';') ? '' : ';'}`;
        const response = await fetch(`${this.baseUrl}/sql`, {
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'text/plain',
                'Authorization': this.authHeader,
            },
            body: fullSql,
        });
        if (!response.ok) {
            const text = await response.text();
            throw new Error(`SurrealDB HTTP error ${response.status}: ${text}`);
        }
        const data = await response.json();
        // SurrealDB 3.x HTTP API returns array of results
        // First result is USE statement, then LET statements, then actual query
        if (Array.isArray(data) && data.length > 0) {
            // Count how many non-query results we have (USE + LET statements)
            const nonQueryCount = 1 + (params ? Object.keys(params).length : 0);
            if (data.length > nonQueryCount) {
                // Return the actual query result (skip USE and LET results)
                return data.slice(nonQueryCount).map((r) => r.result);
            }
            else if (data.length === nonQueryCount) {
                // Only USE and LET, no actual query result - this shouldn't happen normally
                return [];
            }
            // Fallback: if we have 1 result, it might be the query itself
            return data[0].result;
        }
        return data;
    }
    async healthCheck() {
        try {
            const result = await this.query('SELECT count() FROM information_schema.tables GROUP ALL');
            return Array.isArray(result);
        }
        catch {
            return false;
        }
    }
}
const MEMORY_TABLE = 'memory';
const ENTITY_TABLE = 'entity';
const MEMORY_ENTITY_TABLE = 'memory_entity';
const ENTITY_RELATION_TABLE = 'entity_relation'; // Stage 2: Entity-Entity edges
const RELATES_TABLE = 'relates';
const VECTOR_DIMENSION = 1024;
const SCHEMA_VERSION = 1;
// Document import tracking
const DOCUMENTS_TABLE = 'documents';
const DOCUMENT_IMPORT_STATE_TABLE = 'document_import_state';
// Stage 2: Co-occurrence threshold - minimum memories to form entity-entity relationship
const CO_OCCURRENCE_THRESHOLD = 3;
// Stage 3: Topic Layer tables
const TOPIC_TABLE = 'topic';
const TOPIC_MEMORY_TABLE = 'topic_memory';
const ENTITY_ALIAS_TABLE = 'entity_alias';
// Stage 3: Super Node thresholds
const TOPIC_SOFT_LIMIT = 400; // 80% threshold, trigger Topic creation
const TOPIC_HARD_LIMIT = 500; // 100% threshold, force freeze
export { TOPIC_TABLE, TOPIC_MEMORY_TABLE, ENTITY_ALIAS_TABLE, TOPIC_SOFT_LIMIT, TOPIC_HARD_LIMIT, ENTITY_RELATION_TABLE, MEMORY_TABLE, ENTITY_TABLE, DOCUMENTS_TABLE, DOCUMENT_IMPORT_STATE_TABLE };
export const GRAPH_PROTECTION = {
    MIN_MENTION_COUNT: 1, // 降低阈值，允许新实体快速创建
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
    // Heartbeat for connection monitoring
    heartbeatInterval;
    heartbeatEnabled = true;
    // Retry configuration - increased for boot-time race conditions
    maxRetries = 10;
    baseDelayMs = 2000;
    maxDelayMs = 10000;
    constructor(config) {
        this.config = config;
    }
    /**
     * Ensure we have a valid connection to SurrealDB.
     * Reconnects if connection is lost.
     */
    async ensureConnected() {
        if (!this.client) {
            // No client, need to initialize
            await this.initialize();
            return;
        }
        // Client exists, check if connection is still alive
        try {
            const result = await this.client.query('SELECT count() FROM information_schema.tables GROUP ALL');
            if (!Array.isArray(result)) {
                throw new Error('Invalid health check result');
            }
        }
        catch (error) {
            // Connection dead, reconnect
            logInfo(`[SurrealDB] Connection lost, reconnecting... (${error.message})`);
            this.client = null;
            this.initialized = false;
            await this.initialize();
        }
    }
    async initialize() {
        // Check if we need to reconnect (connection may have been lost)
        if (this.initialized && this.client) {
            // Connection exists, check if it's still alive
            try {
                // Try a simple query to verify connection
                const result = await this.client.query('SELECT count() FROM information_schema.tables GROUP ALL');
                if (Array.isArray(result)) {
                    return { success: true, migrated: false, changes: [] };
                }
            }
            catch {
                // Connection dead, will reconnect below
                logInfo('[SurrealDB] Connection lost, reconnecting...');
            }
        }
        const result = { success: true, migrated: false, changes: [] };
        try {
            // Create HTTP client for SurrealDB 3.x
            await this.executeWithRetry(async () => {
                this.client = new SurrealHTTPClient(this.config.url, this.config.username, this.config.password, this.config.namespace, this.config.database);
            }, 'connect');
            const schemaMigrated = await this.createSchema();
            if (schemaMigrated) {
                result.changes.push('Created schema and indexes');
                result.migrated = true;
            }
            this.initialized = true;
            // Start heartbeat for connection monitoring
            this.startHeartbeat();
        }
        catch (error) {
            result.success = false;
            logError(`SurrealDB initialization failed: ${error.message}`);
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
        logInfo('Memory table defined');
        try {
            await this.query(`
        DEFINE INDEX IF NOT EXISTS vector_idx ON TABLE ${MEMORY_TABLE}
        FIELDS embedding HNSW DIMENSION ${VECTOR_DIMENSION} DISTANCE COSINE;
      `);
            logInfo('Vector index created');
            migrated = true;
        }
        catch (error) {
            logWarn(`Vector index creation failed: ${error.message}`);
        }
        try {
            await this.query(`DEFINE INDEX IF NOT EXISTS type_idx ON TABLE ${MEMORY_TABLE} FIELDS type;`);
            logInfo('Type index created');
            migrated = true;
        }
        catch (error) {
            logWarn(`Type index creation failed: ${error.message}`);
        }
        try {
            await this.query(`DEFINE INDEX IF NOT EXISTS session_idx ON TABLE ${MEMORY_TABLE} FIELDS session_id;`);
            logInfo('Session index created');
            migrated = true;
        }
        catch (error) {
            logWarn(`Session index creation failed: ${error.message}`);
        }
        try {
            await this.query(`DEFINE INDEX IF NOT EXISTS is_indexed_idx ON TABLE ${MEMORY_TABLE} FIELDS is_indexed;`);
            logInfo('is_indexed index created');
            migrated = true;
        }
        catch (error) {
            logWarn(`is_indexed index creation failed: ${error.message}`);
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
      DEFINE FIELD IF NOT EXISTS last_mentioned_at ON TABLE ${ENTITY_TABLE} TYPE option<string>;
      DEFINE FIELD IF NOT EXISTS first_seen_at ON TABLE ${ENTITY_TABLE} TYPE option<string>;
      DEFINE FIELD IF NOT EXISTS created_at ON TABLE ${ENTITY_TABLE} TYPE string DEFAULT time::now();
      DEFINE FIELD IF NOT EXISTS is_active ON TABLE ${ENTITY_TABLE} TYPE bool DEFAULT true;
      DEFINE FIELD IF NOT EXISTS is_frozen ON TABLE ${ENTITY_TABLE} TYPE bool DEFAULT false;
      DEFINE FIELD IF NOT EXISTS canonical_id ON TABLE ${ENTITY_TABLE} TYPE option<string>;
      DEFINE FIELD IF NOT EXISTS is_merged ON TABLE ${ENTITY_TABLE} TYPE bool DEFAULT false;
    `);
        logInfo('Entity table defined');
        try {
            await this.query(`DEFINE INDEX IF NOT EXISTS entity_name_idx ON TABLE ${ENTITY_TABLE} FIELDS name;`);
            logInfo('Entity name index created');
            migrated = true;
        }
        catch (error) {
            logWarn(`[SurrealDB] Entity name index creation failed: ${error.message}`);
        }
        try {
            await this.query(`DEFINE INDEX IF NOT EXISTS entity_normalized_idx ON TABLE ${ENTITY_TABLE} FIELDS normalized_name;`);
            logInfo('Entity normalized_name index created');
            migrated = true;
        }
        catch (error) {
            logWarn(`[SurrealDB] Entity normalized_name index creation failed: ${error.message}`);
        }
        try {
            await this.query(`DEFINE INDEX IF NOT EXISTS entity_last_mentioned_idx ON TABLE ${ENTITY_TABLE} FIELDS last_mentioned_at;`);
            logInfo('Entity last_mentioned_at index created');
            migrated = true;
        }
        catch (error) {
            logWarn(`[SurrealDB] Entity last_mentioned_at index creation failed: ${error.message}`);
        }
        try {
            await this.query(`DEFINE INDEX IF NOT EXISTS entity_first_seen_idx ON TABLE ${ENTITY_TABLE} FIELDS first_seen_at;`);
            logInfo('Entity first_seen_at index created');
            migrated = true;
        }
        catch (error) {
            logWarn(`[SurrealDB] Entity first_seen_at index creation failed: ${error.message}`);
        }
        await this.query(`
      DEFINE TABLE IF NOT EXISTS ${MEMORY_ENTITY_TABLE} SCHEMAFULL;
      DEFINE FIELD IF NOT EXISTS memory ON TABLE ${MEMORY_ENTITY_TABLE} TYPE record<${MEMORY_TABLE}>;
      DEFINE FIELD IF NOT EXISTS entity ON TABLE ${MEMORY_ENTITY_TABLE} TYPE record<${ENTITY_TABLE}>;
      DEFINE FIELD IF NOT EXISTS relation_type ON TABLE ${MEMORY_ENTITY_TABLE} TYPE string;
      DEFINE FIELD IF NOT EXISTS weight ON TABLE ${MEMORY_ENTITY_TABLE} TYPE float DEFAULT 1.0;
      DEFINE FIELD IF NOT EXISTS created_at ON TABLE ${MEMORY_ENTITY_TABLE} TYPE string;
    `);
        logInfo('memory_entity edge table defined');
        try {
            await this.query(`DEFINE INDEX IF NOT EXISTS memory_entity_memory_idx ON TABLE ${MEMORY_ENTITY_TABLE} FIELDS memory;`);
            logInfo('memory_entity memory index created');
            migrated = true;
        }
        catch (error) {
            logWarn(`[SurrealDB] memory_entity memory index creation failed: ${error.message}`);
        }
        try {
            await this.query(`DEFINE INDEX IF NOT EXISTS memory_entity_entity_idx ON TABLE ${MEMORY_ENTITY_TABLE} FIELDS entity;`);
            logInfo('memory_entity entity index created');
            migrated = true;
        }
        catch (error) {
            logWarn(`[SurrealDB] memory_entity entity index creation failed: ${error.message}`);
        }
        await this.query(`
      DEFINE TABLE IF NOT EXISTS ${RELATES_TABLE} SCHEMAFULL;
      DEFINE FIELD IF NOT EXISTS type ON TABLE ${RELATES_TABLE} TYPE string;
      DEFINE FIELD IF NOT EXISTS evidence ON TABLE ${RELATES_TABLE} TYPE array<record<${MEMORY_TABLE}>>;
    `);
        logInfo('Relates table defined');
        // Stage 2: Entity-Entity relationship table (using RELATE-style edges)
        await this.query(`
      DEFINE TABLE IF NOT EXISTS ${ENTITY_RELATION_TABLE} SCHEMAFULL;
      DEFINE FIELD IF NOT EXISTS in ON TABLE ${ENTITY_RELATION_TABLE} TYPE record<${ENTITY_TABLE}>;
      DEFINE FIELD IF NOT EXISTS out ON TABLE ${ENTITY_RELATION_TABLE} TYPE record<${ENTITY_TABLE}>;
      DEFINE FIELD IF NOT EXISTS relation_type ON TABLE ${ENTITY_RELATION_TABLE} TYPE string DEFAULT 'co_occurs';
      DEFINE FIELD IF NOT EXISTS weight ON TABLE ${ENTITY_RELATION_TABLE} TYPE float DEFAULT 1.0;
      DEFINE FIELD IF NOT EXISTS evidence_memory_ids ON TABLE ${ENTITY_RELATION_TABLE} TYPE array<int>;
      DEFINE FIELD IF NOT EXISTS evidence_count ON TABLE ${ENTITY_RELATION_TABLE} TYPE int DEFAULT 0;
      DEFINE FIELD IF NOT EXISTS created_at ON TABLE ${ENTITY_RELATION_TABLE} TYPE string;
      DEFINE FIELD IF NOT EXISTS updated_at ON TABLE ${ENTITY_RELATION_TABLE} TYPE string DEFAULT time::now();
      DEFINE FIELD IF NOT EXISTS is_manual_refined ON TABLE ${ENTITY_RELATION_TABLE} TYPE bool DEFAULT false;
      DEFINE FIELD IF NOT EXISTS confidence ON TABLE ${ENTITY_RELATION_TABLE} TYPE float DEFAULT 0.0;
      DEFINE FIELD IF NOT EXISTS reasoning ON TABLE ${ENTITY_RELATION_TABLE} TYPE option<string>;
      DEFINE FIELD IF NOT EXISTS last_occurrence_at ON TABLE ${ENTITY_RELATION_TABLE} TYPE option<string>;
    `);
        logInfo('Entity relation table defined');
        try {
            await this.query(`DEFINE INDEX IF NOT EXISTS entity_relation_in_idx ON TABLE ${ENTITY_RELATION_TABLE} FIELDS in;`);
            logInfo('Entity relation in index created');
            migrated = true;
        }
        catch (error) {
            // Silently ignore
        }
        try {
            await this.query(`DEFINE INDEX IF NOT EXISTS entity_relation_out_idx ON TABLE ${ENTITY_RELATION_TABLE} FIELDS out;`);
            logInfo('Entity relation out index created');
            migrated = true;
        }
        catch (error) {
            // Silently ignore
        }
        try {
            await this.query(`DEFINE INDEX IF NOT EXISTS entity_relation_weight_idx ON TABLE ${ENTITY_RELATION_TABLE} FIELDS weight;`);
            logInfo('Entity relation weight index created');
            migrated = true;
        }
        catch (error) {
            logWarn(`[SurrealDB] Entity relation weight index creation failed: ${error.message}`);
        }
        // ==================== Stage 3: Topic Layer Schema ====================
        // Topic table
        await this.query(`
      DEFINE TABLE IF NOT EXISTS ${TOPIC_TABLE} SCHEMAFULL;
      DEFINE FIELD IF NOT EXISTS name ON TABLE ${TOPIC_TABLE} TYPE string;
      DEFINE FIELD IF NOT EXISTS description ON TABLE ${TOPIC_TABLE} TYPE option<string>;
      DEFINE FIELD IF NOT EXISTS parent_entity_id ON TABLE ${TOPIC_TABLE} TYPE option<string>;
      DEFINE FIELD IF NOT EXISTS memory_count ON TABLE ${TOPIC_TABLE} TYPE int DEFAULT 0;
      DEFINE FIELD IF NOT EXISTS created_at ON TABLE ${TOPIC_TABLE} TYPE datetime DEFAULT time::now();
      DEFINE FIELD IF NOT EXISTS updated_at ON TABLE ${TOPIC_TABLE} TYPE datetime;
      DEFINE FIELD IF NOT EXISTS last_accessed_at ON TABLE ${TOPIC_TABLE} TYPE datetime;
    `);
        logInfo('Topic table defined');
        try {
            await this.query(`DEFINE INDEX IF NOT EXISTS topic_name_idx ON TABLE ${TOPIC_TABLE} FIELDS name;`);
            logInfo('Topic name index created');
            migrated = true;
        }
        catch (error) {
            logWarn(`[SurrealDB] Topic name index creation failed: ${error.message}`);
        }
        try {
            await this.query(`DEFINE INDEX IF NOT EXISTS topic_entity_idx ON TABLE ${TOPIC_TABLE} FIELDS parent_entity_id;`);
            logInfo('Topic parent_entity_id index created');
            migrated = true;
        }
        catch (error) {
            logWarn(`[SurrealDB] Topic parent_entity_id index creation failed: ${error.message}`);
        }
        try {
            await this.query(`DEFINE INDEX IF NOT EXISTS topic_last_accessed_idx ON TABLE ${TOPIC_TABLE} FIELDS last_accessed_at;`);
            logInfo('Topic last_accessed_at index created');
            migrated = true;
        }
        catch (error) {
            logWarn(`[SurrealDB] Topic last_accessed_at index creation failed: ${error.message}`);
        }
        // topic_memory edge table
        await this.query(`
      DEFINE TABLE IF NOT EXISTS ${TOPIC_MEMORY_TABLE} SCHEMAFULL;
      DEFINE FIELD IF NOT EXISTS in ON TABLE ${TOPIC_MEMORY_TABLE} TYPE record<${TOPIC_TABLE}>;
      DEFINE FIELD IF NOT EXISTS out ON TABLE ${TOPIC_MEMORY_TABLE} TYPE record<${MEMORY_TABLE}>;
      DEFINE FIELD IF NOT EXISTS relevance_score ON TABLE ${TOPIC_MEMORY_TABLE} TYPE float;
      DEFINE FIELD IF NOT EXISTS weight ON TABLE ${TOPIC_MEMORY_TABLE} TYPE float;
      DEFINE FIELD IF NOT EXISTS created_at ON TABLE ${TOPIC_MEMORY_TABLE} TYPE datetime DEFAULT time::now();
    `);
        logInfo('topic_memory edge table defined');
        try {
            await this.query(`DEFINE INDEX IF NOT EXISTS topic_memory_in_idx ON TABLE ${TOPIC_MEMORY_TABLE} FIELDS in;`);
            logInfo('topic_memory in index created');
            migrated = true;
        }
        catch (error) {
            // Silently ignore
        }
        try {
            await this.query(`DEFINE INDEX IF NOT EXISTS topic_memory_out_idx ON TABLE ${TOPIC_MEMORY_TABLE} FIELDS out;`);
            logInfo('topic_memory out index created');
            migrated = true;
        }
        catch (error) {
            // Silently ignore
        }
        // entity_alias table
        await this.query(`
      DEFINE TABLE IF NOT EXISTS ${ENTITY_ALIAS_TABLE} SCHEMAFULL;
      DEFINE FIELD IF NOT EXISTS alias ON TABLE ${ENTITY_ALIAS_TABLE} TYPE string;
      DEFINE FIELD IF NOT EXISTS entity_id ON TABLE ${ENTITY_ALIAS_TABLE} TYPE string;
      DEFINE FIELD IF NOT EXISTS verified ON TABLE ${ENTITY_ALIAS_TABLE} TYPE bool DEFAULT false;
      DEFINE FIELD IF NOT EXISTS source ON TABLE ${ENTITY_ALIAS_TABLE} TYPE string DEFAULT 'manual';
      DEFINE FIELD IF NOT EXISTS created_at ON TABLE ${ENTITY_ALIAS_TABLE} TYPE datetime DEFAULT time::now();
      DEFINE FIELD IF NOT EXISTS created_by ON TABLE ${ENTITY_ALIAS_TABLE} TYPE option<string>;
    `);
        logInfo('entity_alias table defined');
        try {
            await this.query(`DEFINE INDEX IF NOT EXISTS alias_name_idx ON TABLE ${ENTITY_ALIAS_TABLE} FIELDS alias;`);
            logInfo('entity_alias name index created');
            migrated = true;
        }
        catch (error) {
            logWarn(`[SurrealDB] entity_alias name index creation failed: ${error.message}`);
        }
        try {
            await this.query(`DEFINE INDEX IF NOT EXISTS alias_entity_idx ON TABLE ${ENTITY_ALIAS_TABLE} FIELDS entity_id;`);
            logInfo('entity_alias entity_id index created');
            migrated = true;
        }
        catch (error) {
            logWarn(`[SurrealDB] entity_alias entity_id index creation failed: ${error.message}`);
        }
        try {
            await this.query(`DEFINE INDEX IF NOT EXISTS alias_unique_idx ON TABLE ${ENTITY_ALIAS_TABLE} FIELDS alias UNIQUE;`);
            logInfo('entity_alias unique index created');
            migrated = true;
        }
        catch (error) {
            logWarn(`[SurrealDB] entity_alias unique index creation failed: ${error.message}`);
        }
        // Add canonical_id field to entity table (if not exists)
        await this.query(`
      DEFINE FIELD IF NOT EXISTS canonical_id ON TABLE ${ENTITY_TABLE} TYPE option<string>;
      DEFINE FIELD IF NOT EXISTS is_merged ON TABLE ${ENTITY_TABLE} TYPE bool DEFAULT false;
      DEFINE FIELD IF NOT EXISTS merged_at ON TABLE ${ENTITY_TABLE} TYPE option<datetime>;
    `);
        logInfo('Entity table extended');
        // Document import state tracking table
        await this.query(`
      DEFINE TABLE IF NOT EXISTS ${DOCUMENT_IMPORT_STATE_TABLE} SCHEMAFULL;
      DEFINE FIELD IF NOT EXISTS file_path ON TABLE ${DOCUMENT_IMPORT_STATE_TABLE} TYPE string;
      DEFINE FIELD IF NOT EXISTS file_hash ON TABLE ${DOCUMENT_IMPORT_STATE_TABLE} TYPE option<string>;
      DEFINE FIELD IF NOT EXISTS file_size ON TABLE ${DOCUMENT_IMPORT_STATE_TABLE} TYPE option<int>;
      DEFINE FIELD IF NOT EXISTS imported_at ON TABLE ${DOCUMENT_IMPORT_STATE_TABLE} TYPE datetime DEFAULT time::now();
      DEFINE FIELD IF NOT EXISTS chunks_count ON TABLE ${DOCUMENT_IMPORT_STATE_TABLE} TYPE option<int>;
      DEFINE FIELD IF NOT EXISTS entities_extracted ON TABLE ${DOCUMENT_IMPORT_STATE_TABLE} TYPE bool DEFAULT false;
      DEFINE FIELD IF NOT EXISTS relations_extracted ON TABLE ${DOCUMENT_IMPORT_STATE_TABLE} TYPE bool DEFAULT false;
      DEFINE FIELD IF NOT EXISTS status ON TABLE ${DOCUMENT_IMPORT_STATE_TABLE} TYPE string DEFAULT 'pending';
      DEFINE FIELD IF NOT EXISTS error ON TABLE ${DOCUMENT_IMPORT_STATE_TABLE} TYPE option<string>;
    `);
        logInfo('Document import state table defined');
        try {
            await this.query(`DEFINE INDEX IF NOT EXISTS doc_state_path_idx ON TABLE ${DOCUMENT_IMPORT_STATE_TABLE} FIELDS file_path;`);
            logInfo('Document state file_path index created');
            migrated = true;
        }
        catch (error) {
            logWarn(`[SurrealDB] Document state file_path index creation failed: ${error.message}`);
        }
        try {
            await this.query(`DEFINE INDEX IF NOT EXISTS doc_state_status_idx ON TABLE ${DOCUMENT_IMPORT_STATE_TABLE} FIELDS status;`);
            logInfo('Document state status index created');
            migrated = true;
        }
        catch (error) {
            logWarn(`[SurrealDB] Document state status index creation failed: ${error.message}`);
        }
        await this.storeSchemaVersion();
        return migrated;
    }
    async query(sql, params) {
        return this.executeQuery(sql, params);
    }
    /**
     * Raw query execution with automatic reconnection on errors.
     * This is the low-level method that all query operations should use.
     */
    async executeQuery(sql, params) {
        // Ensure we have a valid connection
        await this.ensureConnected();
        try {
            const result = await this.client.query(sql, params);
            return result;
        }
        catch (error) {
            // On connection lost, try to reconnect
            const errorMsg = error.message?.toLowerCase() || '';
            if (errorMsg.includes('connection') || errorMsg.includes('closed') ||
                errorMsg.includes('timeout') || errorMsg.includes('econnreset') ||
                errorMsg.includes('fetch') || errorMsg.includes('econnrefused') ||
                errorMsg.includes('socket') || errorMsg.includes('network') ||
                errorMsg.includes('aborted') || errorMsg.includes('disconnect')) {
                logInfo('[SurrealDB] Connection error detected, reconnecting...');
                this.client = null;
                this.initialized = false;
                await this.ensureConnected();
                // Retry the query once
                return this.client.query(sql, params);
            }
            throw error;
        }
    }
    async executeWithRetry(operation, operationName) {
        let lastError = null;
        for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
            try {
                return await operation();
            }
            catch (error) {
                lastError = error;
                logError(`[SurrealDB] ${operationName} failed (attempt ${attempt}/${this.maxRetries}): ${error.message}`);
                if (attempt < this.maxRetries) {
                    const delay = Math.min(Math.pow(2, attempt - 1) * this.baseDelayMs, this.maxDelayMs);
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
        }
        throw new Error(`[SurrealDB] ${operationName} failed after ${this.maxRetries} retries: ${lastError?.message}`);
    }
    /**
     * Start heartbeat to monitor connection health
     */
    startHeartbeat() {
        if (this.heartbeatInterval) {
            return; // Already running
        }
        this.heartbeatEnabled = true;
        this.heartbeatInterval = setInterval(async () => {
            if (!this.heartbeatEnabled || !this.client) {
                return;
            }
            try {
                const healthy = await this.client.healthCheck();
                if (!healthy) {
                    logInfo('[SurrealDB] Heartbeat failed, marking connection for reconnect');
                    this.initialized = false;
                }
            }
            catch (error) {
                logWarn(`[SurrealDB] Heartbeat error: ${error.message}`);
                this.initialized = false;
            }
        }, 30000); // Check every 30 seconds
        logInfo('[SurrealDB] Heartbeat started (30s interval)');
    }
    /**
     * Stop heartbeat monitoring
     */
    stopHeartbeat() {
        this.heartbeatEnabled = false;
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = undefined;
            logInfo('[SurrealDB] Heartbeat stopped');
        }
    }
    /**
     * Dispose - clean up resources
     */
    dispose() {
        this.stopHeartbeat();
        this.client = null;
        this.initialized = false;
        logInfo('[SurrealDB] Disposed');
    }
    async upsert(id, embedding, payload, options) {
        // Ensure we have a valid connection
        await this.ensureConnected();
        const recordId = `${MEMORY_TABLE}:${id}`;
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
        fields.push(`is_indexed = $is_indexed`);
        params.is_indexed = payload.is_indexed ?? false;
        if (payload.summary !== undefined) {
            fields.push(`summary = $summary`);
            params.summary = payload.summary;
        }
        fields.push(`updated_at = $updated_at`);
        params.updated_at = now;
        const sql = `UPSERT ${String(recordId)} SET ${fields.join(', ')}`;
        try {
            await this.executeQuery(sql, params);
            return { success: true };
        }
        catch (error) {
            return { success: false, reason: error.message };
        }
    }
    async search(embedding, limit = 10, filter) {
        // Ensure we have a valid connection
        await this.ensureConnected();
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
        const result = await this.executeQuery(sql, params);
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
        const result = await this.executeQuery(sql, params);
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
        // Ensure we have a valid connection
        await this.ensureConnected();
        try {
            const recordId = `${MEMORY_TABLE}:${id}`;
            const result = await this.executeQuery(`SELECT * FROM ${String(recordId)}`, {});
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
            logError(`[SurrealDB] Get failed: ${error.message}`);
        }
        return null;
    }
    async updatePayload(id, payload, options) {
        // Ensure we have a valid connection
        await this.ensureConnected();
        try {
            const recordId = `${MEMORY_TABLE}:${id}`;
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
            await this.executeQuery(sql, params);
            return { success: true };
        }
        catch (error) {
            logError(`[SurrealDB] Update payload failed: ${error.message}`);
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
        const result = await this.query(sql, params);
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
        const result = await this.executeQuery(sql, typedParams);
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
            const recordId = `${MEMORY_TABLE}:${id}`;
            await this.executeQuery(`DELETE ${String(recordId)}`, {});
        }
    }
    async count() {
        // Ensure we have a valid connection
        await this.ensureConnected();
        try {
            const result = await this.executeQuery('SELECT count() AS count FROM memory');
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
    /**
     * Query counts by memory type (episodic, semantic, reflection).
     */
    async queryTypeCounts() {
        // Ensure we have a valid connection
        await this.ensureConnected();
        try {
            const result = await this.executeQuery(`
        SELECT type, count() AS count FROM memory GROUP BY type
      `);
            // Parse SurrealDB 3.x result format
            let data = [];
            if (Array.isArray(result) && result.length > 0) {
                if (Array.isArray(result[0])) {
                    data = result[0] || [];
                }
                else if (result[0]?.result) {
                    data = result[0].result || [];
                }
            }
            const counts = {
                episodic: 0,
                semantic: 0,
                reflection: 0,
            };
            for (const row of data) {
                const type = row.type || 'episodic';
                const count = row.count || 0;
                counts[type] = count;
            }
            return {
                episodic: counts.episodic || 0,
                semantic: counts.semantic || 0,
                reflection: counts.reflection || 0,
                total: counts.episodic + counts.semantic + counts.reflection,
            };
        }
        catch {
            return { episodic: 0, semantic: 0, reflection: 0, total: 0 };
        }
    }
    async getSchemaVersion() {
        if (!this.client) {
            return 0;
        }
        try {
            const result = await this.executeQuery('SELECT schema_version FROM metadata LIMIT 1');
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
            await this.query(`
        UPSERT INTO metadata:id 'metadata:1'
        SET schema_version = ${SCHEMA_VERSION}, updated_at = time::now();
      `);
        }
        catch (error) {
            logError(`[SurrealDB] Failed to store schema version: ${error.message}`);
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
    extractStringIdFromRecord(record) {
        // Handle direct string
        if (typeof record === 'string') {
            const parts = record.split(':');
            return parts[parts.length - 1];
        }
        // Handle RecordId object with tb and id
        if (record && typeof record === 'object') {
            if (record.tb && record.id !== undefined) {
                return String(record.id);
            }
            if (record.id && typeof record.id === 'object' && record.id.id !== undefined) {
                return String(record.id.id);
            }
            if (typeof record.id === 'string') {
                const parts = record.id.split(':');
                return parts[parts.length - 1];
            }
        }
        return String(record?.id || 0);
    }
    /**
     * Extract numeric ID from Record ID string (e.g., 'entity:123' -> 123)
     */
    extractIdFromRecordId(recordId) {
        const parts = recordId.split(':');
        return parseInt(parts[parts.length - 1], 10);
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
        const findResult = await this.executeQuery(`SELECT * FROM ${ENTITY_TABLE} WHERE name = $name LIMIT 1`, { name });
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
            const existingId = this.extractStringIdFromRecord(data[0]);
            await this.executeQuery(`UPDATE ${ENTITY_TABLE}:${existingId} SET mention_count = mention_count + 1, last_accessed = $now, last_mentioned_at = $now`, { now });
            return existingId;
        }
        // Entity doesn't exist, create new one
        const createSql = `
      CREATE ${ENTITY_TABLE} CONTENT {
        name: $name,
        entity_type: $type,
        mention_count: 1,
        relation_count: 0,
        created_at: $now,
        first_seen_at: $now,
        last_mentioned_at: $now,
        is_active: true,
        is_frozen: false
      }
    `;
        try {
            const result = await this.executeQuery(createSql, {
                name,
                type,
                now,
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
                return this.extractStringIdFromRecord(createData[0]);
            }
            throw new Error('[SurrealDB] Failed to get entity ID after create');
        }
        catch (error) {
            logError(`[SurrealDB] upsertEntity failed: ${error.message}`);
            throw error;
        }
    }
    /**
     * 2. linkMemoryEntity - Create memory-entity edge
     * Includes Super Node frozen check and Topic creation trigger
     */
    async linkMemoryEntity(memoryId, entityId, relevanceScore, topicIndexer // Optional TopicIndexer for triggering topic creation
    ) {
        if (!this.client) {
            throw new Error('[SurrealDB] Client not connected');
        }
        // Convert entityId to string Record ID if needed
        let entityRecordId;
        if (typeof entityId === 'string') {
            entityRecordId = entityId.includes(':') ? entityId : `${ENTITY_TABLE}:${entityId}`;
            // Extract numeric ID for frozen check query
            entityId = this.extractIdFromRecordId(entityRecordId);
        }
        else {
            entityRecordId = `${ENTITY_TABLE}:${entityId}`;
        }
        // Check if entity is frozen (Super Node protection)
        const entityCheck = await this.executeQuery(`SELECT is_frozen FROM ${ENTITY_TABLE}:${entityId}`, {});
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
            logWarn(`[SurrealDB] Entity ${entityId} is frozen (Super Node), skipping link`);
            return;
        }
        const now = new Date().toISOString();
        const memoryRecordId = `${MEMORY_TABLE}:${memoryId}`;
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
            await this.executeQuery(sql, {
                weight: relevanceScore,
                created_at: now,
            });
            // Extract numeric ID for entity's relation_count update
            const numericEntityId = this.extractIdFromRecordId(entityRecordId);
            // Increment entity's relation_count
            await this.executeQuery(`UPDATE ${ENTITY_TABLE}:${numericEntityId} SET relation_count += 1`, {});
            // Check Super Node threshold after linking (User feedback)
            const stats = await this.getEntityStats(entityId);
            if (stats.memory_count >= TOPIC_SOFT_LIMIT) {
                logInfo(`[SurrealDB] Entity ${entityId} reached soft limit (${stats.memory_count} edges), triggering Topic creation`);
                if (topicIndexer) {
                    await topicIndexer.enqueueTopicCreation(String(entityId));
                }
            }
            if (stats.memory_count >= TOPIC_HARD_LIMIT) {
                logWarn(`[SurrealDB] Entity ${entityId} reached hard limit (${stats.memory_count} edges), freezing entity`);
                await this.freezeEntity(String(entityId), 'Super Node hard limit exceeded');
            }
        }
        catch (error) {
            logError(`[SurrealDB] linkMemoryEntity failed: ${error.message}`);
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
        // Convert entityId to string Record ID
        const entityRecordId = typeof entityId === 'string'
            ? (entityId.includes(':') ? entityId : `${ENTITY_TABLE}:${entityId}`)
            : `${ENTITY_TABLE}:${entityId}`;
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
            const result = await this.executeQuery(sql, { limit });
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
            logError(`[SurrealDB] searchByEntity failed: ${error.message}`);
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
            const result = await this.executeQuery(sql, { limit });
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
            logError(`[SurrealDB] searchByAssociation failed: ${error.message}`);
            throw error;
        }
    }
    /**
     * Extract result from SurrealDB query response
     */
    extractResult(result) {
        if (!result)
            return [];
        if (Array.isArray(result)) {
            if (result.length > 0) {
                if (Array.isArray(result[0])) {
                    return result[0] || [];
                }
                else if (result[0]?.result) {
                    return result[0].result || [];
                }
            }
        }
        return result.result || [];
    }
    /**
     * Extract string ID from various formats
     */
    extractStringId(id) {
        if (typeof id === 'string') {
            const parts = id.split(':');
            return parts[parts.length - 1];
        }
        if (typeof id === 'number') {
            return String(id);
        }
        if (id && typeof id === 'object' && id.id !== undefined) {
            return this.extractStringId(id.id);
        }
        return String(id);
    }
    /**
     * Extract numeric ID from various formats
     */
    extractId(id) {
        if (typeof id === 'number')
            return id;
        if (typeof id === 'string') {
            const parts = id.split(':');
            return parseInt(parts[parts.length - 1], 10);
        }
        if (id && typeof id === 'object' && id.id !== undefined) {
            return this.extractId(id.id);
        }
        return 0;
    }
    /**
     * Get memories by entity
     */
    async getMemoriesByEntity(entityId, limit = 100) {
        if (!this.client) {
            throw new Error('[SurrealDB] Client not connected');
        }
        try {
            // Convert entityId to proper record string format
            let entityRecordId;
            if (typeof entityId === 'string') {
                // If it's already a record ID (contains ':'), use it directly
                if (entityId.includes(':')) {
                    entityRecordId = entityId;
                }
                else {
                    // Otherwise, construct the record ID
                    entityRecordId = `entity:${entityId}`;
                }
            }
            else {
                entityRecordId = `entity:${entityId}`;
            }
            // Query using 'entity' field (not 'out') since memory_entity uses named fields
            const result = await this.executeQuery(`SELECT * FROM memory_entity WHERE entity = ${entityRecordId} ORDER BY weight DESC LIMIT ${limit}`, {});
            const data = this.extractResult(result);
            return data.map((r) => ({
                id: this.extractIdFromRecord(r),
                entityId: this.extractId(r.entity),
                relevance: r.relevance || 0,
                created_at: r.created_at ? String(r.created_at) : undefined,
            }));
        }
        catch (error) {
            logError(`[SurrealDB] getMemoriesByEntity failed: ${error.message}`);
            return [];
        }
    }
    /**
     * 5. getGlobalEntityStats - Get global entity statistics
     * Returns total entities, count by type, and total links
     */
    async getGlobalEntityStats() {
        if (!this.client) {
            return { total_entities: 0, by_type: {}, total_links: 0 };
        }
        try {
            // Get total entities by selecting all and counting the array length
            const totalResult = await this.executeQuery(`SELECT * FROM ${ENTITY_TABLE}`, {});
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
            const byTypeResult = await this.executeQuery(`SELECT entity_type, count(true) AS count FROM ${ENTITY_TABLE} GROUP BY entity_type`, {});
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
            const linksResult = await this.executeQuery(`SELECT * FROM ${MEMORY_ENTITY_TABLE}`, {});
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
            logError(`[SurrealDB] getGlobalEntityStats failed: ${error.message}`);
            return { total_entities: 0, by_type: {}, total_links: 0 };
        }
    }
    /**
     * 6. loadKnownEntities - Load all entities from database for caching
     * Used by EntityExtractor to populate the known entity cache
     */
    async loadKnownEntities(limit = 10000) {
        if (!this.client) {
            return [];
        }
        try {
            // Load entities with high mention_count (frequently used)
            // These are the most valuable to cache
            const sql = `
        SELECT name, mention_count, memory_count
        FROM ${ENTITY_TABLE}
        ORDER BY mention_count DESC
        LIMIT $limit
      `;
            const result = await this.executeQuery(sql, { limit });
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
                name: r.name,
                // Confidence based on mention frequency
                confidence: Math.min(0.95, 0.7 + (r.mention_count || 0) * 0.05),
            }));
        }
        catch (error) {
            logError(`[SurrealDB] loadKnownEntities failed: ${error.message}`);
            return [];
        }
    }
    // ============================================================
    // Stage 3: Topic Layer Methods
    // ============================================================
    /**
     * Upsert a topic record
     * @param name - Topic name
     * @param description - Topic description (optional)
     * @param parentEntityId - Parent entity ID (e.g., "entity:123" or 123)
     * @returns Topic ID
     */
    async upsertTopic(name, description, parentEntityId) {
        if (!this.client) {
            throw new Error('[SurrealDB] Client not connected');
        }
        try {
            // Keep parentEntityId as string (Record ID) for Schema compatibility
            let parentId = null;
            if (parentEntityId) {
                if (typeof parentEntityId === 'string') {
                    parentId = parentEntityId;
                }
                else if (typeof parentEntityId === 'number') {
                    // Convert numeric ID to record string
                    parentId = `entity:${parentEntityId}`;
                }
            }
            const sql = `
        UPSERT ${TOPIC_TABLE} SET
          name = $name,
          description = $description,
          parent_entity_id = $parent_entity_id,
          last_accessed_at = time::now(),
          updated_at = time::now()
      `;
            await this.executeQuery(sql, {
                name,
                description,
                parent_entity_id: parentId,
            });
            // Fetch the created topic to get ID
            const result = await this.executeQuery(`SELECT id FROM ${TOPIC_TABLE} WHERE name = $name AND parent_entity_id = $parent_entity_id LIMIT 1`, { name, parent_entity_id: parentId });
            const data = this.extractResult(result);
            if (data && data.length > 0) {
                return this.extractStringId(data[0].id);
            }
            throw new Error('[SurrealDB] Failed to get created topic ID');
        }
        catch (error) {
            logError(`[SurrealDB] upsertTopic failed: ${error.message}`);
            throw error;
        }
    }
    /**
     * Get topic by ID
     * @param topicId - Topic ID
     * @returns Topic record or null
     */
    async getTopicById(topicId) {
        if (!this.client) {
            throw new Error('[SurrealDB] Client not connected');
        }
        try {
            const result = await this.executeQuery(`SELECT * FROM ${TOPIC_TABLE}:${topicId} LIMIT 1`, {});
            const data = this.extractResult(result);
            if (data && data.length > 0) {
                return data[0];
            }
            return null;
        }
        catch (error) {
            logError(`[SurrealDB] getTopicById failed: ${error.message}`);
            return null;
        }
    }
    /**
     * Get topics by parent entity ID
     * @param entityId - Entity ID (e.g., "entity:123" or 123)
     * @returns Array of topics
     */
    async getTopicsByEntity(entityId) {
        if (!this.client) {
            throw new Error('[SurrealDB] Client not connected');
        }
        try {
            // Extract bare entity ID to match what upsertTopic stores in parent_entity_id
            let bareEntityId;
            if (typeof entityId === 'string') {
                bareEntityId = entityId.includes(':') ? entityId.split(':')[1] : entityId;
            }
            else {
                bareEntityId = String(entityId);
            }
            const result = await this.executeQuery(`SELECT id, name, description, parent_entity_id, created_at FROM ${TOPIC_TABLE} WHERE parent_entity_id = $parent_entity_id ORDER BY created_at DESC`, { parent_entity_id: bareEntityId });
            const data = this.extractResult(result);
            return data || [];
        }
        catch (error) {
            logError(`[SurrealDB] getTopicsByEntity failed: ${error.message}`);
            return [];
        }
    }
    /**
     * Delete a topic
     * @param topicId - Topic ID
     */
    async deleteTopic(topicId) {
        if (!this.client) {
            throw new Error('[SurrealDB] Client not connected');
        }
        try {
            // Handle both bare ID and Record ID format
            const topicRecordId = typeof topicId === 'string' && topicId.includes(':')
                ? topicId
                : `${TOPIC_TABLE}:${topicId}`;
            await this.executeQuery(`DELETE ${topicRecordId}`, {});
            logInfo(`[SurrealDB] Deleted topic ${topicId}`);
        }
        catch (error) {
            logError(`[SurrealDB] deleteTopic failed: ${error.message}`);
            throw error;
        }
    }
    /**
     * Link topic to memory
     * @param topicId - Topic ID
     * @param memoryId - Memory ID
     * @param relevanceScore - Relevance score (0-1)
     */
    async linkTopicMemory(topicId, memoryId, relevanceScore = 0.8) {
        if (!this.client) {
            throw new Error('[SurrealDB] Client not connected');
        }
        try {
            // Construct proper record IDs
            const topicRecordId = topicId.includes(':') ? topicId : `${TOPIC_TABLE}:${topicId}`;
            const memoryRecordId = `memory:${memoryId}`;
            // Use INSERT INTO instead of RELATE to avoid RELATION table issues
            // topic_memory has in/out fields but we treat it as a regular edge table
            const sql = `
        INSERT INTO ${TOPIC_MEMORY_TABLE} (
          in,
          out,
          relevance_score,
          weight,
          created_at
        ) VALUES (
          ${topicRecordId},
          ${memoryRecordId},
          $relevance_score,
          $weight,
          time::now()
        )
        ON DUPLICATE KEY UPDATE
          relevance_score = $relevance_score,
          weight = $weight
      `;
            await this.executeQuery(sql, {
                relevance_score: relevanceScore,
                weight: relevanceScore,
            });
            logInfo(`[SurrealDB] Linked topic ${topicId} to memory ${memoryId}`);
        }
        catch (error) {
            logError(`[SurrealDB] linkTopicMemory failed: ${error.message}`);
            throw error;
        }
    }
    /**
     * Get memories linked to a topic
     * @param topicId - Topic ID
     * @param limit - Maximum number of memories to return
     * @returns Array of linked memories
     */
    async getMemoriesByTopic(topicId, limit = 50) {
        if (!this.client) {
            throw new Error('[SurrealDB] Client not connected');
        }
        try {
            const topicRecordId = topicId.includes(':') ? topicId : `${TOPIC_TABLE}:${topicId}`;
            // Use subquery instead of table alias (SurrealDB 3.x doesn't support aliases)
            const sql = `
        SELECT
          out.id AS id,
          out.content AS content,
          out.type AS type,
          weight,
          relevance_score,
          out.created_at AS created_at
        FROM ${TOPIC_MEMORY_TABLE}
        WHERE in = ${topicRecordId}
        ORDER BY weight DESC
        LIMIT ${limit}
      `;
            const result = await this.executeQuery(sql, {});
            const data = this.extractResult(result);
            return (data || []).map((r) => ({
                id: this.extractId(r.id),
                content: r.content,
                type: r.type,
                weight: r.weight,
                similarity: r.relevance_score,
                created_at: r.created_at,
            }));
        }
        catch (error) {
            logError(`[SurrealDB] getMemoriesByTopic failed: ${error.message}`);
            return [];
        }
    }
    /**
     * Get memory payload including embedding by memory ID
     * @param memoryId - Memory ID
     * @returns Memory payload with embedding
     */
    async getMemoryPayload(memoryId) {
        if (!this.client) {
            throw new Error('[SurrealDB] Client not connected');
        }
        try {
            const result = await this.executeQuery(`SELECT content, embedding, type FROM ${MEMORY_TABLE}:${memoryId}`, {});
            if (Array.isArray(result) && result.length > 0) {
                let data = [];
                if (Array.isArray(result[0])) {
                    data = result[0] || [];
                }
                else if (result[0]?.result) {
                    data = result[0].result || [];
                }
                if (data && data.length > 0) {
                    return {
                        content: data[0].content || '',
                        embedding: data[0].embedding || undefined,
                        type: data[0].type || 'episodic',
                    };
                }
            }
            return null;
        }
        catch (error) {
            logError(`[SurrealDB] getMemoryPayload failed: ${error.message}`);
            return null;
        }
    }
    async close() {
        // HTTP client doesn't need to close connections
        this.client = null;
        // Reset initialized flag to allow re-initialization after close
        this.initialized = false;
    }
    // ============================================================
    // Stage 3: Alias Management Methods
    // ============================================================
    /**
     * Add an alias for an entity
     * @param alias - The alias name
     * @param entityId - Entity ID (e.g., "entity:123" or 123)
     * @param verified - Whether the alias is verified
     * @param source - Source of the alias ('manual', 'llm', 'user', 'merged')
     * @param createdBy - Creator identifier (optional)
     */
    async addAlias(alias, entityId, verified = false, source = 'manual', createdBy) {
        if (!this.client) {
            throw new Error('[SurrealDB] Client not connected');
        }
        try {
            // Keep entityId as string (Record ID) for Schema compatibility
            let recordId;
            if (typeof entityId === 'string') {
                recordId = entityId;
            }
            else {
                // Convert numeric ID to record string
                recordId = `entity:${entityId}`;
            }
            const sql = `
        UPSERT ${ENTITY_ALIAS_TABLE} SET
          alias = $alias,
          entity_id = $entity_id,
          verified = $verified,
          source = $source,
          created_by = $created_by,
          created_at = time::now()
      `;
            await this.executeQuery(sql, {
                alias,
                entity_id: recordId,
                verified,
                source,
                created_by: createdBy,
            });
            logInfo(`[SurrealDB] Added alias "${alias}" -> ${recordId}`);
        }
        catch (error) {
            logError(`[SurrealDB] addAlias failed: ${error.message}`);
            throw error;
        }
    }
    /**
     * Resolve an alias to its canonical entity ID (with cycle detection and path flattening)
     * User feedback: prevent infinite loops from circular aliases
     * @param alias - The alias to resolve
     * @param visited - Set of visited aliases for cycle detection (internal use)
     * @returns Canonical entity ID or null
     */
    async resolveAlias(alias, visited = new Set()) {
        if (!this.client) {
            throw new Error('[SurrealDB] Client not connected');
        }
        try {
            // Cycle detection - prevent infinite loops
            if (visited.has(alias)) {
                logWarn(`[SurrealDB] Circular alias reference detected: ${alias}`);
                return null;
            }
            visited.add(alias);
            // First check if this is already a canonical entity (not an alias)
            // Handle both bare ID and Record ID format
            let entityRecordId;
            if (alias.includes(':')) {
                entityRecordId = alias;
            }
            else {
                entityRecordId = `entity:${alias}`;
            }
            // Use direct string interpolation for Record ID (SurrealDB requires this for id comparisons)
            const entityCheckResult = await this.executeQuery(`SELECT id, is_merged FROM ${ENTITY_TABLE} WHERE id = ${entityRecordId} LIMIT 1`, {});
            const entityCheck = this.extractResult(entityCheckResult);
            if (entityCheck && entityCheck.length > 0 && !entityCheck[0].is_merged) {
                // This is a canonical entity, return it directly
                const result = this.extractStringId(entityCheck[0].id);
                return result;
            }
            // Query alias table
            const result = await this.executeQuery(`SELECT VALUE entity_id FROM ${ENTITY_ALIAS_TABLE} WHERE alias = $alias LIMIT 1`, { alias });
            const data = this.extractResult(result);
            if (data && data.length > 0) {
                const entityId = String(data[0]);
                // Check if points to another alias (path flattening)
                const canonicalResult = await this.executeQuery(`SELECT VALUE canonical_id FROM ${ENTITY_TABLE} WHERE id = ${entityId} LIMIT 1`, {});
                const canonicalData = this.extractResult(canonicalResult);
                if (canonicalData && canonicalData.length > 0 && canonicalData[0]) {
                    // Points to another alias, recursively resolve
                    const finalId = await this.resolveAlias(String(canonicalData[0]), visited);
                    return finalId;
                }
                return entityId;
            }
            return null;
        }
        catch (error) {
            logError(`[SurrealDB] resolveAlias failed: ${error.message}`);
            return null;
        }
    }
    /**
     * Get all aliases for an entity
     * @param entityId - Entity ID
     * @returns Array of alias names
     */
    async getAliasesByEntity(entityId) {
        if (!this.client) {
            throw new Error('[SurrealDB] Client not connected');
        }
        try {
            let numericId;
            if (typeof entityId === 'string') {
                const parts = entityId.split(':');
                numericId = parseInt(parts[parts.length - 1], 10);
            }
            else {
                numericId = entityId;
            }
            const result = await this.executeQuery(`SELECT alias FROM ${ENTITY_ALIAS_TABLE} WHERE entity_id = $entityId`, { entity_id: numericId });
            const data = this.extractResult(result);
            return (data || []).map((row) => row.alias);
        }
        catch (error) {
            logError(`[SurrealDB] getAliasesByEntity failed: ${error.message}`);
            return [];
        }
    }
    /**
     * Merge two entities (alias -> canonical)
     * User feedback: check threshold after merge and trigger re-clustering if needed
     * @param aliasEntityId - The entity to merge from
     * @param canonicalEntityId - The canonical entity to merge into
     * @param topicIndexer - Optional TopicIndexer for threshold checking
     */
    async mergeEntities(aliasEntityId, canonicalEntityId, topicIndexer) {
        if (!this.client) {
            throw new Error('[SurrealDB] Client not connected');
        }
        try {
            // Extract numeric IDs for record construction
            const aliasId = typeof aliasEntityId === 'string' ? aliasEntityId.split(':').pop() : aliasEntityId;
            const canonicalId = typeof canonicalEntityId === 'string' ? canonicalEntityId.split(':').pop() : canonicalEntityId;
            if (!aliasId || !canonicalId) {
                throw new Error('[SurrealDB] Invalid entity IDs for merge');
            }
            logInfo(`[SurrealDB] Merging entity:${aliasId} -> entity:${canonicalId}`);
            // Step 1: Get all memories linked to alias entity
            const aliasMemoriesResult = await this.executeQuery(`SELECT * FROM memory_entity WHERE out = entity:${aliasId}`, {});
            const aliasMemories = this.extractResult(aliasMemoriesResult);
            // Step 2: Link each memory to canonical entity (skip duplicates)
            for (const mem of aliasMemories) {
                const memoryId = this.extractId(mem.in);
                try {
                    await this.linkMemoryEntity(memoryId, Number(canonicalId), 0.9);
                }
                catch (e) {
                    // Ignore duplicate edge errors
                }
            }
            // Step 3: Delete old edges from alias entity
            await this.executeQuery(`DELETE FROM memory_entity WHERE out = entity:${aliasId}`, {});
            // Step 4: Mark alias entity as merged (use string Record ID for canonical_id)
            const canonicalRecordId = `entity:${canonicalId}`;
            await this.executeQuery(`UPDATE entity:${aliasId} SET canonical_id = $canonical_id, is_merged = true, merged_at = time::now()`, { canonical_id: canonicalRecordId });
            // Step 5: Add alias record (use string Record ID)
            const aliasNameResult = await this.executeQuery(`SELECT name FROM entity:${aliasId}`, {});
            const aliasNameData = this.extractResult(aliasNameResult);
            const aliasName = aliasNameData && aliasNameData.length > 0 ? aliasNameData[0].name : `entity_${aliasId}`;
            await this.addAlias(aliasName, canonicalRecordId, true, 'merged');
            logInfo(`[SurrealDB] Merged entity:${aliasId} -> entity:${canonicalId}`);
            // Step 6: Check threshold after merge (User feedback)
            const stats = await this.getEntityStats(String(canonicalId));
            if (stats.memory_count >= TOPIC_SOFT_LIMIT) {
                logInfo(`[SurrealDB] Merge triggered Super Node threshold for ${canonicalId} (${stats.memory_count} edges)`);
                if (topicIndexer) {
                    await topicIndexer.enqueuePriorityTopicCreation(String(canonicalId));
                }
            }
        }
        catch (error) {
            logError(`[SurrealDB] mergeEntities failed: ${error.message}`);
            throw error;
        }
    }
    // ============================================================
    // Stage 3: Super Node Management Methods
    // ============================================================
    /**
     * Freeze an entity to prevent new edges (Super Node protection)
     * @param entityId - Entity ID
     * @param reason - Reason for freezing
     */
    async freezeEntity(entityId, reason) {
        if (!this.client) {
            throw new Error('[SurrealDB] Client not connected');
        }
        try {
            let numericId;
            if (typeof entityId === 'string') {
                const parts = entityId.split(':');
                numericId = parseInt(parts[parts.length - 1], 10);
            }
            else {
                numericId = entityId;
            }
            await this.executeQuery(`UPDATE entity:${numericId} SET is_frozen = true, freeze_reason = $reason, frozen_at = time::now()`, { reason: reason || 'Super Node threshold exceeded' });
            logInfo(`[SurrealDB] Froze entity:${numericId} - ${reason || 'Super Node threshold exceeded'}`);
        }
        catch (error) {
            logError(`[SurrealDB] freezeEntity failed: ${error.message}`);
            throw error;
        }
    }
    /**
     * Check if an entity is frozen
     * @param entityId - Entity ID
     * @returns True if frozen
     */
    async isEntityFrozen(entityId) {
        if (!this.client) {
            throw new Error('[SurrealDB] Client not connected');
        }
        try {
            let numericId;
            if (typeof entityId === 'string') {
                const parts = entityId.split(':');
                numericId = parseInt(parts[parts.length - 1], 10);
            }
            else {
                numericId = entityId;
            }
            const result = await this.executeQuery(`SELECT VALUE is_frozen FROM entity:${numericId} LIMIT 1`, {});
            const data = this.extractResult(result);
            return data && data.length > 0 ? data[0] : false;
        }
        catch (error) {
            logError(`[SurrealDB] isEntityFrozen failed: ${error.message}`);
            return false;
        }
    }
    /**
     * Get entity statistics
     * @param entityId - Entity ID
     * @returns Entity statistics
     */
    async getEntityStats(entityId) {
        if (!this.client) {
            throw new Error('[SurrealDB] Client not connected');
        }
        try {
            // Convert entityId to proper record string format
            let entityRecordId;
            if (typeof entityId === 'string') {
                // If it's already a record ID (contains ':'), use it directly
                if (entityId.includes(':')) {
                    entityRecordId = entityId;
                }
                else {
                    // Otherwise, construct the record ID
                    entityRecordId = `entity:${entityId}`;
                }
            }
            else {
                entityRecordId = `entity:${entityId}`;
            }
            // Count memory_entity edges
            const memoryResult = await this.executeQuery(`SELECT count() as count FROM memory_entity WHERE out = ${entityRecordId} GROUP ALL`, {});
            const memoryData = this.extractResult(memoryResult);
            const memoryCount = memoryData && memoryData.length > 0 ? memoryData[0].count : 0;
            // Count topics
            const topicResult = await this.executeQuery(`SELECT count() as count FROM ${TOPIC_TABLE} WHERE parent_entity_id = ${entityRecordId} GROUP ALL`, {});
            const topicData = this.extractResult(topicResult);
            const topicCount = topicData && topicData.length > 0 ? topicData[0].count : 0;
            return {
                memory_count: memoryCount,
                topic_count: topicCount,
            };
        }
        catch (error) {
            logError(`[SurrealDB] getEntityStats failed: ${error.message}`);
            return { memory_count: 0, topic_count: 0 };
        }
    }
    // ============================================================
    // Stage 2: Entity Co-occurrence and Multi-Degree Retrieval
    // ============================================================
    /**
     * 7. buildEntityCooccurrence - Build entity-entity co-occurrence relationships
     *
     * Algorithm:
     * 1. Find all memories that have multiple entities
     * 2. For each pair of entities in the same memory, increment co-occurrence count
     * 3. Create entity_relation edges for pairs with count >= CO_OCCURRENCE_THRESHOLD
     * 4. Weight = co_occurrence_count / sqrt(entity1_total * entity2_total)
     *
     * @param batchSize - Number of memories to process in one batch (default: 1000)
     * @returns Number of entity relations created
     */
    async buildEntityCooccurrence(batchSize = 1000) {
        if (!this.client) {
            throw new Error('[SurrealDB] Client not connected');
        }
        logInfo('[SurrealDB] Starting entity co-occurrence build...');
        // Step 1: Find memories with multiple entities and count co-occurrences
        const cooccurrenceSql = `
      SELECT
        memory,
        array::group(entity) AS entities
      FROM ${MEMORY_ENTITY_TABLE}
      GROUP BY memory
      LIMIT $batchSize
    `;
        const result = await this.executeQuery(cooccurrenceSql, { batchSize });
        let data = [];
        if (Array.isArray(result) && result.length > 0) {
            if (Array.isArray(result[0])) {
                data = result[0] || [];
            }
            else if (result[0]?.result) {
                data = result[0].result || [];
            }
        }
        if (data.length === 0) {
            logInfo('[SurrealDB] No memories with multiple entities found');
            return 0;
        }
        // Step 2: Build co-occurrence counts for entity pairs
        const cooccurrenceMap = new Map();
        for (const row of data) {
            const entities = row.entities || [];
            // Skip memories with only one entity (no co-occurrence possible)
            if (entities.length < 2) {
                continue;
            }
            const memoryId = this.extractIdFromRecord(row.memory);
            // Generate all pairs (order matters for consistent key)
            for (let i = 0; i < entities.length; i++) {
                for (let j = i + 1; j < entities.length; j++) {
                    const entityA = this.extractStringIdFromRecord(entities[i]);
                    const entityB = this.extractStringIdFromRecord(entities[j]);
                    // Ensure consistent ordering (lexicographically smaller ID first)
                    const pairKey = entityA < entityB ? `${entityA}-${entityB}` : `${entityB}-${entityA}`;
                    if (!cooccurrenceMap.has(pairKey)) {
                        cooccurrenceMap.set(pairKey, { count: 0, memoryIds: [] });
                    }
                    const pairData = cooccurrenceMap.get(pairKey);
                    pairData.count++;
                    if (!pairData.memoryIds.includes(memoryId)) {
                        pairData.memoryIds.push(memoryId);
                    }
                }
            }
        }
        logInfo(`[SurrealDB] Found ${cooccurrenceMap.size} entity pairs with co-occurrence`);
        // Step 3: Create or update entity_relation edges for pairs above threshold
        const now = new Date().toISOString();
        let relationsCreated = 0;
        for (const [pairKey, pairData] of cooccurrenceMap.entries()) {
            if (pairData.count < CO_OCCURRENCE_THRESHOLD) {
                continue; // Skip pairs below threshold
            }
            const [entityA, entityB] = pairKey.split('-');
            // Get entity mention counts for normalization
            const entityARecord = await this.executeQuery(`SELECT mention_count FROM ${ENTITY_TABLE}:${entityA}`, {});
            const entityBRecord = await this.executeQuery(`SELECT mention_count FROM ${ENTITY_TABLE}:${entityB}`, {});
            let countA = 1;
            let countB = 1;
            if (Array.isArray(entityARecord) && entityARecord.length > 0) {
                if (Array.isArray(entityARecord[0])) {
                    countA = entityARecord[0][0]?.mention_count || 1;
                }
                else if (entityARecord[0]?.result) {
                    countA = entityARecord[0].result?.[0]?.mention_count || 1;
                }
            }
            if (Array.isArray(entityBRecord) && entityBRecord.length > 0) {
                if (Array.isArray(entityBRecord[0])) {
                    countB = entityBRecord[0][0]?.mention_count || 1;
                }
                else if (entityBRecord[0]?.result) {
                    countB = entityBRecord[0].result?.[0]?.mention_count || 1;
                }
            }
            // Weight = co_occurrence / sqrt(countA * countB)
            const weight = pairData.count / Math.sqrt(countA * countB);
            // Create or update entity_relation edge
            // UPSERT logic: if is_manual_refined = true, preserve relation_type
            const relationSql = `
        INSERT INTO ${ENTITY_RELATION_TABLE} (
          in,
          out,
          relation_type,
          weight,
          evidence_memory_ids,
          evidence_count,
          created_at,
          updated_at,
          is_manual_refined,
          confidence,
          reasoning,
          last_occurrence_at
        ) VALUES (
          ${ENTITY_TABLE}:${entityA},
          ${ENTITY_TABLE}:${entityB},
          'co_occurs',
          $weight,
          $evidence_memory_ids,
          $evidence_count,
          $created_at,
          $updated_at,
          false,
          0.0,
          NULL,
          NULL
        )
        ON DUPLICATE KEY UPDATE
          weight = $weight,
          evidence_memory_ids = array::concat(evidence_memory_ids, $evidence_memory_ids),
          evidence_count = evidence_count + $evidence_count,
          updated_at = $updated_at,
          last_occurrence_at = $updated_at,
          relation_type = IF is_manual_refined THEN relation_type ELSE 'co_occurs' END
      `;
            await this.executeQuery(relationSql, {
                weight,
                evidence_memory_ids: pairData.memoryIds,
                evidence_count: pairData.count,
                created_at: now,
                updated_at: now,
            });
            relationsCreated++;
        }
        logInfo(`[SurrealDB] Created/updated ${relationsCreated} entity relations (threshold: ${CO_OCCURRENCE_THRESHOLD})`);
        return relationsCreated;
    }
    /**
     * 8. searchByMultiDegree - Multi-degree association search
     *
     * Find memories through entity-entity graph traversal:
     * Memory -> Entity -> Entity -> Memory
     *
     * @param seedMemoryId - The seed memory ID
     * @param degree - How many hops to traverse (default: 2 for second-degree)
     * @param maxWeight - Maximum weight threshold for pruning (default: 0.1)
     * @param limit - Maximum number of results to return
     * @returns Associated memories with traversal path info
     */
    async searchByMultiDegree(seedMemoryId, degree = 2, minWeight = 0.1, limit = 20) {
        if (!this.client) {
            throw new Error('[SurrealDB] Client not connected');
        }
        logInfo(`[SurrealDB] Starting ${degree}-degree association search from memory ${seedMemoryId}...`);
        const seedRecordId = `${MEMORY_TABLE}:${seedMemoryId}`;
        // Build dynamic traversal query based on degree
        // For degree=2: Memory -> Entity -> Entity -> Memory
        // For degree=3: Memory -> Entity -> Entity -> Entity -> Memory
        let traversalSql = '';
        if (degree === 1) {
            // First-degree: direct entity association
            traversalSql = `
        SELECT
          memory.id AS id,
          memory.content AS content,
          memory.type AS type,
          memory.created_at AS created_at,
          math::max(weight) AS weight
        FROM ${MEMORY_ENTITY_TABLE}
        WHERE entity IN (
          SELECT VALUE entity FROM ${MEMORY_ENTITY_TABLE} WHERE memory = ${seedRecordId}
        )
        AND memory != ${seedRecordId}
        GROUP BY memory.id, memory.content, memory.type, memory.created_at
        ORDER BY weight DESC
        LIMIT $limit
      `;
        }
        else {
            // Multi-degree: traverse entity-entity relations
            // First get target entity IDs, then fetch memories
            traversalSql = `
        SELECT
          memory.id AS id,
          memory.content AS content,
          memory.type AS type,
          memory.created_at AS created_at,
          math::max(weight) AS weight
        FROM ${MEMORY_ENTITY_TABLE}
        WHERE entity IN (
          SELECT VALUE out FROM ${ENTITY_RELATION_TABLE}
          WHERE in IN (
            SELECT VALUE entity FROM ${MEMORY_ENTITY_TABLE} WHERE memory = ${seedRecordId}
          )
          AND weight >= $minWeight
        )
        AND memory != ${seedRecordId}
        GROUP BY memory.id, memory.content, memory.type, memory.created_at
        ORDER BY weight DESC
        LIMIT $limit
      `;
        }
        try {
            const result = await this.executeQuery(traversalSql, { limit, minWeight });
            let data = [];
            if (Array.isArray(result) && result.length > 0) {
                if (Array.isArray(result[0])) {
                    data = result[0] || [];
                }
                else if (result[0]?.result) {
                    data = result[0].result || [];
                }
            }
            logInfo(`[SurrealDB] ${degree}-degree search found ${data.length} memories`);
            return data.map((r) => ({
                id: this.extractIdFromRecord(r),
                content: r.content,
                type: r.type,
                weight: r.weight,
                created_at: r.created_at,
            }));
        }
        catch (error) {
            logError(`[SurrealDB] ${degree}-degree search failed: ${error.message}`);
            return [];
        }
    }
    /**
     * 9. pruneLowWeightEdges - Remove low-weight entity-entity relations
     *
     * Pruning strategy:
     * - Remove edges with weight < minWeight
     * - Keep edges that are the only connection for an entity
     *
     * @param minWeight - Minimum weight threshold (default: 0.1)
     * @returns Number of edges pruned
     */
    async pruneLowWeightEdges(minWeight = 0.1) {
        if (!this.client) {
            throw new Error('[SurrealDB] Client not connected');
        }
        logInfo(`[SurrealDB] Starting edge pruning with minWeight=${minWeight}...`);
        // First, count edges before pruning
        const beforeResult = await this.executeQuery(`SELECT count() AS total FROM ${ENTITY_RELATION_TABLE} WHERE weight < $minWeight`, { minWeight });
        let beforeCount = 0;
        if (Array.isArray(beforeResult) && beforeResult.length > 0) {
            if (Array.isArray(beforeResult[0])) {
                beforeCount = beforeResult[0][0]?.total || 0;
            }
            else if (beforeResult[0]?.result) {
                beforeCount = beforeResult[0].result?.[0]?.total || 0;
            }
        }
        // Delete low-weight edges
        const deleteSql = `
      DELETE FROM ${ENTITY_RELATION_TABLE}
      WHERE weight < $minWeight
    `;
        await this.executeQuery(deleteSql, { minWeight });
        logInfo(`[SurrealDB] Pruned ${beforeCount} low-weight entity relations`);
        return beforeCount;
    }
    /**
     * 10. getRelationStats - Get entity relation statistics
     * @returns Statistics about entity-entity relations
     */
    async getRelationStats() {
        if (!this.client) {
            return { total_relations: 0, avg_weight: 0, max_weight: 0, min_weight: 0, by_type: {} };
        }
        try {
            // Total relations
            const totalResult = await this.executeQuery(`SELECT count() AS total FROM ${ENTITY_RELATION_TABLE}`, {});
            let total = 0;
            if (Array.isArray(totalResult) && totalResult.length > 0) {
                if (Array.isArray(totalResult[0])) {
                    total = totalResult[0][0]?.total || 0;
                }
                else if (totalResult[0]?.result) {
                    total = totalResult[0].result?.[0]?.total || 0;
                }
            }
            // Weight statistics - compute in JavaScript to avoid SurrealDB math function issues
            const weightResult = await this.executeQuery(`SELECT weight FROM ${ENTITY_RELATION_TABLE}`, {});
            let avgWeight = 0;
            let maxWeight = 0;
            let minWeight = 0;
            let weights = [];
            if (Array.isArray(weightResult) && weightResult.length > 0) {
                if (Array.isArray(weightResult[0])) {
                    weights = weightResult[0].map((r) => r.weight || 0);
                }
                else if (weightResult[0]?.result) {
                    weights = (weightResult[0].result || []).map((r) => r.weight || 0);
                }
            }
            if (weights.length > 0) {
                avgWeight = weights.reduce((sum, w) => sum + w, 0) / weights.length;
                maxWeight = Math.max(...weights);
                minWeight = Math.min(...weights);
            }
            // By type
            const typeResult = await this.executeQuery(`SELECT relation_type, count() AS count FROM ${ENTITY_RELATION_TABLE} GROUP BY relation_type`, {});
            const byType = {};
            if (Array.isArray(typeResult) && typeResult.length > 0) {
                let typeData = [];
                if (Array.isArray(typeResult[0])) {
                    typeData = typeResult[0] || [];
                }
                else if (typeResult[0]?.result) {
                    typeData = typeResult[0].result || [];
                }
                for (const row of typeData) {
                    if (row.relation_type && row.count) {
                        byType[row.relation_type] = row.count;
                    }
                }
            }
            return {
                total_relations: total,
                avg_weight: avgWeight,
                max_weight: maxWeight,
                min_weight: minWeight,
                by_type: byType,
            };
        }
        catch (error) {
            logError(`[SurrealDB] getRelationStats failed: ${error.message}`);
            return { total_relations: 0, avg_weight: 0, max_weight: 0, min_weight: 0, by_type: {} };
        }
    }
    // ============================================================
    // Document Import State Management
    // ============================================================
    /**
     * Check if a document has been imported
     * @param filePath - Absolute file path
     * @returns Document import state or null if not found
     */
    async getDocumentImportState(filePath) {
        if (!this.client) {
            throw new Error('[SurrealDB] Client not connected');
        }
        try {
            const result = await this.executeQuery(`SELECT * FROM ${DOCUMENT_IMPORT_STATE_TABLE} WHERE file_path = $filePath LIMIT 1`, { filePath });
            const data = this.extractResult(result);
            if (data && data.length > 0) {
                return data[0];
            }
            return null;
        }
        catch (error) {
            logError(`[SurrealDB] getDocumentImportState failed: ${error.message}`);
            return null;
        }
    }
    /**
     * Update or create document import state
     * @param filePath - Absolute file path
     * @param updates - Fields to update
     */
    async upsertDocumentImportState(filePath, updates) {
        if (!this.client) {
            throw new Error('[SurrealDB] Client not connected');
        }
        try {
            const setFields = [];
            const params = { filePath };
            if (updates.file_hash !== undefined) {
                setFields.push('file_hash = $file_hash');
                params.file_hash = updates.file_hash;
            }
            if (updates.file_size !== undefined) {
                setFields.push('file_size = $file_size');
                params.file_size = updates.file_size;
            }
            if (updates.chunks_count !== undefined) {
                setFields.push('chunks_count = $chunks_count');
                params.chunks_count = updates.chunks_count;
            }
            if (updates.entities_extracted !== undefined) {
                setFields.push('entities_extracted = $entities_extracted');
                params.entities_extracted = updates.entities_extracted;
            }
            if (updates.relations_extracted !== undefined) {
                setFields.push('relations_extracted = $relations_extracted');
                params.relations_extracted = updates.relations_extracted;
            }
            if (updates.status !== undefined) {
                setFields.push('status = $status');
                params.status = updates.status;
            }
            if (updates.error !== undefined) {
                setFields.push('error = $error');
                params.error = updates.error;
            }
            if (setFields.length > 0) {
                await this.executeQuery(`UPSERT ${DOCUMENT_IMPORT_STATE_TABLE} SET ${setFields.join(', ')}, imported_at = time::now() WHERE file_path = $filePath`, params);
            }
        }
        catch (error) {
            logError(`[SurrealDB] upsertDocumentImportState failed: ${error.message}`);
            throw error;
        }
    }
    /**
     * Get documents pending import or extraction
     * @param status - Filter by status
     * @returns List of pending documents
     */
    async getPendingDocuments(status) {
        if (!this.client) {
            throw new Error('[SurrealDB] Client not connected');
        }
        try {
            let sql;
            if (status) {
                sql = `SELECT * FROM ${DOCUMENT_IMPORT_STATE_TABLE} WHERE status = $status`;
            }
            else {
                // Get all documents that are not completed
                sql = `SELECT * FROM ${DOCUMENT_IMPORT_STATE_TABLE} WHERE status != 'completed' ORDER BY imported_at ASC`;
            }
            const result = await this.executeQuery(sql, status ? { status } : {});
            const data = this.extractResult(result);
            return data || [];
        }
        catch (error) {
            logError(`[SurrealDB] getPendingDocuments failed: ${error.message}`);
            return [];
        }
    }
}
//# sourceMappingURL=surrealdb-client.js.map
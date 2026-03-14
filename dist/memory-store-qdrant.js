/**
 * Memory store using Qdrant vector database.
 */
import { MemoryType } from './qdrant-client.js';
// Semantic deduplication threshold
const DEDUPE_THRESHOLD = 0.95; // Very high threshold for near-duplicates
/**
 * Clean payload for Qdrant storage - remove undefined/null fields, ensure defaults.
 */
function cleanPayload(payload) {
    const cleaned = {};
    for (const [key, value] of Object.entries(payload)) {
        // Skip undefined and null values
        if (value === undefined || value === null) {
            continue;
        }
        // Ensure importance has default value
        if (key === 'importance' && typeof value !== 'number') {
            cleaned[key] = 0.5;
            continue;
        }
        // Ensure access_count has default value
        if (key === 'access_count' && typeof value !== 'number') {
            cleaned[key] = 0;
            continue;
        }
        cleaned[key] = value;
    }
    return cleaned;
}
export class MemoryStore {
    db;
    embedding;
    // In-memory stores for non-vector data
    episodicMemories = new Map();
    semanticMemories = new Map();
    reflectionMemories = new Map();
    idCounter = 0;
    // Async queue for non-blocking storage
    storageQueue = [];
    processingQueue = false;
    constructor(db, embedding) {
        this.db = db;
        this.embedding = embedding;
    }
    /**
     * Store episodic memory with embedding.
     * Checks for near-duplicate content within the same session.
     */
    async storeEpisodic(sessionId, content, importance = 0.5) {
        // Check for duplicates within the same session
        const dedupeResult = await this.checkDuplicateInSession(sessionId, content);
        if (dedupeResult.isDuplicate) {
            console.log(`[MemoryStore] Skipping duplicate episodic memory in session ${sessionId} (similarity: ${dedupeResult.similarity.toFixed(3)}, existing ID: ${dedupeResult.similarMemoryId})`);
            return dedupeResult.similarMemoryId;
        }
        const memoryId = ++this.idCounter;
        const now = Date.now();
        // Generate embedding
        const embedding = await this.embedding.embed(content);
        // Store in Qdrant with version metadata (clean payload first)
        await this.db.upsert(memoryId, embedding, cleanPayload({
            type: MemoryType.EPISODIC,
            session_id: sessionId,
            content: content,
            importance: importance,
            access_count: 0,
            created_at: new Date().toISOString(),
            version: now,
        }));
        // Store in memory
        this.episodicMemories.set(memoryId, {
            id: memoryId,
            session_id: sessionId,
            content,
            importance,
            access_count: 0,
            created_at: new Date(),
        });
        return memoryId;
    }
    /**
     * Check if content is a near-duplicate within the same session.
     */
    async checkDuplicateInSession(sessionId, content) {
        const embedding = await this.embedding.embed(content);
        const results = await this.search(embedding, 5, 0.9, 'episodic');
        // Filter by session and check similarity
        const sessionResults = results.filter(r => r.session_id === sessionId);
        if (sessionResults.length > 0 && sessionResults[0].similarity >= DEDUPE_THRESHOLD) {
            return {
                isDuplicate: true,
                similarMemoryId: sessionResults[0].id,
                similarity: sessionResults[0].similarity,
            };
        }
        return {
            isDuplicate: false,
            similarity: sessionResults.length > 0 ? sessionResults[0].similarity : 0,
        };
    }
    /**
     * Store semantic memory with embedding.
     * Checks for near-duplicate content before storing.
     * @param content - Memory content
     * @param importance - Importance score (0-1)
     * @param sessionId - Optional session ID for session isolation
     */
    async storeSemantic(content, importance = 0.7, sessionId) {
        // Check for duplicates first
        const dedupeResult = await this.checkDuplicate(content);
        if (dedupeResult.isDuplicate) {
            console.log(`[MemoryStore] Skipping duplicate semantic memory (similarity: ${dedupeResult.similarity.toFixed(3)}, existing ID: ${dedupeResult.similarMemoryId})`);
            return dedupeResult.similarMemoryId;
        }
        const memoryId = ++this.idCounter;
        const now = Date.now();
        const embedding = await this.embedding.embed(content);
        // Store in Qdrant with version metadata (clean payload first)
        const payload = {
            type: MemoryType.SEMANTIC,
            content: content,
            importance: importance,
            access_count: 0,
            created_at: new Date().toISOString(),
            version: now,
        };
        // Add session_id if provided (for session isolation)
        if (sessionId) {
            payload.session_id = sessionId;
        }
        await this.db.upsert(memoryId, embedding, cleanPayload(payload));
        this.semanticMemories.set(memoryId, {
            id: memoryId,
            content,
            importance,
            access_count: 0,
            created_at: new Date(),
        });
        return memoryId;
    }
    /**
     * Check if content is a near-duplicate of existing memory.
     * Uses vector similarity with high threshold (0.95).
     */
    async checkDuplicate(content) {
        const embedding = await this.embedding.embed(content);
        const results = await this.search(embedding, 1, 0.9, 'semantic');
        if (results.length > 0 && results[0].similarity >= DEDUPE_THRESHOLD) {
            return {
                isDuplicate: true,
                similarMemoryId: results[0].id,
                similarity: results[0].similarity,
            };
        }
        return {
            isDuplicate: false,
            similarity: results.length > 0 ? results[0].similarity : 0,
        };
    }
    /**
     * Search memories by vector similarity.
     * Filters out superseded memories by default.
     * @param sessionId - Optional session ID for session isolation
     */
    async search(embedding, topK = 10, threshold = 0.6, memoryType, includeSuperseded = false, sessionId // For session isolation
    ) {
        // Check for empty embedding vector
        if (!embedding || embedding.length === 0) {
            console.warn('[MemoryStore] search received empty embedding, returning empty results');
            return [];
        }
        const filter = {};
        if (memoryType)
            filter.type = memoryType;
        if (sessionId)
            filter.session_id = sessionId; // Session isolation
        const results = await this.db.search(embedding, topK * 2, Object.keys(filter).length > 0 ? filter : undefined);
        return results
            .map(r => ({
            id: r.id,
            content: r.payload.content,
            importance: r.payload.importance,
            similarity: r.score,
            type: r.payload.memory_type,
            created_at: new Date(r.payload.created_at),
            access_count: r.payload.access_count || 0,
            session_id: r.payload.session_id,
            is_active: r.payload.is_active ?? true,
        }))
            .filter(m => {
            // Filter by threshold
            if (m.similarity <= threshold)
                return false;
            // Filter out superseded memories unless explicitly requested
            if (!includeSuperseded && m.is_active === false)
                return false;
            return true;
        })
            .slice(0, topK);
    }
    /**
     * Get semantic memories with optional session filtering.
     * @param limit - Maximum number of results
     * @param sessionId - Optional session ID for session isolation
     */
    async getSemantic(limit = 20, sessionId) {
        // If sessionId provided, search from Qdrant with session filter
        if (sessionId) {
            // Get embedding for session-based search (use empty query to get all semantic memories)
            const embedding = await this.embedding.embed('general knowledge fact');
            const results = await this.search(embedding, limit, 0.5, 'semantic', false, sessionId);
            return results.map(r => ({
                id: r.id,
                content: r.content,
                importance: r.importance,
                access_count: r.access_count,
                created_at: r.created_at,
            }));
        }
        // No session filter - return from in-memory cache
        const results = Array.from(this.semanticMemories.values())
            .sort((a, b) => b.importance - a.importance)
            .slice(0, limit);
        return results;
    }
    /**
     * Get reflection memories with optional session filtering.
     * @param limit - Maximum number of results
     * @param sessionId - Optional session ID for session isolation
     */
    async getReflection(limit = 5, sessionId) {
        // If sessionId provided, search from Qdrant with session filter
        if (sessionId) {
            // Get embedding for session-based search (use empty query to get all reflection memories)
            const embedding = await this.embedding.embed('reflection insight summary');
            const results = await this.search(embedding, limit, 0.5, 'reflection', false, sessionId);
            return results.map(r => ({
                id: r.id,
                summary: r.content,
                importance: r.importance,
                access_count: r.access_count,
                created_at: r.created_at,
            }));
        }
        // No session filter - return from in-memory cache
        const results = Array.from(this.reflectionMemories.values())
            .sort((a, b) => b.importance - a.importance)
            .slice(0, limit);
        return results;
    }
    /**
     * Add reflection memory (in-memory only, also stored in Qdrant).
     * @param summary - Reflection summary
     * @param importance - Importance score (0-1)
     * @param sessionId - Optional session ID for session isolation
     */
    async addReflection(summary, importance = 0.9, sessionId) {
        const memoryId = ++this.idCounter;
        const now = Date.now();
        const embedding = await this.embedding.embed(summary);
        // Store in Qdrant with version metadata (clean payload first)
        const payload = {
            type: MemoryType.REFLECTION,
            summary: summary,
            importance: importance,
            access_count: 0,
            created_at: new Date().toISOString(),
            version: now,
        };
        // Add session_id if provided (for session isolation)
        if (sessionId) {
            payload.session_id = sessionId;
        }
        await this.db.upsert(memoryId, embedding, cleanPayload(payload));
        const reflection = {
            id: memoryId,
            summary,
            importance,
            access_count: 0,
            created_at: new Date(),
        };
        this.reflectionMemories.set(memoryId, reflection);
        return memoryId;
    }
    /**
     * Increment access count for a memory (also updates Qdrant payload).
     */
    async incrementAccess(memoryId, type) {
        // Get current payload from Qdrant
        const point = await this.db.get(memoryId);
        if (point && point.payload) {
            // Update access count in Qdrant, preserve version
            const newAccessCount = (point.payload.access_count || 0) + 1;
            await this.db.updatePayload(memoryId, {
                ...point.payload,
                access_count: newAccessCount,
                updated_at: new Date().toISOString(),
            });
        }
        // Update in-memory cache
        if (type === 'episodic') {
            const memory = this.episodicMemories.get(memoryId);
            if (memory) {
                memory.access_count++;
                this.episodicMemories.set(memoryId, memory);
            }
        }
        else if (type === 'semantic') {
            const memory = this.semanticMemories.get(memoryId);
            if (memory) {
                memory.access_count++;
                this.semanticMemories.set(memoryId, memory);
            }
        }
        else if (type === 'reflection') {
            const memory = this.reflectionMemories.get(memoryId);
            if (memory) {
                memory.access_count++;
                this.reflectionMemories.set(memoryId, memory);
            }
        }
    }
    /**
     * Mark a memory as superseded (replaced by a newer memory).
     * Does not delete - just adds metadata tags for retrieval filtering.
     */
    async markAsSuperseded(memoryId, metadata) {
        // Get current payload from Qdrant
        const point = await this.db.get(memoryId);
        if (point && point.payload) {
            // Update payload with superseded metadata
            const newPayload = {
                ...point.payload,
                superseded_by: metadata.superseded_by ?? point.payload.superseded_by,
                is_active: metadata.is_active ?? false,
                superseded_at: new Date().toISOString(),
            };
            await this.db.updatePayload(memoryId, newPayload);
        }
        // Note: In-memory cache is not updated - superseded memories are filtered at query time
    }
    /**
     * Get payload for a memory from Qdrant.
     */
    async getPayload(memoryId) {
        const point = await this.db.get(memoryId);
        return point?.payload || null;
    }
    /**
     * Get memory statistics.
     */
    async getStats() {
        const qdrantCount = await this.db.count();
        return {
            episodic_count: this.episodicMemories.size,
            semantic_count: this.semanticMemories.size,
            reflection_count: this.reflectionMemories.size,
            total_count: qdrantCount,
        };
    }
    /**
     * Add a storage task to the async queue.
     * Returns immediately without waiting for completion.
     */
    enqueueStorage(task) {
        this.storageQueue.push(task);
        if (!this.processingQueue) {
            this.processStorageQueue();
        }
    }
    /**
     * Process the storage queue asynchronously with retry support.
     */
    async processStorageQueue() {
        if (this.storageQueue.length === 0) {
            this.processingQueue = false;
            return;
        }
        this.processingQueue = true;
        while (this.storageQueue.length > 0) {
            const task = this.storageQueue.shift();
            if (task) {
                await this.executeWithRetry(task);
            }
        }
        this.processingQueue = false;
    }
    /**
     * Execute a task with retry support (max 3 attempts).
     */
    async executeWithRetry(task, maxRetries = 3) {
        let lastError = null;
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                await task();
                return; // Success
            }
            catch (error) {
                lastError = error;
                console.error(`[MemoryStore] Task failed (attempt ${attempt}/${maxRetries}):`, error.message);
                // Wait before retry (exponential backoff: 1s, 2s, 4s)
                if (attempt < maxRetries) {
                    const delay = Math.pow(2, attempt - 1) * 1000;
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
        }
        console.error('[MemoryStore] Task failed after all retries:', lastError?.message);
    }
    /**
     * Get current queue length.
     */
    getQueueLength() {
        return this.storageQueue.length;
    }
}
//# sourceMappingURL=memory-store-qdrant.js.map
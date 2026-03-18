/**
 * HybridRetriever - Vector + Graph + Topic Hybrid Retrieval (Stage 3)
 *
 * Combines semantic vector search with graph-based entity traversal
 * and topic-based broad recall from SurrealDB.
 *
 * Retrieval Pipeline (4-path parallel):
 * 1. Vector Search (semantic similarity)
 * 2. Entity Search (exact match)
 * 3. Graph Traversal Search (find memories via entities)
 * 4. Topic Recall (broad association)
 * 5. Merge results (deduplicate with path priority)
 * 6. Reranker re-sorting
 * 7. Threshold filtering
 * 8. Return topK
 */
import { EntityExtractor } from './entity-extractor.js';
/**
 * HybridRetriever - combines vector and graph search
 */
export class HybridRetriever {
    db;
    embedding;
    entityIndexer;
    reranker;
    entityExtractor;
    constructor(db, embedding, entityIndexer, reranker) {
        this.db = db;
        this.embedding = embedding;
        this.entityIndexer = entityIndexer;
        this.reranker = reranker;
        this.entityExtractor = new EntityExtractor();
    }
    /**
     * Get database client (for Stage 2 multi-degree retrieval)
     */
    getDb() {
        return this.db;
    }
    /**
     * Main hybrid retrieval method
     * @param query - The search query
     * @param sessionId - Optional session filter
     * @param topK - Final number of results to return
     * @param threshold - Minimum similarity/threshold for results
     * @returns Hybrid retrieval result with statistics
     */
    async retrieve(query, sessionId, topK = 5, threshold = 0.6) {
        const stats = {
            vectorCount: 0,
            graphCount: 0,
            topicCount: 0,
            mergedCount: 0,
            finalCount: 0,
            avgSimilarity: 0,
        };
        // Amnesia Mode: 100ms timeout for graph operations
        const GRAPH_TIMEOUT_MS = 100;
        try {
            // Step 1: Vector search (semantic similarity) - always runs
            const INITIAL_K = Math.max(topK * 4, 20); // Get more for reranking
            const vectorResults = await this.vectorSearch(query, sessionId, INITIAL_K);
            stats.vectorCount = vectorResults.length;
            // Step 2: Extract entities from query
            const entities = await this.extractEntitiesFromQuery(query);
            const entityIds = await Promise.all(entities.map(e => this.getEntityIdByName(e.name)));
            const validEntityIds = entityIds.filter(id => id !== 0 && !isNaN(id));
            // Step 3: Graph traversal search with timeout (Amnesia Mode)
            let graphResults = [];
            if (validEntityIds.length > 0) {
                try {
                    graphResults = await Promise.race([
                        this.graphSearch(validEntityIds, INITIAL_K),
                        new Promise((_, reject) => setTimeout(() => reject(new Error('Graph search timeout')), GRAPH_TIMEOUT_MS))
                    ]);
                    stats.graphCount = graphResults.length;
                }
                catch (timeoutError) {
                    if (timeoutError.message === 'Graph search timeout') {
                        console.warn(`[HybridRetriever] Amnesia Mode: graph search timeout after ${GRAPH_TIMEOUT_MS}ms, using vector-only results`);
                    }
                    else {
                        console.error('[HybridRetriever] graphSearch failed:', timeoutError.message);
                    }
                    // Continue with vector-only results
                    graphResults = [];
                }
            }
            // Step 4: Topic Recall (Stage 3) - broad association
            let topicResults = [];
            if (validEntityIds.length > 0) {
                try {
                    topicResults = await this.topicSearch(validEntityIds, INITIAL_K);
                    stats.topicCount = topicResults.length;
                }
                catch (error) {
                    console.error('[HybridRetriever] topicSearch failed:', error.message);
                    topicResults = [];
                }
            }
            // Step 5: Merge results (deduplicate by ID with path priority)
            const mergedResults = this.mergeResultsWithTopics(vectorResults, graphResults, topicResults);
            stats.mergedCount = mergedResults.length;
            // Step 6: Reranker re-sorting
            const rerankedResults = await this.rerankResults(query, mergedResults);
            // Step 7: Threshold filtering
            const filteredResults = rerankedResults.filter(r => (r.score ?? r.similarity ?? 0) >= threshold);
            // Step 8: Return topK
            const finalResults = filteredResults.slice(0, topK);
            stats.finalCount = finalResults.length;
            // Calculate average similarity
            if (finalResults.length > 0) {
                stats.avgSimilarity = finalResults.reduce((sum, r) => sum + (r.similarity ?? r.score ?? 0), 0) / finalResults.length;
            }
            return {
                results: finalResults,
                stats,
            };
        }
        catch (error) {
            console.error('[HybridRetriever] retrieve failed:', error.message);
            // Return empty result on error
            return {
                results: [],
                stats,
            };
        }
    }
    /**
     * Vector search - semantic similarity search
     * @param query - The search query
     * @param sessionId - Optional session filter
     * @param topK - Number of results to return
     * @returns Vector search results
     */
    async vectorSearch(query, sessionId, topK = 20) {
        try {
            // Generate embedding for query
            const embedding = await this.embedding.embed(query);
            // Build filter
            const filter = {};
            if (sessionId) {
                filter.session_id = sessionId;
            }
            // Search using SurrealDB vector search
            const results = await this.db.search(embedding, topK, filter);
            // Convert to MemoryResult format
            return results.map(r => ({
                id: r.id,
                content: r.payload.content || '',
                type: r.payload.type || 'episodic',
                similarity: r.score,
                score: r.score,
                created_at: r.payload.created_at ? new Date(r.payload.created_at) : undefined,
                access_count: r.payload.access_count,
                importance: r.payload.importance,
                source: 'vector',
            }));
        }
        catch (error) {
            console.error('[HybridRetriever] vectorSearch failed:', error.message);
            return [];
        }
    }
    /**
     * Extract entities from query using EntityExtractor
     * @param query - The search query
     * @returns Extracted entities
     */
    async extractEntitiesFromQuery(query) {
        try {
            const entities = await this.entityExtractor.extract(query);
            console.log(`[HybridRetriever] Extracted ${entities.length} entities from query: "${query.substring(0, 50)}..."`);
            return entities;
        }
        catch (error) {
            console.error('[HybridRetriever] extractEntitiesFromQuery failed:', error.message);
            return [];
        }
    }
    /**
     * Graph search - traverse entity-memory connections
     * @param entityIds - Entity IDs to search from
     * @param topK - Maximum number of results to return
     * @returns Graph traversal results
     */
    async graphSearch(entityIds, topK = 20) {
        const allMemories = new Map();
        try {
            // Search memories for each entity
            for (const entityId of entityIds) {
                const linkedMemories = await this.db.searchByEntity(entityId, topK);
                for (const mem of linkedMemories) {
                    if (!allMemories.has(mem.id)) {
                        allMemories.set(mem.id, {
                            id: mem.id,
                            content: mem.content || '',
                            type: mem.type || 'episodic',
                            weight: mem.weight,
                            score: mem.weight,
                            created_at: mem.created_at ? new Date(mem.created_at) : undefined,
                            source: 'graph',
                        });
                    }
                    else {
                        // Update weight if higher
                        const existing = allMemories.get(mem.id);
                        if ((mem.weight ?? 0) > (existing.weight ?? 0)) {
                            existing.weight = mem.weight;
                            existing.score = mem.weight;
                        }
                    }
                }
            }
            const results = Array.from(allMemories.values());
            console.log(`[HybridRetriever] Graph search found ${results.length} unique memories from ${entityIds.length} entities`);
            return results;
        }
        catch (error) {
            console.error('[HybridRetriever] graphSearch failed:', error.message);
            return [];
        }
    }
    /**
     * Merge vector and graph results with deduplication
     * @param vectorResults - Results from vector search
     * @param graphResults - Results from graph search
     * @returns Merged and deduplicated results
     */
    mergeResults(vectorResults, graphResults) {
        const mergedMap = new Map();
        // Add vector results first
        for (const result of vectorResults) {
            mergedMap.set(result.id, {
                ...result,
                source: 'vector',
            });
        }
        // Add graph results, merging with existing if needed
        for (const result of graphResults) {
            const existing = mergedMap.get(result.id);
            if (existing) {
                // Merge: keep higher score, mark as hybrid source
                const mergedScore = Math.max(existing.score ?? existing.similarity ?? 0, result.score ?? result.weight ?? 0);
                mergedMap.set(result.id, {
                    ...existing,
                    score: mergedScore,
                    similarity: mergedScore,
                    weight: result.weight,
                    source: 'hybrid', // Both vector and graph found this
                });
            }
            else {
                mergedMap.set(result.id, {
                    ...result,
                    source: 'graph',
                });
            }
        }
        const merged = Array.from(mergedMap.values());
        console.log(`[HybridRetriever] Merged ${vectorResults.length} vector + ${graphResults.length} graph -> ${merged.length} unique`);
        return merged;
    }
    /**
     * Topic Recall search - retrieve memories via Topic layer
     * User feedback: add LIMIT 10 to prevent topic flooding
     * @param entityIds - Entity IDs to search topics for (string Record IDs or numeric IDs)
     * @param topK - Maximum number of results to return
     * @returns Topic recall results
     */
    async topicSearch(entityIds, topK = 20) {
        const allMemories = new Map();
        try {
            for (const entityId of entityIds) {
                // Convert to proper Record ID format if needed
                const entityRecordId = typeof entityId === 'string'
                    ? (entityId.includes(':') ? entityId : `entity:${entityId}`)
                    : `entity:${entityId}`;
                // Get topics for this entity
                const topics = await this.db.getTopicsByEntity(entityRecordId);
                // Get memories from each topic (LIMIT 10 per topic - User feedback)
                for (const topic of topics) {
                    const topicId = this.extractStringId(topic.id);
                    const memories = await this.db.getMemoriesByTopic(topicId, 10); // LIMIT 10
                    for (const mem of memories) {
                        if (!allMemories.has(mem.id)) {
                            allMemories.set(mem.id, {
                                id: mem.id,
                                content: mem.content || '',
                                type: mem.type || 'episodic',
                                weight: mem.weight,
                                score: mem.weight,
                                similarity: mem.similarity,
                                created_at: mem.created_at ? new Date(mem.created_at) : undefined,
                                source: 'topic',
                                topic_id: topicId,
                                topic_name: topic.name,
                            });
                        }
                    }
                }
            }
            const results = Array.from(allMemories.values());
            console.log(`[HybridRetriever] Topic search found ${results.length} unique memories`);
            return results;
        }
        catch (error) {
            console.error('[HybridRetriever] topicSearch failed:', error.message);
            return [];
        }
    }
    /**
     * Merge vector, graph, and topic results with efficient deduplication
     * User feedback: reduce 4-path merge overhead, prefer precision paths
     * User feedback: apply path priority scores to prevent topic flooding
     *
     * Path Priority Scores (User feedback #5):
     * - Vector / Entity exact match: 1.0 (core answers)
     * - Topic broad recall: 0.5 (background knowledge)
     */
    mergeResultsWithTopics(vectorResults, graphResults, topicResults) {
        const mergedMap = new Map();
        const memorySources = new Map();
        // Apply path priority scores to prevent topic flooding
        const PATH_PRIORITY = {
            vector: 1.0, // Core semantic answers
            graph: 1.0, // Entity exact match - core answers
            topic: 0.7, // Broad association - background knowledge (User feedback #6)
        };
        const allResults = [
            ...vectorResults.map(r => ({ ...r, _source: 'vector' })),
            ...graphResults.map(r => ({ ...r, _source: 'graph' })),
            ...topicResults.map(r => ({ ...r, _source: 'topic' })),
        ];
        for (const result of allResults) {
            const existing = mergedMap.get(result.id);
            if (existing) {
                // Track sources
                const sources = memorySources.get(result.id) || [];
                sources.push(result._source);
                memorySources.set(result.id, sources);
                // Keep higher prioritized score
                const existingPrioritized = (existing.score ?? existing.similarity ?? 0) / PATH_PRIORITY[existing.source];
                const newPrioritized = (result.score ?? result.similarity ?? result.weight ?? 0) / PATH_PRIORITY[result._source];
                if (newPrioritized > existingPrioritized) {
                    mergedMap.set(result.id, {
                        ...existing,
                        score: result.score ?? result.similarity ?? result.weight ?? 0,
                        similarity: result.score ?? result.similarity ?? result.weight ?? 0,
                        source: 'hybrid',
                    });
                }
            }
            else {
                // Apply path priority score
                const prioritizedScore = (result.score ?? result.similarity ?? result.weight ?? 0) * PATH_PRIORITY[result._source];
                mergedMap.set(result.id, {
                    ...result,
                    score: prioritizedScore,
                    similarity: prioritizedScore,
                    source: result._source,
                });
                memorySources.set(result.id, [result._source]);
            }
        }
        const merged = Array.from(mergedMap.values());
        console.log(`[HybridRetriever] Merged ${vectorResults.length} vector + ${graphResults.length} graph + ${topicResults.length} topic -> ${merged.length} unique`);
        return merged;
    }
    /**
     * Rerank results using LLM
     * @param query - The search query
     * @param results - Results to rerank
     * @returns Reranked results
     */
    async rerankResults(query, results) {
        try {
            if (results.length === 0) {
                return [];
            }
            // Use reranker
            const reranked = await this.reranker.rerank(query, results, {
                topK: results.length,
                threshold: 0, // We'll filter later
                enableDiversity: true,
            });
            // Convert back to MemoryResult format
            return reranked.map((r, index) => ({
                id: r.id,
                content: r.content,
                type: r.type || 'episodic',
                score: r.score,
                similarity: r.score, // Use score as similarity after rerank
                created_at: r.created_at,
                access_count: r.access_count,
                importance: r.importance,
                cluster_id: r.cluster_id,
                source: 'reranked',
            }));
        }
        catch (error) {
            console.error('[HybridRetriever] rerankResults failed:', error.message);
            // Return original results with their scores if rerank fails
            return results;
        }
    }
    /**
     * Get entity ID by name from database
     * @param entityName - Entity name to look up
     * @returns Entity ID or 0 if not found
     */
    async getEntityIdByName(entityName) {
        try {
            // Escape single quotes in entity name for SQL safety
            const escapedName = entityName.replace(/'/g, "''");
            // Query entity by name
            const result = await this.db.query(`SELECT * FROM entity WHERE name = '${escapedName}' LIMIT 1`);
            let data = [];
            if (Array.isArray(result) && result.length > 0) {
                if (Array.isArray(result[0])) {
                    data = result[0] || [];
                }
                else if (result[0]?.result) {
                    data = result[0].result || [];
                }
            }
            if (data && data.length > 0) {
                // Extract ID from record format "entity:id" or numeric
                const idField = data[0].id;
                if (typeof idField === 'string') {
                    const parts = idField.split(':');
                    const parsedId = parseInt(parts[parts.length - 1], 10);
                    return isNaN(parsedId) ? 0 : parsedId;
                }
                else if (typeof idField === 'number') {
                    return idField;
                }
                else if (idField && typeof idField === 'object' && idField.id) {
                    return this.extractId(idField.id);
                }
            }
            return 0;
        }
        catch (error) {
            console.error(`[HybridRetriever] getEntityIdByName failed for "${entityName}":`, error.message);
            return 0;
        }
    }
    /**
     * Extract numeric ID from various formats
     */
    extractId(id) {
        if (typeof id === 'number') {
            return id;
        }
        if (typeof id === 'string') {
            const parts = id.split(':');
            const parsedId = parseInt(parts[parts.length - 1], 10);
            return isNaN(parsedId) ? 0 : parsedId;
        }
        if (id && typeof id === 'object' && id.id !== undefined) {
            return this.extractId(id.id);
        }
        return 0;
    }
    /**
     * Extract string ID from various formats (for topic IDs)
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
     * Multi-degree retrieval - combines vector search with multi-hop graph traversal
     *
     * Enhanced retrieval pipeline:
     * 1. Vector Search (semantic similarity)
     * 2. Extract entities from query
     * 3. Graph Traversal Search (find memories via entities)
     * 4. Multi-degree expansion (entity -> entity -> memory)
     * 5. Merge results (deduplicate)
     * 6. Reranker re-sorting
     * 7. Threshold filtering
     * 8. Return topK
     *
     * @param query - The search query
     * @param sessionId - Optional session filter
     * @param topK - Final number of results to return
     * @param threshold - Minimum similarity/threshold for results
     * @param degree - Multi-degree hops (default: 2 for second-degree)
     * @returns Hybrid retrieval result with statistics
     */
    async retrieveWithMultiDegree(query, sessionId, topK = 5, threshold = 0.6, degree = 2) {
        const stats = {
            vectorCount: 0,
            graphCount: 0,
            topicCount: 0,
            mergedCount: 0,
            finalCount: 0,
            avgSimilarity: 0,
        };
        // Amnesia Mode: 100ms timeout for graph operations
        const GRAPH_TIMEOUT_MS = 100;
        try {
            // Step 1: Vector search (semantic similarity) - always runs
            const INITIAL_K = Math.max(topK * 4, 20); // Get more for reranking
            const vectorResults = await this.vectorSearch(query, sessionId, INITIAL_K);
            stats.vectorCount = vectorResults.length;
            // Step 2: Extract entities from query
            const entities = await this.extractEntitiesFromQuery(query);
            const entityIds = await Promise.all(entities.map(e => this.getEntityIdByName(e.name)));
            const validEntityIds = entityIds.filter(id => id !== 0 && !isNaN(id));
            // Step 3: Graph traversal search with timeout (Amnesia Mode)
            let graphResults = [];
            if (validEntityIds.length > 0) {
                try {
                    graphResults = await Promise.race([
                        this.graphSearch(validEntityIds, INITIAL_K),
                        new Promise((_, reject) => setTimeout(() => reject(new Error('Graph search timeout')), GRAPH_TIMEOUT_MS))
                    ]);
                    stats.graphCount = graphResults.length;
                }
                catch (timeoutError) {
                    if (timeoutError.message === 'Graph search timeout') {
                        console.warn(`[HybridRetriever] Amnesia Mode: graph search timeout after ${GRAPH_TIMEOUT_MS}ms, using vector-only results`);
                    }
                    else {
                        console.error('[HybridRetriever] graphSearch failed:', timeoutError.message);
                    }
                    // Continue with vector-only results
                    graphResults = [];
                }
            }
            // Step 4: Multi-degree expansion (Stage 2)
            let multiDegreeResults = [];
            if (validEntityIds.length > 0 && degree > 1) {
                try {
                    // Use first valid entity as seed for multi-degree search
                    const seedEntityId = validEntityIds[0];
                    // First, find memories linked to this entity
                    const seedMemories = await this.getDb().searchByEntity(seedEntityId, 10);
                    // For each seed memory, do multi-degree expansion
                    for (const seedMem of seedMemories.slice(0, 3)) { // Limit to top 3 seeds
                        const multiDegreeMemories = await this.entityIndexer.searchByMultiDegree(seedMem.id, degree, 0.1, // minWeight
                        INITIAL_K);
                        for (const mem of multiDegreeMemories) {
                            if (!graphResults.find(r => r.id === mem.id)) {
                                multiDegreeResults.push({
                                    id: mem.id,
                                    content: mem.content || '',
                                    type: mem.type || 'episodic',
                                    weight: mem.weight,
                                    score: mem.weight,
                                    created_at: mem.created_at ? new Date(mem.created_at) : undefined,
                                    source: 'graph',
                                });
                            }
                        }
                    }
                    console.log(`[HybridRetriever] Multi-degree (${degree}) expansion found ${multiDegreeResults.length} additional memories`);
                }
                catch (error) {
                    console.error('[HybridRetriever] multi-degree expansion failed:', error.message);
                }
            }
            // Step 5: Merge all results (deduplicate by ID)
            const mergedResults = this.mergeResults(vectorResults, [...graphResults, ...multiDegreeResults]);
            stats.mergedCount = mergedResults.length;
            // Step 6: Reranker re-sorting
            const rerankedResults = await this.rerankResults(query, mergedResults);
            // Step 7: Threshold filtering
            const filteredResults = rerankedResults.filter(r => (r.score ?? r.similarity ?? 0) >= threshold);
            // Step 8: Return topK
            const finalResults = filteredResults.slice(0, topK);
            stats.finalCount = finalResults.length;
            // Calculate average similarity
            if (finalResults.length > 0) {
                stats.avgSimilarity = finalResults.reduce((sum, r) => sum + (r.similarity ?? r.score ?? 0), 0) / finalResults.length;
            }
            return {
                results: finalResults,
                stats,
            };
        }
        catch (error) {
            console.error('[HybridRetriever] retrieveWithMultiDegree failed:', error.message);
            // Return empty result on error
            return {
                results: [],
                stats,
            };
        }
    }
}
//# sourceMappingURL=hybrid-retrieval.js.map
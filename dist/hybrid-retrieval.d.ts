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
import { SurrealDatabase } from './surrealdb-client.js';
import { EmbeddingService } from './embedding.js';
import { EntityIndexer } from './entity-indexer.js';
import { Reranker } from './reranker.js';
import { ExtractedEntity } from './entity-extractor.js';
import { LLMClient } from './llm-client.js';
/**
 * Memory result with similarity score
 */
export interface MemoryResult {
    id: number;
    content: string;
    type: 'episodic' | 'semantic' | 'reflection';
    similarity?: number;
    score?: number;
    weight?: number;
    created_at?: Date;
    access_count?: number;
    importance?: number;
    cluster_id?: string;
    source?: 'vector' | 'graph' | 'hybrid' | 'reranked' | 'topic';
    topic_id?: string;
    topic_name?: string;
}
/**
 * Hybrid retrieval result with statistics (Stage 3: 4-path)
 */
export interface HybridRetrievalResult {
    results: MemoryResult[];
    stats: {
        vectorCount: number;
        graphCount: number;
        topicCount: number;
        mergedCount: number;
        finalCount: number;
        avgSimilarity: number;
    };
}
/**
 * HybridRetriever - combines vector and graph search
 */
export declare class HybridRetriever {
    private db;
    private embedding;
    private entityIndexer;
    private reranker;
    private entityExtractor;
    constructor(db: SurrealDatabase, embedding: EmbeddingService, entityIndexer: EntityIndexer, reranker: Reranker, llmClient?: LLMClient);
    /**
     * Get database client (for Stage 2 multi-degree retrieval)
     */
    private getDb;
    /**
     * Main hybrid retrieval method
     * @param query - The search query
     * @param sessionId - Optional session filter
     * @param topK - Final number of results to return
     * @param threshold - Minimum similarity/threshold for results
     * @returns Hybrid retrieval result with statistics
     */
    retrieve(query: string, sessionId: string | undefined, topK?: number, threshold?: number): Promise<HybridRetrievalResult>;
    /**
     * Vector search - semantic similarity search
     * @param query - The search query
     * @param sessionId - Optional session filter
     * @param topK - Number of results to return
     * @returns Vector search results
     */
    vectorSearch(query: string, sessionId: string | undefined, topK?: number): Promise<MemoryResult[]>;
    /**
     * Extract entities from query using EntityExtractor
     * @param query - The search query
     * @returns Extracted entities
     */
    extractEntitiesFromQuery(query: string): Promise<ExtractedEntity[]>;
    /**
     * Graph search - traverse entity-memory connections
     * @param entityIds - Entity IDs to search from
     * @param topK - Maximum number of results to return
     * @returns Graph traversal results
     */
    graphSearch(entityIds: number[], topK?: number): Promise<MemoryResult[]>;
    /**
     * Merge vector and graph results with deduplication
     * @param vectorResults - Results from vector search
     * @param graphResults - Results from graph search
     * @returns Merged and deduplicated results
     */
    mergeResults(vectorResults: MemoryResult[], graphResults: MemoryResult[]): MemoryResult[];
    /**
     * Topic Recall search - retrieve memories via Topic layer
     * User feedback: add LIMIT 10 to prevent topic flooding
     * @param entityIds - Entity IDs to search topics for (string Record IDs or numeric IDs)
     * @param topK - Maximum number of results to return
     * @returns Topic recall results
     */
    topicSearch(entityIds: (string | number)[], topK?: number): Promise<MemoryResult[]>;
    /**
     * Merge vector, graph, and topic results with efficient deduplication
     * User feedback: reduce 4-path merge overhead, prefer precision paths
     * User feedback: apply path priority scores to prevent topic flooding
     *
     * Path Priority Scores (User feedback #5):
     * - Vector / Entity exact match: 1.0 (core answers)
     * - Topic broad recall: 0.5 (background knowledge)
     */
    mergeResultsWithTopics(vectorResults: MemoryResult[], graphResults: MemoryResult[], topicResults: MemoryResult[]): MemoryResult[];
    /**
     * Rerank results using LLM
     * @param query - The search query
     * @param results - Results to rerank
     * @returns Reranked results
     */
    private rerankResults;
    /**
     * Get entity ID by name from database
     * @param entityName - Entity name to look up
     * @returns Entity ID or 0 if not found
     */
    private getEntityIdByName;
    /**
     * Extract numeric ID from various formats
     */
    private extractId;
    /**
     * Extract string ID from various formats (for topic IDs)
     */
    private extractStringId;
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
    retrieveWithMultiDegree(query: string, sessionId: string | undefined, topK?: number, threshold?: number, degree?: number): Promise<HybridRetrievalResult>;
}
//# sourceMappingURL=hybrid-retrieval.d.ts.map
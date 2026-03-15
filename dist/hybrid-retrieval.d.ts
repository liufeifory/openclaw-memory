/**
 * HybridRetriever - Vector + Graph Hybrid Retrieval
 *
 * Combines semantic vector search with graph-based entity traversal
 * to retrieve relevant memories from SurrealDB.
 *
 * Retrieval Pipeline:
 * 1. Vector Search (semantic similarity)
 * 2. Extract entities from query
 * 3. Graph Traversal Search (find memories via entities)
 * 4. Merge results (deduplicate)
 * 5. Reranker re-sorting
 * 6. Threshold filtering
 * 7. Return topK
 */
import { SurrealDatabase } from './surrealdb-client.js';
import { EmbeddingService } from './embedding.js';
import { EntityIndexer } from './entity-indexer.js';
import { Reranker } from './reranker.js';
import { ExtractedEntity } from './entity-extractor.js';
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
    source?: 'vector' | 'graph' | 'hybrid' | 'reranked';
}
/**
 * Hybrid retrieval result with statistics
 */
export interface HybridRetrievalResult {
    results: MemoryResult[];
    stats: {
        vectorCount: number;
        graphCount: number;
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
    constructor(db: SurrealDatabase, embedding: EmbeddingService, entityIndexer: EntityIndexer, reranker: Reranker);
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
}
//# sourceMappingURL=hybrid-retrieval.d.ts.map
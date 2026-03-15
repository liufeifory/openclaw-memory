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

import { SurrealDatabase, LinkedMemory } from './surrealdb-client.js';
import { EmbeddingService } from './embedding.js';
import { EntityIndexer } from './entity-indexer.js';
import { Reranker, RerankResult } from './reranker.js';
import { EntityExtractor, ExtractedEntity } from './entity-extractor.js';

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
 * Entity search result for graph traversal
 */
interface EntitySearchResult {
  entityId: number;
  entityName: string;
  memories: LinkedMemory[];
}

/**
 * HybridRetriever - combines vector and graph search
 */
export class HybridRetriever {
  private db: SurrealDatabase;
  private embedding: EmbeddingService;
  private entityIndexer: EntityIndexer;
  private reranker: Reranker;
  private entityExtractor: EntityExtractor;

  constructor(
    db: SurrealDatabase,
    embedding: EmbeddingService,
    entityIndexer: EntityIndexer,
    reranker: Reranker
  ) {
    this.db = db;
    this.embedding = embedding;
    this.entityIndexer = entityIndexer;
    this.reranker = reranker;
    this.entityExtractor = new EntityExtractor();
  }

  /**
   * Main hybrid retrieval method
   * @param query - The search query
   * @param sessionId - Optional session filter
   * @param topK - Final number of results to return
   * @param threshold - Minimum similarity/threshold for results
   * @returns Hybrid retrieval result with statistics
   */
  async retrieve(
    query: string,
    sessionId: string | undefined,
    topK: number = 5,
    threshold: number = 0.6
  ): Promise<HybridRetrievalResult> {
    const stats = {
      vectorCount: 0,
      graphCount: 0,
      mergedCount: 0,
      finalCount: 0,
      avgSimilarity: 0,
    };

    try {
      // Step 1: Vector search (semantic similarity)
      const INITIAL_K = Math.max(topK * 4, 20);  // Get more for reranking
      const vectorResults = await this.vectorSearch(query, sessionId, INITIAL_K);
      stats.vectorCount = vectorResults.length;

      // Step 2: Extract entities from query
      const entities = await this.extractEntitiesFromQuery(query);
      const entityIds = await Promise.all(entities.map(e => this.getEntityIdByName(e.name)));
      const validEntityIds = entityIds.filter(id => id !== 0);

      // Step 3: Graph traversal search (find memories via entities)
      let graphResults: MemoryResult[] = [];
      if (validEntityIds.length > 0) {
        graphResults = await this.graphSearch(validEntityIds, INITIAL_K);
        stats.graphCount = graphResults.length;
      }

      // Step 4: Merge results (deduplicate by ID)
      const mergedResults = this.mergeResults(vectorResults, graphResults);
      stats.mergedCount = mergedResults.length;

      // Step 5: Reranker re-sorting
      const rerankedResults = await this.rerankResults(query, mergedResults);

      // Step 6: Threshold filtering
      const filteredResults = rerankedResults.filter(r => (r.score ?? r.similarity ?? 0) >= threshold);

      // Step 7: Return topK
      const finalResults = filteredResults.slice(0, topK);
      stats.finalCount = finalResults.length;

      // Calculate average similarity
      if (finalResults.length > 0) {
        stats.avgSimilarity = finalResults.reduce(
          (sum, r) => sum + (r.similarity ?? r.score ?? 0),
          0
        ) / finalResults.length;
      }

      return {
        results: finalResults,
        stats,
      };
    } catch (error: any) {
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
  async vectorSearch(
    query: string,
    sessionId: string | undefined,
    topK: number = 20
  ): Promise<MemoryResult[]> {
    try {
      // Generate embedding for query
      const embedding = await this.embedding.embed(query);

      // Build filter
      const filter: Record<string, any> = {};
      if (sessionId) {
        filter.session_id = sessionId;
      }

      // Search using SurrealDB vector search
      const results = await this.db.search(embedding, topK, filter);

      // Convert to MemoryResult format
      return results.map(r => ({
        id: r.id,
        content: r.payload.content || '',
        type: (r.payload.type as 'episodic' | 'semantic' | 'reflection') || 'episodic',
        similarity: r.score,
        score: r.score,
        created_at: r.payload.created_at ? new Date(r.payload.created_at) : undefined,
        access_count: r.payload.access_count,
        importance: r.payload.importance,
        source: 'vector' as const,
      }));
    } catch (error: any) {
      console.error('[HybridRetriever] vectorSearch failed:', error.message);
      return [];
    }
  }

  /**
   * Extract entities from query using EntityExtractor
   * @param query - The search query
   * @returns Extracted entities
   */
  async extractEntitiesFromQuery(query: string): Promise<ExtractedEntity[]> {
    try {
      const entities = await this.entityExtractor.extract(query);
      console.log(`[HybridRetriever] Extracted ${entities.length} entities from query: "${query.substring(0, 50)}..."`);
      return entities;
    } catch (error: any) {
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
  async graphSearch(
    entityIds: number[],
    topK: number = 20
  ): Promise<MemoryResult[]> {
    const allMemories: Map<number, MemoryResult> = new Map();

    try {
      // Search memories for each entity
      for (const entityId of entityIds) {
        const linkedMemories = await this.db.searchByEntity(entityId, topK);

        for (const mem of linkedMemories) {
          if (!allMemories.has(mem.id)) {
            allMemories.set(mem.id, {
              id: mem.id,
              content: mem.content || '',
              type: (mem.type as 'episodic' | 'semantic' | 'reflection') || 'episodic',
              weight: mem.weight,
              score: mem.weight,
              created_at: mem.created_at ? new Date(mem.created_at) : undefined,
              source: 'graph' as const,
            });
          } else {
            // Update weight if higher
            const existing = allMemories.get(mem.id)!;
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
    } catch (error: any) {
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
  mergeResults(
    vectorResults: MemoryResult[],
    graphResults: MemoryResult[]
  ): MemoryResult[] {
    const mergedMap: Map<number, MemoryResult> = new Map();

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
        const mergedScore = Math.max(
          existing.score ?? existing.similarity ?? 0,
          result.score ?? result.weight ?? 0
        );
        mergedMap.set(result.id, {
          ...existing,
          score: mergedScore,
          similarity: mergedScore,
          weight: result.weight,
          source: 'hybrid',  // Both vector and graph found this
        });
      } else {
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
   * Rerank results using LLM
   * @param query - The search query
   * @param results - Results to rerank
   * @returns Reranked results
   */
  private async rerankResults(
    query: string,
    results: MemoryResult[]
  ): Promise<MemoryResult[]> {
    try {
      if (results.length === 0) {
        return [];
      }

      // Use reranker
      const reranked = await this.reranker.rerank(query, results, {
        topK: results.length,
        threshold: 0,  // We'll filter later
        enableDiversity: true,
      });

      // Convert back to MemoryResult format
      return reranked.map((r, index) => ({
        id: r.id,
        content: r.content,
        type: (r.type as 'episodic' | 'semantic' | 'reflection') || 'episodic',
        score: r.score,
        similarity: r.score,  // Use score as similarity after rerank
        created_at: r.created_at,
        access_count: r.access_count,
        importance: r.importance,
        cluster_id: r.cluster_id,
        source: 'reranked',
      }));
    } catch (error: any) {
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
  private async getEntityIdByName(entityName: string): Promise<number> {
    try {
      // Escape single quotes in entity name for SQL safety
      const escapedName = entityName.replace(/'/g, "''");

      // Query entity by name
      const result = await this.db.query(
        `SELECT * FROM entity WHERE name = '${escapedName}' LIMIT 1`
      );

      let data: any[] = [];
      if (Array.isArray(result) && result.length > 0) {
        if (Array.isArray(result[0])) {
          data = result[0] || [];
        } else if ((result as any)[0]?.result) {
          data = (result as any)[0].result || [];
        }
      }

      if (data && data.length > 0) {
        // Extract ID from record format "entity:id" or numeric
        const idField = data[0].id;
        if (typeof idField === 'string') {
          const parts = idField.split(':');
          return parseInt(parts[parts.length - 1], 10);
        } else if (typeof idField === 'number') {
          return idField;
        } else if (idField && typeof idField === 'object' && idField.id) {
          return this.extractId(idField.id);
        }
      }

      return 0;
    } catch (error: any) {
      console.error(`[HybridRetriever] getEntityIdByName failed for "${entityName}":`, error.message);
      return 0;
    }
  }

  /**
   * Extract numeric ID from various formats
   */
  private extractId(id: any): number {
    if (typeof id === 'number') {
      return id;
    }
    if (typeof id === 'string') {
      const parts = id.split(':');
      return parseInt(parts[parts.length - 1], 10);
    }
    if (id && typeof id === 'object' && id.id !== undefined) {
      return this.extractId(id.id);
    }
    return 0;
  }
}

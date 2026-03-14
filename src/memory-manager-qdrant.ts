/**
 * Memory Manager - orchestrates all memory operations using Qdrant.
 */

import { QdrantDatabase, MigrationResult } from './qdrant-client.js';
import { EmbeddingService } from './embedding.js';
import { MemoryStore } from './memory-store-qdrant.js';
import { ContextBuilder } from './context-builder.js';
import { Reranker, INITIAL_K } from './reranker.js';
import { ConflictDetector } from './conflict-detector.js';
import { LLMLimiter } from './llm-limiter.js';
import { ImportanceLearning } from './importance-learning.js';
import { SemanticClusterer } from './clusterer.js';
import { Summarizer } from './summarizer.js';
import type { MemoryWithSimilarity } from './memory-store-qdrant.js';

export interface RetrievalFunnelStats {
  initialCount: number;      // After vector search
  afterTimeDecay: number;    // After time decay
  afterRerank: number;       // After LLM reranking
  afterThreshold: number;    // After score threshold
  afterImportance: number;   // After importance filter
  finalCount: number;        // Final returned count
  avgSimilarity: number;
  avgImportance: number;
  typeDistribution: Record<string, number>;
}

export interface MemoryManagerConfig {
  qdrant: {
    url: string;
    port?: number;
    apiKey?: string;
  };
  embedding?: {
    endpoint: string;
  };
}

export class MemoryManager {
  private db: QdrantDatabase;
  private embedding: EmbeddingService;
  private memoryStore: MemoryStore;
  private contextBuilder: ContextBuilder;
  private reranker: Reranker;
  private conflictDetector: ConflictDetector;
  private limiter: LLMLimiter;
  private importanceLearning: ImportanceLearning;
  private clusterer: SemanticClusterer;
  private summarizer: Summarizer;
  private idleClusteringInterval?: NodeJS.Timeout;
  private activeSessions = new Set<string>();  // Track active sessions
  private sessionBuffers = new Map<string, string[]>();  // Buffer conversation turns per session
  private lastRequestTime = Date.now();
  private maintenanceHistory = {
    lastClustering: 0,
    lastDecay: 0,
    lastSummarization: 0,
  };

  constructor(config: MemoryManagerConfig) {
    this.db = new QdrantDatabase(config.qdrant);
    this.embedding = new EmbeddingService(config.embedding?.endpoint ?? 'http://localhost:8080');
    this.memoryStore = new MemoryStore(this.db, this.embedding);
    this.contextBuilder = new ContextBuilder();

    // Create shared LLM limiter for rate control
    const llamaEndpoint = config.embedding?.endpoint?.replace('8080', '8081') ?? 'http://localhost:8081';
    this.limiter = new LLMLimiter({ maxConcurrent: 2, minInterval: 100, queueLimit: 50 });
    this.reranker = new Reranker(llamaEndpoint, this.limiter);
    this.conflictDetector = new ConflictDetector(llamaEndpoint, this.limiter);
    this.importanceLearning = new ImportanceLearning();
    this.clusterer = new SemanticClusterer(llamaEndpoint, this.limiter);
    this.summarizer = new Summarizer(llamaEndpoint, this.limiter);
  }

  /**
   * Initialize the memory manager (connect to Qdrant).
   * @returns Migration result
   */
  async initialize(): Promise<MigrationResult> {
    const result = await this.db.initialize();
    console.log('[MemoryManager] Initialized with Qdrant');

    // Start idle clustering worker (runs every 5 minutes)
    this.startIdleClusteringWorker();

    return result;
  }

  /**
   * Start idle clustering worker - runs semantic clustering during idle time.
   * Task 2.B: Low frequency clustering (idle time) for similarity > 0.9
   */
  private startIdleClusteringWorker(): void {
    // Run every 2 minutes (120000ms) - check idle status
    this.idleClusteringInterval = setInterval(async () => {
      try {
        // Check if system is idle
        const now = Date.now();
        const isIdle = this.activeSessions.size === 0 && (now - this.lastRequestTime) > 30000;

        if (!isIdle) {
          return; // Skip maintenance if system is active
        }

        console.log('[MemoryManager] System idle, running maintenance...');

        // Run clustering every 5 minutes
        if (now - this.maintenanceHistory.lastClustering > 300000) {
          await this.runIdleClustering();
          this.maintenanceHistory.lastClustering = now;
        }

        // Run importance decay every 10 minutes
        if (now - this.maintenanceHistory.lastDecay > 600000) {
          await this.runImportanceDecay();
          this.maintenanceHistory.lastDecay = now;
        }

      } catch (error: any) {
        console.error('[MemoryManager] Idle maintenance failed:', error.message);
      }
    }, 120000);
  }

  /**
   * Track session activity for idle detection.
   */
  trackSessionActivity(sessionId: string): void {
    this.activeSessions.add(sessionId);
    this.lastRequestTime = Date.now();
  }

  /**
   * Track session end for idle detection and trigger auto-reflection.
   */
  async trackSessionEnd(sessionId: string): Promise<void> {
    this.activeSessions.delete(sessionId);

    // Generate reflection from session buffer
    const buffer = this.sessionBuffers.get(sessionId);
    if (buffer && buffer.length > 0) {
      await this.generateAutoReflection(sessionId, buffer);
    }
    this.sessionBuffers.delete(sessionId);
  }

  /**
   * Add conversation turn to session buffer for later reflection generation.
   */
  addToSessionBuffer(sessionId: string, message: string): void {
    if (!this.sessionBuffers.has(sessionId)) {
      this.sessionBuffers.set(sessionId, []);
    }
    const buffer = this.sessionBuffers.get(sessionId)!;
    buffer.push(message);

    // Keep last 50 messages to avoid memory issues
    if (buffer.length > 50) {
      buffer.shift();
    }
  }

  /**
   * Generate reflection memory automatically from session conversation.
   */
  private async generateAutoReflection(sessionId: string, messages: string[]): Promise<void> {
    console.log(`[MemoryManager] Generating auto-reflection for session ${sessionId} (${messages.length} messages)`);

    const result = await this.summarizer.summarize(messages);

    if (!result.isEmpty && result.summary) {
      await this.storeReflection(result.summary, 0.85);
      console.log(`[MemoryManager] Stored auto-reflection: "${result.summary.substring(0, 50)}..."`);
    } else {
      console.log(`[MemoryManager] No significant content for reflection in session ${sessionId}`);
    }
  }

  /**
   * Run idle clustering during maintenance window.
   * Timeout: 2 minutes max to avoid blocking.
   */
  private async runIdleClustering(): Promise<void> {
    console.log('[MemoryManager] Running idle clustering...');

    // Get all semantic memories for clustering
    const semanticMemories = await this.memoryStore.getSemantic(100);

    if (semanticMemories.length < 5) {
      console.log('[MemoryManager] Not enough memories for clustering');
      return;
    }

    // Run clustering with timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120000);  // 2 minutes

    try {
      const clusteringPromise = this.clusterer.runIdleClustering(
        async () => semanticMemories.map(m => ({ id: m.id, content: m.content })),
        async (result) => {
          // Store merged memory with source_ids tracking
          const mergedId = await this.memoryStore.addReflection(
            `Merged fact: ${result.mergedContent}`,
            0.85
          );
          console.log(
            `[MemoryManager] Stored merged memory ${mergedId} from ${result.sourceIds.length} sources: ${result.theme}`
          );
        },
        { timeoutMs: 120000, maxMemories: 100 }
      );

      await Promise.race([
        clusteringPromise,
        new Promise<never>((_, reject) => {
          controller.signal.addEventListener('abort', () => {
            reject(new Error('[MemoryManager] Clustering timeout after 2 minutes'));
          });
        }),
      ]);

      clearTimeout(timeoutId);
    } catch (error: any) {
      console.error('[MemoryManager] Idle clustering failed or timed out:', error.message);
    }
  }

  /**
   * Run importance decay during maintenance window.
   * Formula: importance *= exp(-age/30d) - 30 day half-life
   * Updates Qdrant payloads with decayed importance values.
   */
  private async runImportanceDecay(): Promise<void> {
    console.log('[MemoryManager] Running importance decay...');

    const now = Date.now();
    const halfLifeDays = 30;  // 30 day half-life
    const lambda = Math.log(2) / halfLifeDays;  // λ = ln(2) / half-life

    // Get all memories from Qdrant
    const allMemories = await this.db.scroll(undefined, 100);
    let updatedCount = 0;

    for (const memory of allMemories) {
      const ageMs = now - new Date(memory.payload.created_at).getTime();
      const ageDays = ageMs / (1000 * 60 * 60 * 24);

      // Skip very recent memories (< 1 day)
      if (ageDays < 1) {
        continue;
      }

      // Calculate decay factor: importance *= e^(-λt)
      const decayFactor = Math.exp(-lambda * ageDays);
      const oldImportance = memory.payload.importance || 0.5;
      const newImportance = oldImportance * decayFactor;

      // Only update if significant change (> 5% difference)
      if (Math.abs(oldImportance - newImportance) > 0.05) {
        await this.db.updatePayload(memory.id, {
          importance: Math.max(newImportance, 0.1),  // Floor at 0.1
          updated_at: new Date().toISOString(),
        });
        updatedCount++;
      }
    }

    console.log(`[MemoryManager] Decay applied: ${updatedCount}/${allMemories.length} memories updated (30d half-life)`);
  }

  /**
   * Retrieve memories relevant to a query.
   * Uses vector search + reranking + diversity + time decay.
   * @param query - The search query
   * @param sessionId - Optional session ID for session isolation
   * @param topK - Maximum number of results to return
   * @param threshold - Minimum similarity threshold
   * @param enableFunnelStats - Whether to log funnel statistics
   * @returns Relevant memories sorted by combined score
   */
  async retrieveRelevant(
    query: string,
    sessionId: string | undefined,
    topK: number = 5,
    threshold: number = 0.6,
    enableFunnelStats: boolean = true
  ): Promise<MemoryWithSimilarity[]> {
    const funnel: RetrievalFunnelStats = {
      initialCount: 0,
      afterTimeDecay: 0,
      afterRerank: 0,
      afterThreshold: 0,
      afterImportance: 0,
      finalCount: 0,
      avgSimilarity: 0,
      avgImportance: 0,
      typeDistribution: {},
    };

    // Generate embedding for query
    const embedding = await this.embedding.embed(query);

    // Search all memories with high recall (K=20), optionally filtered by session
    const searchResults = await this.memoryStore.search(embedding, INITIAL_K, threshold, undefined, false, sessionId);
    
    // Safety check: searchResults should always be an array
    if (!searchResults || !Array.isArray(searchResults)) {
      console.warn('[MemoryManager] search returned invalid results, returning empty');
      return [];
    }
    
    funnel.initialCount = searchResults.length;

    // Apply time decay to similarity scores
    const now = new Date();
    for (const mem of searchResults) {
      // Calculate time decay factor: e^(-λt) where λ = 0.05 (half-life ~14 days)
      const daysSinceCreation = (now.getTime() - mem.created_at.getTime()) / (1000 * 60 * 60 * 24);
      const timeDecay = Math.exp(-0.05 * daysSinceCreation);

      // Apply time decay to similarity (but keep recent boost from 3-day window)
      const memoryTime = mem.created_at?.getTime() || 0;
      const threeDaysMs = 3 * 24 * 60 * 60 * 1000;
      let baseSimilarity = mem.similarity ?? 0.5;

      if (now.getTime() - memoryTime < threeDaysMs) {
        // Recent memories get +0.1 boost before decay
        baseSimilarity += 0.1;
      }

      // Final similarity with time decay
      mem.similarity = baseSimilarity * timeDecay;
    }
    funnel.afterTimeDecay = searchResults.length;

    // Rerank with diversity enabled and threshold filtering
    const reranked = await this.reranker.rerank(query, searchResults, {
      topK: topK,
      threshold: 0.7,  // Higher threshold for better precision
      enableDiversity: true,
    });
    
    // Safety check: reranked should always be an array
    if (!reranked || !Array.isArray(reranked)) {
      console.warn('[MemoryManager] reranker returned invalid results, returning empty');
      return [];
    }
    
    funnel.afterRerank = reranked.length;

    // Increment access count for ALL retrieved memories
    for (const mem of reranked) {
      await this.memoryStore.incrementAccess(mem.id, mem.type as 'episodic' | 'semantic' | 'reflection');
    }

    // Filter by threshold
    const afterThreshold = reranked.filter(r => (r.similarity ?? r.score) >= 0.6);
    funnel.afterThreshold = afterThreshold.length;

    // Filter by importance (Task 1.B.2: filter out importance < 0.3)
    const filtered = afterThreshold.filter(r => (r.importance ?? 0.5) >= 0.3);
    funnel.afterImportance = filtered.length;

    // Sort by combined score (similarity × importance)
    filtered.sort((a, b) => {
      const scoreA = (a.similarity ?? a.score) * (a.importance ?? 0.5);
      const scoreB = (b.similarity ?? b.score) * (b.importance ?? 0.5);
      return scoreB - scoreA;
    });

    // Absolute threshold check: if top similarity < 0.6, return empty
    // This prevents memory hallucination (injecting irrelevant memories)
    if (filtered.length === 0 || (filtered[0].similarity ?? filtered[0].score) < 0.6) {
      console.log(`[MemoryManager] Retrieval threshold not met, returning empty (top similarity: ${(filtered[0]?.similarity ?? filtered[0]?.score)?.toFixed(2)})`);
      return [];
    }

    // Calculate statistics (with safety checks)
    funnel.finalCount = filtered?.length ?? 0;
    funnel.avgSimilarity = filtered && filtered.length > 0
      ? filtered.reduce((sum, m) => sum + (m.similarity ?? m.score ?? 0), 0) / filtered.length
      : 0;
    funnel.avgImportance = filtered && filtered.length > 0
      ? filtered.reduce((sum, m) => sum + (m.importance ?? 0.5), 0) / filtered.length
      : 0;
    for (const mem of filtered) {
      funnel.typeDistribution[mem.type] = (funnel.typeDistribution[mem.type] || 0) + 1;
    }

    // Log funnel statistics
    if (enableFunnelStats) {
      console.log(`[MemoryManager] Funnel: ${funnel.initialCount} → ${funnel.afterTimeDecay} → ${funnel.afterRerank} → ${funnel.afterThreshold} → ${funnel.afterImportance} → ${funnel.finalCount}`);
      console.log(`[MemoryManager] Avg similarity: ${funnel.avgSimilarity.toFixed(2)}, Avg importance: ${funnel.avgImportance.toFixed(2)}`);
      console.log(`[MemoryManager] Type distribution:`, funnel.typeDistribution);
    }

    return filtered as MemoryWithSimilarity[];
  }

  /**
   * Retrieve memories using hybrid search (BM25 + Vector).
   * @param query - The search query
   * @param sessionId - Optional session ID for session isolation
   * @param topK - Maximum number of results to return
   * @param threshold - Minimum score threshold
   * @param bm25Weight - Weight for BM25 score (0.5 = equal weighting)
   */
  async retrieveHybrid(
    query: string,
    sessionId: string | undefined,
    topK: number = 5,
    threshold: number = 0.6,
    bm25Weight: number = 0.5
  ): Promise<MemoryWithSimilarity[]> {
    // Generate embedding for query
    const embedding = await this.embedding.embed(query);

    // Build filter
    const filter: Record<string, any> = {};
    if (sessionId) filter.session_id = sessionId;

    // Hybrid search with RRF fusion
    const hybridResults = await this.db.searchHybrid(query, embedding, topK * 2, filter, bm25Weight);

    // Convert to MemoryWithSimilarity format
    const results: MemoryWithSimilarity[] = hybridResults.map(r => ({
      id: r.id,
      content: r.payload.content || r.payload.summary || '',
      importance: r.payload.importance || 0.5,
      similarity: r.score,
      type: r.payload.memory_type as 'episodic' | 'semantic' | 'reflection',
      created_at: new Date(r.payload.created_at),
      access_count: r.payload.access_count || 0,
      session_id: r.payload.session_id,
    }));

    // Apply time decay and importance filtering
    const now = new Date();
    for (const mem of results) {
      const daysSinceCreation = (now.getTime() - mem.created_at.getTime()) / (1000 * 60 * 60 * 24);
      const timeDecay = Math.exp(-Math.log(2) / 30 * daysSinceCreation);  // 30d half-life
      mem.similarity *= timeDecay;
    }

    // Filter by threshold and importance
    const filtered = results.filter(r => r.similarity >= threshold && r.importance >= 0.3);

    // Sort by combined score
    filtered.sort((a, b) => (b.similarity * b.importance) - (a.similarity * a.importance));

    console.log(`[MemoryManager] Hybrid retrieval: ${filtered.length}/${results.length} results (BM25 weight: ${bm25Weight})`);

    return filtered.slice(0, topK);
  }

  /**
   * Retrieve memories using hierarchical search (Reflection -> Semantic -> Episodic).
   * @param query - The search query
   * @param sessionId - Optional session ID for session isolation
   * @param reflectionLimit - Max reflection memories
   * @param semanticLimit - Max semantic memories
   * @param episodicLimit - Max episodic memories
   */
  async retrieveHierarchical(
    query: string,
    sessionId: string | undefined,
    reflectionLimit: number = 3,
    semanticLimit: number = 5,
    episodicLimit: number = 10
  ): Promise<{
    reflections: MemoryWithSimilarity[];
    semantics: MemoryWithSimilarity[];
    episodic: MemoryWithSimilarity[];
  }> {
    // Generate embedding for query
    const embedding = await this.embedding.embed(query);

    // Build filter
    const filter: Record<string, any> = {};
    if (sessionId) filter.session_id = sessionId;

    // Hierarchical search
    const hierarchicalResults = await this.db.searchHierarchical(
      embedding,
      filter,
      reflectionLimit,
      semanticLimit,
      episodicLimit
    );

    // Convert to MemoryWithSimilarity format
    const convertResults = (results: Array<{ id: number; score: number; payload: Record<string, any> }>, defaultType: string): MemoryWithSimilarity[] => {
      return results.map(r => ({
        id: r.id,
        content: r.payload.content || r.payload.summary || '',
        importance: r.payload.importance || 0.5,
        similarity: r.score,
        type: (r.payload.memory_type || defaultType) as 'episodic' | 'semantic' | 'reflection',
        created_at: new Date(r.payload.created_at),
        access_count: r.payload.access_count || 0,
        session_id: r.payload.session_id,
      }));
    };

    const result = {
      reflections: convertResults(hierarchicalResults.reflections, 'reflection'),
      semantics: convertResults(hierarchicalResults.semantics, 'semantic'),
      episodic: convertResults(hierarchicalResults.episodic, 'episodic'),
    };

    console.log(`[MemoryManager] Hierarchical retrieval: ${result.reflections.length} reflections, ${result.semantics.length} semantics, ${result.episodic.length} episodic`);

    return result;
  }

  /**
   * Build context string for LLM.
   */
  buildContext(
    sessionId: string,
    memories: MemoryWithSimilarity[],
    recentConversation?: string
  ): string {
    const reflectionMemories = memories.filter(m => m.type === 'reflection') as any[];
    return this.contextBuilder.buildContext(
      sessionId,
      memories,
      reflectionMemories,
      recentConversation
    );
  }

  /**
   * Build hierarchical memory tree for structured context.
   * Level 1: Episodic (specific events)
   * Level 2: Semantic (general facts)
   * Level 3: Reflection (themes/summaries)
   */
  buildMemoryHierarchy(
    memories: Array<{
      id: number;
      content: string;
      type: string;
      importance: number;
      similarity?: number;
    }>
  ): import('./clusterer.js').HierarchicalMemory[] {
    return this.clusterer.buildHierarchy(memories);
  }

  /**
   * Store memory asynchronously (non-blocking).
   * Uses internal queue to avoid blocking the conversation flow.
   */
  async storeMemory(
    sessionId: string,
    content: string,
    importance: number = 0.5
  ): Promise<void> {
    // Add to async queue - returns immediately
    this.memoryStore.enqueueStorage(async () => {
      await this.memoryStore.storeEpisodic(sessionId, content, importance);
    });
  }

  /**
   * Store semantic memory asynchronously (non-blocking).
   * @param content - Memory content
   * @param importance - Importance score
   * @param sessionId - Optional session ID for session isolation
   */
  async storeSemantic(content: string, importance: number = 0.7, sessionId?: string): Promise<void> {
    this.memoryStore.enqueueStorage(async () => {
      await this.memoryStore.storeSemantic(content, importance, sessionId);
    });
  }

  /**
   * Store semantic memory with conflict detection.
   * Marks conflicting memories as superseded (not deleted).
   * @param content - Memory content
   * @param importance - Importance score
   * @param similarityThreshold - Similarity threshold for conflict detection
   * @param sessionId - Optional session ID for session isolation
   */
  async storeSemanticWithConflictCheck(
    content: string,
    importance: number = 0.7,
    similarityThreshold: number = 0.85,
    sessionId?: string
  ): Promise<{ stored: boolean; conflictDetected: boolean; supersededId?: number }> {
    // Search for similar memories
    const embedding = await this.embedding.embed(content);
    const similar = await this.memoryStore.search(embedding, 5, similarityThreshold);

    if (similar.length > 0) {
      // Check for conflicts
      const conflictResult = await this.conflictDetector.detectConflict(
        content,
        similar.map(m => ({ id: m.id, content: m.content, type: m.type })),
        async (memoryId, metadata) => {
          // Mark old memory as superseded
          await this.memoryStore.markAsSuperseded(memoryId, metadata);
        }
      );

      if (conflictResult.isConflict) {
        console.log(
          `[Memory] Conflict detected: "${content.substring(0, 50)}..." supersedes memory ${conflictResult.oldMemoryId}`
        );
        // Still store the new memory, but mark the old one as superseded
        this.memoryStore.enqueueStorage(async () => {
          await this.memoryStore.storeSemantic(content, importance, sessionId);
        });
        return {
          stored: true,
          conflictDetected: true,
          supersededId: conflictResult.oldMemoryId,
        };
      }
    }

    // No conflict, store normally
    this.memoryStore.enqueueStorage(async () => {
      await this.memoryStore.storeSemantic(content, importance, sessionId);
    });
    return { stored: true, conflictDetected: false };
  }

  /**
   * Store reflection memory.
   * @param summary - Reflection summary
   * @param importance - Importance score
   * @param sessionId - Optional session ID for session isolation
   */
  async storeReflection(summary: string, importance: number = 0.9, sessionId?: string): Promise<number> {
    return this.memoryStore.addReflection(summary, importance, sessionId);
  }

  /**
   * Get memory statistics.
   */
  async getStats() {
    return this.memoryStore.getStats();
  }

  /**
   * Shutdown and cleanup resources.
   */
  async shutdown(): Promise<void> {
    // Stop idle clustering worker
    if (this.idleClusteringInterval) {
      clearInterval(this.idleClusteringInterval);
    }
    console.log('[MemoryManager] Shutting down');
  }

  /**
   * List recent memories (for CLI usage).
   */
  async listMemories(limit: number = 10): Promise<{ points: Array<{ id: number; payload: Record<string, any> }> }> {
    return this.db.scrollMemories(limit);
  }

  /**
   * Delete memories by IDs (for CLI usage).
   */
  async deleteMemories(ids: number[]): Promise<void> {
    return this.db.deleteMemories(ids);
  }

  /**
   * Clear all memories (for CLI usage).
   */
  async clearAllMemories(): Promise<void> {
    const result = await this.db.scrollMemories(1000);
    const ids = result.points.map(p => p.id);
    if (ids.length > 0) {
      await this.db.deleteMemories(ids as number[]);
    }
  }

  /**
   * Get collection stats (for CLI usage).
   */
  async getCollectionStats(): Promise<{
    points_count: number;
    indexed_vectors_count: number;
    segments_count: number;
    status: string;
    payload_schema?: Record<string, any>;
  }> {
    return this.db.getCollectionStats();
  }
}

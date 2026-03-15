/**
 * Memory Manager - orchestrates all memory operations using SurrealDB.
 */

import { SurrealDatabase, MigrationResult } from './surrealdb-client.js';
import { EmbeddingService } from './embedding.js';
import { MemoryStore } from './memory-store-surreal.js';
import { ContextBuilder } from './context-builder.js';
import { Reranker, INITIAL_K } from './reranker.js';
import { ConflictDetector } from './conflict-detector.js';
import { LLMLimiter } from './llm-limiter.js';
import { ImportanceLearning } from './importance-learning.js';
import { SemanticClusterer } from './clusterer.js';
import { Summarizer } from './summarizer.js';
import { HybridRetriever } from './hybrid-retrieval.js';
import { EntityIndexer } from './entity-indexer.js';
import type { MemoryWithSimilarity } from './memory-store-surreal.js';

export interface RetrievalFunnelStats {
  initialCount: number;
  afterTimeDecay: number;
  afterRerank: number;
  afterThreshold: number;
  afterImportance: number;
  finalCount: number;
  avgSimilarity: number;
  avgImportance: number;
  typeDistribution: Record<string, number>;
}

export interface MemoryManagerConfig {
  surrealdb: {
    url: string;
    namespace: string;
    database: string;
    username: string;
    password: string;
  };
  embedding?: {
    endpoint: string;
  };
}

export class MemoryManager {
  private db: SurrealDatabase;
  private embedding: EmbeddingService;
  private memoryStore: MemoryStore;
  private contextBuilder: ContextBuilder;
  private reranker: Reranker;
  private conflictDetector: ConflictDetector;
  private limiter: LLMLimiter;
  private importanceLearning: ImportanceLearning;
  private clusterer: SemanticClusterer;
  private summarizer: Summarizer;
  private hybridRetriever: HybridRetriever;
  private entityIndexer: EntityIndexer;
  private idleClusteringInterval?: NodeJS.Timeout;
  private activeSessions = new Set<string>();
  private sessionBuffers = new Map<string, string[]>();
  private lastRequestTime = Date.now();
  private maintenanceHistory = {
    lastClustering: 0,
    lastDecay: 0,
    lastSummarization: 0,
  };

  constructor(config: MemoryManagerConfig) {
    this.db = new SurrealDatabase(config.surrealdb);
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

    // Initialize EntityIndexer and HybridRetriever
    this.entityIndexer = new EntityIndexer(this.db);
    this.hybridRetriever = new HybridRetriever(this.db, this.embedding, this.entityIndexer, this.reranker);
  }

  /**
   * Initialize the memory manager (connect to SurrealDB).
   */
  async initialize(): Promise<MigrationResult> {
    const result = await this.db.initialize();
    console.log('[MemoryManager] Initialized with SurrealDB');

    // Start idle clustering worker
    this.startIdleClusteringWorker();

    return result;
  }

  /**
   * Start idle clustering worker - runs semantic clustering during idle time.
   */
  private startIdleClusteringWorker(): void {
    this.idleClusteringInterval = setInterval(async () => {
      try {
        const now = Date.now();
        const isIdle = this.activeSessions.size === 0 && (now - this.lastRequestTime) > 30000;

        if (!isIdle) {
          return;
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
   */
  private async runIdleClustering(): Promise<void> {
    console.log('[MemoryManager] Running idle clustering...');

    const semanticMemories = await this.memoryStore.getSemantic(100);

    if (semanticMemories.length < 5) {
      console.log('[MemoryManager] Not enough memories for clustering');
      return;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120000);

    try {
      const clusteringPromise = this.clusterer.runIdleClustering(
        async () => semanticMemories.map(m => ({ id: m.id, content: m.content })),
        async (result) => {
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
   */
  private async runImportanceDecay(): Promise<void> {
    console.log('[MemoryManager] Running importance decay...');

    const now = Date.now();
    const halfLifeDays = 30;
    const lambda = Math.log(2) / halfLifeDays;

    const allMemories = await this.db.scroll(undefined, 100);
    let updatedCount = 0;

    for (const memory of allMemories) {
      const ageMs = now - new Date(memory.payload.created_at).getTime();
      const ageDays = ageMs / (1000 * 60 * 60 * 24);

      if (ageDays < 1) {
        continue;
      }

      const decayFactor = Math.exp(-lambda * ageDays);
      const oldImportance = memory.payload.importance || 0.5;
      const newImportance = oldImportance * decayFactor;

      if (Math.abs(oldImportance - newImportance) > 0.05) {
        await this.db.updatePayload(memory.id, {
          importance: Math.max(newImportance, 0.1),
          updated_at: new Date().toISOString(),
        });
        updatedCount++;
      }
    }

    console.log(`[MemoryManager] Decay applied: ${updatedCount}/${allMemories.length} memories updated`);
  }

  /**
   * Retrieve memories relevant to a query using HybridRetriever.
   * Combines vector search + graph traversal + reranking.
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

    // Use HybridRetriever for vector + graph hybrid search
    const hybridResult = await this.hybridRetriever.retrieve(query, sessionId, topK, threshold);

    funnel.initialCount = hybridResult.stats.vectorCount + hybridResult.stats.graphCount;
    funnel.afterRerank = hybridResult.stats.mergedCount;
    funnel.afterThreshold = hybridResult.stats.finalCount;
    funnel.finalCount = hybridResult.stats.finalCount;
    funnel.avgSimilarity = hybridResult.stats.avgSimilarity;

    // Convert MemoryResult to MemoryWithSimilarity format
    const results: MemoryWithSimilarity[] = hybridResult.results.map(r => ({
      id: r.id,
      content: r.content,
      type: r.type,
      similarity: r.score ?? r.similarity ?? 0,
      score: r.score ?? r.similarity ?? 0,
      importance: r.importance ?? 0.5,
      created_at: r.created_at ?? new Date(),
      access_count: r.access_count ?? 0,
      cluster_id: r.cluster_id,
    }));

    // Increment access counts for retrieved memories
    for (const mem of results) {
      await this.memoryStore.incrementAccess(mem.id, mem.type as 'episodic' | 'semantic' | 'reflection');
    }

    if (enableFunnelStats && hybridResult.stats.mergedCount > 0) {
      console.log(`[MemoryManager] Hybrid Funnel: ${funnel.initialCount} (vector:${hybridResult.stats.vectorCount} + graph:${hybridResult.stats.graphCount}) → ${funnel.afterRerank} merged → ${funnel.finalCount} final`);
      console.log(`[MemoryManager] Avg similarity: ${funnel.avgSimilarity.toFixed(2)}`);
    }

    return results;
  }

  /**
   * Store memory asynchronously.
   */
  async storeMemory(
    sessionId: string,
    content: string,
    importance: number = 0.5
  ): Promise<void> {
    this.memoryStore.enqueueStorage(async () => {
      await this.memoryStore.storeEpisodic(sessionId, content, importance);
    });
  }

  /**
   * Store semantic memory asynchronously.
   */
  async storeSemantic(content: string, importance: number = 0.7, sessionId?: string): Promise<void> {
    this.memoryStore.enqueueStorage(async () => {
      await this.memoryStore.storeSemantic(content, importance, sessionId);
    });
  }

  /**
   * Store semantic memory with conflict detection.
   */
  async storeSemanticWithConflictCheck(
    content: string,
    importance: number = 0.7,
    similarityThreshold: number = 0.85,
    sessionId?: string
  ): Promise<{ stored: boolean; conflictDetected: boolean; supersededId?: number }> {
    const embedding = await this.embedding.embed(content);
    const similar = await this.memoryStore.search(embedding, 5, similarityThreshold);

    if (similar.length > 0) {
      const conflictResult = await this.conflictDetector.detectConflict(
        content,
        similar.map(m => ({ id: m.id, content: m.content, type: m.type })),
        async (memoryId, metadata) => {
          await this.memoryStore.markAsSuperseded(memoryId, metadata);
        }
      );

      if (conflictResult.isConflict) {
        console.log(
          `[Memory] Conflict detected: "${content.substring(0, 50)}..." supersedes memory ${conflictResult.oldMemoryId}`
        );
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

    this.memoryStore.enqueueStorage(async () => {
      await this.memoryStore.storeSemantic(content, importance, sessionId);
    });
    return { stored: true, conflictDetected: false };
  }

  /**
   * Store reflection memory.
   */
  async storeReflection(summary: string, importance: number = 0.9, sessionId?: string): Promise<number> {
    return this.memoryStore.addReflection(summary, importance, sessionId);
  }

  /**
   * Get memory statistics.
   */
  async getStats(): Promise<{
    episodic_count: number;
    semantic_count: number;
    reflection_count: number;
    total_count: number;
  }> {
    return this.memoryStore.getStats();
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
   * Close the memory manager.
   */
  async close(): Promise<void> {
    if (this.idleClusteringInterval) {
      clearInterval(this.idleClusteringInterval);
    }
    await this.db.close();
  }
}

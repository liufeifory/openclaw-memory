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
   * Retrieve memories relevant to a query.
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

    const embedding = await this.embedding.embed(query);

    const searchResults = await this.memoryStore.search(embedding, INITIAL_K, threshold, undefined, false, sessionId);

    if (!searchResults || !Array.isArray(searchResults)) {
      console.warn('[MemoryManager] search returned invalid results, returning empty');
      return [];
    }

    funnel.initialCount = searchResults.length;

    const now = new Date();
    for (const mem of searchResults) {
      const daysSinceCreation = (now.getTime() - mem.created_at.getTime()) / (1000 * 60 * 60 * 24);
      const timeDecay = Math.exp(-0.05 * daysSinceCreation);

      const memoryTime = mem.created_at?.getTime() || 0;
      const threeDaysMs = 3 * 24 * 60 * 60 * 1000;
      let baseSimilarity = mem.similarity ?? 0.5;

      if (now.getTime() - memoryTime < threeDaysMs) {
        baseSimilarity += 0.1;
      }

      mem.similarity = baseSimilarity * timeDecay;
    }
    funnel.afterTimeDecay = searchResults.length;

    const reranked = await this.reranker.rerank(query, searchResults, {
      topK: topK,
      threshold: 0.7,
      enableDiversity: true,
    });

    if (!reranked || !Array.isArray(reranked)) {
      console.warn('[MemoryManager] reranker returned invalid results, returning empty');
      return [];
    }

    funnel.afterRerank = reranked.length;

    for (const mem of reranked) {
      await this.memoryStore.incrementAccess(mem.id, mem.type as 'episodic' | 'semantic' | 'reflection');
    }

    const afterThreshold = reranked.filter(r => (r.similarity ?? r.score) >= 0.6);
    funnel.afterThreshold = afterThreshold.length;

    const filtered = afterThreshold.filter(r => (r.importance ?? 0.5) >= 0.3);
    funnel.afterImportance = filtered.length;

    filtered.sort((a, b) => {
      const scoreA = (a.similarity ?? a.score) * (a.importance ?? 0.5);
      const scoreB = (b.similarity ?? b.score) * (b.importance ?? 0.5);
      return scoreB - scoreA;
    });

    if (filtered.length === 0 || (filtered[0].similarity ?? filtered[0].score) < 0.6) {
      console.log(`[MemoryManager] Retrieval threshold not met, returning empty`);
      return [];
    }

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

    if (enableFunnelStats) {
      console.log(`[MemoryManager] Funnel: ${funnel.initialCount} → ${funnel.afterTimeDecay} → ${funnel.afterRerank} → ${funnel.afterThreshold} → ${funnel.afterImportance} → ${funnel.finalCount}`);
      console.log(`[MemoryManager] Avg similarity: ${funnel.avgSimilarity.toFixed(2)}, Avg importance: ${funnel.avgImportance.toFixed(2)}`);
      console.log(`[MemoryManager] Type distribution:`, funnel.typeDistribution);
    }

    return filtered as MemoryWithSimilarity[];
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

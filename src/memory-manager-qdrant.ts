/**
 * Memory Manager - orchestrates all memory operations using Qdrant.
 */

import { QdrantDatabase } from './qdrant-client.js';
import { EmbeddingService } from './embedding.js';
import { MemoryStore } from './memory-store-qdrant.js';
import { ContextBuilder } from './context-builder.js';
import { Reranker } from './reranker.js';
import { ConflictDetector } from './conflict-detector.js';
import type { MemoryWithSimilarity } from './memory-store-qdrant.js';

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

  constructor(config: MemoryManagerConfig) {
    this.db = new QdrantDatabase(config.qdrant);
    this.embedding = new EmbeddingService(config.embedding?.endpoint ?? 'http://localhost:8080');
    this.memoryStore = new MemoryStore(this.db, this.embedding);
    this.contextBuilder = new ContextBuilder();
    // Use 1B model on port 8081 for reranking and conflict detection
    const llamaEndpoint = config.embedding?.endpoint?.replace('8080', '8081') ?? 'http://localhost:8081';
    this.reranker = new Reranker(llamaEndpoint);
    this.conflictDetector = new ConflictDetector(llamaEndpoint);
  }

  /**
   * Initialize the memory manager (connect to Qdrant).
   */
  async initialize(): Promise<void> {
    await this.db.initialize();
    console.log('[MemoryManager] Initialized with Qdrant');
  }

  /**
   * Retrieve memories relevant to a query.
   * Uses vector search + reranking for better results.
   */
  async retrieveRelevant(
    query: string,
    topK: number = 10,
    threshold: number = 0.6
  ): Promise<MemoryWithSimilarity[]> {
    // Generate embedding for query
    const embedding = await this.embedding.embed(query);

    // Search all memories including reflections
    const searchResults = await this.memoryStore.search(embedding, topK * 2, threshold);

    // Rerank results using 1B model (take top 10 for reranking)
    const reranked = await this.reranker.rerank(query, searchResults);

    // Increment access count for ALL retrieved memories (including reflection)
    for (const mem of reranked) {
      await this.memoryStore.incrementAccess(mem.id, mem.type as 'episodic' | 'semantic' | 'reflection');
    }

    // Sort by combined score (similarity × importance)
    reranked.sort((a, b) => {
      const scoreA = (a.similarity ?? a.score) * (a.importance ?? 0.5);
      const scoreB = (b.similarity ?? b.score) * (b.importance ?? 0.5);
      return scoreB - scoreA;
    });

    // Apply threshold and limit
    return reranked
      .filter(r => (r.similarity ?? r.score) >= threshold)
      .slice(0, 5) as MemoryWithSimilarity[];
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
   */
  async storeSemantic(content: string, importance: number = 0.7): Promise<void> {
    this.memoryStore.enqueueStorage(async () => {
      await this.memoryStore.storeSemantic(content, importance);
    });
  }

  /**
   * Store reflection memory.
   */
  async storeReflection(summary: string, importance: number = 0.9): Promise<number> {
    return this.memoryStore.addReflection(summary, importance);
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
    console.log('[MemoryManager] Shutting down');
  }
}

/**
 * Memory Manager - orchestrates all memory operations using Qdrant.
 */

import { QdrantDatabase } from './qdrant-client.js';
import { EmbeddingService } from './embedding.js';
import { MemoryStore } from './memory-store-qdrant.js';
import { ContextBuilder } from './context-builder.js';
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

  constructor(config: MemoryManagerConfig) {
    this.db = new QdrantDatabase(config.qdrant);
    this.embedding = new EmbeddingService(config.embedding?.endpoint ?? 'http://localhost:8080');
    this.memoryStore = new MemoryStore(this.db, this.embedding);
    this.contextBuilder = new ContextBuilder();
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
   */
  async retrieveRelevant(
    query: string,
    topK: number = 10,
    threshold: number = 0.6
  ): Promise<MemoryWithSimilarity[]> {
    // Generate embedding for query
    const embedding = await this.embedding.embed(query);

    // Search all memories (no type filter)
    const searchResults = await this.memoryStore.search(embedding, topK, threshold);

    // Get reflection memories (highest priority)
    const reflectionMemories = await this.memoryStore.getReflection(5);

    // Combine results
    const results: MemoryWithSimilarity[] = [];

    // Add reflection memories first (highest importance)
    for (const ref of reflectionMemories) {
      results.push({
        id: ref.id,
        type: 'reflection',
        content: ref.summary,
        importance: ref.importance,
        similarity: 1.0,
        created_at: ref.created_at,
        access_count: ref.access_count,
      });
    }

    // Add search results
    for (const m of searchResults) {
      results.push(m);
    }

    // Sort by combined score (similarity × importance)
    results.sort((a, b) => (b.similarity * b.importance) - (a.similarity * a.importance));

    // Filter by threshold and limit
    return results
      .filter(r => r.similarity >= threshold)
      .slice(0, 5);
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
   */
  async storeMemory(
    sessionId: string,
    content: string,
    importance: number = 0.5
  ): Promise<void> {
    // Fire and forget
    this.memoryStore.storeEpisodic(sessionId, content, importance).catch(err => {
      console.error('[MemoryManager] Failed to store memory:', err);
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

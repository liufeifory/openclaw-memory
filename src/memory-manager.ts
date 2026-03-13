/**
 * Memory Manager - orchestrates all memory operations.
 */

import { Database } from './database.js';
import { EmbeddingService } from './embedding.js';
import { MemoryStore } from './memory-store.js';
import { ContextBuilder } from './context-builder.js';
import type { MemoryWithSimilarity } from './memory-types.js';

export interface MemoryManagerConfig {
  database: {
    host: string;
    port: number;
    database: string;
    user: string;
    password: string;
  };
  embedding?: {
    endpoint: string;
  };
}

export class MemoryManager {
  private db: Database;
  private embedding: EmbeddingService;
  private memoryStore: MemoryStore;
  private contextBuilder: ContextBuilder;

  constructor(config: MemoryManagerConfig) {
    this.db = new Database(config.database);
    this.embedding = new EmbeddingService(config.embedding?.endpoint ?? 'http://localhost:8080');
    this.memoryStore = new MemoryStore(this.db, this.embedding);
    this.contextBuilder = new ContextBuilder();
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

    // Search episodic memories
    const episodicResults = await this.memoryStore.searchEpisodic(embedding, topK, threshold);

    // Get semantic memories
    const semanticMemories = await this.memoryStore.getSemantic(20);

    // Get reflection memories
    const reflectionMemories = await this.memoryStore.getReflection(5);

    // Combine results with type markers
    const results: MemoryWithSimilarity[] = [];

    // Add reflection memories (highest importance)
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

    // Add episodic results
    for (const ep of episodicResults) {
      results.push(ep);
    }

    // Add semantic memories
    for (const sem of semanticMemories) {
      results.push({
        id: sem.id,
        type: 'semantic',
        content: sem.content,
        importance: sem.importance,
        similarity: 0.8,
        created_at: sem.created_at,
        access_count: sem.access_count,
      });
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
    // Fire and forget - don't await
    this.memoryStore.storeEpisodic(sessionId, content, importance).catch(err => {
      console.error('Failed to store memory:', err);
    });
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
    await this.db.close();
  }
}

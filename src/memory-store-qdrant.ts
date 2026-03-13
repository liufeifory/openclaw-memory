/**
 * Memory store using Qdrant vector database.
 */

import { QdrantDatabase, MemoryType } from './qdrant-client.js';
import { EmbeddingService } from './embedding.js';

export interface Memory {
  id: number;
  content: string;
  importance: number;
  created_at: Date;
  access_count: number;
}

export interface MemoryWithSimilarity extends Memory {
  similarity: number;
  type: 'episodic' | 'semantic' | 'reflection';
}

export interface EpisodicMemory extends Memory {
  session_id: string;
}

export interface SemanticMemory extends Memory {
  summary?: string;
}

export interface ReflectionMemory {
  id: number;
  summary: string;
  importance: number;
  created_at: Date;
  access_count: number;
  content?: string; // For compatibility with Memory interface
}

export class MemoryStore {
  private db: QdrantDatabase;
  private embedding: EmbeddingService;

  // In-memory stores for non-vector data
  private episodicMemories = new Map<number, EpisodicMemory>();
  private semanticMemories = new Map<number, SemanticMemory>();
  private reflectionMemories = new Map<number, ReflectionMemory>();
  private idCounter = 0;

  // Async queue for non-blocking storage
  private storageQueue: Array<() => Promise<void>> = [];
  private processingQueue = false;

  constructor(db: QdrantDatabase, embedding: EmbeddingService) {
    this.db = db;
    this.embedding = embedding;
  }

  /**
   * Store episodic memory with embedding.
   */
  async storeEpisodic(sessionId: string, content: string, importance: number = 0.5): Promise<number> {
    const memoryId = ++this.idCounter;

    // Generate embedding
    const embedding = await this.embedding.embed(content);

    // Store in Qdrant
    await this.db.upsert(memoryId, embedding, {
      type: MemoryType.EPISODIC,
      session_id: sessionId,
      content: content,
      importance: importance,
      access_count: 0,
      created_at: new Date().toISOString(),
    });

    // Store in memory
    this.episodicMemories.set(memoryId, {
      id: memoryId,
      session_id: sessionId,
      content,
      importance,
      access_count: 0,
      created_at: new Date(),
    });

    return memoryId;
  }

  /**
   * Store semantic memory with embedding.
   */
  async storeSemantic(content: string, importance: number = 0.7): Promise<number> {
    const memoryId = ++this.idCounter;

    const embedding = await this.embedding.embed(content);

    await this.db.upsert(memoryId, embedding, {
      type: MemoryType.SEMANTIC,
      content: content,
      importance: importance,
      access_count: 0,
      created_at: new Date().toISOString(),
    });

    this.semanticMemories.set(memoryId, {
      id: memoryId,
      content,
      importance,
      access_count: 0,
      created_at: new Date(),
    });

    return memoryId;
  }

  /**
   * Search memories by vector similarity.
   */
  async search(
    embedding: number[],
    topK: number = 10,
    threshold: number = 0.6,
    memoryType?: string
  ): Promise<MemoryWithSimilarity[]> {
    const filter = memoryType ? { type: memoryType } : undefined;
    const results = await this.db.search(embedding, topK, filter);

    return results
      .map(r => ({
        id: r.id,
        content: r.payload.content,
        importance: r.payload.importance,
        similarity: r.score,
        type: r.payload.memory_type as 'episodic' | 'semantic' | 'reflection',
        created_at: new Date(r.payload.created_at),
        access_count: r.payload.access_count || 0,
        session_id: r.payload.session_id,
      }))
      .filter(m => m.similarity > threshold);
  }

  /**
   * Get all semantic memories.
   */
  async getSemantic(limit: number = 20): Promise<SemanticMemory[]> {
    const results = Array.from(this.semanticMemories.values())
      .sort((a, b) => b.importance - a.importance)
      .slice(0, limit);
    return results;
  }

  /**
   * Get all reflection memories.
   */
  async getReflection(limit: number = 5): Promise<ReflectionMemory[]> {
    const results = Array.from(this.reflectionMemories.values())
      .sort((a, b) => b.importance - a.importance)
      .slice(0, limit);
    return results;
  }

  /**
   * Add reflection memory (in-memory only, also stored in Qdrant).
   */
  async addReflection(summary: string, importance: number = 0.9): Promise<number> {
    const memoryId = ++this.idCounter;

    const embedding = await this.embedding.embed(summary);

    await this.db.upsert(memoryId, embedding, {
      type: MemoryType.REFLECTION,
      summary: summary,
      importance: importance,
      access_count: 0,
      created_at: new Date().toISOString(),
    });

    const reflection: ReflectionMemory = {
      id: memoryId,
      summary,
      importance,
      access_count: 0,
      created_at: new Date(),
    };

    this.reflectionMemories.set(memoryId, reflection);
    return memoryId;
  }

  /**
   * Increment access count for a memory (also updates Qdrant payload).
   */
  async incrementAccess(memoryId: number, type: 'episodic' | 'semantic' | 'reflection'): Promise<void> {
    // Get current payload from Qdrant
    const point = await this.db.get(memoryId);
    if (point && point.payload) {
      // Update access count in Qdrant
      const newAccessCount = (point.payload.access_count || 0) + 1;
      await this.db.updatePayload(memoryId, { ...point.payload, access_count: newAccessCount });
    }

    // Update in-memory cache
    if (type === 'episodic') {
      const memory = this.episodicMemories.get(memoryId);
      if (memory) {
        memory.access_count++;
        this.episodicMemories.set(memoryId, memory);
      }
    } else if (type === 'semantic') {
      const memory = this.semanticMemories.get(memoryId);
      if (memory) {
        memory.access_count++;
        this.semanticMemories.set(memoryId, memory);
      }
    } else if (type === 'reflection') {
      const memory = this.reflectionMemories.get(memoryId);
      if (memory) {
        memory.access_count++;
        this.reflectionMemories.set(memoryId, memory);
      }
    }
  }

  /**
   * Get payload for a memory from Qdrant.
   */
  private async getPayload(memoryId: number): Promise<Record<string, any> | null> {
    const point = await this.db.get(memoryId);
    return point?.payload || null;
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
    const qdrantCount = await this.db.count();
    return {
      episodic_count: this.episodicMemories.size,
      semantic_count: this.semanticMemories.size,
      reflection_count: this.reflectionMemories.size,
      total_count: qdrantCount,
    };
  }

  /**
   * Add a storage task to the async queue.
   * Returns immediately without waiting for completion.
   */
  enqueueStorage(task: () => Promise<void>): void {
    this.storageQueue.push(task);
    if (!this.processingQueue) {
      this.processStorageQueue();
    }
  }

  /**
   * Process the storage queue asynchronously.
   */
  private async processStorageQueue(): Promise<void> {
    if (this.storageQueue.length === 0) {
      this.processingQueue = false;
      return;
    }

    this.processingQueue = true;

    while (this.storageQueue.length > 0) {
      const task = this.storageQueue.shift();
      if (task) {
        try {
          await task();
        } catch (error: any) {
          console.error('[MemoryStore] Queue task failed:', error.message);
        }
      }
    }

    this.processingQueue = false;
  }

  /**
   * Get current queue length.
   */
  getQueueLength(): number {
    return this.storageQueue.length;
  }
}

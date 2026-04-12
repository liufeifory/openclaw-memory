/* eslint-disable @typescript-eslint/no-explicit-any -- Database query returns have flexible SurrealDB formats */
/**
 * Memory store using SurrealDB.
 */

import { logInfo, logWarn, logError } from './maintenance-logger.js';
import { SurrealDatabase, MemoryType } from './surrealdb-client.js';
import { EmbeddingService } from './embedding.js';
import { EntityIndexer } from './entity-indexer.js';

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
  session_id?: string;
  is_active?: boolean;
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
  content?: string;
}

export interface DedupeCheckResult {
  isDuplicate: boolean;
  similarMemoryId?: number;
  similarity: number;
}

// Semantic deduplication threshold
const DEDUPE_THRESHOLD = 0.95;

/**
 * Clean payload for storage - remove undefined/null fields, ensure defaults.
 */
function cleanPayload(payload: Record<string, any>): Record<string, any> {
  const cleaned: Record<string, any> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (value === undefined || value === null) {
      continue;
    }
    if (key === 'importance' && typeof value !== 'number') {
      cleaned[key] = 0.5;
      continue;
    }
    if (key === 'access_count' && typeof value !== 'number') {
      cleaned[key] = 0;
      continue;
    }
    cleaned[key] = value;
  }
  return cleaned;
}

export class MemoryStore {
  private db: SurrealDatabase;
  private embedding: EmbeddingService;
  private entityIndexer: EntityIndexer | null = null;

  // In-memory stores for non-vector data
  private episodicMemories = new Map<number, EpisodicMemory>();
  private semanticMemories = new Map<number, SemanticMemory>();
  private reflectionMemories = new Map<number, ReflectionMemory>();
  private idCounter = 0;

  constructor(db: SurrealDatabase, embedding: EmbeddingService) {
    this.db = db;
    this.embedding = embedding;
  }

  /**
   * Set entity indexer for graph indexing.
   */
  setEntityIndexer(indexer: EntityIndexer): void {
    this.entityIndexer = indexer;
    logInfo('[MemoryStore] EntityIndexer set');
  }

  /**
   * Store episodic memory with embedding.
   * Checks for near-duplicate content within the same session.
   */
  async storeEpisodic(sessionId: string, content: string, importance: number = 0.5): Promise<number> {
    const dedupeResult = await this.checkDuplicateInSession(sessionId, content);

    if (dedupeResult.isDuplicate && dedupeResult.similarMemoryId) {
      logInfo(`[MemoryStore] Skipping duplicate episodic memory in session ${sessionId} (similarity: ${dedupeResult.similarity.toFixed(3)}, existing ID: ${dedupeResult.similarMemoryId})`);
      return dedupeResult.similarMemoryId;
    }

    const memoryId = ++this.idCounter;
    const now = Date.now();

    const embedding = await this.embedding.embed(content);

    await this.db.upsert(memoryId, embedding, cleanPayload({
      type: MemoryType.EPISODIC,
      session_id: sessionId,
      content: content,
      importance: importance,
      access_count: 0,
      created_at: new Date().toISOString(),
      version: now,
    }));

    this.episodicMemories.set(memoryId, {
      id: memoryId,
      session_id: sessionId,
      content,
      importance,
      access_count: 0,
      created_at: new Date(),
    });

    // Add to entity indexing queue
    if (this.entityIndexer) {
      this.entityIndexer.queueForIndexing(memoryId, content);
    }

    return memoryId;
  }

  /**
   * Check if content is a near-duplicate within the same session.
   */
  private async checkDuplicateInSession(sessionId: string, content: string): Promise<DedupeCheckResult> {
    const embedding = await this.embedding.embed(content);
    const results = await this.search(embedding, 5, 0.9, 'episodic', false, sessionId);

    if (results.length > 0 && results[0].similarity >= DEDUPE_THRESHOLD) {
      return {
        isDuplicate: true,
        similarMemoryId: results[0].id,
        similarity: results[0].similarity,
      };
    }

    return {
      isDuplicate: false,
      similarity: results.length > 0 ? results[0].similarity : 0,
    };
  }

  /**
   * Store semantic memory with embedding.
   */
  async storeSemantic(content: string, importance: number = 0.7, sessionId?: string): Promise<number> {
    const dedupeResult = await this.checkDuplicate(content);

    if (dedupeResult.isDuplicate && dedupeResult.similarMemoryId) {
      logInfo(`[MemoryStore] Skipping duplicate semantic memory (similarity: ${dedupeResult.similarity.toFixed(3)}, existing ID: ${dedupeResult.similarMemoryId})`);
      return dedupeResult.similarMemoryId;
    }

    const memoryId = ++this.idCounter;
    const now = Date.now();

    const embedding = await this.embedding.embed(content);

    const payload: Record<string, any> = {
      type: MemoryType.SEMANTIC,
      content: content,
      importance: importance,
      access_count: 0,
      created_at: new Date().toISOString(),
      version: now,
    };
    if (sessionId) {
      payload.session_id = sessionId;
    }
    await this.db.upsert(memoryId, embedding, cleanPayload(payload));

    this.semanticMemories.set(memoryId, {
      id: memoryId,
      content,
      importance,
      access_count: 0,
      created_at: new Date(),
    });

    // Add to entity indexing queue
    if (this.entityIndexer) {
      this.entityIndexer.queueForIndexing(memoryId, content);
    }

    return memoryId;
  }

  /**
   * Check if content is a near-duplicate of existing memory.
   */
  private async checkDuplicate(content: string): Promise<DedupeCheckResult> {
    const embedding = await this.embedding.embed(content);
    const results = await this.search(embedding, 1, 0.9, 'semantic');

    if (results.length > 0 && results[0].similarity >= DEDUPE_THRESHOLD) {
      return {
        isDuplicate: true,
        similarMemoryId: results[0].id,
        similarity: results[0].similarity,
      };
    }

    return {
      isDuplicate: false,
      similarity: results.length > 0 ? results[0].similarity : 0,
    };
  }

  /**
   * Search memories by vector similarity.
   */
  async search(
    embedding: number[],
    topK: number = 10,
    threshold: number = 0.6,
    memoryType?: string,
    includeSuperseded: boolean = false,
    sessionId?: string
  ): Promise<MemoryWithSimilarity[]> {
    if (!embedding || embedding.length === 0) {
      logWarn('[MemoryStore] search received empty embedding, returning empty results');
      return [];
    }

    const filter: Record<string, any> = {};
    if (memoryType) filter.type = memoryType;
    if (sessionId) filter.session_id = sessionId;

    const results = await this.db.search(embedding, topK * 2, Object.keys(filter).length > 0 ? filter : undefined);

    const mapped = results
      .map(r => ({
        id: r.id,
        content: r.payload.content,
        importance: r.payload.importance,
        similarity: r.score,
        type: r.payload.memory_type as 'episodic' | 'semantic' | 'reflection',
        created_at: new Date(r.payload.created_at),
        access_count: r.payload.access_count || 0,
        session_id: r.payload.session_id,
        is_active: r.payload.is_active ?? true,
      }))
      .filter(m => {
        if (m.similarity <= threshold) return false;
        if (!includeSuperseded && m.is_active === false) return false;
        return true;
      })
      .slice(0, topK);

    return mapped;
  }

  /**
   * Get semantic memories with optional session filtering.
   */
  async getSemantic(limit: number = 20, sessionId?: string): Promise<SemanticMemory[]> {
    if (sessionId) {
      const embedding = await this.embedding.embed('general knowledge fact');
      const results = await this.search(embedding, limit, 0.5, 'semantic', false, sessionId);
      return results.map(r => ({
        id: r.id,
        content: r.content,
        importance: r.importance,
        access_count: r.access_count,
        created_at: r.created_at,
      }));
    }
    const results = Array.from(this.semanticMemories.values())
      .sort((a, b) => b.importance - a.importance)
      .slice(0, limit);
    return results;
  }

  /**
   * Get reflection memories with optional session filtering.
   */
  async getReflection(limit: number = 5, sessionId?: string): Promise<ReflectionMemory[]> {
    if (sessionId) {
      const embedding = await this.embedding.embed('reflection insight summary');
      const results = await this.search(embedding, limit, 0.5, 'reflection', false, sessionId);
      return results.map(r => ({
        id: r.id,
        summary: r.content,
        importance: r.importance,
        access_count: r.access_count,
        created_at: r.created_at,
      }));
    }
    const results = Array.from(this.reflectionMemories.values())
      .sort((a, b) => b.importance - a.importance)
      .slice(0, limit);
    return results;
  }

  /**
   * Add reflection memory.
   */
  async addReflection(summary: string, importance: number = 0.9, sessionId?: string): Promise<number> {
    const memoryId = ++this.idCounter;
    const now = Date.now();

    const embedding = await this.embedding.embed(summary);

    const payload: Record<string, any> = {
      type: MemoryType.REFLECTION,
      content: summary, // Store summary in content field for consistency
      summary: summary,
      importance: importance,
      access_count: 0,
      created_at: new Date().toISOString(),
      version: now,
    };
    if (sessionId) {
      payload.session_id = sessionId;
    }
    await this.db.upsert(memoryId, embedding, cleanPayload(payload));

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
   * Increment access count for a memory.
   */
  async incrementAccess(memoryId: number, type: 'episodic' | 'semantic' | 'reflection'): Promise<void> {
    const point = await this.db.get(memoryId);
    if (point && point.payload) {
      const newAccessCount = (point.payload.access_count || 0) + 1;
      // Only update fields that exist in the database schema
      // memory_type is a computed field, not stored in DB
      await this.db.updatePayload(memoryId, {
        access_count: newAccessCount,
        updated_at: new Date().toISOString(),
      });
    }

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
   * Mark a memory as superseded.
   */
  async markAsSuperseded(
    memoryId: number,
    metadata: { superseded_by?: number; is_active?: boolean }
  ): Promise<void> {
    const point = await this.db.get(memoryId);
    if (point && point.payload) {
      const newPayload = {
        ...point.payload,
        superseded_by: metadata.superseded_by ?? point.payload.superseded_by,
        is_active: metadata.is_active ?? false,
        superseded_at: new Date().toISOString(),
      };
      await this.db.updatePayload(memoryId, newPayload);
    }
  }

  /**
   * Get memory statistics from database (not memory cache).
   */
  async getStats(): Promise<{
    episodic_count: number;
    semantic_count: number;
    reflection_count: number;
    total_count: number;
  }> {
    // Query actual counts from database
    const counts = await this.db.queryTypeCounts();
    return {
      episodic_count: counts.episodic || 0,
      semantic_count: counts.semantic || 0,
      reflection_count: counts.reflection || 0,
      total_count: counts.total || 0,
    };
  }

  /**
   * Enqueue storage operation for async processing.
   */
  enqueueStorage(operation: () => Promise<void>): void {
    // Fire and forget - errors handled within operation
    operation().catch(err => {
      logError(`[MemoryStore] Async storage operation failed: ${err.message}`);
    });
  }
}

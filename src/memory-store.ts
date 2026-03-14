/**
 * Memory store for episodic, semantic, and reflection memories.
 */

import { Database } from './database.js';
import { EmbeddingService } from './embedding.js';
import type { EpisodicMemory, SemanticMemory, ReflectionMemory, MemoryWithSimilarity } from './memory-types.js';

export class MemoryStore {
  private db: Database;
  private embedding: EmbeddingService;

  constructor(db: Database, embedding: EmbeddingService) {
    this.db = db;
    this.embedding = embedding;
  }

  /**
   * Store episodic memory with embedding.
   */
  async storeEpisodic(sessionId: string, content: string, importance: number = 0.5): Promise<number> {
    // Insert episodic memory
    const epResult = await this.db.query<{ id: number }>(
      `INSERT INTO episodic_memory (session_id, content, importance, created_at, access_count)
       VALUES ($1, $2, $3, NOW(), 0)
       RETURNING id`,
      [sessionId, content, importance]
    );

    const memoryId = epResult[0].id;

    // Generate and store embedding
    const embedding = await this.embedding.embed(content);
    await this.db.execute(
      `INSERT INTO memory_embeddings (memory_id, memory_type, embedding, created_at)
       VALUES ($1, 'episodic', $2, NOW())`,
      [memoryId, `[${embedding.join(',')}]`]
    );

    return memoryId;
  }

  /**
   * Store semantic memory with embedding.
   */
  async storeSemantic(content: string, importance: number = 0.7): Promise<number> {
    const smResult = await this.db.query<{ id: number }>(
      `INSERT INTO semantic_memory (content, importance, created_at, access_count)
       VALUES ($1, $2, NOW(), 0)
       RETURNING id`,
      [content, importance]
    );

    const memoryId = smResult[0].id;

    const embedding = await this.embedding.embed(content);
    await this.db.execute(
      `INSERT INTO memory_embeddings (memory_id, memory_type, embedding, created_at)
       VALUES ($1, 'semantic', $2, NOW())`,
      [memoryId, `[${embedding.join(',')}]`]
    );

    return memoryId;
  }

  /**
   * Search episodic memories by vector similarity.
   * @param sessionId - Optional session ID for session isolation
   */
  async searchEpisodic(
    embedding: number[],
    topK: number = 10,
    threshold: number = 0.6,
    sessionId?: string
  ): Promise<MemoryWithSimilarity[]> {
    const embStr = `[${embedding.join(',')}]`;

    // Add session filter if provided
    const sessionCondition = sessionId ? 'AND m.session_id = $3' : '';
    const params = sessionId ? [topK, embStr, sessionId] : [topK, embStr];

    const results = await this.db.query<{
      memory_id: number;
      content: string;
      importance: number;
      similarity: number;
    }>(
      `SELECT e.memory_id, m.content, m.importance,
              1 - (e.embedding <=> $2::vector) AS similarity
       FROM memory_embeddings e
       JOIN episodic_memory m ON e.memory_id = m.id
       WHERE e.memory_type = 'episodic' ${sessionCondition}
       ORDER BY e.embedding <=> $2::vector
       LIMIT $1`,
      params
    );

    return results
      .map(r => ({
        id: r.memory_id,
        content: r.content,
        importance: r.importance,
        similarity: r.similarity,
        type: 'episodic' as const,
        created_at: new Date(),
        access_count: 0,
      }))
      .filter(m => m.similarity > threshold);
  }

  /**
   * Get all semantic memories.
   * @param limit - Maximum number of results
   * @param sessionId - Optional session ID for session isolation (not applicable for semantic memories in PostgreSQL)
   */
  async getSemantic(limit: number = 20, sessionId?: string): Promise<SemanticMemory[]> {
    // PostgreSQL version: semantic memories are global (no session isolation by design)
    // sessionId parameter kept for API compatibility with Qdrant version
    const results = await this.db.query<SemanticMemory>(
      `SELECT * FROM semantic_memory
       ORDER BY importance DESC
       LIMIT $1`,
      [limit]
    );
    return results;
  }

  /**
   * Get all reflection memories.
   * @param limit - Maximum number of results
   * @param sessionId - Optional session ID for session isolation (not applicable for reflection memories in PostgreSQL)
   */
  async getReflection(limit: number = 5, sessionId?: string): Promise<ReflectionMemory[]> {
    // PostgreSQL version: reflection memories are global (no session isolation by design)
    // sessionId parameter kept for API compatibility with Qdrant version
    const results = await this.db.query<ReflectionMemory>(
      `SELECT * FROM reflection_memory
       ORDER BY importance DESC
       LIMIT $1`,
      [limit]
    );
    return results;
  }

  /**
   * Add reflection memory.
   */
  async addReflection(summary: string, importance: number = 0.9): Promise<number> {
    const result = await this.db.query<{ id: number }>(
      `INSERT INTO reflection_memory (summary, importance, created_at, access_count)
       VALUES ($1, $2, NOW(), 0)
       RETURNING id`,
      [summary, importance]
    );
    return result[0].id;
  }

  /**
   * Increment access count for a memory.
   */
  async incrementAccess(memoryId: number, type: 'episodic' | 'semantic' | 'reflection'): Promise<void> {
    let table: string;
    if (type === 'episodic') {
      table = 'episodic_memory';
    } else if (type === 'semantic') {
      table = 'semantic_memory';
    } else {
      table = 'reflection_memory';
    }
    await this.db.execute(
      `UPDATE ${table} SET access_count = access_count + 1 WHERE id = $1`,
      [memoryId]
    );
  }

  /**
   * Get memory statistics.
   */
  async getStats(): Promise<{
    episodic_count: number;
    semantic_count: number;
    reflection_count: number;
    embedding_count: number;
  }> {
    const [ep, sm, ref, emb] = await Promise.all([
      this.db.query<{ count: number }>('SELECT COUNT(*) as count FROM episodic_memory'),
      this.db.query<{ count: number }>('SELECT COUNT(*) as count FROM semantic_memory'),
      this.db.query<{ count: number }>('SELECT COUNT(*) as count FROM reflection_memory'),
      this.db.query<{ count: number }>('SELECT COUNT(*) as count FROM memory_embeddings'),
    ]);

    return {
      episodic_count: ep[0]?.count ?? 0,
      semantic_count: sm[0]?.count ?? 0,
      reflection_count: ref[0]?.count ?? 0,
      embedding_count: emb[0]?.count ?? 0,
    };
  }
}

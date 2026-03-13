/**
 * Qdrant Client wrapper
 */

import { QdrantClient } from '@qdrant/js-client-rest';

export interface QdrantConfig {
  url: string;
  port?: number;
  apiKey?: string;
}

const COLLECTION_NAME = 'openclaw_memories';
const VECTOR_SIZE = 1024; // BGE-M3 embedding dimension

export class QdrantDatabase {
  private client: QdrantClient;
  private initialized = false;

  constructor(config: QdrantConfig) {
    this.client = new QdrantClient({
      url: config.url,
      port: config.port,
      apiKey: config.apiKey,
    });
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      // Check if collection exists
      const collections = await this.client.getCollections();
      const exists = collections.collections.some(c => c.name === COLLECTION_NAME);

      if (!exists) {
        // Create collection with HNSW index
        await this.client.createCollection(COLLECTION_NAME, {
          vectors: {
            size: VECTOR_SIZE,
            distance: 'Cosine',
          },
          optimizers_config: {
            default_segment_number: 2,
          },
          hnsw_config: {
            m: 16,
            ef_construct: 100,
          },
        });
        console.log('[Qdrant] Collection created:', COLLECTION_NAME);
      }

      this.initialized = true;
    } catch (error: any) {
      console.error('[Qdrant] Initialization failed:', error.message);
      throw error;
    }
  }

  async upsert(
    id: number,
    embedding: number[],
    payload: Record<string, any>
  ): Promise<void> {
    await this.client.upsert(COLLECTION_NAME, {
      points: [
        {
          id: id,
          vector: embedding,
          payload: {
            ...payload,
            memory_type: payload.type || 'episodic',
          },
        },
      ],
    });
  }

  async search(
    embedding: number[],
    limit: number = 10,
    filter?: Record<string, any>
  ): Promise<Array<{ id: number; score: number; payload: Record<string, any> }>> {
    const result = await this.client.search(COLLECTION_NAME, {
      vector: embedding,
      limit: limit,
      filter: filter ? this.buildFilter(filter) : undefined,
      with_payload: true,
    });

    return result.map(r => ({
      id: r.id as number,
      score: r.score,
      payload: r.payload as Record<string, any>,
    }));
  }

  private buildFilter(filter: Record<string, any>) {
    const conditions: any[] = [];

    if (filter.type) {
      conditions.push({
        key: 'memory_type',
        match: { value: filter.type },
      });
    }

    return conditions.length > 0 ? { must: conditions } : undefined;
  }

  async delete(id: number): Promise<void> {
    await this.client.delete(COLLECTION_NAME, {
      points: [id],
    });
  }

  async count(): Promise<number> {
    const result = await this.client.count(COLLECTION_NAME, {});
    return result.count;
  }

  async getStats(): Promise<{
    total_points: number;
    collection_name: string;
  }> {
    const info = await this.client.getCollection(COLLECTION_NAME);
    return {
      total_points: info.points_count || 0,
      collection_name: COLLECTION_NAME,
    };
  }
}

export const MemoryType = {
  EPISODIC: 'episodic',
  SEMANTIC: 'semantic',
  REFLECTION: 'reflection',
} as const;

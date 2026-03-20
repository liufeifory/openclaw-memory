/**
 * LRU Cache for entity aliases
 * User feedback: M4 cold start optimization - cache frequently used aliases
 */

import { logInfo } from './maintenance-logger.js';

const DEFAULT_CACHE_SIZE = 1000;

interface CacheEntry {
  entityId: string;
  lastAccessed: number;
}

export class AliasCache {
  private cache: Map<string, CacheEntry>;
  private maxSize: number;

  constructor(maxSize: number = DEFAULT_CACHE_SIZE) {
    this.maxSize = maxSize;
    this.cache = new Map();
  }

  /**
   * Get entity ID for an alias
   */
  get(alias: string): string | null {
    const entry = this.cache.get(alias);
    if (!entry) {
      return null;
    }

    // Update last accessed time (for LRU)
    entry.lastAccessed = Date.now();
    this.cache.set(alias, entry);

    return entry.entityId;
  }

  /**
   * Set alias -> entity mapping
   */
  set(alias: string, entityId: string): void {
    // If at capacity, remove least recently used
    if (this.cache.size >= this.maxSize && !this.cache.has(alias)) {
      this.evictLRU();
    }

    this.cache.set(alias, {
      entityId,
      lastAccessed: Date.now(),
    });
  }

  /**
   * Check if alias exists in cache
   */
  has(alias: string): boolean {
    return this.cache.has(alias);
  }

  /**
   * Remove an alias from cache
   */
  delete(alias: string): boolean {
    return this.cache.delete(alias);
  }

  /**
   * Clear entire cache
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get cache size
   */
  get size(): number {
    return this.cache.size;
  }

  /**
   * Evict least recently used entry
   */
  private evictLRU(): void {
    let oldestTime = Infinity;
    let oldestKey: string | null = null;

    for (const [key, entry] of this.cache.entries()) {
      if (entry.lastAccessed < oldestTime) {
        oldestTime = entry.lastAccessed;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey);
      logInfo(`[AliasCache] Evicted LRU entry: ${oldestKey}`);
    }
  }

  /**
   * Batch load aliases from DB (startup warmup)
   * User feedback: M4 cold start optimization - load ALL aliases at startup
   */
  async warmup(db: any, loadAll: boolean = true): Promise<void> {
    if (loadAll) {
      // M4 optimization: load entire alias table into memory at startup
      // Eliminates DB round-trips for high-frequency alias resolution
      logInfo('[AliasCache] Full warmup - loading all aliases into memory...');

      const { ENTITY_ALIAS_TABLE } = await import('./surrealdb-client.js');
      const result = await db.query(`
        SELECT VALUE { alias: alias, entity_id: entity_id } FROM ${ENTITY_ALIAS_TABLE}
      `);

      const data = this.extractResult(result);
      for (const row of (data || [])) {
        this.set(row.alias, this.extractStringId(row.entity_id));
      }

      logInfo(`[AliasCache] Full warmup complete: ${this.cache.size} entries loaded (M4 optimization)`);
    } else {
      // Original behavior: load only verified/manual aliases up to maxSize
      logInfo('[AliasCache] Partial warmup - loading verified/manual aliases...');

      const { ENTITY_ALIAS_TABLE } = await import('./surrealdb-client.js');
      const result = await db.query(`
        SELECT VALUE { alias: alias, entity_id: entity_id } FROM ${ENTITY_ALIAS_TABLE}
        WHERE verified = true OR source = 'manual'
        LIMIT ${this.maxSize}
      `);

      const data = this.extractResult(result);
      for (const row of (data || [])) {
        this.set(row.alias, this.extractStringId(row.entity_id));
      }

      logInfo(`[AliasCache] Partial warmup complete: ${this.cache.size} entries loaded`);
    }
  }

  /**
   * Extract result from SurrealDB query response
   */
  private extractResult(result: any): any[] {
    if (!result) return [];
    if (Array.isArray(result)) {
      if (result.length > 0) {
        if (Array.isArray(result[0])) {
          return result[0] || [];
        } else if ((result as any)[0]?.result) {
          return (result as any)[0].result || [];
        }
      }
    }
    return result.result || [];
  }

  /**
   * Extract string ID from various formats
   */
  private extractStringId(id: any): string {
    if (typeof id === 'string') {
      const parts = id.split(':');
      return parts[parts.length - 1];
    }
    if (typeof id === 'number') {
      return String(id);
    }
    if (id && typeof id === 'object' && id.id !== undefined) {
      return this.extractStringId(id.id);
    }
    return String(id);
  }

  /**
   * Get cache statistics
   */
  getStats(): { size: number; maxSize: number; hitRate?: number } {
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
    };
  }
}

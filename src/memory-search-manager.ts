/**
 * SurrealDB Memory Search Manager
 *
 * Implements the OpenClaw MemorySearchManager interface for SurrealDB backend.
 * This allows OpenClaw status command to recognize our plugin as available.
 */

import { logInfo, logError } from './maintenance-logger.js';
import { SurrealDatabase } from './surrealdb-client.js';
import { EmbeddingService } from './embedding.js';
import { ServiceFactory, getDB, getEmbedding } from './service-factory.js';
import type { PluginConfig } from './config.js';

/**
 * Memory Search Manager interface (matches OpenClaw's expected interface)
 */
export interface MemorySearchManager {
  search(query: string, opts?: any): Promise<any[]>;
  readFile(params: { path: string }): Promise<any>;
  status(): any;
  sync?(params?: any): Promise<void>;
  probeEmbeddingAvailability(): Promise<{ available: boolean; error?: string }>;
  probeVectorAvailability(): Promise<{ available: boolean; error?: string }>;
  close(): Promise<void>;
}

/**
 * SurrealDB Memory Search Manager implementation
 */
export class SurrealMemorySearchManager implements MemorySearchManager {
  private client: SurrealDatabase;
  private embeddingService: EmbeddingService | null = null;
  private config: PluginConfig;
  private initialized: boolean = false;
  private memoryCount: number = 0;

  constructor(config: PluginConfig) {
    this.config = config;

    // Initialize ServiceFactory if not already initialized
    if (!ServiceFactory.isInitialized()) {
      ServiceFactory.init(config);
    }

    // Get DB from factory (single source of truth)
    this.client = getDB();
  }

  /**
   * Initialize the manager (lazy initialization)
   */
  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;

    try {
      // Initialize database
      await ServiceFactory.initDatabase();

      // Get embedding service from factory
      this.embeddingService = getEmbedding();

      // Get memory count (with timeout)
      const countPromise = this.client.query(`
        USE NS ${this.config.surrealdb.namespace} DB ${this.config.surrealdb.database};
        SELECT count() FROM memory GROUP ALL;
      `);
      const countTimeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Count query timeout')), 3000)
      );

      const result = await Promise.race([countPromise, countTimeoutPromise]);
      this.memoryCount = this.extractCount(result);

      this.initialized = true;
      logInfo('[SurrealMemorySearchManager] Initialized');
    } catch (error: any) {
      logError(`[SurrealMemorySearchManager] Failed to initialize: ${error.message}`);
      throw error;
    }
  }

  /**
   * Extract count from SurrealDB result
   */
  private extractCount(result: any): number {
    if (Array.isArray(result)) {
      for (const r of result) {
        if (r.result && Array.isArray(r.result) && r.result[0]?.count !== undefined) {
          return r.result[0].count;
        }
      }
    }
    return 0;
  }

  /**
   * Search memories using vector similarity
   */
  async search(query: string, opts?: any): Promise<any[]> {
    await this.ensureInitialized();

    if (!this.embeddingService) {
      logError('[SurrealMemorySearchManager] No embedding service configured');
      return [];
    }

    const topK = opts?.topK || 10;
    const threshold = opts?.threshold || 0.5;

    try {
      // Generate embedding for query
      const embedding = await this.embeddingService.embed(query, 'query');

      // Use the existing search functionality
      const results = await this.client.search(embedding, topK);
      return results;
    } catch (error: any) {
      logError(`[SurrealMemorySearchManager] Search failed: ${error.message}`);
      return [];
    }
  }

  /**
   * Read a specific memory file (not applicable for SurrealDB)
   */
  async readFile(params: { path: string }): Promise<any> {
    // SurrealDB doesn't use file-based storage
    return { error: 'SurrealDB backend does not support file-based access' };
  }

  /**
   * Get status information for OpenClaw status command
   */
  status(): any {
    return {
      files: 0, // Not applicable for SurrealDB
      chunks: this.memoryCount,
      dirty: false,
      sources: ['surrealdb'],
      vector: {
        available: this.initialized,
        indexed: this.memoryCount,
        total: this.memoryCount,
      },
      fts: {
        available: false, // SurrealDB uses vector search, not FTS
      },
    };
  }

  /**
   * Sync memory index (not needed for SurrealDB)
   */
  async sync(params?: any): Promise<void> {
    // No-op for SurrealDB - it handles its own indexing
    logInfo('[SurrealMemorySearchManager] Sync called (no-op for SurrealDB)');
  }

  /**
   * Probe embedding availability
   */
  async probeEmbeddingAvailability(): Promise<{ available: boolean; error?: string }> {
    const endpoint = this.config.embedding?.endpoint;

    if (!endpoint) {
      return { available: false, error: 'No embedding endpoint configured' };
    }

    try {
      // Try a minimal embedding request to verify the service is working
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      // Add API key if configured
      const apiKey = this.config.embedding?.apiKey;
      if (apiKey) {
        headers['Authorization'] = `Bearer ${apiKey}`;
      }

      // Use a simple embedding request to test the service
      const response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          input: 'test',
          model: this.config.embedding?.model || 'bge-m3-mlx-fp16',
        }),
        signal: AbortSignal.timeout(30000),
      });

      if (response.ok) {
        return { available: true };
      }

      // Handle specific error codes
      if (response.status === 401) {
        return { available: false, error: 'Authentication failed - check API key' };
      }

      return { available: false, error: `Embedding endpoint returned ${response.status}` };
    } catch (error: any) {
      return { available: false, error: error.message };
    }
  }

  /**
   * Probe vector search availability
   */
  async probeVectorAvailability(): Promise<{ available: boolean; error?: string }> {
    logInfo('[SurrealMemorySearchManager] probeVectorAvailability called');

    // For status check, use a simple HTTP query instead of full initialization
    // This avoids the retry delays in the SurrealDatabase client
    try {
      // Build URL from config (convert ws:// to http://)
      const baseUrl = (this.config.surrealdb?.url || 'ws://127.0.0.1:8001/rpc')
        .replace('ws://', 'http://')
        .replace('wss://', 'https://')
        .replace(/\/rpc$/, '');

      const url = `${baseUrl}/sql`;
      logInfo(`[SurrealMemorySearchManager] Probing URL: ${url}`);

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain',
          'Accept': 'application/json',
          'Authorization': 'Basic ' + Buffer.from(`${this.config.surrealdb?.username || 'root'}:${this.config.surrealdb?.password || 'root'}`).toString('base64'),
        },
        body: `USE NS ${this.config.surrealdb?.namespace || 'openclaw'} DB ${this.config.surrealdb?.database || 'memory'}; SELECT count() FROM memory GROUP ALL;`,
      });

      if (!response.ok) {
        logError(`[SurrealMemorySearchManager] probeVectorAvailability: HTTP ${response.status}`);
        return { available: false, error: `HTTP ${response.status}` };
      }

      const result = await response.json();
      this.memoryCount = this.extractCount(result);
      this.initialized = true; // Mark as initialized for subsequent calls

      logInfo(`[SurrealMemorySearchManager] probeVectorAvailability: initialized, count=${this.memoryCount}`);
      return { available: true };
    } catch (error: any) {
      logError(`[SurrealMemorySearchManager] probeVectorAvailability error: ${error.message}`);
      return { available: false, error: error.message };
    }
  }

  /**
   * Close connections
   */
  async close(): Promise<void> {
    logInfo('[SurrealMemorySearchManager] close called');
    try {
      await this.client.close();
    } catch (error: any) {
      logError(`[SurrealMemorySearchManager] Error closing: ${error.message}`);
    }
    this.initialized = false;
    logInfo('[SurrealMemorySearchManager] Closed');
  }
}

/**
 * Get or create a cached SurrealMemorySearchManager
 */
const managerCache = new Map<string, SurrealMemorySearchManager>();

export async function getSurrealMemorySearchManager(config: PluginConfig, agentId?: string): Promise<SurrealMemorySearchManager> {
  const cacheKey = `${config.surrealdb?.url || 'default'}:${agentId || 'default'}`;

  logInfo(`[SurrealMemorySearchManager] Getting manager for cacheKey: ${cacheKey}`);

  let manager = managerCache.get(cacheKey);

  if (!manager) {
    logInfo('[SurrealMemorySearchManager] Creating new manager');
    manager = new SurrealMemorySearchManager(config);
    managerCache.set(cacheKey, manager);
  } else {
    logInfo('[SurrealMemorySearchManager] Returning cached manager');
  }

  return manager;
}

/**
 * Close all cached managers
 */
export async function closeAllSurrealMemorySearchManagers(): Promise<void> {
  for (const manager of managerCache.values()) {
    await manager.close();
  }
  managerCache.clear();
  logInfo('[SurrealMemorySearchManager] All managers closed');
}
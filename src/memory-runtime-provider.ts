/**
 * Memory Runtime Provider for OpenClaw SDK
 *
 * Implements the required interfaces for OpenClaw to recognize
 * this plugin as a valid memory provider.
 */

import { logInfo, logError } from './maintenance-logger.js';
import { getSurrealMemorySearchManager, closeAllSurrealMemorySearchManagers } from './memory-search-manager.js';

/**
 * Memory Backend Configuration
 */
export interface MemoryBackendConfig {
  backend: string;
  citations: 'on' | 'off' | 'auto';
  surrealdb?: {
    url: string;
    namespace: string;
    database: string;
  };
}

/**
 * Memory Prompt Section Builder
 * Returns guidance for memory tools usage
 */
export function buildPromptSection(params: { availableTools: Set<string>; citationsMode?: string }): string[] {
  const { availableTools, citationsMode = 'auto' } = params;
  const hasMemorySearch = availableTools.has('memory_search');

  if (!hasMemorySearch) return [];

  const lines = [
    '## Memory Recall',
    'Before answering questions about prior work, decisions, preferences, or technical details:',
    '- Use memory_search to find relevant memories from the SurrealDB vector store',
    '- Memories include episodic events, semantic knowledge, and reflections',
    '- The system uses semantic similarity to match your query to stored memories',
    '',
  ];

  if (citationsMode === 'off') {
    lines.push('Citations are disabled: do not mention memory IDs in replies unless explicitly asked.');
  } else {
    lines.push('Citations: include memory ID when it helps verify the source of information.');
  }

  lines.push('');
  return lines;
}

/**
 * Memory Flush Plan Builder
 * Returns plan for storing memories during compaction
 */
export function buildMemoryFlushPlan(params: { cfg?: any; nowMs?: number } = {}): {
  softThresholdTokens: number;
  forceFlushTranscriptBytes: number;
  prompt: string;
  systemPrompt: string;
  relativePath: string;
} | null {
  const { nowMs = Date.now() } = params;

  // Memory flush is handled by our background queue processor
  // This returns null to indicate we don't need the built-in flush
  // Our plugin handles memory storage via message_received hook

  const dateStamp = new Date(nowMs).toISOString().slice(0, 10);
  const relativePath = `memory/${dateStamp}.md`;

  return {
    softThresholdTokens: 4000,
    forceFlushTranscriptBytes: 2 * 1024 * 1024,
    prompt: [
      'Pre-compaction memory flush.',
      'Store durable memories to SurrealDB vector store.',
      'Episodic: specific events and conversations',
      'Semantic: facts and knowledge extracted',
      'Reflections: insights and patterns recognized',
      'If nothing significant to store, reply with NO_REPLY.',
    ].join(' '),
    systemPrompt: [
      'Pre-compaction memory flush turn.',
      'The session is near auto-compaction; capture durable memories.',
      'Use the memory storage system to persist important information.',
      'You may reply, but usually NO_REPLY is correct.',
    ].join(' '),
    relativePath,
  };
}

/**
 * Memory Runtime Provider
 * Implements the OpenClaw memory runtime interface
 */
export function createMemoryRuntime(getConfig: () => any) {
  return {
    /**
     * Get memory search manager
     * Returns a manager that implements the OpenClaw MemorySearchManager interface
     */
    async getMemorySearchManager(params: any) {
      logInfo('[MemoryRuntime] getMemorySearchManager called');

      const config = getConfig();
      logInfo(`[MemoryRuntime] config: ${config ? JSON.stringify(config).slice(0, 200) : 'null'}`);

      if (!config) {
        logError('[MemoryRuntime] No configuration available');
        return {
          manager: null,
          error: 'No configuration available',
        };
      }

      try {
        logInfo('[MemoryRuntime] Calling getSurrealMemorySearchManager');
        const manager = await getSurrealMemorySearchManager(config, params.agentId);
        logInfo(`[MemoryRuntime] Manager created: ${manager ? 'success' : 'null'}`);
        return {
          manager,
          error: null,
        };
      } catch (error: any) {
        logError(`[MemoryRuntime] Failed to create manager: ${error.message}`);
        return {
          manager: null,
          error: error.message,
        };
      }
    },

    /**
     * Resolve memory backend configuration
     * Returns configuration for our SurrealDB backend
     */
    resolveMemoryBackendConfig(params: any): MemoryBackendConfig {
      const cfg = getConfig();
      const surrealConfig = cfg?.surrealdb || {};

      logInfo('[MemoryRuntime] resolveMemoryBackendConfig called');

      return {
        backend: 'surrealdb',
        citations: 'auto',
        surrealdb: {
          url: surrealConfig.url || 'ws://127.0.0.1:8001/rpc',
          namespace: surrealConfig.namespace || 'openclaw',
          database: surrealConfig.database || 'memory',
        },
      };
    },

    /**
     * Close all memory search managers
     */
    async closeAllMemorySearchManagers() {
      logInfo('[MemoryRuntime] closeAllMemorySearchManagers called');
      await closeAllSurrealMemorySearchManagers();
    },
  };
}

/**
 * Type for memory runtime
 */
export type MemoryRuntime = ReturnType<typeof createMemoryRuntime>;
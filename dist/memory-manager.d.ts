/**
 * Memory Manager - orchestrates all memory operations.
 */
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
export declare class MemoryManager {
    private db;
    private embedding;
    private memoryStore;
    private contextBuilder;
    constructor(config: MemoryManagerConfig);
    /**
     * Retrieve memories relevant to a query.
     */
    retrieveRelevant(query: string, topK?: number, threshold?: number): Promise<MemoryWithSimilarity[]>;
    /**
     * Build context string for LLM.
     */
    buildContext(sessionId: string, memories: MemoryWithSimilarity[], recentConversation?: string): string;
    /**
     * Store memory asynchronously (non-blocking).
     */
    storeMemory(sessionId: string, content: string, importance?: number): Promise<void>;
    /**
     * Get memory statistics.
     */
    getStats(): Promise<{
        episodic_count: number;
        semantic_count: number;
        reflection_count: number;
        embedding_count: number;
    }>;
    /**
     * Shutdown and cleanup resources.
     */
    shutdown(): Promise<void>;
}
//# sourceMappingURL=memory-manager.d.ts.map
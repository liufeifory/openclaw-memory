/**
 * Memory Manager - orchestrates all memory operations using Qdrant.
 */
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
export declare class MemoryManager {
    private db;
    private embedding;
    private memoryStore;
    private contextBuilder;
    constructor(config: MemoryManagerConfig);
    /**
     * Initialize the memory manager (connect to Qdrant).
     */
    initialize(): Promise<void>;
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
     * Store reflection memory.
     */
    storeReflection(summary: string, importance?: number): Promise<number>;
    /**
     * Get memory statistics.
     */
    getStats(): Promise<{
        episodic_count: number;
        semantic_count: number;
        reflection_count: number;
        total_count: number;
    }>;
    /**
     * Shutdown and cleanup resources.
     */
    shutdown(): Promise<void>;
}
//# sourceMappingURL=memory-manager-qdrant.d.ts.map
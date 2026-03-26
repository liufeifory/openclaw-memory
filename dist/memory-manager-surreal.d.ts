/**
 * Memory Manager - orchestrates all memory operations using SurrealDB.
 */
import { MigrationResult } from './surrealdb-client.js';
import type { MemoryWithSimilarity } from './memory-store-surreal.js';
export interface RetrievalFunnelStats {
    initialCount: number;
    afterTimeDecay: number;
    afterRerank: number;
    afterThreshold: number;
    afterImportance: number;
    finalCount: number;
    avgSimilarity: number;
    avgImportance: number;
    typeDistribution: Record<string, number>;
}
export interface MemoryManagerConfig {
    surrealdb: {
        url: string;
        namespace: string;
        database: string;
        username: string;
        password: string;
    };
    embedding?: {
        endpoint: string;
    };
    llm?: {
        endpoint?: string;
        cloudEnabled?: boolean;
        cloudProvider?: 'bailian' | 'openai' | 'custom';
        cloudBaseUrl?: string;
        cloudApiKey?: string;
        cloudModel?: string;
        cloudTasks?: ('preference' | 'summarizer' | 'clusterer' | 'reranker')[];
    };
}
export declare class MemoryManager {
    private db;
    private embedding;
    private memoryStore;
    private contextBuilder;
    private reranker;
    private conflictDetector;
    private limiter;
    private importanceLearning;
    private clusterer;
    private summarizer;
    private hybridRetriever;
    private entityIndexer;
    private idleClusteringInterval?;
    private activeSessions;
    private sessionBuffers;
    private lastRequestTime;
    private maintenanceHistory;
    constructor(config: MemoryManagerConfig);
    /**
     * Initialize the memory manager (connect to SurrealDB).
     */
    initialize(): Promise<MigrationResult>;
    /**
     * Dispose the memory manager - stop background workers and close DB connection.
     */
    dispose(): Promise<void>;
    /**
     * Load known entities from database into EntityExtractor cache
     */
    private loadKnownEntitiesToCache;
    /**
     * Start idle clustering worker - runs semantic clustering during idle time.
     * Uses unref() to not block process exit.
     */
    private startIdleClusteringWorker;
    /**
     * Track session activity for idle detection.
     */
    trackSessionActivity(sessionId: string): void;
    /**
     * Track session end for idle detection and trigger auto-reflection.
     */
    trackSessionEnd(sessionId: string): Promise<void>;
    /**
     * Add conversation turn to session buffer for later reflection generation.
     */
    addToSessionBuffer(sessionId: string, message: string): void;
    /**
     * Generate reflection memory automatically from session conversation.
     */
    private generateAutoReflection;
    /**
     * Run idle clustering during maintenance window.
     */
    private runIdleClustering;
    /**
     * Run importance decay during maintenance window.
     */
    private runImportanceDecay;
    /**
     * Run TTL pruning - remove entities not accessed in TTL_DAYS.
     * Called weekly during idle maintenance.
     */
    private runTtlPruning;
    /**
     * Retrieve memories relevant to a query using HybridRetriever.
     * Combines vector search + graph traversal + reranking.
     */
    retrieveRelevant(query: string, sessionId: string | undefined, topK?: number, threshold?: number, enableFunnelStats?: boolean): Promise<MemoryWithSimilarity[]>;
    /**
     * Store memory asynchronously.
     */
    storeMemory(sessionId: string, content: string, importance?: number): Promise<void>;
    /**
     * Store semantic memory asynchronously.
     */
    storeSemantic(content: string, importance?: number, sessionId?: string): Promise<void>;
    /**
     * Store semantic memory with conflict detection.
     */
    storeSemanticWithConflictCheck(content: string, importance?: number, similarityThreshold?: number, sessionId?: string): Promise<{
        stored: boolean;
        conflictDetected: boolean;
        supersededId?: number;
    }>;
    /**
     * Store reflection memory.
     */
    storeReflection(summary: string, importance?: number, sessionId?: string): Promise<number>;
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
     * Build context string for LLM.
     */
    buildContext(sessionId: string, memories: MemoryWithSimilarity[], recentConversation?: string): string;
    /**
     * Close the memory manager.
     */
    close(): Promise<void>;
}
//# sourceMappingURL=memory-manager-surreal.d.ts.map
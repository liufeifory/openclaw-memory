/**
 * Memory Manager - orchestrates all memory operations using Qdrant.
 */
import { MigrationResult } from './qdrant-client.js';
import type { MemoryWithSimilarity } from './memory-store-qdrant.js';
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
    private reranker;
    private conflictDetector;
    private limiter;
    private importanceLearning;
    private clusterer;
    private summarizer;
    private idleClusteringInterval?;
    private activeSessions;
    private sessionBuffers;
    private lastRequestTime;
    private maintenanceHistory;
    constructor(config: MemoryManagerConfig);
    /**
     * Initialize the memory manager (connect to Qdrant).
     * @returns Migration result
     */
    initialize(): Promise<MigrationResult>;
    /**
     * Start idle clustering worker - runs semantic clustering during idle time.
     * Task 2.B: Low frequency clustering (idle time) for similarity > 0.9
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
     * Timeout: 2 minutes max to avoid blocking.
     */
    private runIdleClustering;
    /**
     * Run importance decay during maintenance window.
     * Formula: importance *= exp(-λt) where λ = 0.05 (half-life ~14 days)
     * Updates Qdrant payloads with decayed importance values.
     */
    private runImportanceDecay;
    /**
     * Retrieve memories relevant to a query.
     * Uses vector search + reranking + diversity + time decay.
     * @param query - The search query
     * @param sessionId - Optional session ID for session isolation
     * @param topK - Maximum number of results to return
     * @param threshold - Minimum similarity threshold
     * @param enableFunnelStats - Whether to log funnel statistics
     * @returns Relevant memories sorted by combined score
     */
    retrieveRelevant(query: string, sessionId: string | undefined, topK?: number, threshold?: number, enableFunnelStats?: boolean): Promise<MemoryWithSimilarity[]>;
    /**
     * Build context string for LLM.
     */
    buildContext(sessionId: string, memories: MemoryWithSimilarity[], recentConversation?: string): string;
    /**
     * Build hierarchical memory tree for structured context.
     * Level 1: Episodic (specific events)
     * Level 2: Semantic (general facts)
     * Level 3: Reflection (themes/summaries)
     */
    buildMemoryHierarchy(memories: Array<{
        id: number;
        content: string;
        type: string;
        importance: number;
        similarity?: number;
    }>): import('./clusterer.js').HierarchicalMemory[];
    /**
     * Store memory asynchronously (non-blocking).
     * Uses internal queue to avoid blocking the conversation flow.
     */
    storeMemory(sessionId: string, content: string, importance?: number): Promise<void>;
    /**
     * Store semantic memory asynchronously (non-blocking).
     */
    storeSemantic(content: string, importance?: number): Promise<void>;
    /**
     * Store semantic memory with conflict detection.
     * Marks conflicting memories as superseded (not deleted).
     */
    storeSemanticWithConflictCheck(content: string, importance?: number, similarityThreshold?: number): Promise<{
        stored: boolean;
        conflictDetected: boolean;
        supersededId?: number;
    }>;
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
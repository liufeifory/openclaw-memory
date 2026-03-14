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
     * Formula: importance *= exp(-age/30d) - 30 day half-life
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
     * Retrieve memories using hybrid search (BM25 + Vector).
     * @param query - The search query
     * @param sessionId - Optional session ID for session isolation
     * @param topK - Maximum number of results to return
     * @param threshold - Minimum score threshold
     * @param bm25Weight - Weight for BM25 score (0.5 = equal weighting)
     */
    retrieveHybrid(query: string, sessionId: string | undefined, topK?: number, threshold?: number, bm25Weight?: number): Promise<MemoryWithSimilarity[]>;
    /**
     * Retrieve memories using hierarchical search (Reflection -> Semantic -> Episodic).
     * @param query - The search query
     * @param sessionId - Optional session ID for session isolation
     * @param reflectionLimit - Max reflection memories
     * @param semanticLimit - Max semantic memories
     * @param episodicLimit - Max episodic memories
     */
    retrieveHierarchical(query: string, sessionId: string | undefined, reflectionLimit?: number, semanticLimit?: number, episodicLimit?: number): Promise<{
        reflections: MemoryWithSimilarity[];
        semantics: MemoryWithSimilarity[];
        episodic: MemoryWithSimilarity[];
    }>;
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
     * @param content - Memory content
     * @param importance - Importance score
     * @param sessionId - Optional session ID for session isolation
     */
    storeSemantic(content: string, importance?: number, sessionId?: string): Promise<void>;
    /**
     * Store semantic memory with conflict detection.
     * Marks conflicting memories as superseded (not deleted).
     * @param content - Memory content
     * @param importance - Importance score
     * @param similarityThreshold - Similarity threshold for conflict detection
     * @param sessionId - Optional session ID for session isolation
     */
    storeSemanticWithConflictCheck(content: string, importance?: number, similarityThreshold?: number, sessionId?: string): Promise<{
        stored: boolean;
        conflictDetected: boolean;
        supersededId?: number;
    }>;
    /**
     * Store reflection memory.
     * @param summary - Reflection summary
     * @param importance - Importance score
     * @param sessionId - Optional session ID for session isolation
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
     * Shutdown and cleanup resources.
     */
    shutdown(): Promise<void>;
    /**
     * List recent memories (for CLI usage).
     */
    listMemories(limit?: number): Promise<{
        points: Array<{
            id: number;
            payload: Record<string, any>;
        }>;
    }>;
    /**
     * Delete memories by IDs (for CLI usage).
     */
    deleteMemories(ids: number[]): Promise<void>;
    /**
     * Clear all memories (for CLI usage).
     */
    clearAllMemories(): Promise<void>;
    /**
     * Get collection stats (for CLI usage).
     */
    getCollectionStats(): Promise<{
        points_count: number;
        indexed_vectors_count: number;
        segments_count: number;
        status: string;
        payload_schema?: Record<string, any>;
    }>;
}
//# sourceMappingURL=memory-manager-qdrant.d.ts.map
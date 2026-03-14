/**
 * Conversation Summarizer using Llama-3.2-1B-Instruct
 *
 * Compresses multiple conversation turns into concise summaries.
 * Features:
 * - Token compression ratio monitoring
 * - Alerts for over-compression (ratio < 0.1) and under-compression (ratio > 0.9)
 */
import { LLMLimiter } from './llm-limiter.js';
export interface SummaryResult {
    summary: string;
    isEmpty: boolean;
    compressionRatio?: number;
    compressionQuality?: 'good' | 'over-compressed' | 'under-compressed';
}
export declare class Summarizer {
    private endpoint;
    private limiter;
    private stats;
    constructor(endpoint?: string, limiter?: LLMLimiter);
    /**
     * Get summarizer statistics.
     */
    getStats(): typeof this.stats;
    /**
     * Estimate token count (simple heuristic: ~4 chars per token).
     */
    private estimateTokens;
    /**
     * Calculate compression ratio and quality.
     */
    private calculateCompressionRatio;
    /**
     * Summarize a list of messages into a concise fact.
     * @param messages - Array of message strings
     * @returns Summary result
     */
    summarize(messages: string[]): Promise<SummaryResult>;
    /**
     * Batch summarize multiple message groups (for bulk processing).
     */
    batchSummarize(messageGroups: string[][], concurrency?: number): Promise<SummaryResult[]>;
}
//# sourceMappingURL=summarizer.d.ts.map
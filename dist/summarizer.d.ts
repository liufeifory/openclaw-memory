/**
 * Conversation Summarizer using Llama-3.2-1B-Instruct
 *
 * Compresses multiple conversation turns into concise summaries.
 */
import { LLMLimiter } from './llm-limiter.js';
export interface SummaryResult {
    summary: string;
    isEmpty: boolean;
}
export declare class Summarizer {
    private endpoint;
    private limiter;
    constructor(endpoint?: string, limiter?: LLMLimiter);
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
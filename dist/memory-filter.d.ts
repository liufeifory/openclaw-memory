/**
 * Memory Filter using LLM
 *
 * Classifies user messages and determines storage importance.
 * Uses local 7B model by default (high-frequency task).
 */
import { LLMLimiter } from './llm-limiter.js';
import { LLMClient } from './llm-client.js';
export interface FilterResult {
    category: 'TRIVIAL' | 'FACT' | 'PREFERENCE' | 'EVENT' | 'QUESTION';
    importance: number;
    reason: string;
    shouldStore: boolean;
    memoryType?: 'episodic' | 'semantic';
}
export declare class MemoryFilter {
    private client;
    private limiter;
    constructor(client: LLMClient, limiter?: LLMLimiter);
    /**
     * Classify message and determine if it should be stored.
     */
    classify(message: string): Promise<FilterResult>;
    /**
     * Fallback classification using simple rules.
     */
    private fallbackClassify;
}
//# sourceMappingURL=memory-filter.d.ts.map
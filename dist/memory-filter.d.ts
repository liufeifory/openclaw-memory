/**
 * Memory Filter using Llama-3.2-1B-Instruct
 *
 * Classifies user messages and determines storage importance.
 *
 * Categories:
 * - TRIVIAL: Greetings, thanks, acknowledgments (don't store)
 * - FACT: Factual information about user (store as semantic, importance 0.7-0.9)
 * - PREFERENCE: User likes/dislikes (store as semantic, importance 0.7-0.9)
 * - EVENT: Something that happened (store as episodic, importance 0.5-0.8)
 * - QUESTION: User asking something (don't store, importance 0.3)
 */
export interface FilterResult {
    category: 'TRIVIAL' | 'FACT' | 'PREFERENCE' | 'EVENT' | 'QUESTION';
    importance: number;
    reason: string;
    shouldStore: boolean;
    memoryType?: 'episodic' | 'semantic';
}
export declare class MemoryFilter {
    private endpoint;
    constructor(endpoint?: string);
    /**
     * Classify message and determine if it should be stored.
     */
    classify(message: string): Promise<FilterResult>;
    /**
     * Parse JSON response from LLM.
     */
    private parseJsonResponse;
    /**
     * Fallback classification using simple rules.
     */
    private fallbackClassify;
}
//# sourceMappingURL=memory-filter.d.ts.map
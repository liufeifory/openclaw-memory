/**
 * Preference Extractor using LLM
 *
 * Extracts structured user preferences from conversation.
 * Uses cloud model when configured (high-quality task).
 */
import { LLMLimiter } from './llm-limiter.js';
export interface UserProfile {
    likes: string[];
    dislikes: string[];
    facts: {
        work?: string;
        location?: string;
        skills?: string[];
        [key: string]: string | string[] | undefined;
    };
    habits: string[];
}
export declare class PreferenceExtractor {
    private client;
    private limiter;
    constructor(limiter?: LLMLimiter);
    /**
     * Extract user profile from conversation.
     */
    extract(conversation: string[]): Promise<UserProfile>;
}
//# sourceMappingURL=preference-extractor.d.ts.map
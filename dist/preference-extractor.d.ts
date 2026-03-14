/**
 * Preference Extractor using Llama-3.2-1B-Instruct
 *
 * Extracts structured user preferences from conversation.
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
    private endpoint;
    private limiter;
    constructor(endpoint?: string, limiter?: LLMLimiter);
    /**
     * Extract user profile from conversation.
     */
    extract(conversation: string[]): Promise<UserProfile>;
    /**
     * Parse JSON user profile from LLM output.
     */
    private parseUserProfile;
}
//# sourceMappingURL=preference-extractor.d.ts.map
/**
 * Preference Extractor using LLM
 *
 * Extracts structured user preferences from conversation.
 * Uses cloud model when configured (high-quality task).
 */
import { logError } from './maintenance-logger.js';
import { LLMLimiter } from './llm-limiter.js';
const EXTRACT_PROMPT = `Extract user preferences, facts, and profile information from the conversation.

Output JSON format:
{
  "likes": ["thing1", "thing2"],
  "dislikes": ["thing1"],
  "facts": {
    "work": "job title",
    "location": "city",
    "skills": ["skill1", "skill2"]
  },
  "habits": ["habit1", "habit2"]
}

If no information found, use empty arrays/objects.

Conversation:
{{conversation}}

JSON:`;
export class PreferenceExtractor {
    client;
    limiter;
    constructor(client, limiter) {
        this.client = client;
        this.limiter = limiter ?? new LLMLimiter({ maxConcurrent: 2, minInterval: 100 });
    }
    /**
     * Extract user profile from conversation.
     */
    async extract(conversation) {
        const prompt = EXTRACT_PROMPT.replace('{{conversation}}', conversation.slice(-20).join('\n') // Last 20 messages
        );
        try {
            const result = await this.limiter.execute(async () => {
                return await this.client.completeJson(prompt, 'preference-extractor', { temperature: 0.3, maxTokens: 500 });
            });
            return {
                likes: Array.isArray(result.likes) ? result.likes : [],
                dislikes: Array.isArray(result.dislikes) ? result.dislikes : [],
                facts: result.facts || {},
                habits: Array.isArray(result.habits) ? result.habits : [],
            };
        }
        catch (error) {
            logError(`[PreferenceExtractor] LLM failed: ${error.message}`);
            return {
                likes: [],
                dislikes: [],
                facts: {},
                habits: [],
            };
        }
    }
}
//# sourceMappingURL=preference-extractor.js.map
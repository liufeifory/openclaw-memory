/**
 * Preference Extractor using LLM
 *
 * Extracts structured user preferences from conversation.
 * Uses cloud model when configured (high-quality task).
 */

import { logError } from './maintenance-logger.js';
import { LLMLimiter } from './llm-limiter.js';
import { LLMClient } from './llm-client.js';

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

export class PreferenceExtractor {
  private client: LLMClient;
  private limiter: LLMLimiter;

  constructor(client: LLMClient, limiter?: LLMLimiter) {
    this.client = client;
    this.limiter = limiter ?? new LLMLimiter({ maxConcurrent: 2, minInterval: 100 });
  }

  /**
   * Extract user profile from conversation.
   */
  async extract(conversation: string[]): Promise<UserProfile> {
    const prompt = EXTRACT_PROMPT.replace(
      '{{conversation}}',
      conversation.slice(-20).join('\n')  // Last 20 messages
    );

    try {
      const result = await this.limiter.execute(async () => {
        return await this.client.completeJson<UserProfile>(
          prompt,
          'preference-extractor',
          { temperature: 0.3, maxTokens: 500 }
        );
      });

      return {
        likes: Array.isArray(result.likes) ? result.likes : [],
        dislikes: Array.isArray(result.dislikes) ? result.dislikes : [],
        facts: result.facts || {},
        habits: Array.isArray(result.habits) ? result.habits : [],
      };
    } catch (error: any) {
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

/**
 * Preference Extractor using Llama-3.2-1B-Instruct
 *
 * Extracts structured user preferences from conversation.
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
  private endpoint: string;
  private limiter: LLMLimiter;

  constructor(endpoint: string = 'http://localhost:8081', limiter?: LLMLimiter) {
    this.endpoint = endpoint;
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
        const response = await fetch(`${this.endpoint}/completion`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: prompt,
            n_predict: 500,
            temperature: 0.3,
            top_p: 0.9,
          }),
        });
        return await response.json();
      }) as any;

      const output = (result.content || result.generated_text || '').trim();

      return this.parseUserProfile(output);
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

  /**
   * Parse JSON user profile from LLM output.
   */
  private parseUserProfile(output: string): UserProfile {
    const jsonMatch = output.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          likes: Array.isArray(parsed.likes) ? parsed.likes : [],
          dislikes: Array.isArray(parsed.dislikes) ? parsed.dislikes : [],
          facts: parsed.facts || {},
          habits: Array.isArray(parsed.habits) ? parsed.habits : [],
        };
      } catch {
        // Fall through to default
      }
    }

    return {
      likes: [],
      dislikes: [],
      facts: {},
      habits: [],
    };
  }
}

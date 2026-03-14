/**
 * Preference Extractor using Llama-3.2-1B-Instruct
 *
 * Extracts structured user preferences from conversation.
 */
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
    endpoint;
    constructor(endpoint = 'http://localhost:8081') {
        this.endpoint = endpoint;
    }
    /**
     * Extract user profile from conversation.
     */
    async extract(conversation) {
        const prompt = EXTRACT_PROMPT.replace('{{conversation}}', conversation.slice(-20).join('\n') // Last 20 messages
        );
        try {
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
            const result = await response.json();
            const output = (result.content || result.generated_text || '').trim();
            return this.parseUserProfile(output);
        }
        catch (error) {
            console.error('[PreferenceExtractor] LLM failed:', error.message);
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
    parseUserProfile(output) {
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
            }
            catch {
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
//# sourceMappingURL=preference-extractor.js.map
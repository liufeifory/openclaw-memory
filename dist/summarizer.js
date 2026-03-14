/**
 * Conversation Summarizer using Llama-3.2-1B-Instruct
 *
 * Compresses multiple conversation turns into concise summaries.
 */
const SUMMARIZE_PROMPT = `Summarize these conversation turns into ONE concise fact or observation.
Focus on:
- User preferences mentioned
- Factual information about the user
- Important events

Keep it under 30 words. If nothing important, output "No significant content."

Conversation:
{{messages}}

Summary:`;
export class Summarizer {
    endpoint;
    constructor(endpoint = 'http://localhost:8081') {
        this.endpoint = endpoint;
    }
    /**
     * Summarize a list of messages into a concise fact.
     * @param messages - Array of message strings
     * @returns Summary result
     */
    async summarize(messages) {
        if (messages.length === 0) {
            return { summary: '', isEmpty: true };
        }
        const messagesText = messages.slice(-20).join('\n'); // Last 20 messages
        const prompt = SUMMARIZE_PROMPT.replace('{{messages}}', messagesText);
        try {
            const response = await fetch(`${this.endpoint}/completion`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    prompt: prompt,
                    n_predict: 100,
                    temperature: 0.3,
                    top_p: 0.9,
                }),
            });
            const result = await response.json();
            const output = (result.content || result.generated_text || '').trim();
            const isEmpty = output.toLowerCase().includes('no significant content');
            return {
                summary: isEmpty ? '' : output,
                isEmpty,
            };
        }
        catch (error) {
            console.error('[Summarizer] LLM failed:', error.message);
            return { summary: '', isEmpty: true };
        }
    }
    /**
     * Batch summarize multiple message groups (for bulk processing).
     */
    async batchSummarize(messageGroups, concurrency = 3) {
        const results = [];
        // Process in batches to avoid overwhelming the model
        for (let i = 0; i < messageGroups.length; i += concurrency) {
            const batch = messageGroups.slice(i, i + concurrency);
            const batchResults = await Promise.all(batch.map(group => this.summarize(group)));
            results.push(...batchResults);
        }
        return results;
    }
}
//# sourceMappingURL=summarizer.js.map
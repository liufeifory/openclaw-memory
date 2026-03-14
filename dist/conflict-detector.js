/**
 * Conflict Detector using Llama-3.2-1B-Instruct
 *
 * Detects contradictory memories and marks old ones with superseded_by tag.
 */
import { LLMLimiter } from './llm-limiter.js';
const CONFLICT_PROMPT = `Do these two statements contradict each other?
Consider:
- Preference changes (like red -> like blue) = YES
- Fact updates (work at A -> work at B) = YES
- Compatible additions (like coffee + like tea) = NO
- General + specific (like fruit -> like apples) = NO

Output ONLY: YES or NO

Statement A: "{{old}}"
Statement B: "{{new}}"

Answer:`;
export class ConflictDetector {
    endpoint;
    limiter;
    constructor(endpoint = 'http://localhost:8081', limiter) {
        this.endpoint = endpoint;
        this.limiter = limiter ?? new LLMLimiter({ maxConcurrent: 2, minInterval: 100 });
    }
    /**
     * Check if new content conflicts with existing memories.
     * @param newContent - The new memory content
     * @param similarMemories - Memories with high vector similarity
     * @param storeMemory - Optional function to store/update memory metadata
     * @returns Conflict detection result
     */
    async detectConflict(newContent, similarMemories, storeMemory) {
        if (similarMemories.length === 0) {
            return { isConflict: false, reason: 'no similar memories' };
        }
        // Check each similar memory for conflict
        for (const memory of similarMemories) {
            const isConflict = await this.checkPairwise(newContent, memory.content);
            if (isConflict) {
                // Mark old memory as superseded (not deleted, just tagged)
                if (storeMemory) {
                    await storeMemory(memory.id, { superseded_by: -1, is_active: false });
                }
                return {
                    isConflict: true,
                    oldMemoryId: memory.id,
                    reason: `conflicts with memory ${memory.id}: "${memory.content.substring(0, 50)}..."`,
                    supersededBy: memory.id,
                };
            }
        }
        return { isConflict: false, reason: 'no conflicts found' };
    }
    /**
     * Check pairwise conflict between two statements.
     */
    async checkPairwise(oldStatement, newStatement) {
        const prompt = CONFLICT_PROMPT
            .replace('{{old}}', oldStatement)
            .replace('{{new}}', newStatement);
        try {
            const result = await this.limiter.execute(async () => {
                const response = await fetch(`${this.endpoint}/completion`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        prompt: prompt,
                        n_predict: 10,
                        temperature: 0.1,
                        top_p: 0.9,
                    }),
                });
                return await response.json();
            });
            const output = (result.content || result.generated_text || '').trim().toUpperCase();
            return output.includes('YES');
        }
        catch (error) {
            console.error('[ConflictDetector] LLM failed:', error.message);
            // Fallback: conservative, assume no conflict
            return false;
        }
    }
}
//# sourceMappingURL=conflict-detector.js.map
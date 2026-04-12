/* eslint-disable @typescript-eslint/no-explicit-any -- Database query returns have flexible SurrealDB formats */
/**
 * Conflict Detector using LLM
 *
 * Detects contradictory memories and marks old ones with superseded_by tag.
 * Uses local 7B model by default (high-frequency task).
 */
import { logError } from './maintenance-logger.js';
import { LLMLimiter } from './llm-limiter.js';
const CONFLICT_PROMPT = `Analyze if Statement B contradicts Statement A.

A conflict exists when:
- Preference change: "like X" -> "like Y" where X and Y are alternatives (red vs blue, React vs Vue)
- Fact update: "works at X" -> "works at Y" (different companies, locations)
- Mutually exclusive: "only eats X" -> "only eats Y"

NO conflict when:
- Compatible additions: "likes X" + "likes Y" (both can be true)
- Subset/superset: "likes fruits" + "likes apples" (compatible)
- Different topics: "likes coffee" + "speaks French" (unrelated)

Output ONLY: YES (conflict) or NO (no conflict)

Statement A: "{{old}}"
Statement B: "{{new}}"

Answer:`;
export class ConflictDetector {
    client;
    limiter;
    constructor(client, limiter) {
        this.client = client;
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
     * Uses LLM for semantic analysis with keyword-based fallback.
     */
    async checkPairwise(oldStatement, newStatement) {
        const prompt = CONFLICT_PROMPT
            .replace('{{old}}', oldStatement)
            .replace('{{new}}', newStatement);
        try {
            const output = await this.limiter.execute(async () => {
                return await this.client.complete(prompt, 'conflict-detector', { temperature: 0.3, maxTokens: 10 });
            });
            const llmResult = output.toUpperCase().includes('YES');
            // Fallback: keyword-based conflict detection for common patterns
            if (!llmResult) {
                const keywordConflict = this.checkKeywordConflict(oldStatement, newStatement);
                return keywordConflict;
            }
            return llmResult;
        }
        catch (error) {
            logError(`[ConflictDetector] LLM failed: ${error.message}`);
            // Fallback: keyword-based detection
            return this.checkKeywordConflict(oldStatement, newStatement);
        }
    }
    /**
     * Keyword-based fallback conflict detection.
     */
    checkKeywordConflict(oldStmt, newStmt) {
        const oldLower = oldStmt.toLowerCase();
        const newLower = newStmt.toLowerCase();
        // Pattern 1: "works at X" -> "works at Y" (different companies)
        // Use separate regex instances to avoid state issues
        const oldWorkRegex = /works?\s*(at|for)\s+([a-z][\w.]*)/gi;
        const newWorkRegex = /works?\s*(at|for)\s+([a-z][\w.]*)/gi;
        const oldWork = oldWorkRegex.exec(oldLower);
        const newWork = newWorkRegex.exec(newLower);
        if (oldWork && newWork && oldWork[2] !== newWork[2]) {
            return true;
        }
        // Pattern 2: "prefers X for" / "likes X" - extract the object
        const oldPrefRegex = /(prefers?|likes?)\s+([a-z][\w.]*)\s*(?:for)?/gi;
        const newPrefRegex = /(prefers?|likes?)\s+([a-z][\w.]*)\s*(?:for)?/gi;
        const oldPref = oldPrefRegex.exec(oldLower);
        const newPref = newPrefRegex.exec(newLower);
        // Check if same verb but different object (potential conflict)
        if (oldPref && newPref && oldPref[1] === newPref[1] && oldPref[2] !== newPref[2]) {
            // Check if both are in common conflict categories
            const conflictCategories = [
                ['react', 'vue', 'angular', 'svelte'], // Frontend frameworks
                ['red', 'blue', 'green', 'black', 'white', 'yellow', 'purple'], // Colors
                ['typescript', 'javascript', 'python', 'rust', 'go', 'java'], // Languages
            ];
            for (const category of conflictCategories) {
                if (category.includes(oldPref[2]) && category.includes(newPref[2])) {
                    return true;
                }
            }
        }
        return false;
    }
}
//# sourceMappingURL=conflict-detector.js.map
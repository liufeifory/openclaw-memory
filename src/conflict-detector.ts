/**
 * Conflict Detector using Llama-3.2-1B-Instruct
 *
 * Detects contradictory memories and marks old ones as deprecated.
 */

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

export interface ConflictResult {
  isConflict: boolean;
  oldMemoryId?: number;
  reason: string;
}

export class ConflictDetector {
  private endpoint: string;

  constructor(endpoint: string = 'http://localhost:8081') {
    this.endpoint = endpoint;
  }

  /**
   * Check if new content conflicts with existing memories.
   * @param newContent - The new memory content
   * @param similarMemories - Memories with high vector similarity
   * @returns Conflict detection result
   */
  async detectConflict(
    newContent: string,
    similarMemories: Array<{ id: number; content: string; type: string }>
  ): Promise<ConflictResult> {
    if (similarMemories.length === 0) {
      return { isConflict: false, reason: 'no similar memories' };
    }

    // Check each similar memory for conflict
    for (const memory of similarMemories) {
      const isConflict = await this.checkPairwise(newContent, memory.content);

      if (isConflict) {
        return {
          isConflict: true,
          oldMemoryId: memory.id,
          reason: `conflicts with memory ${memory.id}: "${memory.content.substring(0, 50)}..."`,
        };
      }
    }

    return { isConflict: false, reason: 'no conflicts found' };
  }

  /**
   * Check pairwise conflict between two statements.
   */
  private async checkPairwise(oldStatement: string, newStatement: string): Promise<boolean> {
    const prompt = CONFLICT_PROMPT
      .replace('{{old}}', oldStatement)
      .replace('{{new}}', newStatement);

    try {
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

      const result: any = await response.json();
      const output = (result.content || result.generated_text || '').trim().toUpperCase();

      return output.includes('YES');
    } catch (error: any) {
      console.error('[ConflictDetector] LLM failed:', error.message);
      // Fallback: conservative, assume no conflict
      return false;
    }
  }
}

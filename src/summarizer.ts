/**
 * Conversation Summarizer using Llama-3.2-1B-Instruct
 *
 * Compresses multiple conversation turns into concise summaries.
 * Features:
 * - Token compression ratio monitoring
 * - Alerts for over-compression (ratio < 0.1) and under-compression (ratio > 0.9)
 */

import { LLMLimiter } from './llm-limiter.js';

const SUMMARIZE_PROMPT = `Summarize these conversation turns into ONE concise fact or observation.
Focus on:
- User preferences mentioned
- Factual information about the user
- Important events

Keep it under 30 words. If nothing important, output "No significant content."

Conversation:
{{messages}}

Summary:`;

// Token compression ratio thresholds
const MIN_COMPRESSION_RATIO = 0.1;  // Alert if < 0.1 (over-compression, info loss)
const MAX_COMPRESSION_RATIO = 0.9;  // Alert if > 0.9 (under-compression, not summarizing)

export interface SummaryResult {
  summary: string;
  isEmpty: boolean;
  compressionRatio?: number;  // Added: tokens out / tokens in
  compressionQuality?: 'good' | 'over-compressed' | 'under-compressed';
}

export class Summarizer {
  private endpoint: string;
  private limiter: LLMLimiter;
  private stats = {
    totalSummaries: 0,
    avgCompressionRatio: 0,
    overCompressionCount: 0,
    underCompressionCount: 0,
  };

  constructor(endpoint: string = 'http://localhost:8081', limiter?: LLMLimiter) {
    this.endpoint = endpoint;
    this.limiter = limiter ?? new LLMLimiter({ maxConcurrent: 2, minInterval: 100 });
  }

  /**
   * Get summarizer statistics.
   */
  getStats(): typeof this.stats {
    return { ...this.stats };
  }

  /**
   * Estimate token count (simple heuristic: ~4 chars per token).
   */
  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  /**
   * Calculate compression ratio and quality.
   */
  private calculateCompressionRatio(input: string, output: string): {
    ratio: number;
    quality: 'good' | 'over-compressed' | 'under-compressed';
  } {
    const inputTokens = this.estimateTokens(input);
    const outputTokens = this.estimateTokens(output);
    const ratio = inputTokens > 0 ? outputTokens / inputTokens : 1;

    let quality: 'good' | 'over-compressed' | 'under-compressed';
    if (ratio < MIN_COMPRESSION_RATIO) {
      quality = 'over-compressed';
    } else if (ratio > MAX_COMPRESSION_RATIO) {
      quality = 'under-compressed';
    } else {
      quality = 'good';
    }

    return { ratio, quality };
  }

  /**
   * Summarize a list of messages into a concise fact.
   * @param messages - Array of message strings
   * @returns Summary result
   */
  async summarize(messages: string[]): Promise<SummaryResult> {
    if (messages.length === 0) {
      return { summary: '', isEmpty: true };
    }

    const messagesText = messages.slice(-20).join('\n');  // Last 20 messages
    const prompt = SUMMARIZE_PROMPT.replace('{{messages}}', messagesText);

    try {
      const result = await this.limiter.execute(async () => {
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
        return await response.json();
      }) as any;

      const output = (result.content || result.generated_text || '').trim();

      // Guard: empty output from LLM
      if (!output || output.length === 0) {
        console.warn('[Summarizer] LLM returned empty output');
        return { summary: '', isEmpty: true };
      }

      const isEmpty = output.toLowerCase().includes('no significant content');

      // Calculate compression ratio
      const { ratio, quality } = this.calculateCompressionRatio(messagesText, output);

      // Update statistics
      this.stats.totalSummaries++;
      this.stats.avgCompressionRatio =
        (this.stats.avgCompressionRatio * (this.stats.totalSummaries - 1) + ratio) /
        this.stats.totalSummaries;

      if (quality === 'over-compressed') {
        this.stats.overCompressionCount++;
        console.warn(`[Summarizer] Over-compression detected (ratio: ${ratio.toFixed(3)}): "${output.substring(0, 50)}..."`);
      } else if (quality === 'under-compressed') {
        this.stats.underCompressionCount++;
        console.warn(`[Summarizer] Under-compression detected (ratio: ${ratio.toFixed(3)}): "${output.substring(0, 50)}..."`);
      }

      return {
        summary: isEmpty ? '' : output,
        isEmpty,
        compressionRatio: ratio,
        compressionQuality: quality,
      };
    } catch (error: any) {
      console.error('[Summarizer] LLM failed:', error.message);
      return { summary: '', isEmpty: true };
    }
  }

  /**
   * Batch summarize multiple message groups (for bulk processing).
   */
  async batchSummarize(
    messageGroups: string[][],
    concurrency: number = 3
  ): Promise<SummaryResult[]> {
    const results: SummaryResult[] = [];

    // Process in batches to avoid overwhelming the model
    for (let i = 0; i < messageGroups.length; i += concurrency) {
      const batch = messageGroups.slice(i, i + concurrency);
      const batchResults = await Promise.all(
        batch.map(group => this.summarize(group))
      );
      results.push(...batchResults);
    }

    return results;
  }
}

/**
 * Conversation Summarizer using LLM
 *
 * Compresses multiple conversation turns into concise summaries.
 * Uses cloud model when configured (high-quality task).
 * Features:
 * - Token compression ratio monitoring
 * - Alerts for over-compression (ratio < 0.1) and under-compression (ratio > 0.9)
 */
import { logWarn, logError } from './maintenance-logger.js';
import { LLMLimiter } from './llm-limiter.js';
import { ServiceFactory } from './service-factory.js';
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
const MIN_COMPRESSION_RATIO = 0.1; // Alert if < 0.1 (over-compression, info loss)
const MAX_COMPRESSION_RATIO = 0.9; // Alert if > 0.9 (under-compression, not summarizing)
export class Summarizer {
    client;
    limiter;
    stats = {
        totalSummaries: 0,
        avgCompressionRatio: 0,
        overCompressionCount: 0,
        underCompressionCount: 0,
    };
    constructor(limiter) {
        // 统一从 ServiceFactory 获取 LLMClient（单一入口）
        this.client = ServiceFactory.getLLM();
        this.limiter = limiter ?? new LLMLimiter({ maxConcurrent: 2, minInterval: 100 });
    }
    /**
     * Get summarizer statistics.
     */
    getStats() {
        return { ...this.stats };
    }
    /**
     * Estimate token count (simple heuristic: ~4 chars per token).
     */
    estimateTokens(text) {
        return Math.ceil(text.length / 4);
    }
    /**
     * Calculate compression ratio and quality.
     */
    calculateCompressionRatio(input, output) {
        const inputTokens = this.estimateTokens(input);
        const outputTokens = this.estimateTokens(output);
        const ratio = inputTokens > 0 ? outputTokens / inputTokens : 1;
        let quality;
        if (ratio < MIN_COMPRESSION_RATIO) {
            quality = 'over-compressed';
        }
        else if (ratio > MAX_COMPRESSION_RATIO) {
            quality = 'under-compressed';
        }
        else {
            quality = 'good';
        }
        return { ratio, quality };
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
            const output = await this.limiter.execute(async () => {
                return await this.client.complete(prompt, 'summarizer', { temperature: 0.3, maxTokens: 100 });
            });
            // Guard: empty output from LLM
            if (!output || output.length === 0) {
                logWarn('[Summarizer] LLM returned empty output');
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
                logWarn(`[Summarizer] Over-compression detected (ratio: ${ratio.toFixed(3)}): "${output.substring(0, 50)}..."`);
            }
            else if (quality === 'under-compressed') {
                this.stats.underCompressionCount++;
                logWarn(`[Summarizer] Under-compression detected (ratio: ${ratio.toFixed(3)}): "${output.substring(0, 50)}..."`);
            }
            return {
                summary: isEmpty ? '' : output,
                isEmpty,
                compressionRatio: ratio,
                compressionQuality: quality,
            };
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            logError(`[Summarizer] LLM failed: ${errorMessage}`);
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
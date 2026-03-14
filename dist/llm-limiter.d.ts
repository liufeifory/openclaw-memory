/**
 * LLM Request Rate Limiter
 *
 * Prevents overwhelming the local LLM server with too many concurrent requests.
 * Uses a token bucket algorithm with request queue.
 */
export interface RateLimiterConfig {
    maxConcurrent: number;
    minInterval?: number;
    queueLimit?: number;
}
export declare class LLMLimiter {
    private maxConcurrent;
    private minInterval;
    private queueLimit;
    private running;
    private queue;
    private lastRequestTime;
    constructor(config: RateLimiterConfig);
    /**
     * Execute a request through the rate limiter.
     */
    execute<T>(executeFn: () => Promise<T>): Promise<T>;
    /**
     * Process the request queue.
     */
    private processQueue;
    /**
     * Get current stats.
     */
    getStats(): {
        running: number;
        queued: number;
        available: number;
    };
    /**
     * Clear the queue (cancel pending requests).
     */
    clear(): void;
}
/**
 * Get or create the global LLM limiter.
 */
export declare function getGlobalLimiter(config?: RateLimiterConfig): LLMLimiter;
//# sourceMappingURL=llm-limiter.d.ts.map
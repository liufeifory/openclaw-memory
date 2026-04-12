/* eslint-disable @typescript-eslint/no-explicit-any -- Task queue uses dynamic types */
/**
 * LLM Request Rate Limiter
 *
 * Prevents overwhelming the local LLM server with too many concurrent requests.
 * Uses a token bucket algorithm with request queue.
 */

export interface RateLimiterConfig {
  maxConcurrent: number;      // Max concurrent requests
  minInterval?: number;       // Min interval between requests (ms)
  queueLimit?: number;        // Max queued requests
}

interface QueuedRequest {
  execute: () => Promise<any>;
  resolve: (result: any) => void;
  reject: (error: Error) => void;
  addedAt: number;
}

export class LLMLimiter {
  private maxConcurrent: number;
  private minInterval: number;
  private queueLimit: number;
  private running = 0;
  private queue: QueuedRequest[] = [];
  private lastRequestTime = 0;

  constructor(config: RateLimiterConfig) {
    this.maxConcurrent = config.maxConcurrent;
    this.minInterval = config.minInterval ?? 100;  // 100ms default
    this.queueLimit = config.queueLimit ?? 50;
  }

  /**
   * Execute a request through the rate limiter.
   */
  async execute<T>(executeFn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      // Check queue limit
      if (this.queue.length >= this.queueLimit) {
        reject(new Error('Request queue full'));
        return;
      }

      // Add to queue
      this.queue.push({
        execute: executeFn,
        resolve,
        reject,
        addedAt: Date.now(),
      });

      // Process queue
      this.processQueue();
    });
  }

  /**
   * Process the request queue.
   */
  private async processQueue(): Promise<void> {
    // Already processing
    if (this.running >= this.maxConcurrent) {
      return;
    }

    // Queue empty
    if (this.queue.length === 0) {
      return;
    }

    // Check min interval
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    if (timeSinceLastRequest < this.minInterval) {
      const timer = setTimeout(() => this.processQueue(), this.minInterval - timeSinceLastRequest);
      timer.unref();
      return;
    }

    // Get next request from queue
    const request = this.queue.shift();
    if (!request) return;

    this.running++;
    this.lastRequestTime = now;

    try {
      const result = await request.execute();
      request.resolve(result);
    } catch (error: any) {
      request.reject(error);
    } finally {
      this.running--;
      // Process next request
      const timer = setTimeout(() => this.processQueue(), this.minInterval);
      timer.unref();
    }
  }

  /**
   * Get current stats.
   */
  getStats(): {
    running: number;
    queued: number;
    available: number;
  } {
    return {
      running: this.running,
      queued: this.queue.length,
      available: this.maxConcurrent - this.running,
    };
  }

  /**
   * Clear the queue (cancel pending requests).
   */
  clear(): void {
    for (const request of this.queue) {
      request.reject(new Error('Request cancelled'));
    }
    this.queue = [];
  }
}

// Global limiter instance for LLM calls
let globalLimiter: LLMLimiter | null = null;

/**
 * Get or create the global LLM limiter.
 */
export function getGlobalLimiter(config?: RateLimiterConfig): LLMLimiter {
  if (!globalLimiter) {
    globalLimiter = new LLMLimiter(config ?? {
      maxConcurrent: 2,
      minInterval: 100,
      queueLimit: 50,
    });
  }
  return globalLimiter;
}

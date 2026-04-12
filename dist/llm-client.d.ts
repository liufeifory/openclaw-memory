/**
 * LLM Client - Cloud-only interface
 *
 * All LLM calls go to cloud provider (OpenAI-compatible API)
 * Supports: Aliyun Bailian, OpenAI, DeepSeek, custom OpenAI-compatible endpoints
 */
import type { LLMConfig } from './config.js';
export type { LLMConfig } from './config.js';
export interface LLMOptions {
    maxTokens?: number;
    temperature?: number;
    topP?: number;
    model?: string;
}
export declare class LLMClient {
    private config;
    private defaultOptions;
    constructor(config: LLMConfig, defaultOptions?: LLMOptions);
    /**
     * Get endpoint (always cloud)
     */
    private getEndpoint;
    /**
     * Build request body
     */
    private buildRequestBody;
    /**
     * Build headers
     */
    private buildHeaders;
    /**
     * Detect and clean repetitive patterns in LLM output
     */
    private cleanRepetitiveOutput;
    /**
     * Complete a prompt using cloud LLM
     */
    complete(prompt: string, taskType: string, options?: LLMOptions): Promise<string>;
    /**
     * Parse JSON response from LLM
     */
    completeJson<T>(prompt: string, taskType: string, options?: LLMOptions): Promise<T>;
    /**
     * Get configuration info for logging
     */
    getConfigInfo(): string;
}
/**
 * Create LLM client for memory plugin
 */
export declare function createLLMClients(config: LLMConfig): {
    localClient: LLMClient;
    hybridClient: LLMClient;
};
//# sourceMappingURL=llm-client.d.ts.map
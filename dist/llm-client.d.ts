/**
 * LLM Client - Unified interface for local and cloud LLM providers
 *
 * Supports:
 * - Local llama.cpp server (OpenAI-compatible API)
 * - Cloud providers (Aliyun Bailian, etc.)
 */
export interface LLMOptions {
    maxTokens?: number;
    temperature?: number;
    topP?: number;
    model?: string;
}
export interface LLMConfig {
    localEndpoint?: string;
    cloudEnabled?: boolean;
    cloudProvider?: 'bailian' | 'openai' | 'custom';
    cloudBaseUrl?: string;
    cloudApiKey?: string;
    cloudModel?: string;
    cloudTasks?: ('preference' | 'summarizer' | 'clusterer' | 'reranker')[];
}
export declare class LLMClient {
    private config;
    private defaultOptions;
    constructor(config: LLMConfig, defaultOptions?: LLMOptions);
    /**
     * Check if a task should use cloud LLM
     * Local-only tasks are never routed to cloud
     */
    private shouldUseCloud;
    /**
     * Get endpoint for a task
     */
    private getEndpoint;
    /**
     * Build request body based on provider type
     */
    private buildRequestBody;
    /**
     * Build headers based on provider type
     */
    private buildHeaders;
    /**
     * Parse response based on provider type
     */
    private parseResponse;
    /**
     * Complete a prompt using the appropriate LLM
     * @param prompt - The input prompt
     * @param taskType - Task identifier for routing (e.g., 'memory-filter', 'summarizer')
     * @param options - Optional LLM settings
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
 * Create LLM clients for memory plugin
 * Returns separate clients for local-only and hybrid tasks
 */
export declare function createLLMClients(config: LLMConfig): {
    localClient: LLMClient;
    hybridClient: LLMClient;
};
//# sourceMappingURL=llm-client.d.ts.map
/**
 * LLM Client - Unified interface for local and cloud LLM providers
 *
 * Supports:
 * - Local llama.cpp server (OpenAI-compatible API)
 * - Cloud providers (Aliyun Bailian, etc.)
 */
import { logError, logWarn } from './maintenance-logger.js';
export class LLMClient {
    config;
    defaultOptions;
    constructor(config, defaultOptions) {
        this.config = config;
        this.defaultOptions = defaultOptions ?? {
            maxTokens: 500,
            temperature: 0.3,
            topP: 0.9,
        };
    }
    /**
     * Check if a task should use cloud LLM
     */
    shouldUseCloud(taskType) {
        if (!this.config.cloudEnabled)
            return false;
        if (!this.config.cloudTasks)
            return false;
        return this.config.cloudTasks.includes(taskType);
    }
    /**
     * Get endpoint for a task
     */
    getEndpoint(taskType) {
        if (this.shouldUseCloud(taskType)) {
            return this.config.cloudBaseUrl ?? 'https://dashscope.aliyuncs.com/v1';
        }
        return this.config.localEndpoint ?? 'http://localhost:8082';
    }
    /**
     * Build request body based on provider type
     */
    buildRequestBody(prompt, options, taskType) {
        const isCloud = this.shouldUseCloud(taskType);
        if (isCloud) {
            // Cloud format: OpenAI-compatible chat completions
            return {
                model: this.config.cloudModel ?? 'qwen3.5-plus',
                messages: [{ role: 'user', content: prompt }],
                max_tokens: options.maxTokens ?? this.defaultOptions.maxTokens,
                temperature: options.temperature ?? this.defaultOptions.temperature,
                top_p: options.topP ?? this.defaultOptions.topP,
            };
        }
        else {
            // Local llama.cpp format
            return {
                prompt: prompt,
                n_predict: options.maxTokens ?? this.defaultOptions.maxTokens,
                temperature: options.temperature ?? this.defaultOptions.temperature,
                top_p: options.topP ?? this.defaultOptions.topP,
            };
        }
    }
    /**
     * Build headers based on provider type
     */
    buildHeaders(taskType) {
        const headers = {
            'Content-Type': 'application/json',
        };
        if (this.shouldUseCloud(taskType)) {
            if (this.config.cloudApiKey) {
                headers['Authorization'] = `Bearer ${this.config.cloudApiKey}`;
            }
        }
        return headers;
    }
    /**
     * Parse response based on provider type
     */
    parseResponse(data, taskType) {
        try {
            const isCloud = this.shouldUseCloud(taskType);
            if (isCloud) {
                // Cloud format: OpenAI-compatible response
                return data.choices?.[0]?.message?.content ?? data.content ?? '';
            }
            else {
                // Local llama.cpp format
                return data.content ?? data.generated_text ?? '';
            }
        }
        catch (error) {
            logError(`[LLMClient] Failed to parse response: ${error.message}`);
            return '';
        }
    }
    /**
     * Complete a prompt using the appropriate LLM
     * @param prompt - The input prompt
     * @param taskType - Task identifier for routing (e.g., 'memory-filter', 'summarizer')
     * @param options - Optional LLM settings
     */
    async complete(prompt, taskType, options) {
        const endpoint = this.getEndpoint(taskType);
        const isCloud = this.shouldUseCloud(taskType);
        const mergedOptions = { ...this.defaultOptions, ...options };
        try {
            const body = this.buildRequestBody(prompt, mergedOptions, taskType);
            const headers = this.buildHeaders(taskType);
            const response = await fetch(endpoint, {
                method: 'POST',
                headers,
                body: JSON.stringify(body),
            });
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            const data = await response.json();
            const result = this.parseResponse(data, taskType);
            if (!result) {
                logWarn(`[LLMClient] Empty response for task ${taskType}`);
            }
            return result;
        }
        catch (error) {
            logError(`[LLMClient] ${isCloud ? 'Cloud' : 'Local'} LLM failed for ${taskType}: ${error.message}`);
            throw error;
        }
    }
    /**
     * Parse JSON response from LLM
     */
    async completeJson(prompt, taskType, options) {
        const result = await this.complete(prompt, taskType, options);
        try {
            // Extract JSON from response (may contain markdown or extra text)
            const jsonMatch = result.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                return JSON.parse(jsonMatch[0]);
            }
            return JSON.parse(result);
        }
        catch (error) {
            logError(`[LLMClient] Failed to parse JSON response for ${taskType}: ${error.message}`);
            logError(`[LLMClient] Raw response: ${result.substring(0, 500)}`);
            throw new Error(`JSON parse failed: ${error.message}`);
        }
    }
    /**
     * Get configuration info for logging
     */
    getConfigInfo() {
        const info = [];
        if (this.config.localEndpoint) {
            info.push(`local: ${this.config.localEndpoint}`);
        }
        if (this.config.cloudEnabled) {
            const provider = this.config.cloudProvider ?? 'unknown';
            const model = this.config.cloudModel ?? 'unknown';
            const tasks = this.config.cloudTasks?.join(', ') ?? 'none';
            info.push(`cloud: ${provider}/${model} -> [${tasks}]`);
        }
        return info.join(' | ');
    }
}
/**
 * Create LLM clients for memory plugin
 * Returns separate clients for local-only and hybrid tasks
 */
export function createLLMClients(config) {
    const localClient = new LLMClient(config, {
        maxTokens: 500,
        temperature: 0.1, // Lower for deterministic tasks
        topP: 0.9,
    });
    const hybridClient = new LLMClient(config, {
        maxTokens: 500,
        temperature: 0.3, // Higher for creative tasks
        topP: 0.9,
    });
    return { localClient, hybridClient };
}
//# sourceMappingURL=llm-client.js.map
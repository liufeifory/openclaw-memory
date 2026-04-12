/**
 * LLM Client - Cloud-only interface
 *
 * All LLM calls go to cloud provider (OpenAI-compatible API)
 * Supports: Aliyun Bailian, OpenAI, DeepSeek, custom OpenAI-compatible endpoints
 */
import { logError, logWarn, logInfo } from './maintenance-logger.js';
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
        // Validate cloud config
        if (!this.config.cloudBaseUrl) {
            throw new Error('[LLMClient] cloudBaseUrl required. Set llm.cloudBaseUrl in config.');
        }
        if (!this.config.cloudApiKey) {
            throw new Error('[LLMClient] cloudApiKey required. Set llm.cloudApiKey in config.');
        }
        logInfo(`[LLMClient] Initialized: ${this.config.cloudProvider ?? 'custom'} / ${this.config.cloudModel ?? 'default'}`);
    }
    /**
     * Get endpoint (always cloud)
     */
    getEndpoint() {
        return this.config.cloudBaseUrl.replace(/\/$/, '') + '/chat/completions';
    }
    /**
     * Build request body
     */
    buildRequestBody(prompt, options) {
        const model = options.model ?? this.config.cloudModel ?? 'qwen-plus';
        return {
            model,
            messages: [{ role: 'user', content: prompt }],
            max_tokens: options.maxTokens ?? this.defaultOptions.maxTokens,
            temperature: options.temperature ?? this.defaultOptions.temperature,
            top_p: options.topP ?? this.defaultOptions.topP,
        };
    }
    /**
     * Build headers
     */
    buildHeaders() {
        return {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.config.cloudApiKey}`,
        };
    }
    /**
     * Detect and clean repetitive patterns in LLM output
     */
    cleanRepetitiveOutput(text) {
        if (!text || text.length < 10)
            return text;
        // Detect pattern: word/number followed by repeated short segment
        const repeatedPattern = text.match(/(.{1,10}?)\1{3,}/g);
        if (repeatedPattern) {
            logWarn(`[LLMClient] Detected repetitive pattern: ${repeatedPattern[0].slice(0, 30)}...`);
            for (const pattern of repeatedPattern) {
                const match = pattern.match(/(.{1,10}?)\1{3,}/);
                if (match) {
                    const cleaned = match[1].repeat(Math.min(2, Math.ceil(pattern.length / match[1].length / 3)));
                    text = text.replace(pattern, cleaned);
                }
            }
        }
        // Detect runaway repetition at end
        const endRepetition = text.match(/(.{1,5})\1{5,}$/);
        if (endRepetition) {
            const base = endRepetition[1];
            const repeatCount = (text.length - text.lastIndexOf(base)) / base.length;
            if (repeatCount > 3) {
                logWarn(`[LLMClient] Cleaning runaway repetition at end`);
                text = text.slice(0, text.lastIndexOf(base) + base.length * 2);
            }
        }
        return text;
    }
    /**
     * Complete a prompt using cloud LLM
     */
    async complete(prompt, taskType, options) {
        const endpoint = this.getEndpoint();
        const mergedOptions = { ...this.defaultOptions, ...options };
        // Validate input
        if (!prompt || prompt.trim().length === 0) {
            throw new Error(`[LLMClient] Empty prompt for task ${taskType}`);
        }
        // Check input length (cloud models typically support large context)
        const maxChars = 180000;
        if (prompt.length > maxChars) {
            logWarn(`[LLMClient] Prompt too long for ${taskType}: ${prompt.length} chars, truncating`);
            prompt = prompt.substring(0, maxChars);
        }
        // Timeout control (60s default)
        const timeoutMs = 60000;
        try {
            const body = this.buildRequestBody(prompt, mergedOptions);
            const headers = this.buildHeaders();
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
            const response = await fetch(endpoint, {
                method: 'POST',
                headers,
                body: JSON.stringify(body),
                signal: controller.signal,
            });
            clearTimeout(timeoutId);
            if (!response.ok) {
                const errorText = await response.text().catch(() => response.statusText);
                throw new Error(`HTTP ${response.status}: ${errorText}`);
            }
            const data = await response.json();
            let result = data.choices?.[0]?.message?.content ?? '';
            // Clean up repetitive patterns
            result = this.cleanRepetitiveOutput(result);
            if (!result) {
                logWarn(`[LLMClient] Empty response for task ${taskType}`);
            }
            return result;
        }
        catch (error) {
            if (error instanceof Error) {
                if (error.name === 'AbortError' || error.message?.includes('abort')) {
                    logError(`[LLMClient] Request timeout for ${taskType} after ${timeoutMs}ms`);
                    throw new Error(`LLM timeout after ${timeoutMs}ms for ${taskType}`);
                }
                logError(`[LLMClient] Cloud LLM failed for ${taskType}: ${error.message}`);
                throw error;
            }
            throw new Error(`[LLMClient] Unknown error for ${taskType}`);
        }
    }
    /**
     * Parse JSON response from LLM
     */
    async completeJson(prompt, taskType, options) {
        const result = await this.complete(prompt, taskType, options);
        try {
            // Remove markdown code block markers
            const cleaned = result
                .replace(/```json\s*/gi, '')
                .replace(/```\s*/g, '')
                .trim();
            // Try to extract JSON object
            let jsonMatch = cleaned.match(/\{[\s\S]*\}/);
            // Handle "Thinking Process" prefixes
            if (!jsonMatch) {
                const parts = cleaned.split(/(?:Thinking Process:|思考过程:|Reasoning:)/i);
                const lastPart = parts[parts.length - 1] || cleaned;
                jsonMatch = lastPart.match(/\{[\s\S]*\}/);
            }
            if (jsonMatch) {
                const jsonStr = jsonMatch[0]
                    .replace(/,\s*}/g, '}')
                    .replace(/,\s*]/g, ']')
                    .replace(/"\s*:\s*"/g, '": "')
                    .replace(/\n/g, ' ');
                return JSON.parse(jsonStr);
            }
            return JSON.parse(cleaned);
        }
        catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            logError(`[LLMClient] Failed to parse JSON for ${taskType}: ${message}`);
            logError(`[LLMClient] Raw response: ${result.substring(0, 500)}`);
            throw new Error(`JSON parse failed: ${message}`);
        }
    }
    /**
     * Get configuration info for logging
     */
    getConfigInfo() {
        const provider = this.config.cloudProvider ?? 'custom';
        const model = this.config.cloudModel ?? 'default';
        return `cloud: ${provider}/${model}`;
    }
}
/**
 * Create LLM client for memory plugin
 */
export function createLLMClients(config) {
    const client = new LLMClient(config, {
        maxTokens: 500,
        temperature: 0.3,
        topP: 0.9,
    });
    // Both return same cloud client (legacy compatibility)
    return { localClient: client, hybridClient: client };
}
//# sourceMappingURL=llm-client.js.map
/**
 * LLM Client - Unified interface for local and cloud LLM providers
 *
 * Supports:
 * - Local llama.cpp server (OpenAI-compatible API)
 * - Cloud providers (Aliyun Bailian, etc.)
 */

import { logError, logInfo, logWarn } from './maintenance-logger.js';

export interface LLMOptions {
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  model?: string;  // For cloud providers
}

export interface LLMConfig {
  // Local LLM config
  localEndpoint?: string;

  // Cloud LLM config
  cloudEnabled?: boolean;
  cloudProvider?: 'bailian' | 'openai' | 'custom';
  cloudBaseUrl?: string;
  cloudApiKey?: string;
  cloudModel?: string;

  // Which tasks use cloud (others use local)
  cloudTasks?: ('preference' | 'summarizer' | 'clusterer' | 'reranker')[];
}

export class LLMClient {
  private config: LLMConfig;
  private defaultOptions: LLMOptions;

  constructor(config: LLMConfig, defaultOptions?: LLMOptions) {
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
  private shouldUseCloud(taskType: string): boolean {
    if (!this.config.cloudEnabled) return false;
    if (!this.config.cloudTasks) return false;
    return this.config.cloudTasks.includes(taskType as any);
  }

  /**
   * Get endpoint for a task
   */
  private getEndpoint(taskType: string): string {
    if (this.shouldUseCloud(taskType)) {
      return this.config.cloudBaseUrl ?? 'https://dashscope.aliyuncs.com/v1';
    }
    const localEndpoint = this.config.localEndpoint ?? 'http://localhost:8082';
    // Append /completion for local llama.cpp server
    return localEndpoint.replace(/\/$/, '') + '/completion';
  }

  /**
   * Build request body based on provider type
   */
  private buildRequestBody(prompt: string, options: LLMOptions, taskType: string): any {
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
    } else {
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
  private buildHeaders(taskType: string): Record<string, string> {
    const headers: Record<string, string> = {
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
  private parseResponse(data: any, taskType: string): string {
    try {
      const isCloud = this.shouldUseCloud(taskType);

      if (isCloud) {
        // Cloud format: OpenAI-compatible response
        return data.choices?.[0]?.message?.content ?? data.content ?? '';
      } else {
        // Local llama.cpp format
        return data.content ?? data.generated_text ?? '';
      }
    } catch (error: any) {
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
  async complete(prompt: string, taskType: string, options?: LLMOptions): Promise<string> {
    const endpoint = this.getEndpoint(taskType);
    const isCloud = this.shouldUseCloud(taskType);
    const mergedOptions = { ...this.defaultOptions, ...options };

    // 验证输入
    if (!prompt || prompt.trim().length === 0) {
      const err = new Error(`Empty prompt for task ${taskType}`);
      logError(`[LLMClient] ${err.message}`);
      throw err;
    }

    // 检查输入长度 (qwen3.5-plus max context: 196601 tokens, ~800k chars)
    const maxChars = 180000; // 保守限制
    if (prompt.length > maxChars) {
      logWarn(`[LLMClient] Prompt too long for ${taskType}: ${prompt.length} chars, truncating to ${maxChars}`);
      prompt = prompt.substring(0, maxChars);
    }

    try {
      const body = this.buildRequestBody(prompt, mergedOptions, taskType);
      const headers = this.buildHeaders(taskType);

      const response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => response.statusText);
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }

      const data = await response.json();
      const result = this.parseResponse(data, taskType);

      if (!result) {
        logWarn(`[LLMClient] Empty response for task ${taskType}`);
      }

      return result;
    } catch (error: any) {
      logError(`[LLMClient] ${isCloud ? 'Cloud' : 'Local'} LLM failed for ${taskType}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Parse JSON response from LLM
   */
  async completeJson<T>(prompt: string, taskType: string, options?: LLMOptions): Promise<T> {
    const result = await this.complete(prompt, taskType, options);

    try {
      // Extract JSON from response (may contain markdown or extra text)
      const jsonMatch = result.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]) as T;
      }
      return JSON.parse(result) as T;
    } catch (error: any) {
      logError(`[LLMClient] Failed to parse JSON response for ${taskType}: ${error.message}`);
      logError(`[LLMClient] Raw response: ${result.substring(0, 500)}`);
      throw new Error(`JSON parse failed: ${error.message}`);
    }
  }

  /**
   * Get configuration info for logging
   */
  getConfigInfo(): string {
    const info: string[] = [];

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
export function createLLMClients(config: LLMConfig): {
  localClient: LLMClient;  // For local-only tasks
  hybridClient: LLMClient; // For tasks that can use cloud
} {
  const localClient = new LLMClient(config, {
    maxTokens: 500,
    temperature: 0.1,  // Lower for deterministic tasks
    topP: 0.9,
  });

  const hybridClient = new LLMClient(config, {
    maxTokens: 500,
    temperature: 0.3,  // Higher for creative tasks
    topP: 0.9,
  });

  return { localClient, hybridClient };
}

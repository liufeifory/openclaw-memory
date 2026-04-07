/**
 * LLM Client - Unified interface for local and cloud LLM providers
 *
 * Supports:
 * - Local llama.cpp server (OpenAI-compatible API)
 * - Cloud providers (Aliyun Bailian, etc.)
 */

import { logError, logInfo, logWarn } from './maintenance-logger.js';
import type { LLMConfig } from './config.js';

// Re-export LLMConfig from config.ts for backward compatibility
export type { LLMConfig } from './config.js';

export interface LLMOptions {
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  model?: string;  // For cloud providers
}

// Tasks that MUST use local endpoint (never route to cloud)
const LOCAL_ONLY_TASKS = new Set([
  'entity-extractor',
  'entity-indexer',
  'relation-classifier',
  'memory-filter',
]);

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
   * Local-only tasks are never routed to cloud
   */
  private shouldUseCloud(taskType: string): boolean {
    // Local-only tasks are NEVER routed to cloud
    if (LOCAL_ONLY_TASKS.has(taskType)) return false;

    if (!this.config.cloudEnabled) return false;
    if (!this.config.cloudTasks) return false;
    return this.config.cloudTasks.includes(taskType as any);
  }

  /**
   * Get endpoint for a task
   */
  private getEndpoint(taskType: string): string {
    if (this.shouldUseCloud(taskType)) {
      if (!this.config.cloudBaseUrl) {
        throw new Error('[LLMClient] cloudBaseUrl not configured for cloud LLM');
      }
      return this.config.cloudBaseUrl;
    }
    if (!this.config.localEndpoint) {
      throw new Error('[LLMClient] localEndpoint not configured. Please set llm.endpoint in config.');
    }
    // For omlx and other OpenAI-compatible servers, use /v1/chat/completions
    return this.config.localEndpoint.replace(/\/$/, '') + '/v1/chat/completions';
  }

  /**
   * Build request body based on provider type
   */
  private buildRequestBody(prompt: string, options: LLMOptions, taskType: string): any {
    const isCloud = this.shouldUseCloud(taskType);

    // Both omlx and cloud use OpenAI-compatible chat completions format
    let model: string;
    if (isCloud) {
      model = this.config.cloudModel ?? 'qwen3.5-plus';
    } else {
      if (!this.config.localModel) {
        throw new Error('[LLMClient] localModel not configured. Please set llm.model in config.');
      }
      model = this.config.localModel;
    }

    const body: any = {
      model,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: options.maxTokens ?? this.defaultOptions.maxTokens,
      temperature: options.temperature ?? this.defaultOptions.temperature,
      top_p: options.topP ?? this.defaultOptions.topP,
    };

    // Add repetition penalty for local models to prevent degenerate output
    // Most local LLM servers support this parameter
    if (!isCloud) {
      body.repetition_penalty = 1.1;  // Default 1.0, higher = less repetition
      body.frequency_penalty = 0.3;   // Penalize repeated tokens
    }

    return body;
  }

  /**
   * Build headers based on provider type
   */
  private buildHeaders(taskType: string): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.shouldUseCloud(taskType)) {
      // Cloud provider auth
      if (this.config.cloudApiKey) {
        headers['Authorization'] = `Bearer ${this.config.cloudApiKey}`;
      }
    } else {
      // Local LLM auth (e.g., omlx)
      if (this.config.localApiKey) {
        headers['Authorization'] = `Bearer ${this.config.localApiKey}`;
      }
    }

    return headers;
  }

  /**
   * Detect and clean repetitive patterns in LLM output
   * Handles cases like "MySQL 8.4.4.4.4.4.4.4..." or "the the the the"
   */
  private cleanRepetitiveOutput(text: string): string {
    if (!text || text.length < 10) return text;

    // Detect pattern: word/number followed by repeated short segment
    // e.g., "8.4.4.4.4.4" or "the the the"
    const repeatedPattern = text.match(/(.{1,10}?)\1{3,}/g);
    if (repeatedPattern) {
      logWarn(`[LLMClient] Detected repetitive pattern: ${repeatedPattern[0].slice(0, 30)}...`);

      // Remove the repetition, keep only first occurrence
      for (const pattern of repeatedPattern) {
        const match = pattern.match(/(.{1,10}?)\1{3,}/);
        if (match) {
          // Keep only 1-2 repetitions
          const cleaned = match[1].repeat(Math.min(2, Math.ceil(pattern.length / match[1].length / 3)));
          text = text.replace(pattern, cleaned);
        }
      }
    }

    // Detect runaway repetition at end of string
    // e.g., "...Manual.4.4.4.4.4"
    const endRepetition = text.match(/(.{1,5})\1{5,}$/);
    if (endRepetition) {
      const match = endRepetition;
      const base = match[1];
      // Count how many times it repeats
      const repeatCount = (text.length - text.lastIndexOf(base)) / base.length;
      if (repeatCount > 3) {
        logWarn(`[LLMClient] Cleaning runaway repetition at end`);
        // Find where repetition starts and truncate
        const lastNormal = text.slice(0, text.lastIndexOf(base) + base.length * 2);
        text = lastNormal;
      }
    }

    // Detect JSON value corruption: "title": "MySQL 8.4.4.4.4.4.4.4..."
    const jsonValueCorruption = text.match(/"([^"]+?)":\s*"([^"]*?)(.{1,5})\3{4,}"/g);
    if (jsonValueCorruption) {
      for (const corrupted of jsonValueCorruption) {
        const keyMatch = corrupted.match(/"([^"]+)":/);
        const valueStart = corrupted.match(/:\s*"([^"]*?)(.{1,5})\2{4,}/);
        if (keyMatch && valueStart) {
          const key = keyMatch[1];
          const cleanValue = valueStart[1] + valueStart[2]; // Keep only first occurrence
          text = text.replace(corrupted, `"${key}": "${cleanValue}"`);
          logWarn(`[LLMClient] Fixed corrupted JSON value for key: ${key}`);
        }
      }
    }

    return text;
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
        // Local LLM: try OpenAI-compatible format first (omlx), then llama.cpp format
        return data.choices?.[0]?.message?.content ?? data.content ?? data.generated_text ?? '';
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

    // Add timeout control for LLM requests (default 60s, can be overridden)
    const timeoutMs = taskType === 'entity-extractor' ? 30000 : 60000;  // 30s for entity extraction, 60s for others
    let timeoutId: NodeJS.Timeout | undefined;

    try {
      const body = this.buildRequestBody(prompt, mergedOptions, taskType);
      const headers = this.buildHeaders(taskType);

      const controller = new AbortController();
      timeoutId = setTimeout(() => controller.abort(), timeoutMs);

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
      let result = this.parseResponse(data, taskType);

      // Clean up any repetitive patterns in output
      result = this.cleanRepetitiveOutput(result);

      if (!result) {
        logWarn(`[LLMClient] Empty response for task ${taskType}`);
      }

      return result;
    } catch (error: any) {
      if (error.name === 'AbortError' || error.message?.includes('abort')) {
        logError(`[LLMClient] Request timeout for ${taskType} after ${timeoutMs}ms`);
        throw new Error(`LLM timeout after ${timeoutMs}ms for ${taskType}`);
      }
      logError(`[LLMClient] ${isCloud ? 'Cloud' : 'Local'} LLM failed for ${taskType}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Parse JSON response from LLM
   * Handles responses with markdown code blocks, "Thinking Process" prefix, etc.
   */
  async completeJson<T>(prompt: string, taskType: string, options?: LLMOptions): Promise<T> {
    const result = await this.complete(prompt, taskType, options);

    try {
      // Remove markdown code block markers if present
      let cleaned = result
        .replace(/```json\s*/gi, '')
        .replace(/```\s*/g, '')
        .trim();

      // Try to extract JSON object
      let jsonMatch = cleaned.match(/\{[\s\S]*\}/);

      // If no JSON found, try to find it after "Thinking Process" or similar prefixes
      if (!jsonMatch) {
        const parts = cleaned.split(/(?:Thinking Process:|思考过程:|Reasoning:)/i);
        const lastPart = parts[parts.length - 1] || cleaned;
        jsonMatch = lastPart.match(/\{[\s\S]*\}/);
      }

      if (jsonMatch) {
        // Clean up common JSON formatting issues
        const jsonStr = jsonMatch[0]
          .replace(/,\s*}/g, '}')  // Remove trailing commas
          .replace(/,\s*]/g, ']')  // Remove trailing commas in arrays
          .replace(/"\s*:\s*"/g, '": "')  // Fix spacing
          .replace(/\n/g, ' ');  // Remove newlines in JSON

        return JSON.parse(jsonStr) as T;
      }
      return JSON.parse(cleaned) as T;
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

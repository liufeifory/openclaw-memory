/**
 * 统一配置接口 - 所有模块使用此接口
 *
 * 禁止在其他文件重复定义配置接口
 */

import * as fs from 'fs';
import * as path from 'path';
import { logWarn } from './maintenance-logger.js';

/**
 * SurrealDB 配置
 */
export interface SurrealConfig {
  url: string;
  namespace: string;
  database: string;
  username: string;
  password: string;
}

/**
 * Embedding 服务配置
 */
export interface EmbeddingConfig {
  endpoint: string;
  model?: string;
  apiKey?: string;
}

/**
 * LLM 配置 - 云端模型
 */
export interface LLMConfig {
  // 云端 LLM（必须）
  cloudProvider?: 'bailian' | 'openai' | 'deepseek' | 'custom';
  cloudBaseUrl: string;     // 例如: https://dashscope.aliyuncs.com/compatible-mode/v1
  cloudApiKey: string;      // API Key
  cloudModel?: string;      // 默认模型，例如: qwen-plus
}

/**
 * 文档导入配置
 */
export interface DocumentImportConfig {
  watchDir?: string;
  chunkSize?: number;
  chunkOverlap?: number;
}

/**
 * 插件统一配置 - 所有模块使用此接口
 */
export interface PluginConfig {
  backend?: 'surrealdb';
  surrealdb: SurrealConfig;
  embedding: EmbeddingConfig;
  llm: LLMConfig;
  documentImport?: DocumentImportConfig;
}

/**
 * OpenClaw 主配置文件结构（部分）
 */
interface OpenClawConfig {
  plugins?: {
    entries?: {
      'openclaw-memory'?: {
        config?: PluginConfig;
      };
    };
  };
}

/**
 * 从环境变量构建配置（用于 CLI）
 */
export function buildConfigFromEnv(): PluginConfig {
  return {
    surrealdb: {
      url: process.env.SURREALDB_URL || 'http://localhost:8001',
      namespace: 'openclaw',
      database: 'memory',
      username: 'root',
      password: 'root',
    },
    embedding: {
      endpoint: process.env.EMBEDDING_ENDPOINT || 'http://localhost:8000/v1/embeddings',
      model: process.env.EMBEDDING_MODEL || 'bge-m3-mlx-fp16',
      apiKey: process.env.EMBEDDING_API_KEY || 'liutengfei411',
    },
    llm: {
      cloudProvider: (process.env.LLM_PROVIDER as 'bailian' | 'openai' | 'deepseek' | 'custom') || 'bailian',
      cloudBaseUrl: process.env.LLM_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      cloudApiKey: process.env.LLM_API_KEY || '',
      cloudModel: process.env.LLM_MODEL || 'qwen-plus',
    },
  };
}

/**
 * 从 OpenClaw 主配置文件读取插件配置
 *
 * @param openclawConfigPath - OpenClaw 配置文件路径，默认 ~/.openclaw/openclaw.json
 * @returns 插件配置，如果未找到则返回 buildConfigFromEnv()
 */
export function buildConfigFromOpenClaw(openclawConfigPath?: string): PluginConfig {
  const defaultPath = path.join(process.env.HOME || '/Users/liufei', '.openclaw', 'openclaw.json');
  const configPath = openclawConfigPath || defaultPath;

  try {
    if (!fs.existsSync(configPath)) {
      logWarn(`[Config] OpenClaw config not found at ${configPath}, using env defaults`);
      return buildConfigFromEnv();
    }

    const content = fs.readFileSync(configPath, 'utf-8');
    const config: OpenClawConfig = JSON.parse(content);

    const pluginConfig = config.plugins?.entries?.['openclaw-memory']?.config;
    if (pluginConfig) {
      return pluginConfig;
    }

    logWarn('[Config] openclaw-memory config not found in OpenClaw config, using env defaults');
    return buildConfigFromEnv();
  } catch (error) {
    logWarn(`[Config] Failed to read OpenClaw config: ${error}, using env defaults`);
    return buildConfigFromEnv();
  }
}

/**
 * 获取配置 - 优先从 OpenClaw 配置文件读取，失败则使用环境变量
 *
 * 这是推荐的配置获取方式，CLI 和插件都应使用此函数
 */
export function getConfig(): PluginConfig {
  return buildConfigFromOpenClaw();
}
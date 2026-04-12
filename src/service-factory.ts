/**
 * 统一服务工厂 - 单一入口点管理所有服务实例
 *
 * 使用方式：
 *   import { ServiceFactory } from './service-factory.js';
 *   ServiceFactory.init(config);
 *   const db = ServiceFactory.getDB();
 *   const embedding = ServiceFactory.getEmbedding();
 *   const llm = ServiceFactory.getLLM();
 */

import type { PluginConfig, SurrealConfig, EmbeddingConfig, LLMConfig } from './config.js';
import { SurrealDatabase } from './surrealdb-client.js';
import { EmbeddingService } from './embedding.js';
import { LLMClient } from './llm-client.js';
import { logInfo } from './maintenance-logger.js';

/**
 * 服务工厂 - 单例模式
 */
export class ServiceFactory {
  private static instance: ServiceFactory;
  private config: PluginConfig | null = null;

  // 服务实例（懒加载）
  private _db: SurrealDatabase | null = null;
  private _embedding: EmbeddingService | null = null;
  private _llm: LLMClient | null = null;

  private initialized = false;
  private dbInitialized = false;

  private constructor() {}

  /**
   * 获取单例
   */
  static getInstance(): ServiceFactory {
    if (!ServiceFactory.instance) {
      ServiceFactory.instance = new ServiceFactory();
    }
    return ServiceFactory.instance;
  }

  /**
   * 初始化配置（必须首先调用）
   */
  static init(config: PluginConfig): void {
    ServiceFactory.getInstance()._init(config);
  }

  private _init(config: PluginConfig): void {
    if (this.initialized) {
      logInfo('[ServiceFactory] Already initialized, skipping');
      return;
    }
    this.config = config;
    this.initialized = true;
    logInfo('[ServiceFactory] Initialized with config');
  }

  /**
   * 获取配置
   */
  static getConfig(): PluginConfig | null {
    return ServiceFactory.getInstance().config;
  }

  /**
   * 获取 SurrealDB 配置
   */
  static getSurrealConfig(): SurrealConfig {
    const config = ServiceFactory.getConfig();
    if (!config?.surrealdb) {
      throw new Error('[ServiceFactory] SurrealDB config not initialized. Call init() first.');
    }
    return config.surrealdb;
  }

  /**
   * 获取 Embedding 配置
   */
  static getEmbeddingConfig(): EmbeddingConfig {
    const config = ServiceFactory.getConfig();
    if (!config?.embedding) {
      throw new Error('[ServiceFactory] Embedding config not initialized.');
    }
    return config.embedding;
  }

  /**
   * 获取 LLM 配置
   */
  static getLLMConfig(): LLMConfig {
    const config = ServiceFactory.getConfig();
    if (!config?.llm?.cloudBaseUrl || !config?.llm?.cloudApiKey) {
      throw new Error('[ServiceFactory] LLM cloudBaseUrl and cloudApiKey required in config');
    }
    return config.llm;
  }

  /**
   * 获取 SurrealDB 客户端（单例）
   */
  static getDB(): SurrealDatabase {
    return ServiceFactory.getInstance()._getDB();
  }

  private _getDB(): SurrealDatabase {
    if (!this._db) {
      const surrealConfig = ServiceFactory.getSurrealConfig();
      this._db = new SurrealDatabase(surrealConfig);
      logInfo('[ServiceFactory] Created SurrealDatabase instance');
    }
    return this._db;
  }

  /**
   * 获取 Embedding 服务（单例）
   */
  static getEmbedding(): EmbeddingService {
    return ServiceFactory.getInstance()._getEmbedding();
  }

  private _getEmbedding(): EmbeddingService {
    if (!this._embedding) {
      const embeddingConfig = ServiceFactory.getEmbeddingConfig();
      this._embedding = new EmbeddingService(embeddingConfig);
      logInfo('[ServiceFactory] Created EmbeddingService instance');
    }
    return this._embedding;
  }

  /**
   * 获取 LLM 客户端（单例）
   */
  static getLLM(): LLMClient {
    return ServiceFactory.getInstance()._getLLM();
  }

  private _getLLM(): LLMClient {
    if (!this._llm) {
      const llmConfig = ServiceFactory.getLLMConfig();
      this._llm = new LLMClient({
        cloudProvider: llmConfig.cloudProvider,
        cloudBaseUrl: llmConfig.cloudBaseUrl!,
        cloudApiKey: llmConfig.cloudApiKey!,
        cloudModel: llmConfig.cloudModel,
      });
      logInfo('[ServiceFactory] Created LLMClient instance (cloud-only)');
    }
    return this._llm;
  }

  /**
   * 异步初始化数据库连接
   */
  static async initDatabase(): Promise<void> {
    return ServiceFactory.getInstance()._initDatabase();
  }

  private async _initDatabase(): Promise<void> {
    if (this.dbInitialized) return;
    const db = this._getDB();
    await db.initialize();
    this.dbInitialized = true;
    logInfo('[ServiceFactory] Database initialized');
  }

  /**
   * 检查是否已初始化
   */
  static isInitialized(): boolean {
    return ServiceFactory.getInstance().initialized;
  }

  /**
   * 清理资源
   */
  static async dispose(): Promise<void> {
    return ServiceFactory.getInstance()._dispose();
  }

  private async _dispose(): Promise<void> {
    logInfo('[ServiceFactory] Disposing...');

    if (this._db) {
      await this._db.close();
      this._db = null;
    }

    this._embedding = null;
    this._llm = null;
    this.config = null;
    this.initialized = false;
    this.dbInitialized = false;

    logInfo('[ServiceFactory] Disposed');
  }
}

// 导出便捷函数
export const getDB = () => ServiceFactory.getDB();
export const getEmbedding = () => ServiceFactory.getEmbedding();
export const getLLM = () => ServiceFactory.getLLM();
export const getConfig = () => ServiceFactory.getConfig();
export const initServices = (config: PluginConfig) => ServiceFactory.init(config);
export const disposeServices = () => ServiceFactory.dispose();
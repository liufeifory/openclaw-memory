/**
 * Embedding 服务接口
 * 
 * 所有向量模型必须实现此接口
 * 切换模型时只需修改配置文件，无需改动业务代码
 * 
 * @interface EmbeddingService
 */
export interface EmbeddingService {
  /**
   * 生成文本的向量表示
   * @param text - 输入文本
   * @returns 向量数组
   */
  embed(text: string): Promise<number[]>;

  /**
   * 批量生成向量
   * @param texts - 文本数组
   * @returns 向量数组的数组
   */
  embedBatch(texts: string[]): Promise<number[][]>;

  /**
   * 获取向量维度
   * @returns 维度数（如 1024）
   */
  getDimension(): number;

  /**
   * 获取模型名称
   * @returns 模型标识
   */
  getModelName(): string;
}

/**
 * Embedding 服务配置
 */
export interface EmbeddingConfig {
  /** 模型类型 */
  type: 'local' | 'openai' | 'azure' | 'custom';
  
  /** 模型名称 */
  model: string;
  
  /** API 端点 */
  endpoint: string;
  
  /** API Key（可选） */
  apiKey?: string;
  
  /** 向量维度 */
  dimension: number;
  
  /** 超时时间（毫秒） */
  timeout?: number;
}

/**
 * 创建 Embedding 服务实例
 * 根据配置自动选择实现
 * 
 * @param config - 配置对象
 * @returns Embedding 服务实例
 */
export function createEmbeddingService(config: EmbeddingConfig): EmbeddingService {
  switch (config.type) {
    case 'local':
      return new LocalEmbeddingService(config);
    case 'openai':
      return new OpenAIEmbeddingService(config);
    case 'azure':
      return new AzureEmbeddingService(config);
    default:
      throw new Error(`Unsupported embedding type: ${config.type}`);
  }
}

// ==================== 具体实现 ====================

/**
 * 本地模型实现（llama.cpp / BGE-M3）
 */
class LocalEmbeddingService implements EmbeddingService {
  constructor(private config: EmbeddingConfig) {}

  async embed(text: string): Promise<number[]> {
    const response = await fetch(`${this.config.endpoint}/embedding`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: text }),
      signal: AbortSignal.timeout(this.config.timeout || 30000),
    });

    if (!response.ok) {
      throw new Error(`Embedding API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as { embedding?: number[]; data?: { embedding: number[] }[] };
    return data.embedding || data.data?.[0]?.embedding || [];
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return Promise.all(texts.map(text => this.embed(text)));
  }

  getDimension(): number {
    return this.config.dimension;
  }

  getModelName(): string {
    return this.config.model;
  }
}

/**
 * OpenAI Embedding 实现
 */
class OpenAIEmbeddingService implements EmbeddingService {
  constructor(private config: EmbeddingConfig) {
    if (!config.apiKey) {
      throw new Error('OpenAI API key is required');
    }
  }

  async embed(text: string): Promise<number[]> {
    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        model: this.config.model,
        input: text,
      }),
      signal: AbortSignal.timeout(this.config.timeout || 30000),
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as { data?: { embedding: number[] }[] };
    return data.data?.[0]?.embedding || [];
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        model: this.config.model,
        input: texts,
      }),
      signal: AbortSignal.timeout(this.config.timeout || 30000),
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as { data?: { embedding: number[] }[] };
    return data.data?.map((item) => item.embedding) || [];
  }

  getDimension(): number {
    return this.config.dimension;
  }

  getModelName(): string {
    return this.config.model;
  }
}

/**
 * Azure OpenAI Embedding 实现
 */
class AzureEmbeddingService implements EmbeddingService {
  constructor(private config: EmbeddingConfig) {
    if (!config.apiKey) {
      throw new Error('Azure API key is required');
    }
  }

  async embed(text: string): Promise<number[]> {
    const url = `${this.config.endpoint}/openai/deployments/${this.config.model}/embeddings?api-version=2023-05-15`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': this.config.apiKey || '',
      },
      body: JSON.stringify({ input: text }),
      signal: AbortSignal.timeout(this.config.timeout || 30000),
    });

    if (!response.ok) {
      throw new Error(`Azure API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as { data?: { embedding: number[] }[] };
    return data.data?.[0]?.embedding || [];
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return Promise.all(texts.map(text => this.embed(text)));
  }

  getDimension(): number {
    return this.config.dimension;
  }

  getModelName(): string {
    return this.config.model;
  }
}

/**
 * Term Extraction Types - 术语抽取类型定义
 *
 * 设计原则：
 * - 多领域自适应
 * - 分层架构（统计层 → 候选层 → 判定层）
 * - 高性能（Trie树优化、异步批处理）
 */

// ============================================================
// 领域定义
// ============================================================

/**
 * 支持的领域类型
 */
export type DomainType =
  | 'database'
  | 'ai'
  | 'medical'
  | 'legal'
  | 'finance'
  | 'devops'
  | 'general';

/**
 * 领域检测结果
 */
export interface DomainDetectionResult {
  domain: DomainType;
  confidence: number;  // 0.0 ~ 1.0
  scores: Record<DomainType, number>;  // 各领域得分
}

// ============================================================
// 术语定义
// ============================================================

/**
 * 术语类型分类
 */
export type TermType =
  | 'component'    // 系统组件（如 checkpoint, WAL）
  | 'parameter'    // 配置参数（如 shared_buffers）
  | 'algorithm'    // 算法方法（如 B-tree, hash-join）
  | 'tool'         // 工具命令（如 pg_dump, vacuumdb）
  | 'concept'      // 技术概念（如 MVCC, ACID）
  | 'protocol'     // 协议规范（如 libpq）
  | 'api'          // API/函数（如 pg_stat_activity）
  | 'metric'       // 指标度量（如 latency, throughput）
  | 'entity';      // 实体对象（如 OID, XID）

/**
 * 术语来源（分层架构）
 */
export type TermSource =
  | 'whitelist'    // 白名单匹配（最高优先级）
  | 'regex'        // 正则提取
  | 'statistical'  // 统计层提取（TF-IDF/C-value）
  | 'llm';         // LLM判定

/**
 * 提取的术语
 */
export interface ExtractedTerm {
  term: string;              // 原始术语
  normalized: string;        // 标准化形式（小写）
  namespace: string;         // 命名空间（domain.normalized）
  domain: DomainType;        // 所属领域

  // 分类
  type: TermType;            // 术语类型
  label: string;             // 标签（如 'T/组件'）

  // 来源信息
  source: TermSource;        // 提取来源
  confidence: number;        // 置信度（0.0 ~ 1.0）

  // 统计信息
  freq: number;              // 词频
  score: number;             // 综合评分

  // 上下文
  context?: string;          // 上下文片段
  casePattern?: 'UPPER' | 'LOWER' | 'CAPITALIZED' | 'MIXED';  // 大小写模式

  // 元数据
  createdAt?: Date;
}

// ============================================================
// 统计层
// ============================================================

/**
 * 术语候选（统计层输出）
 */
export interface TermCandidate {
  term: string;
  normalized: string;
  freq: number;
  tfidf: number;
  cvalue: number;
  textrank?: number;
  score: number;
  casePattern: 'UPPER' | 'LOWER' | 'CAPITALIZED' | 'MIXED';
  type?: 'pg_prefix' | 'hyphenated' | 'camelcase' | 'acronym' | 'word';
}

/**
 * N-gram 配置
 */
export interface NgramConfig {
  maxN: number;              // 最大 N-gram（默认 3）
  minFreq: number;           // 最小词频（默认 2）
  minLength: number;         // 最小术语长度（默认 3）
  maxLength: number;         // 最大术语长度（默认 50）
}

// ============================================================
// 领域配置
// ============================================================

/**
 * 领域配置
 */
export interface DomainConfig {
  domain: DomainType;

  // 权重配置
  weights: {
    tfidf: number;           // TF-IDF 权重（默认 0.3）
    cvalue: number;          // C-value 权重（默认 0.4）
    freq: number;            // 词频权重（默认 0.2）
    length: number;          // 长度权重（默认 0.1）
  };

  // 术语规则
  whitelist: string[];       // 白名单术语（必保留）
  blacklist: string[];       // 黑名单术语（必过滤）

  // 词根验证
  roots: string[];           // 领域词根（用于验证连字符词）

  // 正则模式
  patterns: Array<{
    pattern: string;         // 正则表达式
    type: TermType;          // 对应术语类型
  }>;

  // LLM 提示词模板
  llmPromptTemplate?: string;
}

// ============================================================
// 缓存层
// ============================================================

/**
 * 术语缓存项
 */
export interface TermCacheItem {
  term: string;
  normalized: string;
  domain: DomainType;
  type: TermType;
  label: string;
  confidence: number;
  createdAt: Date;
  hitCount: number;          // 缓存命中次数
}

/**
 * 缓存统计
 */
export interface CacheStats {
  size: number;
  hits: number;
  misses: number;
  hitRate: number;           // 命中率
}

// ============================================================
// LLM 批处理
// ============================================================

/**
 * LLM 批处理配置
 */
export interface LLMBatchConfig {
  batchSize: number;         // 每批处理数量（默认 50）
  timeout: number;           // 超时时间（ms，默认 120000）
  temperature: number;       // 温度（默认 0）
  maxTokens: number;         // 最大 token（默认 2000）
}

/**
 * LLM 判定结果
 */
export interface LLMJudgmentResult {
  term: string;
  label: string;             // T/组件、T/参数 等
  reason?: string;           // 判定原因
}

// ============================================================
// Pipeline 配置
// ============================================================

/**
 * 术语抽取配置
 */
export interface TermExtractionConfig {
  // 领域检测
  domainDetection: {
    enabled: boolean;        // 是否启用领域检测（默认 true）
    minConfidence: number;   // 最小置信度阈值（默认 0.3）
  };

  // 统计层
  statistical: NgramConfig;

  // 候选层
  candidate: {
    topK: number;            // Top-K 候选数（默认 200）
    minScore: number;        // 最小评分阈值（默认 1.0）
  };

  // 判定层
  llm: LLMBatchConfig & {
    enabled: boolean;        // 是否启用 LLM 判定（默认 false）
  };

  // 缓存
  cache: {
    enabled: boolean;        // 是否启用缓存（默认 true）
    maxSize: number;         // 最大缓存大小（默认 10000）
  };
}

// ============================================================
// Pipeline 输出
// ============================================================

/**
 * 术语抽取结果
 */
export interface TermExtractionResult {
  domain: DomainType;
  domainConfidence: number;

  terms: ExtractedTerm[];

  // 统计信息
  stats: {
    candidates: number;      // 原始候选数
    filtered: number;        // 过滤后候选数
    cached: number;          // 缓存命中数
    llmJudged: number;       // LLM 判定数
    final: number;           // 最终术语数
  };

  // 分层统计
  layerStats: {
    whitelist: number;
    regex: number;
    statistical: number;
    llm: number;
  };

  // 性能信息
  timing: {
    domainDetection: number;
    statistical: number;
    filtering: number;
    cacheLookup: number;
    llmJudgment: number;
    total: number;
  };
}

// ============================================================
// Trie 树节点（C-value 优化）
// ============================================================

/**
 * Trie 树节点接口
 */
export interface TrieNode {
  children: Map<string, TrieNode>;
  freq: number;
  isEnd: boolean;
  term: string;
}

// ============================================================
// 默认配置
// ============================================================

/**
 * 默认术语抽取配置
 */
export const DEFAULT_TERM_EXTRACTION_CONFIG: TermExtractionConfig = {
  domainDetection: {
    enabled: true,
    minConfidence: 0.3,
  },

  statistical: {
    maxN: 3,
    minFreq: 2,
    minLength: 3,
    maxLength: 50,
  },

  candidate: {
    topK: 200,
    minScore: 1.0,
  },

  llm: {
    enabled: false,
    batchSize: 50,
    timeout: 120000,
    temperature: 0,
    maxTokens: 2000,
  },

  cache: {
    enabled: true,
    maxSize: 10000,
  },
};
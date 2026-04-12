/**
 * Domain Configurations - 领域配置
 *
 * 每个领域包含：
 * - 白名单术语（必保留）
 * - 黑名单术语（必过滤）
 * - 词根列表（验证连字符词）
 * - 正则模式（快速提取）
 */

import type { DomainType, TermType } from './types.js';

// Re-export DomainConfig interface definition
export interface DomainConfig {
  domain: DomainType;

  // 权重配置
  weights: {
    tfidf: number;
    cvalue: number;
    freq: number;
    length: number;
  };

  // 术语规则
  whitelist: string[];
  blacklist: string[];

  // 词根验证
  roots: string[];

  // 正则模式
  patterns: Array<{
    pattern: string;
    type: TermType;
  }>;

  // LLM 提示词模板
  llmPromptTemplate?: string;
}

// ============================================================
// Database 领域配置
// ============================================================

export const DATABASE_CONFIG: DomainConfig = {
  domain: 'database',

  weights: {
    tfidf: 0.3,
    cvalue: 0.4,
    freq: 0.2,
    length: 0.1,
  },

  whitelist: [
    // 核心概念
    'WAL', 'MVCC', 'ACID', 'LSN', 'CTID', 'XID', 'OID', 'TOAST',
    'GIN', 'GiST', 'BRIN', 'SPGiST', 'B-tree', 'Hash',
    'JSONB', 'TSVECTOR', 'TSQUERY', 'UUID', 'PITR', 'FDW', 'JIT', 'SPI',

    // 工具
    'libpq', 'psql', 'pg_dump', 'pg_restore', 'pg_basebackup',
    'initdb', 'pg_ctl', 'pgbench', 'vacuumdb', 'reindexdb',
    'pg_receivewal', 'pg_recvlogical', 'pg_rewind', 'pg_upgrade',
    'pg_verifybackup', 'pg_archivecleanup', 'pg_resetwal',

    // 核心操作
    'VACUUM', 'ANALYZE', 'REINDEX', 'CLUSTER', 'TRUNCATE',
    'checkpoint', 'freeze', 'vacuum', 'analyze',

    // 协议
    'ECPG', 'PL/pgSQL', 'PL/Python', 'PL/Perl',
  ],

  blacklist: [
    // 通用泛词
    '系统', '方法', '流程', '方案', '问题', '时间', '功能', '模块',
    '处理', '方式', '优化', '提升', 'system', 'method', 'process',
    'function', 'module', 'handle', 'way', 'optimize', 'improve',

    // SQL 语法噪声
    'SELECT', 'FROM', 'WHERE', 'ORDER', 'GROUP', 'HAVING', 'LIMIT',
    'INSERT', 'UPDATE', 'DELETE', 'CREATE', 'DROP', 'ALTER',
    'JOIN', 'LEFT', 'RIGHT', 'INNER', 'OUTER', 'CROSS',

    // 通用词
    'table', 'column', 'row', 'value', 'data', 'result',
    'current', 'one', 'two', 'first', 'last',
  ],

  roots: [
    // 数据库核心词根
    'table', 'index', 'row', 'column', 'key', 'value', 'data', 'query',
    'lock', 'transaction', 'commit', 'rollback', 'checkpoint', 'vacuum',
    'trigger', 'function', 'procedure', 'operator', 'type', 'cast',
    'constraint', 'foreign', 'primary', 'unique', 'partition', 'inherit',
    'aggregate', 'window', 'scan', 'plan', 'execute', 'optimize',
    'replication', 'standby', 'backup', 'restore', 'log', 'archive',
    'buffer', 'cache', 'memory', 'disk', 'file', 'page', 'block',
    'server', 'client', 'connection', 'session', 'pool',
    'user', 'role', 'privilege', 'access', 'security', 'auth',
    'gin', 'gist', 'brin', 'hash', 'btree', 'spgist',
    'wal', 'lsn', 'xid', 'oid', 'ctid', 'toast',
    'integer', 'numeric', 'decimal', 'float', 'double', 'string', 'text',
    'date', 'time', 'timestamp', 'interval', 'boolean', 'array', 'json',
    'built', 'run', 'time', 'write', 'read', 'ahead', 'point', 'level',
    'page', 'full', 'hot', 'warm', 'streaming', 'logical', 'physical',
  ],

  patterns: [
    // pg_ 前缀系统对象
    { pattern: 'pg_[a-z0-9_]+', type: 'api' as TermType },

    // 连字符复合术语
    { pattern: '[A-Za-z]+-[A-Za-z]+(?:-[A-Za-z]+)*', type: 'concept' as TermType },

    // CamelCase 源码术语
    { pattern: '[A-Z][a-z]+(?:[A-Z][a-z]+)+', type: 'component' as TermType },

    // 全大写缩写
    { pattern: '[A-Z]{2,8}', type: 'entity' as TermType },
  ],

  llmPromptTemplate: `你是数据库领域专家。

判断以下词是否为 PostgreSQL/数据库专业术语。

标准：
- 技术概念（如 MVCC, ACID）
- 系统组件（如 checkpoint, WAL buffer）
- 配置参数（如 shared_buffers）
- 算法方法（如 B-tree, hash-join）
- 命令工具（如 pg_dump, vacuumdb）
- 系统视图/函数（如 pg_stat_activity）
- 协议规范（如 libpq）

剔除：
- 泛词（系统/方法/流程/方案）
- 通用词（时间/功能/模块/处理）
- SQL 关键字（SELECT/FROM/WHERE）
- 日常词汇（问题/情况/方式）

输出格式：
term | label

严格仅处理给出的候选词列表，严禁新增任何词。`,
};

// ============================================================
// AI 领域配置
// ============================================================

export const AI_CONFIG: DomainConfig = {
  domain: 'ai',

  weights: {
    tfidf: 0.35,
    cvalue: 0.35,
    freq: 0.2,
    length: 0.1,
  },

  whitelist: [
    // 模型架构
    'Transformer', 'BERT', 'GPT', 'LLaMA', 'Claude', 'Mistral',
    'Attention', 'Self-Attention', 'Multi-Head Attention',
    'Embedding', 'Tokenizer', 'Token', 'Vocabulary',
    'Layer', 'Hidden Layer', 'Encoder', 'Decoder',

    // 训练相关
    'Fine-tuning', 'Pre-training', 'Training', 'Inference',
    'Loss', 'Gradient', 'Backpropagation', 'Optimizer',
    'Batch', 'Epoch', 'Learning Rate', 'Weight Decay',
    'Overfitting', 'Underfitting', 'Regularization',

    // 模型类型
    'LLM', 'NLP', 'CV', 'Speech', 'RAG', 'RAG',
    'Generative AI', 'Diffusion Model', 'GAN',
    'Autoencoder', 'VAE', 'CLIP', 'DALL-E',

    // 框架工具
    'PyTorch', 'TensorFlow', 'Hugging Face', 'Transformers',
    'LangChain', 'LlamaIndex', 'OpenAI', 'Anthropic',

    // 概念术语
    'Prompt', 'Context Window', 'Temperature', 'Top-p',
    'Zero-shot', 'Few-shot', 'Chain-of-Thought',
    'RAG', 'Vector Store', 'Knowledge Graph',
  ],

  blacklist: [
    'model', 'method', 'approach', 'technique',
    'result', 'output', 'input', 'value',
    'process', 'system', 'function', 'algorithm',
  ],

  roots: [
    'model', 'training', 'inference', 'embedding', 'attention',
    'layer', 'neural', 'network', 'deep', 'machine', 'learning',
    'transformer', 'encoder', 'decoder', 'token', 'vocab',
    'loss', 'gradient', 'optimizer', 'batch', 'epoch',
    'fine', 'tune', 'pre', 'train', 'prompt', 'context',
    'generative', 'diffusion', 'gan', 'vae', 'clip',
    'rag', 'vector', 'knowledge', 'graph', 'store',
    'llm', 'nlp', 'cv', 'speech', 'bert', 'gpt', 'llama',
  ],

  patterns: [
    { pattern: '[A-Z][a-z]+(?:-[A-Z][a-z]+)+', type: 'algorithm' as TermType },
    { pattern: '[A-Z]{2,6}', type: 'concept' as TermType },
    { pattern: '[a-z]+-[a-z]+(?:-[a-z]+)*', type: 'concept' as TermType },
  ],

  llmPromptTemplate: `你是 AI/机器学习领域专家。

判断以下词是否为专业术语。

标准：
- 模型架构（如 Transformer, BERT）
- 训练概念（如 Fine-tuning, Gradient）
- 推理参数（如 Temperature, Top-p）
- 框架工具（如 PyTorch, Hugging Face）
- 技术方法（如 Chain-of-Thought, RAG）

剔除：
- 泛词（方法/技术/过程）
- 通用词（结果/输出/输入）

输出格式：
term | label`,
};

// ============================================================
// Medical 领域配置
// ============================================================

export const MEDICAL_CONFIG: DomainConfig = {
  domain: 'medical',

  weights: {
    tfidf: 0.3,
    cvalue: 0.45,
    freq: 0.15,
    length: 0.1,
  },

  whitelist: [
    'MRI', 'CT', 'X-ray', 'PET', 'ultrasound',
    'ICD-10', 'ICD-11', 'SNOMED', 'LOINC',
    'HIPAA', 'FDA', 'EMA',
  ],

  blacklist: [
    'patient', 'doctor', 'hospital', 'treatment',
    'result', 'case', 'study', 'report',
  ],

  roots: [
    'diagnosis', 'treatment', 'therapy', 'medication', 'drug',
    'disease', 'condition', 'symptom', 'sign', 'test',
    'surgery', 'procedure', 'clinical', 'trial', 'study',
    'imaging', 'radiology', 'pathology', 'histology',
    'cardio', 'neuro', 'ortho', 'derma', 'endo',
    'oncology', 'hematology', 'immunology', 'genetics',
    'pharma', 'medicine', 'prescription', 'dosage',
  ],

  patterns: [
    { pattern: '[A-Z]{2,6}', type: 'entity' as TermType },
    { pattern: '[A-Z][a-z]+-[A-Z][a-z]+', type: 'concept' as TermType },
  ],

  llmPromptTemplate: `你是医学领域专家。

判断以下词是否为专业术语。

标准：
- 诊断术语（如 MRI, CT scan）
- 治疗方法（如 chemotherapy, immunotherapy）
- 药物术语（如 dosage, pharmacokinetics）
- 病理术语（如 histology, cytology）
- 标准编码（如 ICD-10, SNOMED）

剔除：
- 泛词（病人/治疗/结果）

输出格式：
term | label`,
};

// ============================================================
// Legal 领域配置
// ============================================================

export const LEGAL_CONFIG: DomainConfig = {
  domain: 'legal',

  weights: {
    tfidf: 0.25,
    cvalue: 0.5,
    freq: 0.15,
    length: 0.1,
  },

  whitelist: [
    'GDPR', 'CCPA', 'HIPAA', 'FERPA',
    'Contract', 'Tort', 'Civil', 'Criminal',
    'Liability', 'Damages', 'Injunction',
    ' plaintiff', 'defendant', 'jurisdiction',
  ],

  blacklist: [
    'law', 'case', 'court', 'judge',
    'document', 'file', 'record', 'matter',
  ],

  roots: [
    'contract', 'tort', 'civil', 'criminal', 'statute',
    'regulation', 'compliance', 'liability', 'damages',
    'plaintiff', 'defendant', 'jurisdiction', 'venue',
    'jurisdiction', 'appeal', 'verdict', 'judgment',
    'injunction', 'remedy', 'settlement', 'arbitration',
    'intellectual', 'property', 'patent', 'trademark',
    'privacy', 'data', 'protection', 'consent',
  ],

  patterns: [
    { pattern: '[A-Z]{2,6}', type: 'concept' as TermType },
    { pattern: '[A-Z][a-z]+(?: [A-Z][a-z]+)+', type: 'concept' as TermType },
  ],

  llmPromptTemplate: `你是法律领域专家。

判断以下词是否为专业术语。

标准：
- 法律概念（如 Liability, Jurisdiction）
- 法规名称（如 GDPR, CCPA）
- 法律程序（如 Injunction, Appeal）
- 合同术语（如 Breach, Remedies）

剔除：
- 泛词（法律/案件/法院）

输出格式：
term | label`,
};

// ============================================================
// Finance 领域配置
// ============================================================

export const FINANCE_CONFIG: DomainConfig = {
  domain: 'finance',

  weights: {
    tfidf: 0.3,
    cvalue: 0.4,
    freq: 0.2,
    length: 0.1,
  },

  whitelist: [
    'IPO', 'ROI', 'IRR', 'NPV', 'EBITDA', 'P/E',
    'SEC', 'FINRA', 'FASB', 'GAAP', 'IFRS',
    'Derivative', 'Option', 'Futures', 'Swap',
    'Hedge', 'Leverage', 'Margin', 'Spread',
  ],

  blacklist: [
    'money', 'value', 'amount', 'price',
    'report', 'statement', 'balance', 'account',
  ],

  roots: [
    'asset', 'liability', 'equity', 'revenue', 'expense',
    'profit', 'loss', 'margin', 'yield', 'return',
    'portfolio', 'investment', 'allocation', 'diversification',
    'derivative', 'option', 'futures', 'swap', 'hedge',
    'leverage', 'debt', 'credit', 'loan', 'mortgage',
    'ipo', 'merger', 'acquisition', 'dividend',
    'audit', 'compliance', 'regulation', 'disclosure',
  ],

  patterns: [
    { pattern: '[A-Z]{2,6}', type: 'metric' as TermType },
    { pattern: '[A-Z][a-z]+(?:/[A-Z][a-z]+)?', type: 'metric' as TermType },
  ],

  llmPromptTemplate: `你是金融领域专家。

判断以下词是否为专业术语。

标准：
- 财务指标（如 ROI, EBITDA）
- 金融工具（如 Derivative, Option）
- 会计准则（如 GAAP, IFRS）
- 监管机构（如 SEC, FINRA）

剔除：
- 泛词（金额/价格/报告）

输出格式：
term | label`,
};

// ============================================================
// DevOps 领域配置
// ============================================================

export const DEVOPS_CONFIG: DomainConfig = {
  domain: 'devops',

  weights: {
    tfidf: 0.3,
    cvalue: 0.4,
    freq: 0.2,
    length: 0.1,
  },

  whitelist: [
    'CI/CD', 'Docker', 'Kubernetes', 'K8s', 'Terraform',
    'Ansible', 'Puppet', 'Chef', 'Salt',
    'Prometheus', 'Grafana', 'ELK', 'Jaeger',
    'GitOps', 'IaC', 'Infrastructure as Code',
  ],

  blacklist: [
    'server', 'system', 'process', 'task',
    'job', 'run', 'execute', 'deploy',
  ],

  roots: [
    'container', 'docker', 'kubernetes', 'pod', 'node',
    'orchestration', 'deployment', 'scaling', 'autoscaling',
    'pipeline', 'ci', 'cd', 'cicd', 'build', 'test',
    'monitor', 'observability', 'metric', 'log', 'trace',
    'alert', 'incident', 'sla', 'slo', 'error budget',
    'infrastructure', 'terraform', 'ansible', 'cloud',
    'aws', 'gcp', 'azure', 'iaas', 'paas', 'saas',
  ],

  patterns: [
    { pattern: '[A-Z]{2,6}', type: 'tool' as TermType },
    { pattern: '[A-Z][a-z]+(?:/[A-Z][a-z]+)?', type: 'concept' as TermType },
  ],

  llmPromptTemplate: `你是 DevOps 领域专家。

判断以下词是否为专业术语。

标准：
- 容器技术（如 Docker, Kubernetes）
- CI/CD 工具（如 Jenkins, GitLab CI）
- 监控系统（如 Prometheus, Grafana）
- 配置管理（如 Terraform, Ansible）

剔除：
- 泛词（服务器/系统/任务）

输出格式：
term | label`,
};

// ============================================================
// General 领域配置（Fallback）
// ============================================================

export const GENERAL_CONFIG: DomainConfig = {
  domain: 'general',

  weights: {
    tfidf: 0.35,
    cvalue: 0.35,
    freq: 0.2,
    length: 0.1,
  },

  whitelist: [],  // 通用领域无白名单

  blacklist: [
    // 极高频泛词
    '系统', '方法', '流程', '方案', '问题', '情况',
    '时间', '功能', '模块', '处理', '方式', '优化',
    'system', 'method', 'process', 'approach', 'technique',
    'function', 'module', 'component', 'element',
    'result', 'output', 'input', 'value', 'data',
    'the', 'a', 'an', 'is', 'are', 'was', 'were',
  ],

  roots: [],  // 通用领域无特定词根

  patterns: [
    { pattern: '[A-Z][a-z]+(?:[A-Z][a-z]+)+', type: 'entity' as TermType },
    { pattern: '[A-Z]{2,8}', type: 'entity' as TermType },
    { pattern: '[a-z]+-[a-z]+(?:-[a-z]+)*', type: 'concept' as TermType },
  ],

  llmPromptTemplate: `你是通用领域专家。

判断以下词是否为专业术语或专有名词。

标准：
- 技术概念
- 专有名词
- 算法方法
- 工具框架

剔除：
- 泛词（系统/方法/流程）
- 日常词汇（问题/情况/方式）
- 常用词（时间/功能/模块）

输出格式：
term | label`,
};

// ============================================================
// 配置汇总
// ============================================================

/**
 * 所有领域配置映射
 */
export const DOMAIN_CONFIGS: Record<DomainType, DomainConfig> = {
  database: DATABASE_CONFIG,
  ai: AI_CONFIG,
  medical: MEDICAL_CONFIG,
  legal: LEGAL_CONFIG,
  finance: FINANCE_CONFIG,
  devops: DEVOPS_CONFIG,
  general: GENERAL_CONFIG,
};

/**
 * 获取领域配置
 */
export function getDomainConfig(domain: DomainType): DomainConfig {
  return DOMAIN_CONFIGS[domain] || GENERAL_CONFIG;
}

/**
 * 合并配置（用于 general fallback 时保留领域匹配能力）
 */
export function mergeConfigs(
  primary: DomainConfig,
  secondary: DomainConfig
): DomainConfig {
  return {
    domain: primary.domain,
    weights: primary.weights,
    whitelist: [...primary.whitelist, ...secondary.whitelist],
    blacklist: [...primary.blacklist, ...secondary.blacklist],
    roots: [...primary.roots, ...secondary.roots],
    patterns: [...primary.patterns, ...secondary.patterns],
    llmPromptTemplate: primary.llmPromptTemplate || secondary.llmPromptTemplate,
  };
}
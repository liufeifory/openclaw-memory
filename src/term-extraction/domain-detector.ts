/**
 * Domain Detector - 领域自动识别
 *
 * 功能：
 * - 关键词匹配检测
 * - 置信度计算
 * - 多领域 fallback 机制
 */

import type { DomainType, DomainDetectionResult } from './types.js';
import { logInfo } from '../maintenance-logger.js';

// ============================================================
// 领域关键词定义
// ============================================================

/**
 * 各领域的关键词集合（用于快速检测）
 */
const DOMAIN_KEYWORDS: Record<DomainType, Set<string>> = {
  database: new Set([
    // 数据库核心技术
    'sql', 'postgres', 'postgresql', 'mysql', 'mongodb', 'redis',
    'index', 'query', 'table', 'schema', 'database',
    'wal', 'checkpoint', 'vacuum', 'transaction', 'commit',
    'acid', 'mvcc', 'lock', 'deadlock', 'isolation',
    'gin', 'gist', 'brin', 'btree', 'hash',
    'pg_dump', 'pg_restore', 'pg_basebackup', 'libpq',
    'join', 'select', 'insert', 'update', 'delete',
    'trigger', 'procedure', 'function', 'cursor',

    // 数据库工具
    'psql', 'vacuumdb', 'reindexdb', 'analyze',
    'initdb', 'pg_ctl', 'pgbench',

    // 数据库概念
    'replication', 'standby', 'primary', 'backup',
    'streaming', 'logical', 'physical',
  ]),

  ai: new Set([
    // 模型架构
    'transformer', 'bert', 'gpt', 'llama', 'claude', 'mistral',
    'attention', 'embedding', 'tokenizer', 'token',
    'encoder', 'decoder', 'layer', 'hidden',

    // 训练概念
    'training', 'fine-tuning', 'pre-training', 'inference',
    'loss', 'gradient', 'backpropagation', 'optimizer',
    'batch', 'epoch', 'learning rate', 'weight decay',
    'overfitting', 'regularization',

    // AI 类型
    'llm', 'nlp', 'ml', 'deep learning', 'machine learning',
    'generative', 'diffusion', 'gan', 'vae',
    'rag', 'vector store', 'knowledge graph',

    // AI 工具
    'pytorch', 'tensorflow', 'hugging face', 'langchain',
    'openai', 'anthropic', 'llamaindex',

    // AI 参数
    'prompt', 'context', 'temperature', 'top-p', 'top-k',
    'zero-shot', 'few-shot', 'chain-of-thought',
  ]),

  medical: new Set([
    // 医疗术语
    'diagnosis', 'treatment', 'therapy', 'medication',
    'patient', 'symptom', 'disease', 'condition',
    'clinical', 'trial', 'study',

    // 医学影像
    'mri', 'ct', 'x-ray', 'pet', 'ultrasound',
    'imaging', 'radiology', 'pathology', 'histology',

    // 医学专科
    'cardiology', 'neurology', 'oncology', 'hematology',
    'immunology', 'genetics', 'pharmacology',

    // 医疗标准
    'icd', 'snomed', 'loinc', 'hipaa', 'fda',

    // 医疗程序
    'surgery', 'procedure', 'test', 'examination',
    'prescription', 'dosage', 'pharma',
  ]),

  legal: new Set([
    // 法律术语
    'contract', 'tort', 'civil', 'criminal', 'statute',
    'regulation', 'compliance', 'liability', 'damages',
    'plaintiff', 'defendant', 'jurisdiction',

    // 法律程序
    'court', 'judge', 'verdict', 'judgment', 'appeal',
    'injunction', 'remedy', 'settlement', 'arbitration',

    // 法律类型
    'intellectual property', 'patent', 'trademark', 'copyright',
    'privacy', 'data protection', 'gdpr', 'ccpa',

    // 法律概念
    'breach', 'negligence', 'fraud', 'liability',
  ]),

  finance: new Set([
    // 财务术语
    'asset', 'liability', 'equity', 'revenue', 'expense',
    'profit', 'loss', 'margin', 'yield', 'return',

    // 金融工具
    'derivative', 'option', 'futures', 'swap', 'hedge',
    'leverage', 'debt', 'credit', 'loan', 'mortgage',

    // 财务指标
    'roi', 'irr', 'npv', 'ebitda', 'pe ratio',
    'ipo', 'merger', 'acquisition', 'dividend',

    // 财务标准
    'gaap', 'ifrs', 'sec', 'finra', 'fasb',

    // 投资概念
    'portfolio', 'investment', 'allocation', 'diversification',
  ]),

  devops: new Set([
    // 容器技术
    'docker', 'kubernetes', 'k8s', 'container', 'pod',
    'orchestration', 'deployment', 'scaling',

    // CI/CD
    'cicd', 'ci', 'cd', 'pipeline', 'build', 'test',
    'jenkins', 'gitlab', 'github actions',

    // 监控
    'prometheus', 'grafana', 'elk', 'jaeger',
    'monitor', 'observability', 'metric', 'log', 'trace',

    // 配置管理
    'terraform', 'ansible', 'puppet', 'chef',
    'infrastructure', 'iac', 'gitops',

    // 云平台
    'aws', 'gcp', 'azure', 'cloud',
    'iaas', 'paas', 'saas',
  ]),

  general: new Set([
    // 通用领域无特定关键词
  ]),
};

// ============================================================
// 加权关键词（核心术语权重更高）
// ============================================================

/**
 * 核心术语（出现即高置信度）
 */
const CORE_TERMS: Record<DomainType, Set<string>> = {
  database: new Set([
    'postgres', 'postgresql', 'mysql', 'mongodb', 'redis',
    'wal', 'mvcc', 'acid', 'checkpoint', 'vacuum',
    'pg_dump', 'pg_restore', 'libpq', 'psql',
  ]),

  ai: new Set([
    'transformer', 'bert', 'gpt', 'llama', 'claude',
    'llm', 'rag', 'fine-tuning', 'pytorch', 'tensorflow',
  ]),

  medical: new Set([
    'mri', 'ct', 'pet', 'icd', 'snomed',
    'diagnosis', 'pathology', 'clinical trial',
  ]),

  legal: new Set([
    'gdpr', 'ccpa', 'contract', 'tort', 'liability',
    'jurisdiction', 'injunction',
  ]),

  finance: new Set([
    'roi', 'ebitda', 'ipo', 'derivative', 'gaap',
    'sec', 'portfolio',
  ]),

  devops: new Set([
    'docker', 'kubernetes', 'terraform', 'prometheus',
    'grafana', 'cicd', 'gitops',
  ]),

  general: new Set(),
};

// ============================================================
// Domain Detector 类
// ============================================================

/**
 * 领域检测器
 */
export class DomainDetector {
  /**
   * 检测文本所属领域
   *
   * 算法：
   * 1. 计算各领域关键词命中数
   * 2. 核心术语加权（命中核心术语 = +2 分）
   * 3. 计算置信度 = (top1 - top2) / (top1 + 1)
   * 4. 如果置信度 < minConfidence，返回 general
   *
   * @param text 输入文本
   * @param minConfidence 最小置信度阈值（默认 0.3）
   * @returns 领域检测结果
   */
  detect(text: string, minConfidence: number = 0.3): DomainDetectionResult {
    const textLower = text.toLowerCase();
    const scores: Record<DomainType, number> = {
      database: 0,
      ai: 0,
      medical: 0,
      legal: 0,
      finance: 0,
      devops: 0,
      general: 0,
    };

    // 1. 计算关键词命中
    for (const [domain, keywords] of Object.entries(DOMAIN_KEYWORDS)) {
      if (domain === 'general') continue;

      for (const keyword of keywords) {
        // 使用 indexOf 检测（比正则更快）
        if (textLower.includes(keyword.toLowerCase())) {
          scores[domain as DomainType] += 1;
        }
      }
    }

    // 2. 核心术语加权
    for (const [domain, coreTerms] of Object.entries(CORE_TERMS)) {
      if (domain === 'general') continue;

      for (const term of coreTerms) {
        if (textLower.includes(term.toLowerCase())) {
          scores[domain as DomainType] += 2;  // 核心术语加权
        }
      }
    }

    // 3. 排序得分
    const sortedDomains = Object.entries(scores)
      .filter(([domain]) => domain !== 'general')
      .sort((a, b) => b[1] - a[1]) as [DomainType, number][];

    // 4. 计算置信度
    const top1 = sortedDomains[0];
    const top2 = sortedDomains[1] || ['general', 0];

    // 无任何匹配
    if (top1[1] === 0) {
      logInfo('[DomainDetector] No domain match, returning general');
      return {
        domain: 'general',
        confidence: 0,
        scores,
      };
    }

    // 计算置信度
    const confidence = (top1[1] - top2[1]) / (top1[1] + 1);

    // 低置信度时返回 general（但保留匹配能力）
    if (confidence < minConfidence) {
      logInfo(`[DomainDetector] Low confidence (${confidence.toFixed(2)}), returning general`);
      return {
        domain: 'general',
        confidence,
        scores,
      };
    }

    logInfo(`[DomainDetector] Detected: ${top1[0]} (confidence: ${confidence.toFixed(2)}, score: ${top1[1]})`);

    return {
      domain: top1[0],
      confidence,
      scores,
    };
  }

  /**
   * 检测并返回合并配置
   *
   * 当检测为 general 时，合并所有高分领域的配置
   * 以保留领域匹配能力
   *
   * @param text 输入文本
   * @returns 检测结果 + 是否需要合并
   */
  detectWithFallback(text: string): {
    result: DomainDetectionResult;
    needsMerge: boolean;
    secondaryDomains: DomainType[];
  } {
    const result = this.detect(text);

    // 如果是 general，检查是否需要合并
    if (result.domain === 'general') {
      // 找出得分 > 0 的领域
      const secondaryDomains = Object.entries(result.scores)
        .filter(([domain, score]) => domain !== 'general' && score > 0)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)  // 最多合并 3 个领域
        .map(([domain]) => domain as DomainType);

      return {
        result,
        needsMerge: secondaryDomains.length > 0,
        secondaryDomains,
      };
    }

    return {
      result,
      needsMerge: false,
      secondaryDomains: [],
    };
  }

  /**
   * 快速检测（只返回领域，不计算置信度）
   */
  quickDetect(text: string): DomainType {
    const result = this.detect(text, 0.3);
    return result.domain;
  }

  /**
   * 分析单个块的领域（用于混合文档）
   *
   * 高置信度块可以覆盖文档级领域
   *
   * @param block 块文本内容
   * @returns 块级领域检测结果
   */
  analyzeBlock(block: string): {
    domain: DomainType;
    confidence: number;
  } {
    const result = this.detect(block, 0.3);
    return {
      domain: result.domain,
      confidence: result.confidence,
    };
  }

  /**
   * 决策是否使用块级覆盖
   *
   * 条件：块置信度 > 文档置信度 * 1.2 时覆盖
   *
   * @param blockConfidence 块置信度
   * @param docConfidence 文档置信度
   * @returns 是否覆盖
   */
  shouldOverride(
    blockConfidence: number,
    docConfidence: number
  ): boolean {
    // 低置信度块不覆盖（避免噪声）
    if (blockConfidence < 0.5) return false;

    // 块置信度显著高于文档置信度时覆盖
    return blockConfidence > docConfidence * 1.2;
  }

  /**
   * 选择有效领域（文档级 vs 块级）
   *
   * @param docResult 文档级检测结果
   * @param blockResult 块级检测结果
   * @returns 有效领域
   */
  selectEffectiveDomain(
    docResult: { domain: DomainType; confidence: number },
    blockResult: { domain: DomainType; confidence: number }
  ): DomainType {
    if (this.shouldOverride(blockResult.confidence, docResult.confidence)) {
      logInfo(`[DomainDetector] Block override: ${blockResult.domain} (block: ${blockResult.confidence.toFixed(2)} > doc: ${docResult.confidence.toFixed(2)})`);
      return blockResult.domain;
    }
    return docResult.domain;
  }
}

// ============================================================
// 导出单例
// ============================================================

/**
 * 全局领域检测器实例
 */
export const domainDetector = new DomainDetector();
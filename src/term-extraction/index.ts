/**
 * Term Extraction Module - 术语抽取模块
 *
 * 用于替代三元组提取，直接抽取专业术语
 *
 * 使用方式：
 * ```typescript
 * import { extractTerms, detectDomain } from './term-extraction/index.js';
 *
 * // 快速抽取
 * const terms = extractTerms(text);
 *
 * // 检测领域
 * const { domain, confidence } = detectDomain(text);
 *
 * // 使用 Pipeline
 * const pipeline = new TermExtractionPipeline({ llm: { enabled: true } });
 * const result = pipeline.extract(text);
 * ```
 */

// ============================================================
// Types
// ============================================================

export type {
  DomainType,
  DomainDetectionResult,
  TermType,
  TermSource,
  ExtractedTerm,
  TermCandidate,
  NgramConfig,
  DomainConfig,
  TermCacheItem,
  CacheStats,
  LLMBatchConfig,
  LLMJudgmentResult,
  TermExtractionConfig,
  TermExtractionResult,
  TrieNode,
} from './types.js';

export { DEFAULT_TERM_EXTRACTION_CONFIG } from './types.js';

// ============================================================
// Domain Detection
// ============================================================

export { DomainDetector, domainDetector } from './domain-detector.js';

// ============================================================
// Domain Configs
// ============================================================

export {
  DATABASE_CONFIG,
  AI_CONFIG,
  MEDICAL_CONFIG,
  LEGAL_CONFIG,
  FINANCE_CONFIG,
  DEVOPS_CONFIG,
  GENERAL_CONFIG,
  DOMAIN_CONFIGS,
  getDomainConfig,
  mergeConfigs,
} from './domain-configs.js';

// ============================================================
// Statistical Layer
// ============================================================

export { StatisticalLayer } from './statistical-layer.js';

// ============================================================
// Candidate Filter
// ============================================================

export { CandidateFilter } from './candidate-filter.js';

// ============================================================
// Cache
// ============================================================

export { TermCache, termCache } from './cache.js';

// ============================================================
// Pipeline
// ============================================================

export {
  TermExtractionPipeline,
  termExtractionPipeline,
  extractTerms,
  detectDomain,
} from './pipeline.js';
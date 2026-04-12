/**
 * Term Extraction Pipeline - 术语抽取主流程
 *
 * 分层架构：
 * [1] Domain Detection → [2] Statistical → [3] Candidate Filter → [4] Cache → [5] LLM (可选)
 *
 * 设计原则：
 * - 多领域自适应
 * - 高性能（Trie优化）
 * - 低成本（缓存命中率高）
 */

import { logInfo } from '../maintenance-logger.js';
import type {
  TermExtractionConfig,
  TermExtractionResult,
  ExtractedTerm,
  DomainType,
  TermType,
} from './types.js';
import { DomainDetector } from './domain-detector.js';
import { StatisticalLayer } from './statistical-layer.js';
import { CandidateFilter } from './candidate-filter.js';
import { TermCache, termCache } from './cache.js';
import {
  getDomainConfig,
  mergeConfigs,
} from './domain-configs.js';
import type { DomainConfig } from './domain-configs.js';

// ============================================================
// Term Extraction Pipeline 类
// ============================================================

/**
 * 术语抽取 Pipeline
 */
export class TermExtractionPipeline {
  private config: TermExtractionConfig;
  private domainDetector: DomainDetector;
  private statisticalLayer: StatisticalLayer;
  private candidateFilter: CandidateFilter;
  private cache: TermCache;

  constructor(config?: Partial<TermExtractionConfig>) {
    // 合并默认配置
    this.config = {
      domainDetection: {
        enabled: true,
        minConfidence: 0.3,
        ...config?.domainDetection,
      },
      statistical: {
        maxN: 3,
        minFreq: 2,
        minLength: 3,
        maxLength: 50,
        ...config?.statistical,
      },
      candidate: {
        topK: 200,
        minScore: 1.0,
        ...config?.candidate,
      },
      llm: {
        enabled: false,
        batchSize: 50,
        timeout: 120000,
        temperature: 0,
        maxTokens: 2000,
        ...config?.llm,
      },
      cache: {
        enabled: true,
        maxSize: 10000,
        ...config?.cache,
      },
    };

    // 初始化各层
    this.domainDetector = new DomainDetector();
    this.statisticalLayer = new StatisticalLayer(this.config.statistical);
    this.candidateFilter = new CandidateFilter();
    this.cache = this.config.cache.enabled ? termCache : new TermCache(0);

    logInfo('[TermExtractionPipeline] Initialized');
  }

  /**
   * 执行术语抽取
   *
   * @param text 输入文本
   * @returns 抽取结果
   */
  extract(text: string): TermExtractionResult {
    const startTime = Date.now();
    const timing = {
      domainDetection: 0,
      statistical: 0,
      filtering: 0,
      cacheLookup: 0,
      llmJudgment: 0,
      total: 0,
    };

    const stats = {
      candidates: 0,
      filtered: 0,
      cached: 0,
      llmJudged: 0,
      final: 0,
    };

    const layerStats = {
      whitelist: 0,
      regex: 0,
      statistical: 0,
      llm: 0,
    };

    // ============================================================
    // Step 1: Domain Detection
    // ============================================================
    const domainStartTime = Date.now();

    let domain: DomainType = 'general';
    let domainConfidence = 0;
    let domainConfig: DomainConfig;

    if (this.config.domainDetection.enabled) {
      const detectionResult = this.domainDetector.detect(
        text,
        this.config.domainDetection.minConfidence
      );

      domain = detectionResult.domain;
      domainConfidence = detectionResult.confidence;

      // 获取领域配置
      domainConfig = getDomainConfig(domain);

      // 如果是 general 且有其他领域匹配，合并配置
      if (domain === 'general' && this.config.domainDetection.enabled) {
        const fallbackResult = this.domainDetector.detectWithFallback(text);

        if (fallbackResult.needsMerge && fallbackResult.secondaryDomains.length > 0) {
          // 合合所有匹配领域的配置
          const primaryConfig = getDomainConfig('general');
          const secondaryConfigs = fallbackResult.secondaryDomains.map(d => getDomainConfig(d));

          // 合合配置（保留所有领域的白名单）
          domainConfig = secondaryConfigs.reduce(
            (merged, secondary) => mergeConfigs(merged, secondary),
            primaryConfig
          );

          logInfo(`[Pipeline] Merged configs for domains: ${fallbackResult.secondaryDomains.join(', ')}`);
        }
      }
    } else {
      domainConfig = getDomainConfig('general');
    }

    timing.domainDetection = Date.now() - domainStartTime;

    logInfo(`[Pipeline] Domain: ${domain} (confidence: ${domainConfidence.toFixed(2)})`);

    // ============================================================
    // Step 2: Statistical Layer
    // ============================================================
    const statisticalStartTime = Date.now();

    const candidates = this.statisticalLayer.extract(
      text,
      domainConfig.weights,
      domain
    );

    stats.candidates = candidates.length;

    timing.statistical = Date.now() - statisticalStartTime;

    // ============================================================
    // Step 3: Candidate Filter
    // ============================================================
    const filteringStartTime = Date.now();

    const filteredTerms = this.candidateFilter.filter(
      candidates.slice(0, this.config.candidate.topK),
      domainConfig,
      domain
    );

    stats.filtered = filteredTerms.length;

    // 计算分层统计
    layerStats.whitelist = filteredTerms.filter(t => t.source === 'whitelist').length;
    layerStats.regex = filteredTerms.filter(t => t.source === 'regex').length;
    layerStats.statistical = filteredTerms.filter(t => t.source === 'statistical').length;

    timing.filtering = Date.now() - filteringStartTime;

    // ============================================================
    // Step 4: Cache Lookup
    // ============================================================
    const cacheStartTime = Date.now();

    const finalTerms: ExtractedTerm[] = [];
    const termsNeedLLM: ExtractedTerm[] = [];

    for (const term of filteredTerms) {
      // 缓存查询（对于 statistical 来源的术语）
      if (term.source === 'statistical' && this.config.cache.enabled) {
        const cached = this.cache.checkAndGet(term.normalized, domain);

        if (cached) {
          finalTerms.push(cached);
          stats.cached++;
          continue;
        }
      }

      // 非缓存术语，加入最终列表或待 LLM 判定
      finalTerms.push(term);

      // 如果启用 LLM 且置信度较低，需要 LLM 判定
      if (this.config.llm.enabled && term.confidence < 0.8) {
        termsNeedLLM.push(term);
      }
    }

    timing.cacheLookup = Date.now() - cacheStartTime;

    // ============================================================
    // Step 5: LLM Judgment (可选)
    // ============================================================
    if (this.config.llm.enabled && termsNeedLLM.length > 0) {
      const llmStartTime = Date.now();

      // TODO: 实现 LLM 批处理判定
      // 这里暂时跳过，实际实现需要 LLMClient

      stats.llmJudged = termsNeedLLM.length;
      layerStats.llm = termsNeedLLM.length;

      timing.llmJudgment = Date.now() - llmStartTime;

      logInfo(`[Pipeline] LLM judgment skipped (not implemented)`);
    }

    // ============================================================
    // Step 6: Post-processing
    // ============================================================

    // 按评分排序
    finalTerms.sort((a, b) => b.score - a.score);

    // 限制数量
    const limitedTerms = finalTerms.slice(0, this.config.candidate.topK);

    stats.final = limitedTerms.length;

    // 更新缓存
    if (this.config.cache.enabled) {
      for (const term of limitedTerms) {
        this.cache.storeExtractedTerm(term);
      }

      // Positive Feedback Loop: 自动晋升高置信度术语为种子
      const promotedCount = this.cache.autoPromoteSeedTerms(limitedTerms);
      if (promotedCount > 0) {
        logInfo(`[Pipeline] Positive Feedback Loop: promoted ${promotedCount} seed terms`);
      }
    }

    timing.total = Date.now() - startTime;

    logInfo(`[Pipeline] Completed: ${stats.final} terms in ${timing.total}ms`);

    return {
      domain,
      domainConfidence,
      terms: limitedTerms,
      stats,
      layerStats,
      timing,
    };
  }

  /**
   * 快速抽取（不使用 LLM）
   *
   * 用于高频调用场景
   */
  quickExtract(text: string): ExtractedTerm[] {
    const result = this.extract(text);
    return result.terms;
  }

  /**
   * 检测领域并返回配置
   */
  detectDomain(text: string): {
    domain: DomainType;
    confidence: number;
    config: DomainConfig;
  } {
    const result = this.domainDetector.detect(text, this.config.domainDetection.minConfidence);
    const config = getDomainConfig(result.domain);

    return {
      domain: result.domain,
      confidence: result.confidence,
      config,
    };
  }

  /**
   * 获取缓存统计
   */
  getCacheStats() {
    return this.cache.getStats();
  }

  /**
   * 加载种子术语（冷启动）
   */
  loadSeedTerms(
    terms: Array<{ term: string; type?: TermType; domain?: DomainType }>,
    defaultDomain: DomainType = 'general'
  ) {
    this.cache.loadSeedTerms(terms, defaultDomain);
  }

  /**
   * 清空缓存
   */
  clearCache() {
    this.cache.clear();
  }
}

// ============================================================
// 导出单例
// ============================================================

/**
 * 默认 Pipeline 实例
 */
export const termExtractionPipeline = new TermExtractionPipeline();

// ============================================================
// 导出便捷函数
// ============================================================

/**
 * 快速抽取术语
 */
export function extractTerms(text: string): ExtractedTerm[] {
  return termExtractionPipeline.quickExtract(text);
}

/**
 * 检测文本领域
 */
export function detectDomain(text: string): {
  domain: DomainType;
  confidence: number;
} {
  return termExtractionPipeline.detectDomain(text);
}
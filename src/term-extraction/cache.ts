/**
 * Term Cache - 术语缓存层
 *
 * 功能：
 * - 缓存已判定术语
 * - 按领域分区存储
 * - 命中率统计
 * - 冷启动种子加载
 */

import { logInfo, logError } from '../maintenance-logger.js';
import type {
  TermCacheItem,
  CacheStats,
  DomainType,
  ExtractedTerm,
  TermType,
} from './types.js';

// ============================================================
// Term Cache 类
// ============================================================

/**
 * 术语缓存
 *
 * 使用 Map 存储，键为 (domain, normalized) 组合
 */
export class TermCache {
  private cache: Map<string, TermCacheItem>;
  private maxSize: number;
  private stats: {
    hits: number;
    misses: number;
  };

  constructor(maxSize: number = 10000) {
    this.cache = new Map();
    this.maxSize = maxSize;
    this.stats = {
      hits: 0,
      misses: 0,
    };
  }

  /**
   * 生成缓存键
   */
  private _getKey(normalized: string, domain: DomainType): string {
    return `${domain}:${normalized}`;
  }

  /**
   * 查询缓存
   *
   * @param normalized 标准化术语
   * @param domain 领域
   * @returns 缓存项或 null
   */
  lookup(normalized: string, domain: DomainType): TermCacheItem | null {
    const key = this._getKey(normalized, domain);
    const item = this.cache.get(key);

    if (item) {
      this.stats.hits++;
      // 更新命中计数
      item.hitCount++;
      return item;
    }

    this.stats.misses++;
    return null;
  }

  /**
   * 存入缓存
   */
  store(
    term: string,
    normalized: string,
    domain: DomainType,
    type: TermType,
    label: string,
    confidence: number
  ): void {
    // 检查容量
    if (this.cache.size >= this.maxSize) {
      this._evictOldest();
    }

    const key = this._getKey(normalized, domain);

    const item: TermCacheItem = {
      term,
      normalized,
      domain,
      type,
      label,
      confidence,
      createdAt: new Date(),
      hitCount: 0,
    };

    this.cache.set(key, item);
    logInfo(`[TermCache] Stored: ${term} (${domain})`);
  }

  /**
   * 存储 ExtractedTerm
   */
  storeExtractedTerm(term: ExtractedTerm): void {
    this.store(
      term.term,
      term.normalized,
      term.domain,
      term.type,
      term.label,
      term.confidence
    );
  }

  /**
   * 批量加载种子术语（冷启动）
   *
   * @param seedTerms 种子术语列表
   * @param domain 默认领域
   */
  loadSeedTerms(
    seedTerms: Array<{ term: string; type?: TermType; domain?: DomainType }>,
    defaultDomain: DomainType = 'general'
  ): void {
    for (const seed of seedTerms) {
      const normalized = seed.term.toLowerCase();
      const domain = seed.domain || defaultDomain;
      const type = seed.type || 'concept';

      this.store(
        seed.term,
        normalized,
        domain,
        type,
        `T/${type}`,
        1.0  // 种子术语置信度最高
      );
    }

    logInfo(`[TermCache] Loaded ${seedTerms.length} seed terms`);
  }

  /**
   * 检查是否命中缓存并返回结果
   *
   * 用于 Pipeline 中快速路径
   */
  checkAndGet(
    normalized: string,
    domain: DomainType
  ): ExtractedTerm | null {
    const cached = this.lookup(normalized, domain);

    if (cached) {
      return {
        term: cached.term,
        normalized: cached.normalized,
        namespace: `${cached.domain}.${cached.normalized}`,
        domain: cached.domain,
        type: cached.type,
        label: cached.label,
        source: 'whitelist',  // 缓存命中视为白名单级别
        confidence: cached.confidence,
        freq: 0,  // 缓存项不记录频次
        score: cached.confidence * 10,  // 转换为评分
        casePattern: 'UPPER',  // 默认
      };
    }

    return null;
  }

  /**
   * 获取缓存统计
   */
  getStats(): CacheStats {
    const total = this.stats.hits + this.stats.misses;
    const hitRate = total > 0 ? this.stats.hits / total : 0;

    return {
      size: this.cache.size,
      hits: this.stats.hits,
      misses: this.stats.misses,
      hitRate,
    };
  }

  /**
   * 获取各领域缓存大小
   */
  getDomainStats(): Record<DomainType, number> {
    const stats: Record<DomainType, number> = {
      database: 0,
      ai: 0,
      medical: 0,
      legal: 0,
      finance: 0,
      devops: 0,
      general: 0,
    };

    for (const item of this.cache.values()) {
      stats[item.domain]++;
    }

    return stats;
  }

  /**
   * 清理最旧项（容量管理）
   */
  private _evictOldest(): void {
    // 找出最旧且命中次数最低的项
    let oldestKey: string | null = null;
    let oldestTime = Date.now();
    let lowestHits = Infinity;

    for (const [key, item] of this.cache) {
      const itemTime = item.createdAt.getTime();
      if (itemTime < oldestTime || (itemTime === oldestTime && item.hitCount < lowestHits)) {
        oldestKey = key;
        oldestTime = itemTime;
        lowestHits = item.hitCount;
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey);
      logInfo(`[TermCache] Evicted oldest item (hits: ${lowestHits})`);
    }
  }

  /**
   * 清空缓存
   */
  clear(): void {
    this.cache.clear();
    this.stats.hits = 0;
    this.stats.misses = 0;
    logInfo('[TermCache] Cleared');
  }

  /**
   * 获取所有术语
   */
  getAllTerms(): TermCacheItem[] {
    return Array.from(this.cache.values());
  }

  /**
   * 导出为 JSON
   */
  exportJson(): string {
    const items = this.getAllTerms();
    return JSON.stringify(items, null, 2);
  }

  /**
   * 从 JSON 导入
   */
  importJson(json: string): void {
    try {
      const items = JSON.parse(json) as TermCacheItem[];

      for (const item of items) {
        const key = this._getKey(item.normalized, item.domain);
        item.createdAt = new Date(item.createdAt);
        this.cache.set(key, item);
      }

      logInfo(`[TermCache] Imported ${items.length} items`);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logError(`[TermCache] Import failed: ${errorMessage}`);
    }
  }

  /**
   * 自动晋升种子术语（Positive Feedback Loop）
   *
   * 当术语满足以下条件时，自动晋升为 Seed_Term：
   * - confidence >= 0.95（极高置信度）
   * - frequency >= 50（极高频次）
   * - domain != 'general'（明确领域）
   *
   * 效果：
   * - 系统越跑越快
   * - LLM 调用率随时间单调递减
   * - 新文档处理效率持续提升
   *
   * @param extractedTerms 提取的术语列表
   * @returns 晋升的种子术语数量
   */
  autoPromoteSeedTerms(extractedTerms: ExtractedTerm[]): number {
    const promotionThreshold = {
      minConfidence: 0.95,
      minFrequency: 50,
      excludeDomain: 'general' as DomainType,
    };

    let promotedCount = 0;

    for (const term of extractedTerms) {
      // 检查晋升条件
      if (
        term.confidence >= promotionThreshold.minConfidence &&
        term.freq >= promotionThreshold.minFrequency &&
        term.domain !== promotionThreshold.excludeDomain
      ) {
        // 检查是否已存在（避免重复晋升）
        const existing = this.lookup(term.normalized, term.domain);
        if (existing && existing.confidence >= 1.0) {
          continue;  // 已是种子术语
        }

        // 晋升为种子术语
        this.store(
          term.term,
          term.normalized,
          term.domain,
          term.type,
          term.label,
          1.0  // 种子术语置信度最高
        );

        promotedCount++;
        logInfo(`[TermCache] Auto-promoted seed term: ${term.term} (${term.domain}, freq=${term.freq})`);
      }
    }

    if (promotedCount > 0) {
      logInfo(`[TermCache] Positive Feedback Loop: promoted ${promotedCount} seed terms`);
    }

    return promotedCount;
  }

  /**
   * 获取种子术语列表（用于冷启动）
   */
  getSeedTerms(): TermCacheItem[] {
    const seeds: TermCacheItem[] = [];

    for (const item of this.cache.values()) {
      if (item.confidence >= 1.0 && item.domain !== 'general') {
        seeds.push(item);
      }
    }

    return seeds;
  }

  /**
   * 导出种子术语（用于持久化）
   */
  exportSeedTerms(): string {
    const seeds = this.getSeedTerms();
    return JSON.stringify(seeds, null, 2);
  }
}

// ============================================================
// 导出单例
// ============================================================

/**
 * 全局术语缓存实例
 */
export const termCache = new TermCache(10000);
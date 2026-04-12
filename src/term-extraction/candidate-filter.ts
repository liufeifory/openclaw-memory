/**
 * Candidate Filter - 候选层（规则过滤）
 *
 * 功能：
 * - 白名单匹配（必保留）
 * - 黑名单过滤（必剔除）
 * - 词根验证（连字符词）
 * - 正则模式匹配
 * - 领域特定规则
 */

import { logInfo } from '../maintenance-logger.js';
import type {
  TermCandidate,
  ExtractedTerm,
  DomainType,
  TermType,
  TermSource,
} from './types.js';
import type { DomainConfig } from './domain-configs.js';

// ============================================================
// SQL 关键字黑名单（全局）
// ============================================================

const SQL_KEYWORDS = new Set([
  'SELECT', 'FROM', 'WHERE', 'ORDER', 'GROUP', 'HAVING', 'LIMIT',
  'OFFSET', 'INSERT', 'UPDATE', 'DELETE', 'CREATE', 'DROP', 'ALTER',
  'JOIN', 'LEFT', 'RIGHT', 'INNER', 'OUTER', 'CROSS', 'NATURAL',
  'UNION', 'EXCEPT', 'INTERSECT', 'WITH', 'AS', 'ON', 'USING',
  'AND', 'OR', 'NOT', 'IN', 'IS', 'LIKE', 'BETWEEN', 'EXISTS',
  'NULL', 'TRUE', 'FALSE', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END',
  'CAST', 'COALESCE', 'NULLIF', 'DISTINCT', 'ALL', 'ANY', 'SOME',
]);

// ============================================================
// Candidate Filter 类
// ============================================================

/**
 * 候选过滤器
 */
export class CandidateFilter {
  /**
   * 过滤候选术语
   *
   * @param candidates 统计层输出的候选
   * @param config 领域配置
   * @param domain 领域类型
   * @returns 过滤后的术语
   */
  filter(
    candidates: TermCandidate[],
    config: DomainConfig,
    domain: DomainType
  ): ExtractedTerm[] {
    const results: ExtractedTerm[] = [];
    const whitelistSet = new Set(config.whitelist.map((w: string) => w.toLowerCase()));
    const blacklistSet = new Set(config.blacklist.map((b: string) => b.toLowerCase()));
    const rootsSet = new Set(config.roots);

    for (const candidate of candidates) {
      const normalized = candidate.normalized;

      // 1. 黑名单过滤（优先级最高）
      if (blacklistSet.has(normalized)) {
        continue;
      }

      // 2. SQL 关键字过滤
      if (SQL_KEYWORDS.has(candidate.term.toUpperCase())) {
        continue;
      }

      // 3. 白名单匹配（必保留）
      if (whitelistSet.has(normalized)) {
        results.push(this._createExtractedTerm(
          candidate,
          domain,
          this._inferType(candidate.term),
          'whitelist',
          1.0  // 白名单置信度最高
        ));
        continue;
      }

      // 4. pg_ 前缀（必保留）
      if (candidate.type === 'pg_prefix') {
        results.push(this._createExtractedTerm(
          candidate,
          domain,
          'api',
          'regex',
          0.95
        ));
        continue;
      }

      // 5. CamelCase（源码术语）
      if (candidate.type === 'camelcase') {
        // 检查是否是重复噪声（如 PgPgPgPg）
        if (this._isRepetitiveCamelCase(candidate.term)) {
          continue;
        }

        results.push(this._createExtractedTerm(
          candidate,
          domain,
          'component',
          'regex',
          0.85
        ));
        continue;
      }

      // 6. 连字符术语（需要词根验证）
      if (candidate.type === 'hyphenated') {
        const parts = normalized.split('-');

        // 排除单字母片段噪声
        if (parts.some(p => p.length <= 1)) {
          continue;
        }

        // 检查是否包含领域词根
        if (rootsSet.size > 0 && parts.some(p => rootsSet.has(p))) {
          results.push(this._createExtractedTerm(
            candidate,
            domain,
            'concept',
            'statistical',
            0.75
          ));
          continue;
        }

        // 通用领域的连字符词（宽松验证）
        if (domain === 'general') {
          results.push(this._createExtractedTerm(
            candidate,
            domain,
            'concept',
            'statistical',
            0.6
          ));
        }
        continue;
      }

      // 7. 全大写缩写（需要白名单验证）
      if (candidate.type === 'acronym') {
        // 如果在白名单中，保留
        if (whitelistSet.has(normalized)) {
          results.push(this._createExtractedTerm(
            candidate,
            domain,
            'entity',
            'whitelist',
            1.0
          ));
          continue;
        }

        // 其他缩写（根据评分决定）
        if (candidate.score > 2.0) {
          results.push(this._createExtractedTerm(
            candidate,
            domain,
            'entity',
            'statistical',
            0.7
          ));
        }
        continue;
      }

      // 8. 普通单词（N-gram 组合）
      // 只有高分且包含领域词根时保留
      if (candidate.score > 3.0) {
        const tokens = normalized.split(' ');
        if (rootsSet.size > 0 && tokens.some(t => rootsSet.has(t))) {
          results.push(this._createExtractedTerm(
            candidate,
            domain,
            'concept',
            'statistical',
            0.6
          ));
        }
      }
    }

    logInfo(`[CandidateFilter] Filtered: ${candidates.length} → ${results.length}`);

    return results;
  }

  /**
   * 创建 ExtractedTerm 对象
   */
  private _createExtractedTerm(
    candidate: TermCandidate,
    domain: DomainType,
    type: TermType,
    source: TermSource,
    confidence: number
  ): ExtractedTerm {
    return {
      term: candidate.term,
      normalized: candidate.normalized,
      namespace: `${domain}.${candidate.normalized}`,
      domain,
      type,
      label: `T/${this._typeToLabel(type)}`,
      source,
      confidence,
      freq: candidate.freq,
      score: candidate.score,
      casePattern: candidate.casePattern,
    };
  }

  /**
   * 类型转标签
   */
  private _typeToLabel(type: TermType): string {
    const labelMap: Record<TermType, string> = {
      component: '组件',
      parameter: '参数',
      algorithm: '算法',
      tool: '工具',
      concept: '概念',
      protocol: '协议',
      api: 'API',
      metric: '指标',
      entity: '实体',
    };

    return labelMap[type] || '概念';
  }

  /**
   * 推断术语类型
   */
  private _inferType(term: string): TermType {
    const lower = term.toLowerCase();

    // 配置参数模式（如 shared_buffers, max_connections）
    if (lower.includes('_') && !lower.startsWith('pg_')) {
      return 'parameter';
    }

    // 工具命令（如 pg_dump, vacuumdb）
    if (lower.startsWith('pg_') && lower.length <= 20) {
      return 'tool';
    }

    // 算法/方法（如 b-tree, hash-join）
    if (lower.includes('-') && lower.includes('join') || lower.includes('tree')) {
      return 'algorithm';
    }

    // 协议（如 libpq, ecpg）
    if (lower.startsWith('lib') || lower === 'ecpg') {
      return 'protocol';
    }

    // 默认为概念
    return 'concept';
  }

  /**
   * 检查是否是重复噪声的 CamelCase
   *
   * 如 "PgPgPgPg" 是重复的 "Pg"
   */
  private _isRepetitiveCamelCase(term: string): boolean {
    const parts = term.match(/[A-Z][a-z]+/g) || [];

    if (parts.length >= 3) {
      const uniqueParts = new Set(parts);
      // 如果所有部分都相同且数量 >= 3，则是重复噪声
      if (uniqueParts.size === 1) {
        return true;
      }
    }

    return false;
  }
}
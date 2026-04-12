/**
 * Statistical Layer - 统计层（候选生成 + 打分）
 *
 * 核心：
 * - TF-IDF 计算
 * - C-value 计算（Trie 树优化）
 * - N-gram 生成
 * - 综合评分
 */

import { logInfo } from '../maintenance-logger.js';
import type {
  TermCandidate,
  NgramConfig,
  DomainType,
} from './types.js';

// ============================================================
// Trie 树实现（C-value 优化）
// ============================================================

/**
 * Trie 树节点
 */
interface TrieNodeData {
  children: Map<string, TrieNodeData>;
  freq: number;
  isEnd: boolean;
  term: string;
}

/**
 * Trie 树类 - 用于优化 C-value 计算
 *
 * 优化原理：
 * - 按单词数量从长到短处理
 * - 长词的频率信息存入 Trie
 * - 子词计算时直接查询，避免 O(N²) 字符串匹配
 */
class Trie {
  private root: TrieNodeData;

  constructor() {
    this.root = {
      children: new Map(),
      freq: 0,
      isEnd: false,
      term: '',
    };
  }

  /**
   * 插入术语
   */
  insert(term: string, freq: number = 1): void {
    const tokens = term.split(' ');
    let node = this.root;

    for (const token of tokens) {
      if (!node.children.has(token)) {
        node.children.set(token, {
          children: new Map(),
          freq: 0,
          isEnd: false,
          term: '',
        });
      }
      const childNode = node.children.get(token);
      if (!childNode) continue;
      node = childNode;
    }

    node.isEnd = true;
    node.freq = freq;
    node.term = term;
  }

  /**
   * 查找包含目标术语的所有更长术语
   *
   * 优化：只遍历可能包含的分支
   */
  findContainingTerms(term: string): string[] {
    const results: string[] = [];
    const targetTokens = term.split(' ');

    // 从根节点开始搜索
    this._searchContaining(this.root, targetTokens, [], results);

    return results;
  }

  private _searchContaining(
    node: TrieNodeData,
    targetTokens: string[],
    currentPath: string[],
    results: string[]
  ): void {
    // 如果当前节点是终点且比目标术语长
    if (node.isEnd && currentPath.length > targetTokens.length) {
      // 检查当前路径是否包含目标术语
      const _currentTerm = currentPath.join(' ');
      if (this._contains(currentPath, targetTokens)) {
        results.push(node.term);
      }
    }

    // 继续搜索子节点
    for (const [token, child] of node.children) {
      this._searchContaining(child, targetTokens, [...currentPath, token], results);
    }
  }

  private _contains(path: string[], target: string[]): boolean {
    // 检查 target 是否是 path 的子序列
    let targetIndex = 0;

    for (const token of path) {
      if (token === target[targetIndex]) {
        targetIndex++;
        if (targetIndex === target.length) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * 获取所有术语
   */
  getAllTerms(): Array<{ term: string; freq: number }> {
    const results: Array<{ term: string; freq: number }> = [];
    this._collectTerms(this.root, [], results);
    return results;
  }

  private _collectTerms(
    node: TrieNodeData,
    path: string[],
    results: Array<{ term: string; freq: number }>
  ): void {
    if (node.isEnd) {
      results.push({ term: node.term, freq: node.freq });
    }

    for (const [token, child] of node.children) {
      this._collectTerms(child, [...path, token], results);
    }
  }
}

// ============================================================
// 统计层类
// ============================================================

/**
 * 统计层 - 术语候选生成
 */
export class StatisticalLayer {
  private config: NgramConfig;

  constructor(config: NgramConfig) {
    this.config = config;
  }

  /**
   * 分词
   *
   * 提取各类术语模式：
   * - pg_ 前缀术语
   * - CamelCase 术语
   * - 连字符术语
   * - 全大写缩写
   * - 普通单词
   */
  tokenize(text: string): string[] {
    const tokens: string[] = [];

    // 1. pg_ 前缀术语（高优先级）
    const pgPattern = /pg_[a-z0-9_]+/gi;
    const pgMatches = text.match(pgPattern) || [];
    tokens.push(...pgMatches);

    // 2. CamelCase 术语
    const camelPattern = /[A-Z][a-z]+(?:[A-Z][a-z]+)+/g;
    const camelMatches = text.match(camelPattern) || [];
    tokens.push(...camelMatches);

    // 3. 连字符术语
    const hyphenPattern = /[A-Za-z]+(?:-[A-Za-z]+)+/g;
    const hyphenMatches = text.match(hyphenPattern) || [];
    tokens.push(...hyphenMatches);

    // 4. 全大写缩写（2-8 字符）
    const acronymPattern = /\b[A-Z]{2,8}\b/g;
    const acronymMatches = text.match(acronymPattern) || [];
    tokens.push(...acronymMatches);

    // 5. 普通单词（只取英文单词，保留中文词）
    const wordPattern = /[A-Za-z][a-z]+/g;
    const wordMatches = text.match(wordPattern) || [];

    // 过滤停用词
    const filteredWords = this._filterStopwords(wordMatches);
    tokens.push(...filteredWords);

    return tokens;
  }

  /**
   * 过滤停用词
   */
  private _filterStopwords(tokens: string[]): string[] {
    const STOPWORDS = new Set([
      // 英文停用词
      'the', 'a', 'an', 'this', 'that', 'it', 'if', 'for', 'of', 'to',
      'is', 'are', 'was', 'were', 'have', 'has', 'had', 'does', 'did',
      'and', 'but', 'not', 'only', 'own', 'same', 'than', 'too', 'very',
      'can', 'will', 'may', 'must', 'should', 'would', 'could', 'might',
      'be', 'do', 'so', 'no', 'yes', 'up', 'down', 'out', 'off', 'on',

      // 高频噪声词
      'user', 'data', 'example', 'note', 'section', 'chapter', 'page',
      'file', 'code', 'value', 'result', 'output', 'input', 'param',
      'method', 'system', 'process', 'operation', 'action', 'step',
      'part', 'version', 'feature', 'option', 'setting', 'config',
    ]);

    return tokens.filter(t => {
      const lower = t.toLowerCase();
      return !STOPWORDS.has(lower) && t.length >= this.config.minLength;
    });
  }

  /**
   * 生成 N-gram
   *
   * 规则：
   * - 特殊术语（pg_, CamelCase, 连字符）不生成 N-gram
   * - 普通单词生成 2-gram 和 3-gram（长度 >= 8）
   */
  generateNgrams(tokens: string[]): string[] {
    const ngrams: string[] = [];

    // 1. 保留特殊术语（不拆分）
    for (const token of tokens) {
      if (
        token.startsWith('pg_') ||
        token.includes('-') ||
        /[A-Z][a-z]+[A-Z]/.test(token) ||
        (token.toUpperCase() === token && token.length <= 8)
      ) {
        if (token.length >= this.config.minLength) {
          ngrams.push(token);
        }
      }
    }

    // 2. 普通单词生成 N-gram
    const normalWords = tokens.filter(t =>
      !t.startsWith('pg_') &&
      !t.includes('-') &&
      !/[A-Z][a-z]+[A-Z]/.test(t) &&
      !(t.toUpperCase() === t && t.length <= 8)
    );

    // 2-gram 和 3-gram
    for (let i = 0; i < normalWords.length; i++) {
      for (let n = 2; n <= this.config.maxN; n++) {
        if (i + n <= normalWords.length) {
          const ngram = normalWords.slice(i, i + n).join(' ');
          // 只保留有意义的长组合
          if (ngram.length >= 8) {
            ngrams.push(ngram);
          }
        }
      }
    }

    return ngrams;
  }

  /**
   * 计算词频
   */
  computeFrequency(ngrams: string[]): Map<string, number> {
    const freq = new Map<string, number>();

    for (const term of ngrams) {
      const count = freq.get(term) || 0;
      freq.set(term, count + 1);
    }

    return freq;
  }

  /**
   * 计算 TF-IDF（简化版）
   *
   * 由于单文档处理，使用词形作为 IDF 代理：
   * - pg_ 前缀：uniqueFactor = 3.0
   * - CamelCase：uniqueFactor = 2.0
   * - 缩写：uniqueFactor = 2.0
   * - 连字符：uniqueFactor = 1.5
   */
  computeTfidf(freq: Map<string, number>, totalTokens: number): Map<string, number> {
    const tfidf = new Map<string, number>();

    for (const [term, f] of freq) {
      const tf = f / totalTokens;

      // 计算 uniqueFactor
      let uniqueFactor = 1.0;

      if (term.startsWith('pg_')) {
        uniqueFactor = 3.0;
      } else if (/[A-Z][a-z]+[A-Z]/.test(term)) {
        uniqueFactor = 2.0;
      } else if (term.toUpperCase() === term && term.length <= 8) {
        uniqueFactor = 2.0;
      } else if (term.includes('-')) {
        uniqueFactor = 1.5;
      }

      tfidf.set(term, tf * uniqueFactor);
    }

    return tfidf;
  }

  /**
   * 计算 C-value（使用 Trie 优化）
   *
   * 公式：
   * C-value(a) = log2(|a|) × (f(a) - Σf(b)/|Ta|)
   *
   * 其中：
   * - a: 当前短语
   * - f(a): 出现次数
   * - Ta: 包含 a 的更长短语集合
   *
   * 优化：按长度从长到短处理，避免 O(N²)
   */
  computeCvalue(freq: Map<string, number>): Map<string, number> {
    const cvalue = new Map<string, number>();

    // 1. 构建 Trie（按长度从长到短插入）
    const trie = new Trie();
    const termsByLength = Array.from(freq.entries())
      .sort((a, b) => b[0].split(' ').length - a[0].split(' ').length);

    for (const [term, f] of termsByLength) {
      trie.insert(term, f);
    }

    // 2. 计算 C-value
    for (const [term, f_a] of freq) {
      const tokens = term.split(' ');
      const length = tokens.length;

      if (length < 1) continue;

      // 使用 Trie 查找包含该术语的更长术语
      const containing = trie.findContainingTerms(term);

      if (containing.length > 0) {
        // 有嵌套短语
        const nestedFreq = containing.reduce((sum, t) => sum + (freq.get(t) || 0), 0);
        const cvalueScore = Math.log2(length) * (f_a - nestedFreq / containing.length);
        cvalue.set(term, Math.max(0, cvalueScore));  // C-value 可能为负，取 0
      } else {
        // 无嵌套短语
        cvalue.set(term, Math.log2(length) * f_a);
      }
    }

    return cvalue;
  }

  /**
   * 检测大小写模式
   */
  detectCasePattern(term: string): 'UPPER' | 'LOWER' | 'CAPITALIZED' | 'MIXED' {
    if (term.toUpperCase() === term) {
      return 'UPPER';
    }
    if (term.toLowerCase() === term) {
      return 'LOWER';
    }
    if (term[0].toUpperCase() === term[0] && term.slice(1).toLowerCase() === term.slice(1)) {
      return 'CAPITALIZED';
    }
    return 'MIXED';
  }

  /**
   * 检测术语类型
   */
  detectTermType(term: string): 'pg_prefix' | 'hyphenated' | 'camelcase' | 'acronym' | 'word' {
    if (term.startsWith('pg_')) {
      return 'pg_prefix';
    }
    if (term.includes('-')) {
      return 'hyphenated';
    }
    if (/[A-Z][a-z]+[A-Z]/.test(term)) {
      return 'camelcase';
    }
    if (term.toUpperCase() === term && term.length <= 8) {
      return 'acronym';
    }
    return 'word';
  }

  /**
   * 计算综合评分
   *
   * score = weights.tfidf × tfidf + weights.cvalue × cvalue + weights.freq × freqFactor
   */
  computeScore(
    term: string,
    tfidf: number,
    cvalue: number,
    freq: number,
    weights: { tfidf: number; cvalue: number; freq: number; length: number }
  ): number {
    const freqFactor = Math.log2(1 + freq);
    const lengthFactor = term.split(' ').length / this.config.maxN;

    const score =
      weights.tfidf * tfidf +
      weights.cvalue * cvalue +
      weights.freq * freqFactor +
      weights.length * lengthFactor;

    return Math.max(0, score);
  }

  /**
   * 提取候选术语（完整流程）
   */
  extract(
    text: string,
    weights: { tfidf: number; cvalue: number; freq: number; length: number },
    domain: DomainType
  ): TermCandidate[] {
    logInfo(`[StatisticalLayer] Starting extraction for domain: ${domain}`);

    // 1. 分词
    const tokens = this.tokenize(text);
    if (tokens.length === 0) {
      return [];
    }

    logInfo(`[StatisticalLayer] Tokens: ${tokens.length}`);

    // 2. 生成 N-gram
    const ngrams = this.generateNgrams(tokens);
    logInfo(`[StatisticalLayer] Ngrams: ${ngrams.length}`);

    // 3. 计算词频
    const freq = this.computeFrequency(ngrams);

    // 4. 计算 TF-IDF
    const tfidf = this.computeTfidf(freq, tokens.length);

    // 5. 计算 C-value（Trie 优化）
    const cvalue = this.computeCvalue(freq);

    // 6. 构建候选对象
    const candidates: TermCandidate[] = [];

    for (const [term, f] of freq) {
      // 过滤低频词
      if (f < this.config.minFreq) continue;
      if (term.length < this.config.minLength) continue;
      if (term.length > this.config.maxLength) continue;

      candidates.push({
        term,
        normalized: term.toLowerCase(),
        freq: f,
        tfidf: tfidf.get(term) || 0,
        cvalue: cvalue.get(term) || 0,
        score: this.computeScore(
          term,
          tfidf.get(term) || 0,
          cvalue.get(term) || 0,
          f,
          weights
        ),
        casePattern: this.detectCasePattern(term),
        type: this.detectTermType(term),
      });
    }

    // 7. 按评分排序
    candidates.sort((a, b) => b.score - a.score);

    logInfo(`[StatisticalLayer] Candidates: ${candidates.length}`);

    return candidates;
  }
}
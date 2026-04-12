/**
 * Term Importer - 术语知识系统文档导入器
 *
 * 功能：
 * - 解析文档（PDF/Markdown/Word/HTML）
 * - 术语抽取（TermExtractionPipeline）
 * - 知识图谱构建（KnowledgeGraphBuilder）
 * - 支持块级领域覆盖
 * - Positive Feedback Loop（自动晋升种子）
 *
 * 使用方式：
 * ```typescript
 * const importer = new TermImporter(config);
 * await importer.importDocument('postgresql.pdf', { type: 'database' });
 * ```
 */

import { logInfo, logError } from './maintenance-logger.js';
import { DocumentParser } from './document-parser.js';
import { DocumentSplitter } from './document-splitter.js';
import { TermExtractionPipeline } from './term-extraction/pipeline.js';
import { KnowledgeGraphBuilder } from './knowledge-graph/builder.js';
import { ServiceFactory } from './service-factory.js';
import { EmbeddingService } from './embedding.js';
import type { DomainType, ExtractedTerm } from './term-extraction/types.js';

// ============================================================
// 类型定义
// ============================================================

/**
 * 导入配置
 */
export interface TermImportConfig {
  // 文档类型（用于领域检测辅助）
  docType?: string;

  // 文档版本（如 PostgreSQL 版本 "15"）
  version?: string;

  // 是否启用块级领域覆盖
  enableBlockOverride?: boolean;

  // 最小块置信度（用于覆盖决策）
  minBlockConfidence?: number;

  // 是否启用正反馈循环
  enableFeedbackLoop?: boolean;

  // 最小术语频次（用于晋升种子）
  minSeedFrequency?: number;

  // 批处理大小
  batchSize?: number;
}

/**
 * 导入结果
 */
export interface TermImportResult {
  // 文档信息
  filePath: string;
  docType: string;

  // 统计信息
  totalBlocks: number;
  processedBlocks: number;
  totalTerms: number;
  uniqueTerms: number;
  totalRelations: number;

  // 术语分布
  termsByDomain: Record<DomainType, number>;

  // 正反馈循环
  promotedSeedCount: number;

  // 性能信息
  timing: {
    parsing: number;
    extraction: number;
    graphBuilding: number;
    total: number;
  };

  // 错误信息
  errors: string[];
}

/**
 * 默认配置
 */
const DEFAULT_IMPORT_CONFIG: TermImportConfig = {
  docType: 'general',
  enableBlockOverride: true,
  minBlockConfidence: 0.5,
  enableFeedbackLoop: true,
  minSeedFrequency: 50,
  batchSize: 10,
};

// ============================================================
// TermImporter 类
// ============================================================

/**
 * 术语知识系统文档导入器
 */
export class TermImporter {
  private parser: DocumentParser;
  private splitter: DocumentSplitter;
  private termPipeline: TermExtractionPipeline;
  private graphBuilder: KnowledgeGraphBuilder;
  private embedding: EmbeddingService;
  private config: TermImportConfig;

  constructor(config?: Partial<TermImportConfig>) {
    // 统一从 ServiceFactory 获取服务（单一入口）
    this.embedding = ServiceFactory.getEmbedding();

    this.config = { ...DEFAULT_IMPORT_CONFIG, ...config };

    // 初始化组件
    this.parser = new DocumentParser();
    this.splitter = new DocumentSplitter(500, 50);
    this.termPipeline = new TermExtractionPipeline({
      cache: { enabled: true, maxSize: 10000 },
      llm: { enabled: false, batchSize: 50, timeout: 120000, temperature: 0, maxTokens: 2000 },
    });

    // 初始化知识图谱构建器（内部使用 ServiceFactory）
    this.graphBuilder = new KnowledgeGraphBuilder();

    logInfo('[TermImporter] Initialized (using ServiceFactory)');
  }

  /**
   * 导入文档
   */
  async importDocument(
    filePath: string,
    options?: Partial<TermImportConfig>
  ): Promise<TermImportResult> {
    const startTime = Date.now();
    const mergedConfig = { ...this.config, ...options };

    const result: TermImportResult = {
      filePath,
      docType: mergedConfig.docType || 'general',
      totalBlocks: 0,
      processedBlocks: 0,
      totalTerms: 0,
      uniqueTerms: 0,
      totalRelations: 0,
      termsByDomain: {
        database: 0,
        ai: 0,
        medical: 0,
        legal: 0,
        finance: 0,
        devops: 0,
        general: 0,
      },
      promotedSeedCount: 0,
      timing: {
        parsing: 0,
        extraction: 0,
        graphBuilding: 0,
        total: 0,
      },
      errors: [],
    };

    try {
      // 1. 解析文档
      const parseStartTime = Date.now();
      logInfo(`[TermImporter] Parsing document: ${filePath}`);

      const doc = await this.parser.parse(filePath);
      result.timing.parsing = Date.now() - parseStartTime;

      if (!doc.content) {
        result.errors.push('Document content is empty');
        return result;
      }

      // 2. 分块
      const chunks = this.splitter.split(doc.content, filePath);
      result.totalBlocks = chunks.length;

      logInfo(`[TermImporter] Document parsed: ${result.totalBlocks} blocks`);

      // 3. 文档级领域检测
      const docDomainResult = this.termPipeline.detectDomain(doc.content);
      logInfo(`[TermImporter] Document domain: ${docDomainResult.domain} (confidence: ${docDomainResult.confidence.toFixed(2)})`);

      // 4. 逐块处理
      const extractionStartTime = Date.now();
      const allTerms: ExtractedTerm[] = [];

      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];

        try {
          // 4.1 块级领域检测（可能覆盖）
          let _effectiveDomain = docDomainResult.domain;

          if (mergedConfig.enableBlockOverride && mergedConfig.minBlockConfidence !== undefined) {
            const blockDomainResult = this.termPipeline.detectDomain(chunk.content);

            if (
              blockDomainResult.confidence > mergedConfig.minBlockConfidence &&
              blockDomainResult.confidence > docDomainResult.confidence * 1.2
            ) {
              _effectiveDomain = blockDomainResult.domain;
              logInfo(`[TermImporter] Block ${i}: domain override (${blockDomainResult.domain}, conf: ${blockDomainResult.confidence.toFixed(2)})`);
            }
          }

          // 4.2 术语抽取
          const extractionResult = this.termPipeline.extract(chunk.content);
          const terms = extractionResult.terms;

          // 更新领域分布
          for (const term of terms) {
            result.termsByDomain[term.domain]++;
          }

          // 4.3 知识图谱构建
          if (terms.length > 0) {
            await this.graphBuilder.buildFromDocument(terms, filePath);
            allTerms.push(...terms);
          }

          result.processedBlocks++;
          result.totalTerms += terms.length;

          // 进度日志
          if (i % 10 === 0) {
            logInfo(`[TermImporter] Processed ${i}/${chunks.length} blocks, ${terms.length} terms`);
          }
        } catch (error: unknown) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          result.errors.push(`Block ${i}: ${errorMessage}`);
          logError(`[TermImporter] Block ${i} error: ${errorMessage}`);
        }
      }

      result.timing.extraction = Date.now() - extractionStartTime;

      // 5. 关系发现（文档完成后）
      const graphStartTime = Date.now();

      const coRelations = await this.graphBuilder.extractCoOccurrenceRelations();
      const semanticRelations = await this.graphBuilder.extractSemanticRelations();
      const structuralRelations = await this.graphBuilder.extractStructuralRelations();

      const allRelations = [...coRelations, ...semanticRelations, ...structuralRelations];
      await this.graphBuilder.storeRelations(allRelations);

      result.totalRelations = allRelations.length;
      result.timing.graphBuilding = Date.now() - graphStartTime;

      // 6. 正反馈循环（自动晋升种子）
      if (mergedConfig.enableFeedbackLoop && mergedConfig.minSeedFrequency !== undefined) {
        const uniqueTerms = this._deduplicateTerms(allTerms);
        result.uniqueTerms = uniqueTerms.length;

        // 晋升条件：confidence >= 0.95, frequency >= minSeedFrequency, domain != 'general'
        for (const term of uniqueTerms) {
          if (
            term.confidence >= 0.95 &&
            term.freq >= mergedConfig.minSeedFrequency &&
            term.domain !== 'general'
          ) {
            result.promotedSeedCount++;
          }
        }

        if (result.promotedSeedCount > 0) {
          logInfo(`[TermImporter] Positive Feedback Loop: ${result.promotedSeedCount} terms eligible for seed promotion`);
        }
      }

      // 7. 完成
      result.timing.total = Date.now() - startTime;

      logInfo(`[TermImporter] Import complete: ${result.totalTerms} terms, ${result.totalRelations} relations in ${result.timing.total}ms`);

      return result;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      result.errors.push(errorMessage);
      result.timing.total = Date.now() - startTime;
      logError(`[TermImporter] Import failed: ${errorMessage}`);
      return result;
    }
  }

  /**
   * 导入多个文档
   */
  async importDocuments(
    filePaths: string[],
    options?: Partial<TermImportConfig>
  ): Promise<TermImportResult[]> {
    const results: TermImportResult[] = [];

    for (const filePath of filePaths) {
      const result = await this.importDocument(filePath, options);
      results.push(result);
    }

    return results;
  }

  /**
   * 去重术语
   */
  private _deduplicateTerms(terms: ExtractedTerm[]): ExtractedTerm[] {
    const uniqueMap = new Map<string, ExtractedTerm>();

    for (const term of terms) {
      const key = `${term.domain}:${term.normalized}`;

      if (!uniqueMap.has(key)) {
        uniqueMap.set(key, term);
      } else {
        // 合并频次
        const existing = uniqueMap.get(key);
        if (existing) {
          existing.freq += term.freq;
        }
      }
    }

    return Array.from(uniqueMap.values());
  }

  /**
   * 获取缓存统计
   */
  getCacheStats() {
    return this.termPipeline.getCacheStats();
  }

  /**
   * 加载种子术语（冷启动）
   */
  loadSeedTerms(
    terms: Array<{ term: string; type?: import('./term-extraction/types.js').TermType; domain?: DomainType }>
  ) {
    this.termPipeline.loadSeedTerms(terms);
  }
}

// ============================================================
// 工厂函数
// ============================================================

/**
 * 创建术语导入器
 */
export async function createTermImporter(
  config?: Partial<TermImportConfig>
): Promise<TermImporter> {
  // ServiceFactory 在 init() 时已初始化，无需手动获取服务
  return new TermImporter(config);
}
/* eslint-disable @typescript-eslint/no-non-null-assertion -- Knowledge graph assertions are guaranteed by DB schema */
/**
 * Knowledge Graph Builder - 知识图谱构建器
 *
 * 将术语转化为结构化知识图谱：
 * - 术语作为实体节点（term 表）
 * - 术语关系作为边（term_relation 表）
 *
 * 关系发现方法：
 * 1. 共现关系（统计层）
 * 2. 语义关系（向量层）
 * 3. 结构关系（规则层）
 * 4. 上下文关系（LLM层）
 */

import { logInfo, logError } from '../maintenance-logger.js';
import { ServiceFactory } from '../service-factory.js';
import type { SurrealDatabase } from '../surrealdb-client.js';
import { EmbeddingService } from '../embedding.js';
import type { LLMClient } from '../llm-client.js';
import type {
  ExtractedTerm,
  DomainType,
  TermType,
} from '../term-extraction/types.js';

// ============================================================
// 知识图谱类型定义
// ============================================================

/**
 * 术语实体
 */
export interface TermEntity {
  id?: string;
  name: string;
  normalized: string;
  namespace: string;
  domain: DomainType;
  type: TermType;
  aliases: string[];
  description?: string;
  embedding?: number[];
  frequency: number;
  confidence: number;
  source_docs: string[];
  created_at?: Date;
  updated_at?: Date;
}

/**
 * 术语关系类型
 */
export type RelationType =
  | 'is_a'        // 分类关系（pg_dump is_a tool）
  | 'part_of'     // 组成关系（checkpoint part_of WAL）
  | 'uses'        // 使用关系（pg_dump uses libpq）
  | 'related_to'  // 相关关系（GIN related_to index）
  | 'synonym'     // 同义关系（WAL synonym write-ahead-log）
  | 'derived_from' // 派生关系（B-tree derived_from tree）
  | 'configures'  // 配置关系（shared_buffers configures PostgreSQL）
  | 'implements'  // 实现关系（libpq implements PostgreSQL protocol）
  | 'co_occurs';  // 共现关系（统计发现）

/**
 * 关系发现方法
 */
export type RelationMethod =
  | 'rule'          // 命名模式规则（可信度 0.95）
  | 'llm'           // LLM 上下文分析（可信度 0.90）
  | 'embedding'     // 向量语义相似度（可信度 0.75）
  | 'co_occurrence';// 统计共现（可信度 0.50）

/**
 * 方法可信度映射
 */
export const METHOD_CONFIDENCE: Record<RelationMethod, number> = {
  rule: 0.95,
  llm: 0.90,
  embedding: 0.75,
  co_occurrence: 0.50,
};

/**
 * 术语关系（V2.0 - 支持 Graph Relation）
 */
export interface TermRelation {
  id?: string;
  source_id: string;      // 源术语 Record ID
  target_id: string;      // 目标术语 Record ID
  relation_type: RelationType;
  weight: number;         // 关系强度 0.0 ~ 1.0
  confidence: number;     // 关系可信度 0.0 ~ 1.0
  method: RelationMethod; // 发现方法
  decay_factor?: number;  // 衰减因子（默认 1.0）
  evidence?: string;      // 关系证据（原文片段）
  source_doc?: string;    // 来源文档
  version?: string;       // 特定版本
  created_at?: Date;
}

/**
 * 构建配置
 */
export interface GraphBuilderConfig {
  // 共现关系
  co_occurrence: {
    enabled: boolean;
    min_count: number;     // 最小共现次数（默认 3）
    min_weight: number;    // 最小关系强度（默认 0.1）
  };

  // 语义关系
  semantic: {
    enabled: boolean;
    min_similarity: number; // 最小相似度（默认 0.7）
  };

  // 结构关系
  structural: {
    enabled: boolean;
  };

  // LLM 关系
  llm: {
    enabled: boolean;
    batch_size: number;
  };
}

/**
 * 默认配置
 */
export const DEFAULT_GRAPH_CONFIG: GraphBuilderConfig = {
  co_occurrence: {
    enabled: true,
    min_count: 3,
    min_weight: 0.1,
  },
  semantic: {
    enabled: true,
    min_similarity: 0.7,
  },
  structural: {
    enabled: true,
  },
  llm: {
    enabled: false,
    batch_size: 20,
  },
};

// ============================================================
// 知识图谱构建器类
// ============================================================

/**
 * 知识图谱构建器（V2.0 - 通过 ServiceFactory 统一获取服务）
 */
export class KnowledgeGraphBuilder {
  private db: SurrealDatabase;
  private embedding: EmbeddingService;
  private llm: LLMClient | null;
  private config: GraphBuilderConfig;

  // 共现矩阵（文档级别）
  private co_occurrenceMatrix: Map<string, Map<string, number>>;

  constructor(config?: Partial<GraphBuilderConfig>) {
    // 统一从 ServiceFactory 获取服务（单一入口）
    this.db = ServiceFactory.getDB();
    this.embedding = ServiceFactory.getEmbedding();
    this.llm = ServiceFactory.getLLM();

    this.config = {
      ...DEFAULT_GRAPH_CONFIG,
      ...config,
      llm: {
        ...DEFAULT_GRAPH_CONFIG.llm,
        enabled: !!this.llm,  // 自动根据 ServiceFactory 决定是否启用
        ...config?.llm,
      },
    };

    this.co_occurrenceMatrix = new Map();

    logInfo('[KnowledgeGraphBuilder] Initialized (using ServiceFactory)');
  }

  // ============================================================
  // 术语存储
  // ============================================================

  /**
   * 存储术语实体（V2.0 - name+description 嵌入）
   */
  async storeTerm(term: ExtractedTerm, sourceDoc: string, version?: string): Promise<string> {
    // 1. 检查是否已存在（去重）
    const existingRaw = await this.db.query(
      'SELECT id FROM term WHERE normalized = $normalized AND domain = $domain',
      { normalized: term.normalized, domain: term.domain }
    );
    const existing = existingRaw as Array<Array<{ id?: string }>>;

    if (existing[0]?.[0]?.id) {
      // 已存在，更新频率和来源文档
      const id = existing[0][0].id;
      await this.db.query(
        `UPDATE $id SET
          frequency = frequency + 1,
          source_docs = array::distinct(source_docs + $sourceDoc),
          updated_at = time::now()`,
        { id, sourceDoc }
      );
      return id;
    }

    // 2. 生成向量嵌入（name + description 组合）
    let embedding: number[] | undefined;
    if (this.config.semantic.enabled) {
      try {
        // V2.0 改进：对 name + description 做嵌入
        const embeddingText = term.term + ' ' + (term.context || '');
        embedding = await this.embedding.embed(embeddingText);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        logError(`[KnowledgeGraphBuilder] Embedding failed for ${term.term}: ${message}`);
      }
    }

    // 3. 存储（带版本字段）
    const resultRaw = await this.db.query(
      `CREATE term SET
        name = $name,
        normalized = $normalized,
        namespace = $namespace,
        domain = $domain,
        type = $type,
        aliases = [],
        description = $description,
        embedding = $embedding,
        frequency = $frequency,
        confidence = $confidence,
        source_docs = [$sourceDoc],
        version_range = $version_range,
        is_primary = true,
        primary_id = '',
        created_at = time::now(),
        updated_at = time::now()`,
      {
        name: term.term,
        normalized: term.normalized,
        namespace: term.namespace,
        domain: term.domain,
        type: term.type,
        description: term.context || '',
        embedding: embedding || [],
        frequency: term.freq,
        confidence: term.confidence,
        sourceDoc,
        version_range: version || '',
      }
    );
    const result = resultRaw as Array<Array<{ id?: string }>>;

    const id = result[0]?.[0]?.id ?? '';
    logInfo(`[KnowledgeGraphBuilder] Stored term: ${term.term} (${id})`);

    return id;
  }

  /**
   * 批量存储术语
   */
  async storeTerms(terms: ExtractedTerm[], sourceDoc: string): Promise<string[]> {
    const ids: string[] = [];

    for (const term of terms) {
      const id = await this.storeTerm(term, sourceDoc);
      ids.push(id);
    }

    // 记录共现关系（文档内所有术语）
    this._recordCoOccurrences(ids);

    return ids;
  }

  // ============================================================
  // 共现关系发现
  // ============================================================

  /**
   * 记录共现关系（文档内）
   */
  private _recordCoOccurrences(termIds: string[]): void {
    // 文档内所有术语互为共现
    for (const sourceId of termIds) {
      if (!this.co_occurrenceMatrix.has(sourceId)) {
        this.co_occurrenceMatrix.set(sourceId, new Map());
      }

      for (const targetId of termIds) {
        if (sourceId === targetId) continue;

        const sourceMap = this.co_occurrenceMatrix.get(sourceId)!;
        const count = sourceMap.get(targetId) || 0;
        sourceMap.set(targetId, count + 1);
      }
    }
  }

  /**
   * 提取共现关系
   */
  async extractCoOccurrenceRelations(): Promise<TermRelation[]> {
    if (!this.config.co_occurrence.enabled) {
      return [];
    }

    const relations: TermRelation[] = [];
    const minCount = this.config.co_occurrence.min_count;
    const minWeight = this.config.co_occurrence.min_weight;

    // 遍历共现矩阵
    for (const [sourceId, targetMap] of this.co_occurrenceMatrix) {
      // 获取源术语频率
      const sourceResultRaw = await this.db.query(
        'SELECT frequency FROM term WHERE id = $id',
        { id: sourceId }
      );
      const sourceResult = sourceResultRaw as Array<Array<{ frequency?: number }>>;
      const sourceFreq = sourceResult[0]?.[0]?.frequency || 1;

      for (const [targetId, count] of targetMap) {
        // 过滤低频共现
        if (count < minCount) continue;

        // 获取目标术语频率
        const targetResultRaw = await this.db.query(
          'SELECT frequency FROM term WHERE id = $id',
          { id: targetId }
        );
        const targetResult = targetResultRaw as Array<Array<{ frequency?: number }>>;
        const targetFreq = targetResult[0]?.[0]?.frequency || 1;

        // 计算关系强度
        const weight = count / Math.min(sourceFreq, targetFreq);

        // 过滤低强度关系
        if (weight < minWeight) continue;

        relations.push({
          source_id: sourceId,
          target_id: targetId,
          relation_type: 'co_occurs',
          weight,
          confidence: METHOD_CONFIDENCE.co_occurrence,
          method: 'co_occurrence',
          decay_factor: 1.0,  // 初始无衰减
          evidence: `共现 ${count} 次`,
        });
      }
    }

    logInfo(`[KnowledgeGraphBuilder] Extracted ${relations.length} co-occurrence relations`);

    return relations;
  }

  // ============================================================
  // 语义关系发现
  // ============================================================

  /**
   * 提取语义关系（向量相似度，V2.0 改进）
   */
  async extractSemanticRelations(domain?: DomainType): Promise<TermRelation[]> {
    if (!this.config.semantic.enabled) {
      return [];
    }

    const relations: TermRelation[] = [];
    const minSimilarity = this.config.semantic.min_similarity;

    // 查询所有术语（带向量）
    const termsResultRaw = await this.db.query(
      `SELECT id, name, embedding, normalized FROM term
       WHERE embedding != []
       ${domain ? 'AND domain = $domain' : ''}`,
      { domain }
    );
    const termsResult = termsResultRaw as Array<Array<{ id: string; name: string; embedding?: number[]; normalized?: string }>>;
    const terms = termsResult[0] || [];

    // 计算两两相似度（优化：只计算同领域内）
    for (let i = 0; i < terms.length; i++) {
      for (let j = i + 1; j < terms.length; j++) {
        const termA = terms[i] as { id: string; embedding?: number[] };
        const termB = terms[j] as { id: string; embedding?: number[] };

        if (!termA.embedding || !termB.embedding) continue;

        // 计算余弦相似度
        const similarity = this._cosineSimilarity(termA.embedding, termB.embedding);

        // 过滤低相似度
        if (similarity < minSimilarity) continue;

        // V2.0 改进：高相似度（>0.85）标记为 synonym
        const relationType = similarity > 0.85 ? 'synonym' : 'related_to';

        relations.push({
          source_id: termA.id,
          target_id: termB.id,
          relation_type: relationType,
          weight: similarity,
          confidence: METHOD_CONFIDENCE.embedding,
          method: 'embedding',
          evidence: `向量相似度 ${similarity.toFixed(2)}`,
        });
      }
    }

    logInfo(`[KnowledgeGraphBuilder] Extracted ${relations.length} semantic relations`);

    return relations;
  }

  /**
   * 计算余弦相似度
   */
  private _cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    if (normA === 0 || normB === 0) return 0;

    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  // ============================================================
  // 结构关系发现
  // ============================================================

  /**
   * 提取结构关系（命名模式规则）
   */
  async extractStructuralRelations(): Promise<TermRelation[]> {
    if (!this.config.structural.enabled) {
      return [];
    }

    const relations: TermRelation[] = [];

    // 查询所有术语
    const termsResultRaw = await this.db.query(
      'SELECT id, name, normalized, type FROM term',
      {}
    );
    const termsResult = termsResultRaw as Array<Array<{ id: string; name: string; normalized: string; type?: string }>>;
    const terms = termsResult[0] || [];

    // 命名模式规则
    const rules = [
      // pg_ 前缀规则
      {
        pattern: /^pg_/,
        target: 'system_object',
        relation: 'is_a',
        createTarget: false,  // 目标术语需要已存在
      },

      // 索引相关
      {
        pattern: /index$/i,
        target: 'index',
        relation: 'part_of',
        createTarget: false,
      },

      // 缓冲相关
      {
        pattern: /buffer$/i,
        target: 'memory',
        relation: 'part_of',
        createTarget: false,
      },

      // 配置参数
      {
        pattern: /^shared_|^max_|^min_|^default_/,
        target: 'configuration',
        relation: 'is_a',
        createTarget: false,
      },

      // 工具命令
      {
        pattern: /dump|restore|backup|import|export$/i,
        target: 'tool',
        relation: 'is_a',
        createTarget: false,
      },
    ];

    // 预定义目标术语（需要先存在）
    const targetTerms = {
      'system_object': { normalized: 'system_object', type: 'concept' },
      'index': { normalized: 'index', type: 'concept' },
      'memory': { normalized: 'memory', type: 'component' },
      'configuration': { normalized: 'configuration', type: 'parameter' },
      'tool': { normalized: 'tool', type: 'tool' },
    };

    // 创建目标术语（如果不存在）
    for (const [_key, target] of Object.entries(targetTerms)) {
      const existingRaw = await this.db.query(
        'SELECT id FROM term WHERE normalized = $normalized',
        { normalized: target.normalized }
      );
      const existing = existingRaw as Array<Array<{ id?: string }>>;

      if (!existing[0]?.[0]?.id) {
        await this.db.query(
          `CREATE term SET
            name = $normalized,
            normalized = $normalized,
            namespace = 'general.' + $normalized,
            domain = 'general',
            type = $type,
            frequency = 0,
            confidence = 1.0,
            source_docs = [],
            aliases = [],
            embedding = [],
            created_at = time::now()`,
          { normalized: target.normalized, type: target.type }
        );
      }
    }

    // 应用规则
    for (const term of terms) {
      for (const rule of rules) {
        if (rule.pattern.test(term.normalized)) {
          // 查找目标术语
          const targetResultRaw = await this.db.query(
            'SELECT id FROM term WHERE normalized = $normalized',
            { normalized: rule.target }
          );
          const targetResult = targetResultRaw as Array<Array<{ id?: string }>>;
          const targetId = targetResult[0]?.[0]?.id;

          if (targetId) {
            relations.push({
              source_id: term.id,
              target_id: targetId,
              relation_type: rule.relation as RelationType,
              weight: 0.8,
              confidence: METHOD_CONFIDENCE.rule,
              method: 'rule',
              evidence: `命名模式匹配: ${rule.pattern.toString()}`,
            });
          }
        }
      }
    }

    logInfo(`[KnowledgeGraphBuilder] Extracted ${relations.length} structural relations`);

    return relations;
  }

  // ============================================================
  // LLM 关系发现（V2.0 - 复用 OpenClaw LLM）
  // ============================================================

  /**
   * 提取 LLM 关系（上下文分析）
   *
   * 使用 OpenClaw 的 LLMClient 分析术语在上下文中的关系
   * 可信度最高（0.90），但成本较高，仅用于关键术语
   *
   * @param terms 术语列表（限制数量避免超额调用）
   * @param context 上下文文本
   */
  async extractLLMRelations(
    terms: ExtractedTerm[],
    context: string
  ): Promise<TermRelation[]> {
    if (!this.config.llm.enabled || !this.llm) {
      logInfo('[KnowledgeGraphBuilder] LLM relation discovery disabled');
      return [];
    }

    const relations: TermRelation[] = [];
    const batchSize = this.config.llm.batch_size;

    // 限制术语数量（只处理高置信度术语）
    const candidateTerms = terms
      .filter(t => t.confidence >= 0.8 && t.domain !== 'general')
      .slice(0, batchSize);

    if (candidateTerms.length < 2) {
      logInfo('[KnowledgeGraphBuilder] Not enough high-confidence terms for LLM analysis');
      return [];
    }

    logInfo(`[KnowledgeGraphBuilder] LLM analyzing ${candidateTerms.length} terms`);

    try {
      // 构建 Prompt
      const termList = candidateTerms.map(t => `- ${t.term} (${t.type})`).join('\n');
      const prompt = `分析以下术语在上下文中的关系：

术语列表：
${termList}

上下文：
${context.slice(0, 2000)}

请识别术语之间的关系，输出格式：
source | target | relation_type | evidence

关系类型：
- is_a: 分类关系（如 pg_dump is_a tool）
- part_of: 组成关系（如 checkpoint part_of WAL）
- uses: 使用关系（如 pg_dump uses libpq）
- related_to: 相关关系
- synonym: 同义关系

每行一个关系，只输出确定的关系，不要猜测。`;

      // 调用 OpenClaw LLM
      const response = await this.llm.complete(prompt, 'knowledge-graph', {
        maxTokens: 500,
        temperature: 0.3,
      });

      // 解析响应（管道分隔格式）
      const lines = response.split('\n');
      for (const line of lines) {
        if (!line.includes('|')) continue;

        const parts = line.split('|').map(p => p.trim());
        if (parts.length < 4) continue;

        const sourceName = parts[0];
        const targetName = parts[1];
        const relationType = parts[2] as RelationType;
        const evidence = parts[3];

        // 查找术语 ID
        const sourceResultRaw = await this.db.query(
          'SELECT id FROM term WHERE normalized = $normalized',
          { normalized: sourceName.toLowerCase() }
        );
        const targetResultRaw = await this.db.query(
          'SELECT id FROM term WHERE normalized = $normalized',
          { normalized: targetName.toLowerCase() }
        );
        const sourceResult = sourceResultRaw as Array<Array<{ id?: string }>>;
        const targetResult = targetResultRaw as Array<Array<{ id?: string }>>;
        const sourceId = sourceResult[0]?.[0]?.id;
        const targetId = targetResult[0]?.[0]?.id;

        if (sourceId && targetId) {
          relations.push({
            source_id: sourceId,
            target_id: targetId,
            relation_type: relationType,
            weight: 0.85,
            confidence: METHOD_CONFIDENCE.llm,
            method: 'llm',
            evidence: `LLM分析: ${evidence}`,
          });
        }
      }

      logInfo(`[KnowledgeGraphBuilder] Extracted ${relations.length} LLM relations`);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logError(`[KnowledgeGraphBuilder] LLM relation discovery failed: ${message}`);
    }

    return relations;
  }

  // ============================================================
  // 关系存储（V2.0 - RELATE 语法）
  // ============================================================

  /**
   * 存储术语关系（使用 RELATE 语法）
   */
  async storeRelation(relation: TermRelation): Promise<string> {
    const method = relation.method || 'co_occurrence';
    const confidence = relation.confidence || METHOD_CONFIDENCE[method];
    const decayFactor = relation.decay_factor || 1.0;

    // 检查是否已存在（使用 in/out 字段）
    const existingRaw = await this.db.query(
      `SELECT id FROM term_relation
       WHERE in = $source_id
       AND out = $target_id
       AND relation_type = $relation_type`,
      {
        source_id: relation.source_id,
        target_id: relation.target_id,
        relation_type: relation.relation_type,
      }
    );
    const existing = existingRaw as Array<Array<{ id?: string }>>;

    if (existing[0]?.[0]?.id) {
      // 已存在，更新权重（取更高置信度）
      const id = existing[0][0].id;
      await this.db.query(
        `UPDATE $id SET
          weight = math::max(weight, $weight),
          confidence = math::max(confidence, $confidence),
          method = IF $method_confidence > confidence THEN $method ELSE method END,
          decay_factor = $decay_factor,
          evidence = $evidence,
          created_at = time::now()`,
        {
          id,
          weight: relation.weight,
          confidence,
          method,
          method_confidence: METHOD_CONFIDENCE[method],
          decay_factor: decayFactor,
          evidence: relation.evidence || '',
        }
      );
      return id;
    }

    // 使用 RELATE 语法创建 Graph 关系
    const resultRaw = await this.db.query(
      `RELATE $source_id -> term_relation -> $target_id SET
        relation_type = $relation_type,
        weight = $weight,
        confidence = $confidence,
        method = $method,
        decay_factor = $decay_factor,
        evidence = $evidence,
        source_doc = $source_doc,
        version = $version,
        created_at = time::now()`,
      {
        source_id: relation.source_id,
        target_id: relation.target_id,
        relation_type: relation.relation_type,
        weight: relation.weight,
        confidence,
        method,
        decay_factor: decayFactor,
        evidence: relation.evidence || '',
        source_doc: relation.source_doc || '',
        version: relation.version || '',
      }
    );
    const result = resultRaw as Array<Array<{ id?: string }>>;

    const id = result[0]?.[0]?.id ?? '';
    logInfo(`[KnowledgeGraphBuilder] Created relation: ${relation.source_id} -> ${relation.relation_type} -> ${relation.target_id} (${method}, conf: ${confidence.toFixed(2)})`);
    return id;
  }

  /**
   * 批量存储关系
   */
  async storeRelations(relations: TermRelation[]): Promise<number> {
    let count = 0;

    for (const relation of relations) {
      await this.storeRelation(relation);
      count++;
    }

    logInfo(`[KnowledgeGraphBuilder] Stored ${count} relations`);

    return count;
  }

  // ============================================================
  // 完整构建流程
  // ============================================================

  /**
   * 从文档构建知识图谱（V2.0 - 支持 LLM 关系）
   */
  async buildFromDocument(
    terms: ExtractedTerm[],
    sourceDoc: string,
    context?: string  // 可选上下文（用于 LLM 关系发现）
  ): Promise<{
    termCount: number;
    relationCount: number;
    llmRelationCount: number;
  }> {
    logInfo(`[KnowledgeGraphBuilder] Building from document: ${sourceDoc}`);

    // 1. 存储术语
    const termIds = await this.storeTerms(terms, sourceDoc);

    // 2. 提取关系（并行）
    const coRelations = await this.extractCoOccurrenceRelations();
    const semanticRelations = await this.extractSemanticRelations();
    const structuralRelations = await this.extractStructuralRelations();

    // 3. LLM 关系发现（可选，复用 OpenClaw LLM）
    let llmRelations: TermRelation[] = [];
    if (this.llm && this.config.llm.enabled && context) {
      llmRelations = await this.extractLLMRelations(terms, context);
    }

    // 4. 合并关系
    const allRelations = [...coRelations, ...semanticRelations, ...structuralRelations, ...llmRelations];

    // 5. 存储关系
    const relationCount = await this.storeRelations(allRelations);

    // 6. 清空共现矩阵（为下一个文档准备）
    this.co_occurrenceMatrix.clear();

    logInfo(`[KnowledgeGraphBuilder] Document complete: ${termIds.length} terms, ${relationCount} relations (${llmRelations.length} from LLM)`);

    return {
      termCount: termIds.length,
      relationCount,
      llmRelationCount: llmRelations.length,
    };
  }

  /**
   * 清空共现矩阵
   */
  clearCoOccurrence(): void {
    this.co_occurrenceMatrix.clear();
  }

  // ============================================================
  // V2.0 新增：冲突检测与解决
  // ============================================================

  /**
   * 解决关系冲突
   *
   * 优先级：rule > llm > embedding > co_occurrence
   *
   * 当同一 source-target 对存在多个关系时：
   * 1. 保留高优先级方法的关系
   * 2. 删除低优先级的关系
   */
  async resolveRelationConflicts(): Promise<number> {
    logInfo('[KnowledgeGraphBuilder] Starting conflict resolution...');

    // 查询所有关系对
    const relationsRaw = await this.db.query(`
      SELECT in, out, relation_type, method, confidence, id FROM term_relation
    `, {});
    const relations = relationsRaw as Array<Array<{ in?: string; out?: string; relation_type?: string; method?: string; confidence?: number; id?: string }>>;
    const relationList = relations[0] || [];
    const conflictMap = new Map<string, TermRelation[]>();

    // 按源-目标分组
    for (const r of relationList) {
      const record = r as { in?: string; out?: string; relation_type?: string; method?: string; confidence?: number; id?: string };
      const key = `${record.in}-${record.out}`;
      if (!conflictMap.has(key)) {
        conflictMap.set(key, []);
      }
      conflictMap.get(key)!.push({
        id: record.id,
        source_id: record.in || '',
        target_id: record.out || '',
        relation_type: record.relation_type as RelationType || 'related_to',
        weight: 0,
        confidence: record.confidence || 0,
        method: record.method as RelationMethod || 'co_occurrence',
      });
    }

    // 解决冲突
    const methodPriority = { rule: 4, llm: 3, embedding: 2, co_occurrence: 1 };
    let resolvedCount = 0;

    for (const [, rels] of conflictMap) {
      if (rels.length <= 1) continue;

      // 按优先级排序
      const sorted = rels.sort((a, b) =>
        (methodPriority[b.method!] || 0) - (methodPriority[a.method!] || 0) ||
        b.confidence - a.confidence
      );

      // 保留最高优先级，删除其他
      const keep = sorted[0];
      for (const r of sorted.slice(1)) {
        if (r.id && r.id !== keep.id) {
          await this.db.query(`DELETE $id`, { id: r.id });
          resolvedCount++;
          logInfo(`[KnowledgeGraphBuilder] Resolved conflict: deleted ${r.method} relation, kept ${keep.method}`);
        }
      }
    }

    logInfo(`[KnowledgeGraphBuilder] Resolved ${resolvedCount} relation conflicts`);
    return resolvedCount;
  }

  // ============================================================
  // V2.0 新增：同义词合并
  // ============================================================

  /**
   * 合并同义词（高相似度 > 0.99）
   *
   * 当两个术语被判定为 synonym 且相似度 > 0.99 时：
   * 1. 选择高频术语为主实体（is_primary = true）
   * 2. 低频术语设为别名（is_primary = false, primary_id = 主实体ID）
   * 3. 合并 aliases 数组和频次
   */
  async mergeSynonyms(): Promise<number> {
    logInfo('[KnowledgeGraphBuilder] Starting synonym merge...');

    // 查找高相似度 synonym 关系
    const candidatesRaw = await this.db.query(`
      SELECT in, out, weight FROM term_relation
      WHERE relation_type = 'synonym' AND weight > 0.99
    `, {});
    const candidates = candidatesRaw as Array<Array<{ in?: string; out?: string; weight?: number }>>;
    const candidateList = candidates[0] || [];
    let mergedCount = 0;

    for (const c of candidateList) {
      const record = c as { in?: string; out?: string; weight?: number };
      // 获取两个术语的详情
      const termARaw = await this.db.query(
        'SELECT id, name, frequency FROM term WHERE id = $id',
        { id: record.in }
      );
      const termBRaw = await this.db.query(
        'SELECT id, name, frequency FROM term WHERE id = $id',
        { id: record.out }
      );
      const termA = termARaw as Array<Array<{ id?: string; name?: string; frequency?: number }>>;
      const termB = termBRaw as Array<Array<{ id?: string; name?: string; frequency?: number }>>;
      const a = termA[0]?.[0];
      const b = termB[0]?.[0];

      if (!a || !b) continue;

      // 选择高频为主实体
      const primary = (a.frequency ?? 0) >= (b.frequency ?? 0) ? a : b;
      const alias = (a.frequency ?? 0) < (b.frequency ?? 0) ? a : b;

      // 合并
      await this.db.query(`
        UPDATE $primary SET
          aliases = array::distinct(aliases + $alias_name),
          frequency = frequency + $alias_freq,
          updated_at = time::now()
      `, {
        primary: primary.id,
        alias_name: alias.name,
        alias_freq: alias.frequency,
      });

      // 设置别名为非主实体
      await this.db.query(`
        UPDATE $alias SET
          is_primary = false,
          primary_id = $primary_id,
          updated_at = time::now()
      `, {
        alias: alias.id,
        primary_id: primary.id,
      });

      mergedCount++;
      logInfo(`[KnowledgeGraphBuilder] Merged synonym: ${alias.name} -> ${primary.name}`);
    }

    logInfo(`[KnowledgeGraphBuilder] Merged ${mergedCount} synonym pairs`);
    return mergedCount;
  }

  // ============================================================
  // V2.0 新增：衰减更新
  // ============================================================

  /**
   * 更新共现关系的衰减因子
   *
   * decay_factor = e^(-λ × time_elapsed)
   * λ = 0.01（每月衰减约 1%）
   */
  async updateDecayFactors(): Promise<number> {
    logInfo('[KnowledgeGraphBuilder] Updating decay factors...');

    const lambda = 0.01;  // 衰减率

    // 查询所有 co_occurrence 关系
    const relationsRaw = await this.db.query(`
      SELECT id, created_at, decay_factor FROM term_relation
      WHERE method = 'co_occurrence'
    `, {});
    const relations = relationsRaw as Array<Array<{ id?: string; created_at?: string; decay_factor?: number }>>;
    const relationList = relations[0] || [];
    let updatedCount = 0;

    for (const r of relationList) {
      const record = r as { id?: string; created_at?: string; decay_factor?: number };
      if (!record.created_at) continue;

      // 计算时间差（月）
      const createdTime = new Date(record.created_at);
      const now = new Date();
      const monthsElapsed = (now.getTime() - createdTime.getTime()) / (30 * 24 * 60 * 60 * 1000);

      // 计算衰减因子
      const decayFactor = Math.exp(-lambda * monthsElapsed);

      // 更新
      await this.db.query(`
        UPDATE $id SET decay_factor = $decay_factor
      `, { id: record.id, decay_factor: decayFactor });

      updatedCount++;
    }

    logInfo(`[KnowledgeGraphBuilder] Updated ${updatedCount} decay factors`);
    return updatedCount;
  }
}
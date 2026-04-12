/**
 * Knowledge Compiler - 知识编译器核心
 *
 * 流程：
 * 1. 计算内容哈希（去重）
 * 2. LLM提取三元组和摘要
 * 3. 生成向量嵌入
 * 4. 存储到数据库
 */

import * as crypto from 'crypto';
import { LLMClient } from '../llm-client.js';
import { createEmbeddingService, type EmbeddingService } from '../embedding-service.js';
import type { SurrealDatabase } from '../surrealdb-client.js';
import { logInfo, logError, logWarn } from '../maintenance-logger.js';
import type {
  WikiPage,
  KnowledgeTriple,
  ExtractedKnowledge,
  BlockMetadata,
  CompileResult,
  CompilerConfig,
} from './types.js';

/**
 * 批量编译结果
 */
export interface BatchCompileResult {
  results: CompileResult[];
  stats: {
    total: number;
    stored: number;
    skipped: number;
    failed: number;
  };
}

export class KnowledgeCompiler {
  private llm: LLMClient;
  private embedding: EmbeddingService;

  constructor(
    private db: SurrealDatabase,
    config: CompilerConfig
  ) {
    this.llm = new LLMClient(config.llm, {
      maxTokens: 2000,  // 批量处理需要更多 token
      temperature: 0.3,
      topP: 0.9,
    });

    this.embedding = createEmbeddingService({
      type: 'local',
      endpoint: config.embedding.endpoint,
      model: config.embedding.model || 'bge-m3-mlx-fp16',
      apiKey: config.embedding.apiKey,
      dimension: 1024,
    });
  }

  /**
   * 批量编译多个块 - 一次 LLM 调用处理多个块
   * 这是主要的性能优化方法
   */
  async compileBatch(
    blocks: Array<{ text: string; metadata: BlockMetadata }>,
    batchSize: number = 5
  ): Promise<BatchCompileResult> {
    const results: CompileResult[] = [];
    let stats = { total: blocks.length, stored: 0, skipped: 0, failed: 0 };

    // 1. 批量计算哈希
    const hashes = blocks.map(b => this.computeHash(b.text));

    // 2. 批量检查去重
    const existingChecks = await Promise.all(
      hashes.map(h => this.checkExisting(h))
    );

    // 3. 过滤出需要处理的块
    const toProcess: Array<{ index: number; text: string; metadata: BlockMetadata; hash: string }> = [];
    for (let i = 0; i < blocks.length; i++) {
      if (existingChecks[i]) {
        // 已存在，添加版本引用
        await this.addVersionReference(hashes[i], blocks[i].metadata.doc_version);
        results[i] = { page: null, isNew: false, skipped: true };
        stats.skipped++;
      } else {
        toProcess.push({ index: i, text: blocks[i].text, metadata: blocks[i].metadata, hash: hashes[i] });
      }
    }

    // 4. 批量 LLM 提取（核心优化）
    if (toProcess.length > 0) {
      const batchExtractions = await this.extractKnowledgeBatch(
        toProcess.map(b => b.text)
      );

      // 5. 并行生成向量并存储
      const storePromises = toProcess.map(async (block, i) => {
        const extracted = batchExtractions[i];

        if (!extracted.summary || extracted.triples.length === 0) {
          results[block.index] = { page: null, isNew: false, skipped: false };
          stats.failed++;
          return;
        }

        const embedding = await this.embedding.embed(extracted.summary);
        if (!embedding || embedding.length !== 1024) {
          results[block.index] = { page: null, isNew: false, skipped: false };
          stats.failed++;
          return;
        }

        try {
          const page = await this.store({
            content: extracted.summary,
            raw_content: block.text,
            content_hash: block.hash,
            triples: extracted.triples,
            embedding,
            topic: extracted.topic,
            section: block.metadata.section || '',
            page_number: block.metadata.page_number,
            session_id: block.metadata.session_id,
            doc_version: block.metadata.doc_version,
            source_path: block.metadata.source_path,
            source_type: block.metadata.source_type,
            status: 'compiled',
          });

          await this.createReference(block.hash, block.metadata.doc_version);
          results[block.index] = { page, isNew: true, skipped: false };
          stats.stored++;
        } catch (error) {
          results[block.index] = { page: null, isNew: false, skipped: false };
          stats.failed++;
        }
      });

      await Promise.all(storePromises);
    }

    return { results, stats };
  }

  /**
   * 批量 LLM 提取 - 一次调用处理多个块
   */
  private async extractKnowledgeBatch(texts: string[]): Promise<ExtractedKnowledge[]> {
    const prompt = this.buildBatchPrompt(texts);

    try {
      const response = await this.llm.complete(prompt, 'knowledge-batch', {
        maxTokens: 2000,
        temperature: 0.3,
      });

      return this.parseBatchResponse(response, texts.length);
    } catch (error: any) {
      logError(`[Compiler] Batch extraction failed: ${error.message}`);
      // 返回空结果
      return texts.map(() => ({ triples: [], summary: '', topic: '' }));
    }
  }

  /**
   * 构建批量提取提示词 - 使用 JSON 格式输出
   */
  private buildBatchPrompt(texts: string[]): string {
    let prompt = `分析以下 ${texts.length} 个技术文档段落，为每个段落提取知识三元组和精炼摘要。

请严格按以下 JSON 格式输出，不要添加任何其他内容：
[
  {
    "triples": [{"subject": "主体", "relation": "关系", "obj": "客体"}],
    "summary": "50-100字摘要"
  },
  ...
]

文档段落：`;

    texts.forEach((text, i) => {
      prompt += `\n\n【段落${i + 1}】\n${text.slice(0, 600)}`;
    });

    return prompt;
  }

  /**
   * 解析批量响应 - JSON 格式
   */
  private parseBatchResponse(content: string, expectedCount: number): ExtractedKnowledge[] {
    const results: ExtractedKnowledge[] = [];

    // 尝试提取 JSON 数组
    try {
      // 查找 JSON 数组
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);

        for (let i = 0; i < expectedCount; i++) {
          if (parsed[i] && Array.isArray(parsed[i].triples)) {
            results.push({
              triples: parsed[i].triples.slice(0, 20).map((t: any) => ({
                subject: String(t.subject || '').slice(0, 100),
                relation: String(t.relation || '').slice(0, 100),
                obj: String(t.obj || '').slice(0, 100),
              })),
              summary: String(parsed[i].summary || '').slice(0, 300),
              topic: '',
            });
          } else {
            results.push({ triples: [], summary: '', topic: '' });
          }
        }
        return results;
      }
    } catch (e) {
      // JSON 解析失败，回退到管道分隔格式
    }

    // 回退：尝试逐个解析
    for (let i = 0; i < expectedCount; i++) {
      results.push({ triples: [], summary: '', topic: '' });
    }

    return results;
  }

  /**
   * 解析单个块的提取结果
   */
  private parseBlockExtraction(content: string): ExtractedKnowledge {
    const triples: KnowledgeTriple[] = [];
    let summary = '';
    let topic = '';

    const lines = content.split('\n');
    let currentSection = '';

    for (const line of lines) {
      const trimmed = line.trim();

      if (trimmed === '---TRIPLES---') {
        currentSection = 'triples';
        continue;
      } else if (trimmed === '---SUMMARY---') {
        currentSection = 'summary';
        continue;
      } else if (trimmed === '---TOPIC---') {
        currentSection = 'topic';
        continue;
      } else if (trimmed.startsWith('===')) {
        continue;
      }

      if (currentSection === 'triples' && trimmed.includes('|')) {
        const parts = trimmed.split('|');
        if (parts.length >= 3) {
          triples.push({
            subject: parts[0].trim(),
            relation: parts[1].trim(),
            obj: parts[2].trim(),
          });
        }
      } else if (currentSection === 'summary' && trimmed) {
        summary += trimmed + ' ';
      } else if (currentSection === 'topic' && trimmed) {
        topic = trimmed;
      }
    }

    return {
      triples: triples.slice(0, 20), // 限制三元组数量
      summary: summary.trim().slice(0, 300),
      topic: topic.trim().slice(0, 50),
    };
  }

  /**
   * 编译文档块 - 带去重
   */
  async compileBlock(text: string, metadata: BlockMetadata): Promise<CompileResult> {
    console.log(`[Compiler] Compiling block (${text.length} chars)...`);

    // 1. 计算内容哈希
    const contentHash = this.computeHash(text);
    // 只在每10个块输出一次详细日志
    const verbose = process.env.V3_VERBOSE === 'true';

    // 2. 检查是否已存在（去重）
    const existing = await this.checkExisting(contentHash);

    if (existing) {
      // 已存在，只添加版本引用
      await this.addVersionReference(contentHash, metadata.doc_version);
      if (verbose) console.log(`[Compiler] Skipped duplicate: ${contentHash.slice(0, 8)}`);

      return {
        page: null,
        isNew: false,
        skipped: true,
      };
    }

    // 3. LLM提取三元组和摘要
    const extracted = await this.extractKnowledge(text);

    if (!extracted.summary || extracted.triples.length === 0) {
      if (verbose) logWarn(`[Compiler] Empty extraction for ${metadata.session_id}`);
      return {
        page: null,
        isNew: false,
        skipped: false,
      };
    }

    // 4. 生成向量
    const embedding = await this.embedding.embed(extracted.summary);

    if (!embedding || embedding.length !== 1024) {
      logError(`[Compiler] Invalid embedding dimension: ${embedding?.length}`);
      return {
        page: null,
        isNew: false,
        skipped: false,
      };
    }

    // 5. 存储到数据库
    try {
      const page = await this.store({
        content: extracted.summary,
        raw_content: text,
        content_hash: contentHash,
        triples: extracted.triples,
        embedding,
        topic: extracted.topic,
        section: metadata.section || '',
        page_number: metadata.page_number,
        session_id: metadata.session_id,
        doc_version: metadata.doc_version,
        source_path: metadata.source_path,
        source_type: metadata.source_type,
        status: 'compiled',
      });

      // 6. 创建引用记录
      await this.createReference(contentHash, metadata.doc_version);

      if (verbose) console.log(`[Compiler] Stored: ${page.id}, ${extracted.triples.length} triples`);
      return {
        page,
        isNew: true,
        skipped: false,
      };
    } catch (error: any) {
      console.error(`[Compiler] Store failed: ${error.message}`);
      return {
        page: null,
        isNew: false,
        skipped: false,
      };
    }
  }

  /**
   * 计算内容哈希
   */
  private computeHash(text: string): string {
    // 标准化文本（去除空白差异）
    const normalized = text
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .replace(/[^\w\s\u4e00-\u9fff]/g, '')
      .trim();

    return crypto.createHash('sha256').update(normalized).digest('hex');
  }

  /**
   * 检查内容是否已存在
   */
  private async checkExisting(contentHash: string): Promise<boolean> {
    try {
      const result = await this.db.query(
        'SELECT count() FROM memory WHERE content_hash = $hash GROUP ALL',
        { hash: contentHash }
      );

      // SurrealHTTPClient.query returns [[{count: N}]] for SELECT queries
      return result[0]?.[0]?.count > 0;
    } catch (error) {
      return false;
    }
  }

  /**
   * 添加版本引用
   */
  private async addVersionReference(contentHash: string, version: string): Promise<void> {
    try {
      await this.db.query(
        `UPDATE content_reference SET
          doc_versions = array::distinct(doc_versions + $version),
          ref_count += 1
        WHERE content_hash = $hash`,
        { hash: contentHash, version }
      );
    } catch (error: any) {
      logWarn(`[Compiler] Failed to add version reference: ${error.message}`);
    }
  }

  /**
   * 创建引用记录
   */
  private async createReference(contentHash: string, version: string): Promise<void> {
    try {
      await this.db.query(
        `CREATE content_reference SET
          content_hash = $hash,
          doc_versions = [$version],
          ref_count = 1,
          first_seen = time::now()`,
        { hash: contentHash, version }
      );
    } catch (error: any) {
      // 忽略重复键错误
      if (!error.message?.includes('already exists')) {
        logWarn(`[Compiler] Failed to create reference: ${error.message}`);
      }
    }
  }

  /**
   * LLM提取知识 - 使用管道分隔格式
   */
  private async extractKnowledge(text: string): Promise<ExtractedKnowledge> {
    const prompt = this.buildExtractPrompt(text);

    try {
      const response = await this.llm.complete(prompt, 'knowledge-compiler', {
        maxTokens: 400,
        temperature: 0.3,
      });

      return this.parsePipeDelimitedResponse(response);
    } catch (error: any) {
      logError(`[Compiler] LLM extraction failed: ${error.message}`);
      return { triples: [], summary: '', topic: '' };
    }
  }

  /**
   * 构建提取提示词
   */
  private buildExtractPrompt(text: string): string {
    // 简化提示词，避免 LLM 输出重复
    return `提取以下文档的知识。输出格式要简洁，不要重复。

【文档】
${text.slice(0, 1500)}

【输出要求】
1. 三元组（每行一个）：主体|关系|客体
2. 摘要（一句话）：50字以内

---三元组---
主体|关系|客体
---摘要---
一句话总结`;
  }

  /**
   * 解析管道分隔格式响应
   */
  private parsePipeDelimitedResponse(content: string): ExtractedKnowledge {
    const triples: KnowledgeTriple[] = [];
    let summary = '';
    let topic = '';

    const lines = content.split('\n');
    let currentSection = '';

    for (const line of lines) {
      const trimmed = line.trim();

      // 支持中文和英文分隔符
      if (trimmed === '---TRIPLES---' || trimmed === '---三元组---') {
        currentSection = 'triples';
        continue;
      } else if (trimmed === '---SUMMARY---' || trimmed === '---摘要---') {
        currentSection = 'summary';
        continue;
      } else if (trimmed === '---TOPIC---' || trimmed === '---主题---') {
        currentSection = 'topic';
        continue;
      } else if (trimmed.startsWith('---')) {
        continue;
      }

      if (currentSection === 'triples' && trimmed.includes('|')) {
        const parts = trimmed.split('|');
        if (parts.length >= 3) {
          const subject = parts[0].trim();
          const relation = parts[1].trim();
          const obj = parts.slice(2).join('|').trim();

          // 过滤重复和无效三元组
          if (subject && relation && obj &&
              subject.length < 100 && relation.length < 100 && obj.length < 100 &&
              !this.isRepetitive(subject) && !this.isRepetitive(relation) && !this.isRepetitive(obj)) {
            triples.push({ subject, relation, obj });
          }
        }
      } else if (currentSection === 'summary' && trimmed && !trimmed.includes('---')) {
        if (!summary && trimmed.length > 5) {
          // 清理摘要中的重复
          summary = this.cleanRepetitive(trimmed);
        }
      } else if (currentSection === 'topic' && trimmed && !topic) {
        topic = trimmed;
      }
    }

    return {
      triples: triples.slice(0, 15),
      summary: summary.slice(0, 200),
      topic: topic.slice(0, 50),
    };
  }

  /**
   * 检查字符串是否有重复模式或无效内容
   */
  private isRepetitive(text: string): boolean {
    if (text.length < 2) return true;

    // 检查是否有连续重复字符/词语
    const pattern = text.match(/(.{2,}?)\1{2,}/);
    if (pattern) return true;

    // 检查是否全是重复单词
    const words = text.split(/\s+/);
    if (words.length > 3) {
      const unique = new Set(words);
      if (unique.size < words.length / 2) return true;
    }

    return false;
  }

  /**
   * 清理重复输出
   */
  private cleanRepetitive(text: string): string {
    // 移除连续重复的单词
    return text
      .replace(/\b(\w+)(\s+\1)+\b/gi, '$1')  // word word word -> word
      .replace(/(.{2,}?)\1{2,}/g, '$1$1')    // aaa... -> aa
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * 存储到数据库
   */
  private async store(page: Omit<WikiPage, 'id' | 'created_at' | 'updated_at'>): Promise<WikiPage> {
    const now = new Date().toISOString();

    const result = await this.db.query(
      `CREATE memory SET
        content = $content,
        raw_content = $raw_content,
        content_hash = $content_hash,
        triples = $triples,
        embedding = $embedding,
        topic = $topic,
        section = $section,
        page_number = $page_number,
        session_id = $session_id,
        doc_version = $doc_version,
        source_path = $source_path,
        source_type = $source_type,
        status = $status,
        created_at = $now,
        updated_at = $now,
        is_active = true,
        access_count = 0,
        importance = 0.7,
        type = "semantic"`,
      {
        ...page,
        now,
      }
    );

    console.log(`[Compiler] DB result: ${JSON.stringify(result).slice(0, 200)}`);

    // Parse the result - SurrealDB returns [[{id: "memory:xxx", ...}]]
    const id = result[0]?.[0]?.id;

    return {
      ...page,
      id,
      created_at: new Date(now),
      updated_at: new Date(now),
    } as WikiPage;
  }
}
/**
 * Compile Manager - 编译流程管理
 *
 * 功能：
 * - 文档解析和分块
 * - 批量编译流程
 * - 统计追踪
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import { DocumentParser } from '../document-parser.js';
import { DocumentSplitter } from '../document-splitter.js';
import { SmartDocumentSplitter, type SemanticBlock } from './smart-splitter.js';
import type { SurrealDatabase } from '../surrealdb-client.js';
import { logInfo, logError, logWarn } from '../maintenance-logger.js';
import { KnowledgeCompiler } from './compiler.js';
import type {
  BlockMetadata,
  CompileStats,
  CompilerConfig,
} from './types.js';

export interface DocumentCompileOptions {
  docType: string;           // postgres, mysql, oracle
  docVersion: string;        // 15, 17
  maxPages?: number;         // 最大页数限制
  skipExisting?: boolean;    // 跳过已编译
  useSmartSplit?: boolean;   // 使用智能分块（LLM辅助）
  onProgress?: (stats: CompileStats) => void; // 进度回调
  batchSize?: number;        // 批量大小（默认5，一次LLM调用处理的块数）
}

export class CompileManager {
  private compiler: KnowledgeCompiler;
  private parser: DocumentParser;
  private splitter: DocumentSplitter;
  private smartSplitter?: SmartDocumentSplitter;

  constructor(
    private db: SurrealDatabase,
    config: CompilerConfig
  ) {
    this.compiler = new KnowledgeCompiler(db, config);
    this.parser = new DocumentParser();
    this.splitter = new DocumentSplitter(1000, 100); // chunkSize=1000, overlap=100

    // 智能分块器（可选）
    if (config.llm) {
      this.smartSplitter = new SmartDocumentSplitter({
        llm: config.llm,
        maxChunkSize: 2000,
        minChunkSize: 100,
      });
    }
  }

  /**
   * 编译文档
   */
  async compileDocument(
    filePath: string,
    options: DocumentCompileOptions
  ): Promise<CompileStats> {
    const stats: CompileStats = {
      total: 0,
      stored: 0,
      skipped: 0,
      failed: 0,
      triples: 0,
    };

    console.log(`[CompileManager] Starting: ${filePath}`);
    console.log(`[CompileManager] Type: ${options.docType}, Version: ${options.docVersion}`);
    logInfo(`[CompileManager] Starting: ${filePath}`);
    logInfo(`[CompileManager] Type: ${options.docType}, Version: ${options.docVersion}`);

    try {
      // 1. 检查文件
      const stat = await fs.stat(filePath);
      if (!stat.isFile()) {
        throw new Error(`Not a file: ${filePath}`);
      }
      console.log('[CompileManager] File exists, parsing...');

      // 2. 解析文档（自动跳过PDF前言：封面、版权、目录）
      const parsed = await this.parser.parse(filePath);
      console.log(`[CompileManager] Parsed: ${parsed.content.length} chars`);

      // 3. 分块
      let blocks: Array<{ text: string; page?: number; sectionTitle?: string; blockType?: string }>;

      // 对于大文档，自动禁用智能分块（太慢）
      const contentLength = parsed.content.length;
      const isLargeDocument = contentLength > 100000; // 100KB

      if (options.useSmartSplit && this.smartSplitter && !isLargeDocument) {
        // 使用智能分块（LLM辅助）
        console.log('[CompileManager] Using smart split (LLM-assisted)');
        const semanticBlocks = await this.smartSplitter.smartSplit(parsed.content);
        blocks = semanticBlocks.map((block, index) => ({
          text: block.text,
          page: index + 1,
          sectionTitle: block.sectionTitle,
          blockType: block.type,
        }));
      } else {
        // 使用传统分块
        if (isLargeDocument) {
          console.log(`[CompileManager] Large document (${Math.round(contentLength/1024)}KB), using simple split`);
        }
        blocks = this.splitIntoBlocks(parsed.content, options.maxPages);
      }

      stats.total = blocks.length;
      console.log(`[CompileManager] Total blocks: ${blocks.length}`);

      // 4. 生成 session_id
      const filename = path.basename(filePath).replace(/\.[^.]+$/, '');
      const sessionId = `doc:${options.docType}:${options.docVersion}:${filename}`;

      // 5. 逐块编译（单块处理，更可靠）
      console.log(`[CompileManager] Using single-block processing`);

      for (let i = 0; i < blocks.length; i++) {
        const block = blocks[i];

        // 进度日志（每 20 块）
        if ((i + 1) % 20 === 0 || i === blocks.length - 1) {
          console.log(`[CompileManager] Progress: ${i + 1}/${blocks.length}, stored: ${stats.stored}`);
        }

        const metadata: BlockMetadata = {
          session_id: sessionId,
          doc_version: options.docVersion,
          source_path: filePath,
          source_type: parsed.metadata.type,
          page_number: block.page || i + 1,
          section: block.sectionTitle || '',
        };

        try {
          const result = await this.compiler.compileBlock(block.text, metadata);

          if (result.skipped) {
            stats.skipped++;
          } else if (result.page) {
            stats.stored++;
            stats.triples += result.page.triples.length;
          } else {
            stats.failed++;
          }

          // 进度回调
          if (options.onProgress) {
            options.onProgress(stats);
          }
        } catch (error: any) {
          stats.failed++;
        }
      }

      logInfo(`[CompileManager] Completed: ${stats.stored} stored, ${stats.skipped} skipped, ${stats.failed} failed`);

      return stats;
    } catch (error: any) {
      logError(`[CompileManager] Failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * 将文档内容分块
   */
  private splitIntoBlocks(content: string, maxPages?: number): Array<{ text: string; page?: number }> {
    // 使用 DocumentSplitter 进行分块
    const chunks = this.splitter.split(content, '');

    // 限制块数（如果指定了 maxPages）
    const limit = maxPages ? maxPages * 3 : chunks.length; // 假设每页约3块

    return chunks.slice(0, limit).map((chunk, index) => ({
      text: chunk.content,
      page: index + 1, // DocumentSplitter doesn't track page numbers
    }));
  }

  /**
   * 清除指定 session 的数据
   */
  async clearSession(sessionId: string): Promise<number> {
    try {
      const result = await this.db.query(
        'DELETE FROM memory WHERE session_id = $sessionId',
        { sessionId }
      );

      const count = result[0]?.[0]?.count || 0;
      logInfo(`[CompileManager] Cleared ${count} records from session: ${sessionId}`);
      return count;
    } catch (error: any) {
      logError(`[CompileManager] Clear failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * 获取编译状态
   */
  async getStatus(sessionId?: string): Promise<{
    total: number;
    byVersion: Record<string, number>;
    triples: number;
  }> {
    try {
      // 总数
      const totalResult = await this.db.query(
        sessionId
          ? 'SELECT count() FROM memory WHERE session_id = $sessionId GROUP ALL'
          : 'SELECT count() FROM memory GROUP ALL',
        { sessionId }
      );

      // 按版本统计
      const versionResult = await this.db.query(
        `SELECT doc_version, count() AS count
         FROM memory
         ${sessionId ? 'WHERE session_id = $sessionId' : ''}
         GROUP BY doc_version`,
        { sessionId }
      );

      // 三元组总数
      const triplesResult = await this.db.query(
        `SELECT math::sum(array::len(triples)) AS total
         FROM memory
         ${sessionId ? 'WHERE session_id = $sessionId' : ''}
         GROUP ALL`,
        { sessionId }
      );

      const byVersion: Record<string, number> = {};
      for (const row of versionResult[0] || []) {
        if (row.doc_version) {
          byVersion[row.doc_version] = row.count;
        }
      }

      return {
        total: totalResult[0]?.[0]?.count || 0,
        byVersion,
        triples: triplesResult[0]?.[0]?.total || 0,
      };
    } catch (error: any) {
      logError(`[CompileManager] Status failed: ${error.message}`);
      return { total: 0, byVersion: {}, triples: 0 };
    }
  }

  /**
   * 延迟
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
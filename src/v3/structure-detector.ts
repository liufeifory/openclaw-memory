/**
 * Document Structure Detector - 检测文档是否结构化
 *
 * 结构化文档特征：
 * - PDF: 有目录(TOC)、章节标题、页码
 * - Markdown: 有标题层级(# ## ###)
 * - HTML: 有语义标签(section, article, header)
 * - Word: 有样式（标题1、标题2等）
 *
 * 非结构化文档：
 * - 纯文本无格式
 * - 扫描PDF（无文字层）
 * - 无结构的HTML（全是div）
 */

import * as fs from 'fs/promises';
import * as path from 'path';

export interface StructureInfo {
  isStructured: boolean;
  structureType: 'structured' | 'semi-structured' | 'unstructured';
  confidence: number;           // 0-1
  features: StructureFeatures;
  suggestedSplitMethod: 'smart' | 'simple';
}

export interface StructureFeatures {
  // PDF特征
  hasTOC?: boolean;             // 有目录
  hasPageNumbers?: boolean;     // 有页码
  hasChapters?: boolean;        // 有章节

  // Markdown特征
  headingCount?: number;        // 标题数量
  headingLevels?: number[];     // 标题层级 [1, 2, 3]

  // HTML特征
  hasSemanticTags?: boolean;    // 有语义标签
  semanticTagCount?: number;    // 语义标签数量

  // 通用特征
  paragraphCount?: number;      // 段落数量
  avgParagraphLength?: number;  // 平均段落长度
  hasListStructure?: boolean;   // 有列表结构
  hasCodeBlocks?: boolean;      // 有代码块
  hasTables?: boolean;          // 有表格
}

export class StructureDetector {
  /**
   * 检测文档结构
   */
  async detect(filePath: string, content?: string): Promise<StructureInfo> {
    const ext = path.extname(filePath).toLowerCase();

    let features: StructureFeatures;
    let isStructured = false;
    let confidence = 0;

    switch (ext) {
      case '.pdf':
        features = await this.detectPDFStructure(filePath);
        ({ isStructured, confidence } = this.evaluatePDFStructure(features));
        break;

      case '.md':
      case '.markdown':
        features = this.detectMarkdownStructure(content || await this.readFile(filePath));
        ({ isStructured, confidence } = this.evaluateMarkdownStructure(features));
        break;

      case '.html':
      case '.htm':
        features = this.detectHTMLStructure(content || await this.readFile(filePath));
        ({ isStructured, confidence } = this.evaluateHTMLStructure(features));
        break;

      case '.docx':
      case '.doc':
        features = await this.detectWordStructure(filePath);
        ({ isStructured, confidence } = this.evaluateWordStructure(features));
        break;

      default:
        // 纯文本，尝试检测是否有结构
        features = this.detectTextStructure(content || await this.readFile(filePath));
        ({ isStructured, confidence } = this.evaluateTextStructure(features));
    }

    // 确定结构类型
    const structureType: StructureInfo['structureType'] =
      confidence >= 0.7 ? 'structured' :
      confidence >= 0.4 ? 'semi-structured' : 'unstructured';

    // 建议分块方法
    const suggestedSplitMethod: StructureInfo['suggestedSplitMethod'] =
      isStructured ? 'smart' : 'simple';

    return {
      isStructured,
      structureType,
      confidence,
      features,
      suggestedSplitMethod,
    };
  }

  /**
   * 检测PDF结构
   */
  private async detectPDFStructure(filePath: string): Promise<StructureFeatures> {
    const features: StructureFeatures = {};

    try {
      // 使用pdftotext提取文本
      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const execAsync = promisify(exec);

      // 检查是否有目录
      const { stdout: tocCheck } = await execAsync(
        `pdftotext "${filePath}" - 2>/dev/null | head -100`,
        { timeout: 30000 }
      );

      const text = tocCheck.toLowerCase();

      // 检测目录关键词
      features.hasTOC = text.includes('contents') ||
                        text.includes('table of contents') ||
                        text.includes('目录') ||
                        text.includes('目次');

      // 检测章节标记
      const chapterPatterns = [
        /chapter\s+\d+/i,
        /第[一二三四五六七八九十\d]+[章节]/,
        /part\s+\d+/i,
        /section\s+\d+/i,
      ];
      features.hasChapters = chapterPatterns.some(p => p.test(text));

      // 检测页码
      features.hasPageNumbers = /\b\d+\s*$|\bpage\s+\d+/im.test(text);

      // 段落数量
      const paragraphs = text.split(/\n\n+/).filter(p => p.trim().length > 50);
      features.paragraphCount = paragraphs.length;
      features.avgParagraphLength = paragraphs.reduce((sum, p) => sum + p.length, 0) / Math.max(paragraphs.length, 1);

    } catch (error) {
      // 无法检测，假设非结构化
      features.hasTOC = false;
      features.hasChapters = false;
    }

    return features;
  }

  /**
   * 检测Markdown结构
   */
  private detectMarkdownStructure(content: string): StructureFeatures {
    const features: StructureFeatures = {};

    // 检测标题
    const headingMatches = content.match(/^#{1,6}\s+.+$/gm) || [];
    features.headingCount = headingMatches.length;

    // 检测标题层级
    const levels = new Set<number>();
    for (const match of headingMatches) {
      const level = match.match(/^#+/)?.[0]?.length || 0;
      if (level > 0) levels.add(level);
    }
    features.headingLevels = Array.from(levels).sort();

    // 检测代码块
    features.hasCodeBlocks = /```\w*\n[\s\S]*?```/.test(content);

    // 检测表格
    features.hasTables = /\|.+\|[\r\n]+\|[-:| ]+\|/.test(content);

    // 检测列表
    features.hasListStructure = /^[\s]*[-*+]\s+/m.test(content) || /^[\s]*\d+\.\s+/m.test(content);

    // 段落数量
    const paragraphs = content.split(/\n\n+/).filter(p => p.trim().length > 20);
    features.paragraphCount = paragraphs.length;
    features.avgParagraphLength = paragraphs.reduce((sum, p) => sum + p.length, 0) / Math.max(paragraphs.length, 1);

    return features;
  }

  /**
   * 检测HTML结构
   */
  private detectHTMLStructure(content: string): StructureFeatures {
    const features: StructureFeatures = {};

    // 语义标签
    const semanticTags = ['section', 'article', 'header', 'nav', 'main', 'aside', 'footer', 'figure', 'figcaption'];
    let semanticCount = 0;

    for (const tag of semanticTags) {
      const matches = content.match(new RegExp(`<${tag}[^>]*>`, 'gi')) || [];
      semanticCount += matches.length;
    }

    features.hasSemanticTags = semanticCount > 0;
    features.semanticTagCount = semanticCount;

    // 检测标题标签
    const headingMatches = content.match(/<h[1-6][^>]*>/gi) || [];
    features.headingCount = headingMatches.length;

    // 检测表格
    features.hasTables = /<table[^>]*>/i.test(content);

    // 检测列表
    features.hasListStructure = /<[ou]l[^>]*>/i.test(content);

    // 检测代码块
    features.hasCodeBlocks = /<code[^>]*>|<pre[^>]*>/i.test(content);

    return features;
  }

  /**
   * 检测Word文档结构（简化版）
   */
  private async detectWordStructure(filePath: string): Promise<StructureFeatures> {
    // 简化实现：使用mammoth提取文本后分析
    const features: StructureFeatures = {};

    try {
      const mammoth = await import('mammoth');
      const result = await mammoth.extractRawText({ path: filePath });
      const text = result.value;

      // 检测可能的章节标题（全大写、数字开头等）
      const lines = text.split('\n');
      let headingLike = 0;

      for (const line of lines) {
        const trimmed = line.trim();
        // 章节标题特征：全大写、数字开头、较短
        if (trimmed.length < 50 && trimmed.length > 3) {
          if (/^[A-Z\s]+$/.test(trimmed) ||
              /^第[一二三四五六七八九十\d]+/.test(trimmed) ||
              /^\d+[\.\s]/.test(trimmed)) {
            headingLike++;
          }
        }
      }

      features.hasChapters = headingLike > 2;
      features.headingCount = headingLike;

      const paragraphs = text.split(/\n\n+/).filter(p => p.trim().length > 20);
      features.paragraphCount = paragraphs.length;

    } catch (error) {
      features.hasChapters = false;
    }

    return features;
  }

  /**
   * 检测纯文本结构
   */
  private detectTextStructure(content: string): StructureFeatures {
    const features: StructureFeatures = {};

    const lines = content.split('\n');

    // 检测可能的章节标题
    let headingLike = 0;
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.length < 50 && trimmed.length > 3) {
        // 可能是标题的特征
        if (/^[A-Z\s]+$/.test(trimmed) ||
            /^第[一二三四五六七八九十\d]+/.test(trimmed) ||
            /^\d+[\.\s]/.test(trimmed) ||
            /^[一二三四五六七八九十]+[、.．]/.test(trimmed)) {
          headingLike++;
        }
      }
    }

    features.headingCount = headingLike;
    features.hasChapters = headingLike > 2;

    // 段落数量
    const paragraphs = content.split(/\n\n+/).filter(p => p.trim().length > 20);
    features.paragraphCount = paragraphs.length;
    features.avgParagraphLength = paragraphs.reduce((sum, p) => sum + p.length, 0) / Math.max(paragraphs.length, 1);

    return features;
  }

  /**
   * 评估PDF结构化程度
   */
  private evaluatePDFStructure(features: StructureFeatures): { isStructured: boolean; confidence: number } {
    let score = 0;

    if (features.hasTOC) score += 0.4;
    if (features.hasChapters) score += 0.3;
    if (features.hasPageNumbers) score += 0.1;
    if ((features.paragraphCount || 0) > 10) score += 0.2;

    return {
      isStructured: score >= 0.5,
      confidence: Math.min(score, 1),
    };
  }

  /**
   * 评估Markdown结构化程度
   */
  private evaluateMarkdownStructure(features: StructureFeatures): { isStructured: boolean; confidence: number } {
    let score = 0;

    // 标题数量和层级是关键指标
    const headingCount = features.headingCount || 0;
    const headingLevels = features.headingLevels?.length || 0;

    if (headingCount >= 3) score += 0.4;
    if (headingLevels >= 2) score += 0.2;

    // 其他结构特征
    if (features.hasCodeBlocks) score += 0.1;
    if (features.hasTables) score += 0.1;
    if (features.hasListStructure) score += 0.1;
    if ((features.paragraphCount || 0) > 5) score += 0.1;

    return {
      isStructured: score >= 0.5,
      confidence: Math.min(score, 1),
    };
  }

  /**
   * 评估HTML结构化程度
   */
  private evaluateHTMLStructure(features: StructureFeatures): { isStructured: boolean; confidence: number } {
    let score = 0;

    if (features.hasSemanticTags) score += 0.3;
    if ((features.semanticTagCount || 0) > 3) score += 0.2;
    if ((features.headingCount || 0) > 2) score += 0.2;
    if (features.hasListStructure) score += 0.1;
    if (features.hasTables) score += 0.1;
    if (features.hasCodeBlocks) score += 0.1;

    return {
      isStructured: score >= 0.5,
      confidence: Math.min(score, 1),
    };
  }

  /**
   * 评估Word文档结构化程度
   */
  private evaluateWordStructure(features: StructureFeatures): { isStructured: boolean; confidence: number } {
    let score = 0;

    if (features.hasChapters) score += 0.5;
    if ((features.headingCount || 0) > 3) score += 0.3;
    if ((features.paragraphCount || 0) > 5) score += 0.2;

    return {
      isStructured: score >= 0.5,
      confidence: Math.min(score, 1),
    };
  }

  /**
   * 评估纯文本结构化程度
   */
  private evaluateTextStructure(features: StructureFeatures): { isStructured: boolean; confidence: number } {
    let score = 0;

    if (features.hasChapters) score += 0.4;
    if ((features.headingCount || 0) > 2) score += 0.3;
    if ((features.paragraphCount || 0) > 5) score += 0.2;
    if ((features.avgParagraphLength || 0) > 100) score += 0.1;

    return {
      isStructured: score >= 0.5,
      confidence: Math.min(score, 1),
    };
  }

  /**
   * 读取文件内容
   */
  private async readFile(filePath: string): Promise<string> {
    return fs.readFile(filePath, 'utf-8');
  }

  /**
   * 快速检测（不读取全部内容）
   */
  async quickDetect(filePath: string): Promise<StructureInfo> {
    const ext = path.extname(filePath).toLowerCase();

    // 对于文本类型，只读取前5000字符快速判断
    if (['.md', '.markdown', '.html', '.htm', '.txt'].includes(ext)) {
      const content = await this.readFile(filePath);
      const sample = content.slice(0, 5000);
      return this.detect(filePath, sample);
    }

    // 其他类型完整检测
    return this.detect(filePath);
  }
}
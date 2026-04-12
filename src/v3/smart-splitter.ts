/**
 * Smart Document Splitter - LLM辅助的智能文档分块
 *
 * 功能：
 * - 分析文档结构（章节、段落）
 * - 按语义单元分块
 * - 保留上下文信息
 */

import { LLMClient } from '../llm-client.js';
import { logInfo, logError } from '../maintenance-logger.js';
import type { LLMConfig } from '../config.js';

// ============================================================
// 类型定义
// ============================================================

export interface DocumentSection {
  title: string;
  level: number;
  startIndex: number;
  endIndex: number;
}

export interface SemanticUnit {
  type: 'concept' | 'procedure' | 'example' | 'reference' | 'overview';
  startIndex: number;
  endIndex: number;
  context?: string;
}

export interface DocumentStructure {
  docType: string;
  sections: DocumentSection[];
  semanticUnits: SemanticUnit[];
}

export interface SemanticBlock {
  text: string;
  type: SemanticUnit['type'];
  sectionTitle: string;
  context: {
    before: string;
    after: string;
  };
  metadata: {
    heading?: string;
    level?: number;
  };
}

export interface SmartSplitterConfig {
  llm: LLMConfig;
  maxChunkSize?: number;
  minChunkSize?: number;
}

// ============================================================
// 智能分块器
// ============================================================

export class SmartDocumentSplitter {
  private llm: LLMClient;
  private maxChunkSize: number;
  private minChunkSize: number;

  constructor(config: SmartSplitterConfig) {
    this.llm = new LLMClient(config.llm, {
      maxTokens: 800,
      temperature: 0.2,
    });
    this.maxChunkSize = config.maxChunkSize || 2000;
    this.minChunkSize = config.minChunkSize || 100;
  }

  /**
   * 智能分块主入口
   */
  async smartSplit(content: string): Promise<SemanticBlock[]> {
    logInfo(`[SmartSplitter] Analyzing document (${content.length} chars)`);

    // 1. 分析文档结构
    const structure = await this.analyzeStructure(content);

    if (structure.semanticUnits.length > 0) {
      // 有语义单元，按语义分块
      return this.splitBySemanticUnits(content, structure);
    } else if (structure.sections.length > 0) {
      // 有章节结构，按章节分块
      return this.splitBySections(content, structure);
    } else {
      // 无结构，回退到固定分块
      return this.fallbackSplit(content);
    }
  }

  /**
   * LLM分析文档结构
   */
  private async analyzeStructure(content: string): Promise<DocumentStructure> {
    // 对长文档，只分析前4000字符确定结构
    const sampleContent = content.slice(0, 4000);

    const prompt = `分析以下文档内容，识别文档结构。

文档内容：
${sampleContent}

请识别：
1. 文档类型（文章/教程/手册/API文档/其他）
2. 主要章节（如有标题，列出标题和层级）
3. 语义单元（应保持完整的段落组）

请按以下格式输出：
---DOCTYPE---
文档类型
---SECTIONS---
标题1|层级|起始位置大致范围
---SEMANTIC---
类型|简要描述

注意：
- 类型可选：concept（概念）, procedure（步骤）, example（示例）, reference（参考）, overview（概述）
- 如果文档没有明显结构，输出空列表即可`;

    try {
      const response = await this.llm.complete(prompt, 'structure-analyzer', {
        maxTokens: 800,
        temperature: 0.2,
      });

      return this.parseStructureResponse(response, content);
    } catch (error: any) {
      logError(`[SmartSplitter] Structure analysis failed: ${error.message}`);
      return { docType: 'unknown', sections: [], semanticUnits: [] };
    }
  }

  /**
   * 解析结构分析响应
   */
  private parseStructureResponse(response: string, content: string): DocumentStructure {
    const lines = response.split('\n');
    let currentSection = '';
    let docType = 'unknown';
    const sections: DocumentSection[] = [];
    const semanticUnits: SemanticUnit[] = [];

    for (const line of lines) {
      const trimmed = line.trim();

      if (trimmed === '---DOCTYPE---') {
        currentSection = 'doctype';
        continue;
      } else if (trimmed === '---SECTIONS---') {
        currentSection = 'sections';
        continue;
      } else if (trimmed === '---SEMANTIC---') {
        currentSection = 'semantic';
        continue;
      }

      if (currentSection === 'doctype' && trimmed) {
        docType = trimmed;
      } else if (currentSection === 'sections' && trimmed.includes('|')) {
        const parts = trimmed.split('|');
        if (parts.length >= 2) {
          sections.push({
            title: parts[0].trim(),
            level: parseInt(parts[1]) || 1,
            startIndex: 0,
            endIndex: 0,
          });
        }
      } else if (currentSection === 'semantic' && trimmed.includes('|')) {
        const parts = trimmed.split('|');
        if (parts.length >= 1) {
          const type = parts[0].trim() as SemanticUnit['type'];
          if (['concept', 'procedure', 'example', 'reference', 'overview'].includes(type)) {
            semanticUnits.push({
              type,
              startIndex: 0,
              endIndex: 0,
              context: parts[1]?.trim(),
            });
          }
        }
      }
    }

    // 如果没有检测到结构，尝试在原文中定位章节
    if (sections.length === 0 && content.length > 500) {
      this.detectSectionsFromContent(content, sections);
    }

    return { docType, sections, semanticUnits };
  }

  /**
   * 从内容中检测章节（Markdown标题）
   */
  private detectSectionsFromContent(content: string, sections: DocumentSection[]): void {
    const lines = content.split('\n');
    let currentIndex = 0;

    for (const line of lines) {
      // Markdown标题
      const match = line.match(/^(#{1,6})\s+(.+)$/);
      if (match) {
        sections.push({
          title: match[2].trim(),
          level: match[1].length,
          startIndex: currentIndex,
          endIndex: currentIndex + line.length,
        });
      }
      currentIndex += line.length + 1;
    }
  }

  /**
   * 按语义单元分块
   */
  private splitBySemanticUnits(content: string, structure: DocumentStructure): SemanticBlock[] {
    const blocks: SemanticBlock[] = [];

    // 简化实现：按段落分组
    const paragraphs = content.split(/\n\n+/);
    let currentIndex = 0;
    let currentBlock = '';
    let currentType: SemanticUnit['type'] = 'concept';
    let currentSection = '';

    for (const para of paragraphs) {
      // 检测是否是标题
      const headingMatch = para.match(/^(#{1,6})\s+(.+)$/);
      if (headingMatch) {
        // 保存当前块
        if (currentBlock.length >= this.minChunkSize) {
          blocks.push({
            text: currentBlock.trim(),
            type: currentType,
            sectionTitle: currentSection,
            context: { before: '', after: '' },
            metadata: { heading: currentSection },
          });
        }
        currentSection = headingMatch[2].trim();
        currentBlock = '';
        continue;
      }

      // 检测语义类型
      if (para.includes('步骤') || para.includes('首先') || para.match(/^\d+\./)) {
        currentType = 'procedure';
      } else if (para.includes('例如') || para.includes('示例')) {
        currentType = 'example';
      } else if (para.includes('参考') || para.includes('参见')) {
        currentType = 'reference';
      }

      currentBlock += para + '\n\n';

      // 超过最大长度，切分
      if (currentBlock.length >= this.maxChunkSize) {
        blocks.push({
          text: currentBlock.trim(),
          type: currentType,
          sectionTitle: currentSection,
          context: { before: '', after: '' },
          metadata: { heading: currentSection },
        });
        currentBlock = '';
        currentType = 'concept';
      }

      currentIndex += para.length + 2;
    }

    // 保存最后一块
    if (currentBlock.length >= this.minChunkSize) {
      blocks.push({
        text: currentBlock.trim(),
        type: currentType,
        sectionTitle: currentSection,
        context: { before: '', after: '' },
        metadata: { heading: currentSection },
      });
    }

    logInfo(`[SmartSplitter] Split into ${blocks.length} semantic blocks`);
    return blocks;
  }

  /**
   * 按章节分块
   */
  private splitBySections(content: string, structure: DocumentStructure): SemanticBlock[] {
    const blocks: SemanticBlock[] = [];
    const sections = structure.sections;

    if (sections.length === 0) {
      return this.fallbackSplit(content);
    }

    // 简化：每个章节作为一块
    for (let i = 0; i < sections.length; i++) {
      const section = sections[i];
      const nextSection = sections[i + 1];

      const startIdx = section.endIndex;
      const endIdx = nextSection ? nextSection.startIndex : content.length;

      const text = content.slice(startIdx, endIdx).trim();

      if (text.length >= this.minChunkSize) {
        // 如果章节太长，需要切分
        if (text.length > this.maxChunkSize) {
          const subBlocks = this.splitLargeSection(text, section.title);
          blocks.push(...subBlocks);
        } else {
          blocks.push({
            text,
            type: 'concept',
            sectionTitle: section.title,
            context: { before: '', after: '' },
            metadata: { heading: section.title, level: section.level },
          });
        }
      }
    }

    return blocks;
  }

  /**
   * 切分过大的章节
   */
  private splitLargeSection(text: string, sectionTitle: string): SemanticBlock[] {
    const blocks: SemanticBlock[] = [];
    const paragraphs = text.split(/\n\n+/);

    let currentBlock = '';

    for (const para of paragraphs) {
      if (currentBlock.length + para.length > this.maxChunkSize) {
        if (currentBlock.length >= this.minChunkSize) {
          blocks.push({
            text: currentBlock.trim(),
            type: 'concept',
            sectionTitle,
            context: { before: '', after: '' },
            metadata: { heading: sectionTitle },
          });
        }
        currentBlock = para + '\n\n';
      } else {
        currentBlock += para + '\n\n';
      }
    }

    if (currentBlock.length >= this.minChunkSize) {
      blocks.push({
        text: currentBlock.trim(),
        type: 'concept',
        sectionTitle,
        context: { before: '', after: '' },
        metadata: { heading: sectionTitle },
      });
    }

    return blocks;
  }

  /**
   * 回退分块（固定长度）
   */
  private fallbackSplit(content: string): SemanticBlock[] {
    logInfo(`[SmartSplitter] Using fallback split`);

    const blocks: SemanticBlock[] = [];
    const chunks = content.match(new RegExp(`[\\s\\S]{1,${this.maxChunkSize}}`, 'g')) || [];

    for (const chunk of chunks) {
      if (chunk.trim().length >= this.minChunkSize) {
        blocks.push({
          text: chunk.trim(),
          type: 'concept',
          sectionTitle: '',
          context: { before: '', after: '' },
          metadata: {},
        });
      }
    }

    return blocks;
  }
}
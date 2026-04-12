/**
 * OpenClaw Memory V3 - 知识编译系统类型定义
 *
 * 核心概念：
 * - WikiPage: 编译后的知识页面
 * - KnowledgeTriple: 知识三元组（subject | relation | object）
 * - ContentReference: 版本引用追踪（去重）
 */

import type { LLMConfig, EmbeddingConfig, SurrealConfig } from '../config.js';

// ============================================================
// 知识三元组
// ============================================================

/**
 * 知识三元组 - 使用 obj 避免 SurrealDB 保留字 object
 */
export interface KnowledgeTriple {
  subject: string;
  relation: string;
  obj: string;
}

// ============================================================
// Wiki 页面
// ============================================================

/**
 * 编译后的知识页面
 */
export interface WikiPage {
  id?: string;

  // 内容
  content: string;           // 精炼摘要（LLM生成）
  raw_content: string;       // 原文（完整保留）
  content_hash: string;      // 内容哈希（用于去重）

  // 知识结构
  triples: KnowledgeTriple[];
  embedding: number[];
  topic: string;
  section: string;

  // 元数据
  page_number: number;
  session_id: string;        // doc:postgres:15:postgresql-15-A4
  doc_version: string;       // "15", "17" 等版本号
  source_path: string;
  source_type: 'pdf' | 'markdown' | 'word' | 'html';

  // 状态
  status: 'pending' | 'compiled' | 'validated';
  created_at: Date;
  updated_at: Date;
}

// ============================================================
// 内容引用（去重追踪）
// ============================================================

/**
 * 版本引用表 - 记录哪些版本引用了同一内容
 */
export interface ContentReference {
  content_hash: string;      // 内容哈希
  doc_versions: string[];    // ["15", "17"] 引用此内容的版本
  first_seen: Date;          // 首次出现时间
  ref_count: number;         // 引用次数
}

// ============================================================
// 编译相关
// ============================================================

/**
 * LLM 提取结果
 */
export interface ExtractedKnowledge {
  triples: KnowledgeTriple[];
  summary: string;
  topic: string;
}

/**
 * 文档块元数据
 */
export interface BlockMetadata {
  session_id: string;
  doc_version: string;
  source_path: string;
  source_type: 'pdf' | 'markdown' | 'word' | 'html';
  page_number: number;
  section?: string;
}

/**
 * 编译结果
 */
export interface CompileResult {
  page: WikiPage | null;     // null 表示去重跳过
  isNew: boolean;            // 是否新内容
  skipped?: boolean;         // 是否因去重跳过
}

/**
 * 编译器配置
 */
export interface CompilerConfig {
  llm: LLMConfig;
  embedding: EmbeddingConfig;
  db: SurrealConfig;
}

/**
 * 编译统计
 */
export interface CompileStats {
  total: number;
  stored: number;
  skipped: number;           // 去重跳过
  failed: number;
  triples: number;
}

/**
 * 编译进度回调
 */
export type ProgressCallback = (stats: CompileStats) => void;
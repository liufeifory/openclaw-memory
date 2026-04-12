/**
 * OpenClaw Memory V3 - 知识编译系统
 *
 * 导出所有 V3 组件
 */

export * from './types.js';
export { KnowledgeCompiler } from './compiler.js';
export { CompileManager } from './compile-manager.js';
export { SmartDocumentSplitter } from './smart-splitter.js';
export { StructureDetector } from './structure-detector.js';

// 版本标识
export const V3_VERSION = '3.0.0';
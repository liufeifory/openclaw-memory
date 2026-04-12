#!/usr/bin/env node
/**
 * V3 Knowledge Import - 完整文档导入脚本
 *
 * 支持长时间运行、进度追踪、断点续传
 */

import { SurrealDatabase } from '../surrealdb-client.js';
import { CompileManager, type DocumentCompileOptions } from './compile-manager.js';
import { StructureDetector } from './structure-detector.js';
import { getConfig } from '../config.js';
import * as fs from 'fs/promises';
import * as path from 'path';

const LOG_DIR = path.join(process.env.HOME || '~', '.openclaw', 'logs');
const PROGRESS_FILE = path.join(LOG_DIR, 'v3-import-progress.json');

interface Progress {
  file: string;
  type: string;
  version: string;
  startTime: string;
  lastUpdate: string;
  processed: number;
  stored: number;
  skipped: number;
  failed: number;
  triples: number;
  status: 'running' | 'completed' | 'failed';
}

async function ensureLogDir() {
  try {
    await fs.mkdir(LOG_DIR, { recursive: true });
  } catch (e) {}
}

async function saveProgress(progress: Progress) {
  await fs.writeFile(PROGRESS_FILE, JSON.stringify(progress, null, 2));
}

async function loadProgress(): Promise<Progress | null> {
  try {
    const data = await fs.readFile(PROGRESS_FILE, 'utf-8');
    return JSON.parse(data);
  } catch {
    return null;
  }
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 1) {
    console.log('用法: node dist/v3/import.js <文件> --type <类型> --version <版本>');
    console.log('');
    console.log('示例:');
    console.log('  node dist/v3/import.js papers/postgresql-15-A4.pdf --type postgres --version 15');
    console.log('');
    console.log('进度文件: ~/.openclaw/logs/v3-import-progress.json');
    process.exit(1);
  }

  await ensureLogDir();

  // 解析参数
  const filePath = args[0].replace(/^~/, process.env.HOME || '');
  const typeIndex = args.indexOf('--type');
  const versionIndex = args.indexOf('--version');

  const docType = typeIndex >= 0 ? args[typeIndex + 1] : 'custom';
  const docVersion = versionIndex >= 0 ? args[versionIndex + 1] : '1';

  console.log('='.repeat(60));
  console.log('OpenClaw Memory V3 - 知识导入');
  console.log('='.repeat(60));
  console.log(`文件: ${filePath}`);
  console.log(`类型: ${docType}`);
  console.log(`版本: ${docVersion}`);
  console.log('');

  // 检测结构
  const detector = new StructureDetector();
  const structureInfo = await detector.quickDetect(filePath);

  console.log(`文档结构: ${structureInfo.structureType} (置信度: ${(structureInfo.confidence * 100).toFixed(0)}%)`);
  console.log(`建议分块: ${structureInfo.suggestedSplitMethod}`);
  console.log('');

  // 初始化进度
  const progress: Progress = {
    file: filePath,
    type: docType,
    version: docVersion,
    startTime: new Date().toISOString(),
    lastUpdate: new Date().toISOString(),
    processed: 0,
    stored: 0,
    skipped: 0,
    failed: 0,
    triples: 0,
    status: 'running',
  };
  await saveProgress(progress);

  // 加载配置
  const config = getConfig();

  // 初始化数据库
  const db = new SurrealDatabase(config.surrealdb);
  await db.initialize();

  // 创建编译管理器
  const manager = new CompileManager(db, {
    llm: config.llm,
    embedding: config.embedding,
    db: config.surrealdb,
  });

  // 编译选项
  const options: DocumentCompileOptions = {
    docType,
    docVersion,
    useSmartSplit: structureInfo.isStructured,
    // 进度回调：实时更新进度文件
    onProgress: (stats) => {
      progress.processed = stats.total;
      progress.stored = stats.stored;
      progress.skipped = stats.skipped;
      progress.failed = stats.failed;
      progress.triples = stats.triples;
      progress.lastUpdate = new Date().toISOString();
      // 每次更新都保存到文件
      saveProgress(progress).catch(() => {});
    },
  };

  // 定期保存进度的定时器（备份）
  const progressInterval = setInterval(async () => {
    await saveProgress(progress);
  }, 10000); // 每10秒保存一次

  try {
    console.log('开始导入...');
    console.log('');

    const stats = await manager.compileDocument(filePath, options);

    progress.processed = stats.total;
    progress.stored = stats.stored;
    progress.skipped = stats.skipped;
    progress.failed = stats.failed;
    progress.triples = stats.triples;
    progress.status = 'completed';
    progress.lastUpdate = new Date().toISOString();

    clearInterval(progressInterval);
    await saveProgress(progress);

    console.log('');
    console.log('='.repeat(60));
    console.log('导入完成');
    console.log('='.repeat(60));
    console.log(`总块数: ${stats.total}`);
    console.log(`已存储: ${stats.stored}`);
    console.log(`去重跳过: ${stats.skipped}`);
    console.log(`失败: ${stats.failed}`);
    console.log(`三元组: ${stats.triples}`);

    // 计算耗时
    const startTime = new Date(progress.startTime);
    const endTime = new Date();
    const duration = Math.round((endTime.getTime() - startTime.getTime()) / 1000);
    const minutes = Math.floor(duration / 60);
    const seconds = duration % 60;
    console.log(`耗时: ${minutes}分${seconds}秒`);

    process.exit(0);
  } catch (error: any) {
    progress.status = 'failed';
    progress.lastUpdate = new Date().toISOString();
    clearInterval(progressInterval);
    await saveProgress(progress);

    console.error('导入失败:', error.message);
    process.exit(1);
  }
}

main();
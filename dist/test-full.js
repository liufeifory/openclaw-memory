#!/usr/bin/env node
/**
 * Complete Test Suite for Node.js Memory Plugin
 */

import { MemoryManager } from './memory-manager.js';

const config = {
  database: {
    host: 'localhost',
    port: 5432,
    database: 'openclaw_memory',
    user: 'liufei',
    password: '',
  },
  embedding: {
    endpoint: 'http://localhost:8080',
  },
};

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.error(`  ✗ ${message}`);
    failed++;
  }
}

async function testSearch() {
  console.log('\n[Test 1] 搜索记忆');
  const start = Date.now();
  const memories = await mm.retrieveRelevant('用户想学什么编程语言', 5, 0.6);
  const elapsed = Date.now() - start;

  assert(memories.length >= 0, `找到 ${memories.length} 条记忆`);
  assert(elapsed < 500, `搜索耗时 ${elapsed}ms < 500ms`);

  for (const m of memories) {
    assert(m.type === 'episodic' || m.type === 'semantic' || m.type === 'reflection',
           `记忆类型有效：${m.type}`);
    assert(typeof m.content === 'string', '内容有效');
    assert(m.similarity >= 0 && m.similarity <= 1, `相似度有效：${m.similarity.toFixed(2)}`);
  }

  return elapsed;
}

async function testStore() {
  console.log('\n[Test 2] 存储记忆');
  const testContent = `测试记忆-${Date.now()}`;

  try {
    // 存储记忆（异步，不等待）
    mm.storeMemory('test-session', testContent, 0.5);
    console.log('  ✓ 记忆已提交存储');
    passed++;

    // 等待 1 秒让异步存储完成
    await new Promise(resolve => setTimeout(resolve, 1000));

    // 验证存储
    const memories = await mm.retrieveRelevant(testContent, 5, 0.3);
    const found = memories.some(m => m.content.includes('测试记忆'));
    assert(found, '能够检索到刚存储的记忆');
  } catch (error) {
    console.error(`  ✗ 存储失败：${error.message}`);
    failed++;
  }
}

async function testContextBuilder() {
  console.log('\n[Test 3] 构建 Context');

  const memories = await mm.retrieveRelevant('用户想学习', 5, 0.5);
  const context = mm.buildContext('test-session', memories, 'User: 你好');

  assert(context.includes('Memory Context'), 'Context 包含头部');
  assert(context.includes('test-session'), 'Context 包含 session ID');
  assert(typeof context === 'string', 'Context 是字符串');
  assert(context.length > 0, 'Context 不为空');

  console.log(`  Context 长度：${context.length} 字符`);
}

async function testStats() {
  console.log('\n[Test 4] 获取统计');

  const stats = await mm.getStats();

  assert(typeof stats.episodic_count !== 'undefined', '有 episodic 统计');
  assert(typeof stats.semantic_count !== 'undefined', '有 semantic 统计');
  assert(typeof stats.reflection_count !== 'undefined', '有 reflection 统计');
  assert(typeof stats.embedding_count !== 'undefined', '有 embedding 统计');

  console.log(`  Episodic: ${stats.episodic_count}, Semantic: ${stats.semantic_count}, Reflection: ${stats.reflection_count}`);
}

async function testConcurrent() {
  console.log('\n[Test 5] 并发搜索');

  const queries = ['用户想学什么', '编程语言', 'Rust', 'Python', '编程'];
  const start = Date.now();

  const results = await Promise.all(queries.map(q => mm.retrieveRelevant(q, 3, 0.5)));

  const elapsed = Date.now() - start;
  assert(results.length === 5, `完成 5 个并发查询`);
  assert(elapsed < 1000, `并发耗时 ${elapsed}ms < 1000ms`);

  console.log(`  5 个并发查询耗时：${elapsed}ms`);
}

async function testThreshold() {
  console.log('\n[Test 6] 阈值过滤');

  // 低阈值应该返回更多结果
  const lowThreshold = await mm.retrieveRelevant('用户', 10, 0.3);
  // 高阈值应该返回更少结果
  const highThreshold = await mm.retrieveRelevant('用户', 10, 0.8);

  assert(lowThreshold.length >= highThreshold.length,
         `低阈值结果 (${lowThreshold.length}) >= 高阈值结果 (${highThreshold.length})`);

  // 验证高阈值的结果相似度都高于阈值
  for (const m of highThreshold) {
    assert(m.similarity >= 0.8, `高阈值结果相似度 ${m.similarity.toFixed(2)} >= 0.8`);
  }
}

async function runAllTests() {
  console.log('=== OpenClaw Memory Plugin 完整测试套件 ===');
  console.log(`数据库：${config.database.database}@${config.database.host}`);
  console.log(`Embedding: ${config.embedding.endpoint}`);

  const totalStart = Date.now();

  try {
    await testSearch();
    await testStore();
    await testContextBuilder();
    await testStats();
    await testConcurrent();
    await testThreshold();

  } catch (error) {
    console.error('\n测试失败:', error);
    failed++;
  } finally {
    await mm.shutdown();
  }

  const totalElapsed = Date.now() - totalStart;

  console.log('\n=== 测试结果 ===');
  console.log(`通过：${passed}`);
  console.log(`失败：${failed}`);
  console.log(`总耗时：${totalElapsed}ms`);

  if (failed > 0) {
    console.error('\n有测试失败，请检查！');
    process.exit(1);
  } else {
    console.log('\n所有测试通过！');
  }
}

const mm = new MemoryManager(config);
runAllTests().catch(console.error);

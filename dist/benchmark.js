#!/usr/bin/env node
/**
 * Performance Benchmark for Node.js Memory Plugin
 *
 * Tests:
 * 1. Cold start (first query)
 * 2. Warm queries (subsequent)
 * 3. Concurrent requests
 * 4. Database connection pool
 * 5. Embedding latency
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

const QUERIES = [
  '用户想学什么编程语言',
  'Rust 编程',
  'Python 开发',
  '数据库设计',
  'Web 开发',
  '机器学习',
  '云计算',
  '编程经验',
  '技术讨论',
  '学习计划',
];

async function benchmark(name, fn, iterations = 10) {
  const times = [];

  for (let i = 0; i < iterations; i++) {
    const start = Date.now();
    await fn();
    const elapsed = Date.now() - start;
    times.push(elapsed);
  }

  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  const min = Math.min(...times);
  const max = Math.max(...times);
  const p95 = times.sort((a, b) => a - b)[Math.floor(times.length * 0.95)];

  console.log(`\n${name}`);
  console.log(`  平均：${avg.toFixed(2)}ms`);
  console.log(`  最小：${min}ms`);
  console.log(`  最大：${max}ms`);
  console.log(`  P95: ${p95}ms`);

  return { avg, min, max, p95, times };
}

async function runBenchmark() {
  console.log('=== OpenClaw Memory 性能基准测试 ===\n');
  console.log(`数据库：${config.database.database}@${config.database.host}`);
  console.log(`Embedding: ${config.embedding.endpoint}`);
  console.log(`测试查询数：${QUERIES.length}`);
  console.log(`每次测试迭代：10 次\n`);

  const mm = new MemoryManager(config);

  // Test 1: Cold Start
  console.log('--- Test 1: 首次查询 (Cold Start) ---');
  const coldStart = await benchmark('首次查询', async () => {
    await mm.retrieveRelevant(QUERIES[0], 5, 0.6);
  }, 1);

  // Test 2: Warm Queries (single thread)
  console.log('\n--- Test 2: 连续查询 (Warm) ---');
  let queryIdx = 0;
  const warm = await benchmark(
    '连续查询',
    async () => {
      const q = QUERIES[queryIdx % QUERIES.length];
      queryIdx++;
      await mm.retrieveRelevant(q, 5, 0.6);
    },
    10
  );

  // Test 3: Concurrent Requests
  console.log('\n--- Test 3: 并发查询 ---');
  const concurrent = await benchmark(
    '并发查询 (5 个同时)',
    async () => {
      await Promise.all(
        QUERIES.slice(0, 5).map(q => mm.retrieveRelevant(q, 5, 0.6))
      );
    },
    5
  );

  // Test 4: Database Only (no embedding)
  console.log('\n--- Test 4: 仅数据库查询 ---');
  const dbOnly = await benchmark(
    '数据库统计查询',
    async () => {
      await mm.getStats();
    },
    10
  );

  // Test 5: Context Building
  console.log('\n--- Test 5: Context 构建 ---');
  const contextBuild = await benchmark(
    'Context 构建',
    async () => {
      const memories = await mm.retrieveRelevant(QUERIES[0], 5, 0.6);
      mm.buildContext('test-session', memories, 'User: hello');
    },
    10
  );

  // Test 6: Store Operations
  console.log('\n--- Test 6: 存储操作 (异步) ---');
  const storeTimes = [];
  for (let i = 0; i < 5; i++) {
    const start = Date.now();
    mm.storeMemory('benchmark-session', `测试内容 ${Date.now()}`, 0.5);
    // Don't await - it's async
    const elapsed = Date.now() - start;
    storeTimes.push(elapsed);
  }
  await new Promise(resolve => setTimeout(resolve, 100)); // Wait for async
  const storeAvg = storeTimes.reduce((a, b) => a + b, 0) / storeTimes.length;
  console.log(`  存储提交平均：${storeAvg.toFixed(2)}ms (异步，不等待写入)`);

  await mm.shutdown();

  // Summary
  console.log('\n=== 性能摘要 ===\n');
  console.log('| 测试项 | 平均耗时 |');
  console.log('|--------|----------|');
  console.log(`| Cold Start | ${coldStart.avg.toFixed(2)}ms |`);
  console.log(`| Warm Queries | ${warm.avg.toFixed(2)}ms |`);
  console.log(`| Concurrent (5x) | ${concurrent.avg.toFixed(2)}ms |`);
  console.log(`| DB Only | ${dbOnly.avg.toFixed(2)}ms |`);
  console.log(`| Context Build | ${contextBuild.avg.toFixed(2)}ms |`);
  console.log(`| Store (async) | ${storeAvg.toFixed(2)}ms |`);

  // Comparison with Python version
  console.log('\n=== 与 Python 版本对比 ===\n');
  console.log('Python v1.0 (HTTP):');
  console.log('  - memory-server 响应：~33ms');
  console.log('  - 端到端 (含 HTTP): ~60ms');
  console.log('');
  console.log(`Node.js v2.0 (原生):`);
  console.log(`  - Warm queries: ~${warm.avg.toFixed(0)}ms`);
  console.log(`  - 性能提升：${((60 - warm.avg) / 60 * 100).toFixed(1)}%`);
}

runBenchmark().catch(console.error);

#!/usr/bin/env node
/**
 * Test script for Qdrant Memory Plugin
 */

import { MemoryManager } from './memory-manager-qdrant.js';

const config = {
  qdrant: {
    url: 'http://localhost:6333',
  },
  embedding: {
    endpoint: 'http://localhost:8080',
  },
};

async function test() {
  console.log('=== OpenClaw Memory Plugin (Qdrant) Test ===\n');

  const mm = new MemoryManager(config);

  try {
    // Initialize Qdrant
    console.log('Connecting to Qdrant...');
    await mm.initialize();
    console.log('✓ Connected\n');

    // Test 1: Search
    console.log('Test 1: Search memories');
    const start = Date.now();
    const memories = await mm.retrieveRelevant('用户想学什么编程语言', 5, 0.6);
    const elapsed = Date.now() - start;
    console.log(`  Found ${memories.length} memories in ${elapsed}ms`);
    for (const m of memories) {
      console.log(`  - [${m.type}] ${m.content.substring(0, 50)}... (score: ${(m.similarity * m.importance).toFixed(2)})`);
    }
    console.log();

    // Test 2: Build context
    console.log('Test 2: Build context');
    const context = mm.buildContext('test-session', memories);
    console.log(context);
    console.log();

    // Test 3: Store memory
    console.log('Test 3: Store memory (async)');
    await mm.storeMemory('test-session', `Qdrant 测试-${Date.now()}`, 0.8);
    console.log('  Memory stored');
    console.log();

    // Test 4: Get stats
    console.log('Test 4: Get stats');
    const stats = await mm.getStats();
    console.log(JSON.stringify(stats, null, 2));

  } catch (error: any) {
    console.error('Test failed:', error.message);
    console.error('Make sure Qdrant is running: ./start-qdrant.sh');
  } finally {
    await mm.shutdown();
  }

  console.log('\n=== Test Complete ===');
}

test().catch(console.error);

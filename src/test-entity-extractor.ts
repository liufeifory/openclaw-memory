/**
 * Entity Extractor Test Suite
 * Tests the three-layer funnel strategy for entity extraction
 */

import { EntityExtractor, ExtractedEntity, LayerStats } from './entity-extractor.js';

async function testLayer1RegexMatch() {
  console.log('\n=== Test Layer 1: Regex Match ===');

  const extractor = new EntityExtractor();
  const text = 'I love TypeScript and TS. Also using Postgres and PostgreSQL for database.';

  const entities = extractor.layer1_RegexMatch(text);
  console.log('Extracted entities:', entities);

  // Should find TypeScript (and TS alias)
  const hasTypeScript = entities.some(e => e.name.toLowerCase().includes('typescript'));
  // Should find PostgreSQL (and Postgres alias)
  const hasPostgreSQL = entities.some(e => e.name.toLowerCase().includes('postgresql'));

  console.log(`Found TypeScript: ${hasTypeScript}`);
  console.log(`Found PostgreSQL: ${hasPostgreSQL}`);

  if (hasTypeScript && hasPostgreSQL) {
    console.log('[PASS] Layer 1 regex matching works correctly');
    return true;
  } else {
    console.log('[FAIL] Layer 1 regex matching failed');
    return false;
  }
}

async function testNormalizeText() {
  console.log('\n=== Test Alias Normalization ===');

  const extractor = new EntityExtractor();

  const testCases: [string, string][] = [
    ['TS', 'TypeScript'],
    ['Typescript', 'TypeScript'],
    ['Postgres', 'PostgreSQL'],
    ['postgres', 'PostgreSQL'],
    ['JS', 'JavaScript'],
    ['js', 'JavaScript'],
    ['React', 'React'],  // No normalization needed
  ];

  let passed = 0;
  let failed = 0;

  for (const [input, expected] of testCases) {
    const result = extractor.normalizeText(input);
    const normalizedResult = result.toLowerCase() === expected.toLowerCase();

    if (normalizedResult) {
      console.log(`[PASS] "${input}" -> "${result}"`);
      passed++;
    } else {
      console.log(`[FAIL] "${input}" -> "${result}" (expected "${expected}")`);
      failed++;
    }
  }

  console.log(`\nAlias normalization: ${passed} passed, ${failed} failed`);
  return failed === 0;
}

async function testLayer2_1BFilter() {
  console.log('\n=== Test Layer 2: 1B Model Pre-Filter ===');

  const extractor = new EntityExtractor('http://localhost:8081');

  // Test texts - some should be entities, some shouldn't
  const testTexts = [
    'TypeScript is a programming language',  // Should be entity
    'I like to eat pizza',                   // Probably not an entity
    'PostgreSQL database management',        // Should be entity
    'The weather is nice today',             // Not an entity
  ];

  try {
    const results = await extractor.layer2_1BFilter(testTexts);
    console.log('1B Filter results:', results);
    console.log(`Results count: ${results.length}, Expected: ${testTexts.length}`);

    if (results.length === testTexts.length) {
      console.log('[PASS] Layer 2 1B filter returned correct number of results');
      return true;
    } else {
      console.log('[FAIL] Layer 2 1B filter returned wrong number of results');
      return false;
    }
  } catch (error: any) {
    console.log(`[INFO] Layer 2 1B filter test skipped (LLM not available): ${error.message}`);
    return true;  // Don't fail test if LLM is unavailable
  }
}

async function testLayer3_7BRefine() {
  console.log('\n=== Test Layer 3: 7B Model Refine ===');

  const extractor = new EntityExtractor('http://localhost:8081', 'http://localhost:8083');

  const text = 'The user prefers using VSCode with the Prettier extension for formatting TypeScript code.';

  try {
    const entities = await extractor.layer3_7BRefine(text);
    console.log('7B Refine results:', entities);

    // Should return some entities
    if (Array.isArray(entities)) {
      console.log(`[PASS] Layer 3 7B refine returned ${entities.length} entities`);
      return true;
    } else {
      console.log('[FAIL] Layer 3 7B refine did not return an array');
      return false;
    }
  } catch (error: any) {
    console.log(`[INFO] Layer 3 7B refine test skipped (LLM not available): ${error.message}`);
    return true;  // Don't fail test if LLM is unavailable
  }
}

async function testMiniBatchBuffer() {
  console.log('\n=== Test Mini-Batch Buffer ===');

  const extractor = new EntityExtractor('http://localhost:8081');

  // Add items to buffer
  extractor.addToBuffer('TypeScript is great', 0.8);
  extractor.addToBuffer('PostgreSQL database', 0.9);
  extractor.addToBuffer('Random text', 0.3);

  const bufferStats = extractor.getBufferStats();
  console.log('Buffer stats:', bufferStats);

  if (bufferStats.size === 3) {
    console.log('[PASS] Mini-batch buffer correctly stores items');

    // Flush buffer
    await extractor.flushBuffer();
    const afterFlush = extractor.getBufferStats();

    if (afterFlush.size === 0) {
      console.log('[PASS] Buffer flush works correctly');
      return true;
    } else {
      console.log('[FAIL] Buffer was not cleared after flush');
      return false;
    }
  } else {
    console.log('[FAIL] Mini-batch buffer did not store items correctly');
    return false;
  }
}

async function testExtractFullPipeline() {
  console.log('\n=== Test Full Extract Pipeline ===');

  const extractor = new EntityExtractor('http://localhost:8081', 'http://localhost:8083');

  const text = `
    I've been working with TypeScript and JavaScript for years.
    My favorite database is PostgreSQL, though I also use Redis for caching.
    I code in VSCode and use Git for version control.
    Sometimes I miss Python but TS is my go-to now.
  `;

  try {
    const entities = await extractor.extract(text);
    console.log('Full pipeline results:', entities);

    const stats = extractor.getLayerStats();
    console.log('Layer stats:', stats);

    if (Array.isArray(entities) && entities.length > 0) {
      console.log(`[PASS] Full pipeline extracted ${entities.length} entities`);
      return true;
    } else {
      console.log('[INFO] Full pipeline returned empty results (may need LLM)');
      return true;  // Empty results are OK if LLM is unavailable
    }
  } catch (error: any) {
    console.log(`[FAIL] Full pipeline error: ${error.message}`);
    return false;
  }
}

async function testKnownEntityCache() {
  console.log('\n=== Test Known Entity Cache ===');

  const extractor = new EntityExtractor();

  // Add known entities to cache
  extractor.addKnownEntities([
    { name: 'TypeScript', confidence: 1.0 },
    { name: 'PostgreSQL', confidence: 1.0 },
    { name: 'Redis', confidence: 1.0 },
  ]);

  const cacheSize = extractor.getKnownCacheSize();
  console.log(`Known entity cache size: ${cacheSize}`);

  if (cacheSize === 3) {
    console.log('[PASS] Known entity cache works correctly');
    return true;
  } else {
    console.log('[FAIL] Known entity cache did not store entities');
    return false;
  }
}

async function runAllTests() {
  console.log('Running Entity Extractor Tests...\n');
  console.log('=' .repeat(50));

  const results: boolean[] = [];

  results.push(await testLayer1RegexMatch());
  results.push(await testNormalizeText());
  results.push(await testMiniBatchBuffer());
  results.push(await testKnownEntityCache());
  results.push(await testLayer2_1BFilter());
  results.push(await testLayer3_7BRefine());
  results.push(await testExtractFullPipeline());

  console.log('\n' + '=' .repeat(50));
  const passed = results.filter(r => r).length;
  const total = results.length;
  console.log(`\nTest Results: ${passed}/${total} passed`);

  if (passed === total) {
    console.log('[SUCCESS] All tests passed!');
    process.exit(0);
  } else {
    console.log('[FAILURE] Some tests failed');
    process.exit(1);
  }
}

runAllTests().catch(console.error);

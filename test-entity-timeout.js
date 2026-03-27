/**
 * Test Entity Extractor timeout protection
 */

import { EntityExtractor } from './dist/entity-extractor.js';
import { LLMClient } from './dist/llm-client.js';

async function test() {
  console.log('=== Entity Extractor Timeout Test ===\n');

  // Create LLM client
  const client = new LLMClient({
    localEndpoint: 'http://localhost:8082',
  });

  // Create entity extractor
  const extractor = new EntityExtractor(client);

  // Test 1: Query WITH technical terms (should hit Layer 1, fast)
  console.log('Test 1: Query WITH technical terms (Layer 1 only)');
  const start1 = Date.now();
  const entities1 = await extractor.extract('test query about TypeScript and database');
  const time1 = Date.now() - start1;
  console.log(`  Time: ${time1}ms`);
  console.log(`  Entities: ${entities1.map(e => e.name).join(', ') || 'none'}`);
  console.log();

  // Test 2: Query WITHOUT technical terms (Layer 1 misses, Layer 2 with timeout)
  console.log('Test 2: Query WITHOUT technical terms (Layer 2 with 10s timeout)');
  const start2 = Date.now();
  const entities2 = await extractor.extract('test query');
  const time2 = Date.now() - start2;
  console.log(`  Time: ${time2}ms`);
  console.log(`  Entities: ${entities2.map(e => e.name).join(', ') || 'none'}`);
  console.log();

  // Test 3: Another plain query
  console.log('Test 3: Another plain query');
  const start3 = Date.now();
  const entities3 = await extractor.extract('what did i say last week');
  const time3 = Date.now() - start3;
  console.log(`  Time: ${time3}ms`);
  console.log(`  Entities: ${entities3.map(e => e.name).join(', ') || 'none'}`);
  console.log();

  // Summary
  console.log('=== Summary ===');
  console.log(`Layer 1 (fast): ${time1}ms - OK`);
  console.log(`Layer 2 (timeout protected): ${time2}ms - Should be < 11000ms`);
  console.log(`Layer 2 (timeout protected): ${time3}ms - Should be < 11000ms`);

  if (time2 < 11000 && time3 < 11000) {
    console.log('\n[SUCCESS] Timeout protection working!');
  } else {
    console.log('\n[WARNING] Timeout may not be working correctly');
  }

  process.exit(0);
}

test().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});

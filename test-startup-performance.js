/**
 * Test startup performance with timeout fix
 */

import { MemoryManager } from './dist/memory-manager-surreal.js';
import { EntityExtractor } from './dist/entity-extractor.js';
import { LLMClient } from './dist/llm-client.js';

async function test() {
  console.log('=== Startup Performance Test ===\n');

  const totalTime = Date.now();

  // Create components
  const startInit = Date.now();
  const client = new LLMClient({
    localEndpoint: 'http://localhost:8082',
  });
  const extractor = new EntityExtractor(client);
  const initTime = Date.now() - startInit;
  console.log(`Initialize: ${initTime}ms`);

  // Test entity extraction (the bottleneck)
  console.log('\nTesting entity extraction...');
  const startExtract = Date.now();

  // Test 1: With technical terms (Layer 1)
  const e1 = await extractor.extract('TypeScript question');
  const t1 = Date.now() - startExtract;
  console.log(`  Layer 1 (TS query): ${t1}ms - ${e1.length} entities`);

  // Test 2: Without technical terms (Layer 2 timeout)
  const e2 = await extractor.extract('what did i say');
  const t2 = Date.now() - startExtract - t1;
  console.log(`  Layer 2 (plain query): ${t2}ms - ${e2.length} entities`);

  const totalExtract = Date.now() - startExtract;
  console.log(`  Total extraction: ${totalExtract}ms`);

  const totalTimeMs = Date.now() - totalTime;
  console.log(`\n=== Total: ${totalTimeMs}ms ===`);

  if (totalExtract < 15000) {
    console.log('[SUCCESS] Entity extraction now timeout protected!');
  } else {
    console.log('[WARNING] Entity extraction still slow');
  }

  process.exit(0);
}

test().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});

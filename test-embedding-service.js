/**
 * Test embedding service from the plugin
 */
import { EmbeddingService } from './dist/embedding.js';

async function test() {
  const embedding = new EmbeddingService('http://localhost:8080');

  console.log('Testing embedding for "MySQL"...');
  const result = await embedding.embed('MySQL');

  console.log(`Embedding length: ${result.length}`);
  console.log(`First 5 values: ${result.slice(0, 5).join(', ')}`);
  console.log(`Last 5 values: ${result.slice(-5).join(', ')}`);

  // Check if it's all zeros
  const allZeros = result.every(v => v === 0);
  console.log(`All zeros: ${allZeros}`);

  // Check if any NaN
  const hasNaN = result.some(v => isNaN(v));
  console.log(`Has NaN: ${hasNaN}`);
}

test().catch(console.error);

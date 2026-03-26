/**
 * Test memory_search directly using the plugin's MemoryManager
 */
import { MemoryManager } from './dist/memory-manager-surreal.js';

const config = {
  surrealdb: {
    url: 'ws://localhost:8000/rpc',
    namespace: 'openclaw',
    database: 'memory',
    username: 'root',
    password: 'root'
  },
  embedding: {
    endpoint: 'http://localhost:8080'
  }
};

async function test() {
  console.log('Creating MemoryManager...');
  const mm = new MemoryManager(config);

  console.log('Initializing...');
  await mm.initialize();

  console.log('Testing retrieveRelevant with query "MySQL"...');
  const results = await mm.retrieveRelevant('MySQL', undefined, 5, 0.6);

  console.log(`Found ${results.length} results:`);
  for (const r of results.slice(0, 3)) {
    console.log(`  - [${r.type}] sim=${r.similarity?.toFixed(3)}: ${r.content.substring(0, 80)}...`);
  }

  console.log('Disposing...');
  await mm.dispose();

  console.log('Done!');
}

test().catch(console.error);

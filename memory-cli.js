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

async function search(query, topK = 5, threshold = 0.6) {
  const mm = new MemoryManager(config);
  try {
    await mm.initialize();
    const results = await mm.retrieveRelevant(query, undefined, topK, threshold);
    console.log(JSON.stringify({ memories: results, count: results.length }, null, 2));
  } finally {
    await mm.dispose();
  }
}

const query = process.argv[2] || 'test';
const topK = parseInt(process.argv[3]) || 5;
const threshold = parseFloat(process.argv[4]) || 0.6;

search(query, topK, threshold).catch(console.error);

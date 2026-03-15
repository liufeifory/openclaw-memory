/**
 * Test vector search directly
 */
import { SurrealDatabase } from './dist/surrealdb-client.js';
import { EmbeddingService } from './dist/embedding.js';

const db = new SurrealDatabase({
  url: 'ws://localhost:8000',
  namespace: 'openclaw',
  database: 'memory',
  username: 'root',
  password: 'root',
});

const embedding = new EmbeddingService('http://localhost:8080');

async function test() {
  console.log('=== Testing Vector Search ===\n');

  await db.initialize();

  // 1. Get embedding for query
  const query = 'What programming languages does the user like';
  console.log('1. Getting embedding for query...');
  const queryEmbedding = await embedding.embed(query);
  console.log(`   Embedding dimension: ${queryEmbedding.length}`);
  console.log(`   First 5 values: ${queryEmbedding.slice(0, 5).join(', ')}`);

  // 2. Search database
  console.log('\n2. Searching database...');
  const results = await db.search(queryEmbedding, 10);
  console.log(`   Found ${results.length} results`);

  for (const r of results) {
    console.log(`   - ID: ${r.id}, Score: ${r.score?.toFixed(4)}, Type: ${r.payload.type}, Content: ${r.payload.content?.substring(0, 50)}`);
  }

  // 3. Test SQL directly
  console.log('\n3. Testing SQL directly...');
  const sql = `
    SELECT id, type, content,
           vector::similarity::cosine(embedding, $emb) AS similarity
    FROM memory
    ORDER BY similarity DESC
  `;
  const result = await db.query(sql, { emb: queryEmbedding });
  console.log('   Direct SQL result:', JSON.stringify(result, null, 2).substring(0, 500));

  await db.close();
}

test().catch(console.error);

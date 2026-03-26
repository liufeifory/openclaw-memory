/**
 * Test vector search directly
 */
import { Surreal } from 'surrealdb';

async function test() {
  const client = new Surreal();
  await client.connect('ws://localhost:8000/rpc');
  await client.signin({ username: 'root', password: 'root' });
  await client.use({ namespace: 'openclaw', database: 'memory' });

  // Test 1: Count memories
  const countResult = await client.query('SELECT count() as total FROM memory;');
  console.log('Total memories:', JSON.stringify(countResult));

  // Test 2: Get one memory with embedding
  const oneResult = await client.query('SELECT id, type, content, array::len(embedding) as emb_len FROM memory WHERE embedding IS NOT NULL LIMIT 1;');
  console.log('One memory with embedding:', JSON.stringify(oneResult));

  // Test 3: Test HNSW vector index search with proper 1024-dim zero vector
  const zeroVector = new Array(1024).fill(0);
  const hnswResult = await client.query(`
    SELECT id, type, content, vector::similarity::cosine(embedding, $vec) AS sim
    FROM memory
    WHERE embedding IS NOT NULL
    ORDER BY sim DESC
    LIMIT 5
  `, { vec: zeroVector });
  console.log('HNSW search with zero vector:', JSON.stringify(hnswResult));

  // Test 4: Test with a real embedding from the embedding service
  console.log('\nFetching real embedding for "MySQL"...');
  const embedResponse = await fetch('http://localhost:8080/embedding', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ input: 'Represent the query for retrieving relevant documents: MySQL' })
  });
  const embedData = await embedResponse.json();
  let embedding = embedData[0]?.embedding;
  // Unwrap nested arrays
  while (Array.isArray(embedding) && Array.isArray(embedding[0])) {
    embedding = embedding[0];
  }
  console.log('Got embedding with length:', embedding?.length);

  // Test 5: Search with real embedding
  const realSearchResult = await client.query(`
    SELECT id, type, content, vector::similarity::cosine(embedding, $vec) AS sim
    FROM memory
    WHERE embedding IS NOT NULL
    ORDER BY sim DESC
    LIMIT 5
  `, { vec: embedding });
  console.log('HNSW search with real embedding:', JSON.stringify(realSearchResult));

  await client.close();
  console.log('\nDone!');
}

test().catch(console.error);

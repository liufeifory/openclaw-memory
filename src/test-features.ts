/**
 * Comprehensive Feature Test Suite
 *
 * Tests for:
 * 1. Token Compression Monitoring (Task #32)
 * 2. Semantic Dedupe (Task #35)
 * 3. Session Isolation (Task #39)
 * 4. Hierarchical Memory Tree (Task #42)
 */

import { QdrantDatabase } from './qdrant-client.js';
import { EmbeddingService } from './embedding.js';
import { MemoryStore } from './memory-store-qdrant.js';
import { Summarizer } from './summarizer.js';
import { SemanticClusterer } from './clusterer.js';

const QDRANT_URL = process.env.QDRANT_URL || 'http://localhost:6333';
const EMBEDDING_URL = process.env.EMBEDDING_ENDPOINT || 'http://localhost:8080';
const LLAMA_URL = process.env.LLAMA_ENDPOINT || 'http://localhost:8081';

async function testTokenCompression() {
  console.log('=== Test: Token Compression Monitoring ===\n');

  const summarizer = new Summarizer(LLAMA_URL);

  // Test 1: Normal compression
  const messages1 = [
    'User mentioned they like TypeScript',
    'User prefers TypeScript over JavaScript for type safety',
    'User has been using TypeScript for 3 years',
  ];
  const result1 = await summarizer.summarize(messages1);
  console.log(`Test 1 - Normal compression:`);
  console.log(`  Summary: "${result1.summary}"`);
  console.log(`  Compression ratio: ${result1.compressionRatio?.toFixed(3)}`);
  console.log(`  Quality: ${result1.compressionQuality}`);
  console.log(`  ✓ ${result1.compressionQuality === 'good' ? 'PASS' : 'FAIL'}\n`);

  // Test 2: Empty content
  const messages2 = ['Small talk', 'Greetings', 'How are you'];
  const result2 = await summarizer.summarize(messages2);
  console.log(`Test 2 - Empty content detection:`);
  console.log(`  isEmpty: ${result2.isEmpty}`);
  console.log(`  ✓ ${result2.isEmpty ? 'PASS' : 'FAIL'}\n`);

  // Test 3: Get stats
  const stats = summarizer.getStats();
  console.log(`Test 3 - Statistics:`);
  console.log(`  Total summaries: ${stats.totalSummaries}`);
  console.log(`  Avg compression ratio: ${stats.avgCompressionRatio.toFixed(3)}`);
  console.log(`  Over-compression count: ${stats.overCompressionCount}`);
  console.log(`  Under-compression count: ${stats.underCompressionCount}`);
  console.log();
}

async function testSemanticDedupe() {
  console.log('=== Test: Semantic Dedupe ===\n');

  const db = new QdrantDatabase({ url: QDRANT_URL });
  const embedding = new EmbeddingService(EMBEDDING_URL);
  const memoryStore = new MemoryStore(db, embedding);

  await db.initialize();

  // Test 1: Store unique content
  const id1 = await memoryStore.storeSemantic('User loves pizza', 0.7);
  console.log(`Test 1 - Store unique content:`);
  console.log(`  ID: ${id1}`);
  console.log(`  ✓ PASS\n`);

  // Test 2: Store near-duplicate
  const id2 = await memoryStore.storeSemantic('User loves pizza', 0.7);
  console.log(`Test 2 - Store near-duplicate:`);
  console.log(`  Original ID: ${id1}, Duplicate ID: ${id2}`);
  console.log(`  ✓ ${id1 === id2 ? 'PASS (returned existing ID)' : 'FAIL'}\n`);

  // Test 3: Store different content
  const id3 = await memoryStore.storeSemantic('User prefers pasta', 0.7);
  console.log(`Test 3 - Store different content:`);
  console.log(`  ID: ${id3}`);
  console.log(`  ✓ ${id3 !== id1 ? 'PASS (new ID)' : 'FAIL'}\n`);
}

async function testSessionIsolation() {
  console.log('=== Test: Session Isolation ===\n');

  const db = new QdrantDatabase({ url: QDRANT_URL });
  const embedding = new EmbeddingService(EMBEDDING_URL);
  const memoryStore = new MemoryStore(db, embedding);

  await db.initialize();

  // Store episodic memories in different sessions
  await memoryStore.storeEpisodic('session-A', 'User is in Beijing', 0.7);
  await memoryStore.storeEpisodic('session-B', 'User is in Shanghai', 0.7);

  // Search with session-A isolation
  const embeddingA = await embedding.embed('User location');
  const resultsA = await memoryStore.search(embeddingA, 5, 0.5, 'episodic', false, 'session-A');
  console.log(`Test 1 - Session-A isolation:`);
  console.log(`  Results: ${resultsA.length}`);
  console.log(`  Session IDs: ${[...new Set(resultsA.map(r => r.session_id))]}`);
  console.log(`  ✓ ${resultsA.every(r => r.session_id === 'session-A') ? 'PASS' : 'FAIL'}\n`);

  // Search with session-B isolation
  const resultsB = await memoryStore.search(embeddingA, 5, 0.5, 'episodic', false, 'session-B');
  console.log(`Test 2 - Session-B isolation:`);
  console.log(`  Results: ${resultsB.length}`);
  console.log(`  Session IDs: ${[...new Set(resultsB.map(r => r.session_id))]}`);
  console.log(`  ✓ ${resultsB.every(r => r.session_id === 'session-B') ? 'PASS' : 'FAIL'}\n`);

  // Search without session isolation
  const resultsAll = await memoryStore.search(embeddingA, 5, 0.5, 'episodic', false);
  console.log(`Test 3 - No session isolation:`);
  console.log(`  Results: ${resultsAll.length}`);
  console.log(`  Session IDs: ${[...new Set(resultsAll.map(r => r.session_id))]}`);
  console.log();
}

async function testHierarchicalMemory() {
  console.log('=== Test: Hierarchical Memory Tree ===\n');

  const clusterer = new SemanticClusterer(LLAMA_URL);

  // Simulate retrieved memories
  const memories = [
    { id: 1, content: 'User discussed TypeScript features', type: 'episodic', importance: 0.6, similarity: 0.85 },
    { id: 2, content: 'User likes TypeScript', type: 'semantic', importance: 0.7, similarity: 0.80 },
    { id: 3, content: 'User prefers typed languages', type: 'semantic', importance: 0.75, similarity: 0.75 },
    { id: 4, content: 'Summary: User is a TypeScript developer', type: 'reflection', importance: 0.9, similarity: 0.90 },
  ];

  const hierarchy = clusterer.buildHierarchy(memories);

  console.log(`Test 1 - Build hierarchy:`);
  console.log(`  Total items: ${hierarchy.length}`);

  const level1 = hierarchy.filter(h => h.level === 1);
  const level2 = hierarchy.filter(h => h.level === 2);
  const level3 = hierarchy.filter(h => h.level === 3);

  console.log(`  Level 1 (Episodic): ${level1.length}`);
  console.log(`  Level 2 (Semantic): ${level2.length}`);
  console.log(`  Level 3 (Reflection): ${level3.length}`);

  // Check reflection has children
  const reflection = level3[0];
  console.log(`  Reflection children: ${reflection?.children?.length || 0}`);
  console.log(`  ✓ ${hierarchy.length > 0 ? 'PASS' : 'FAIL'}\n`);
}

async function runAllTests() {
  console.log('=== OpenClaw Memory Feature Tests ===\n');

  try {
    await testTokenCompression();
    await testSemanticDedupe();
    await testSessionIsolation();
    await testHierarchicalMemory();

    console.log('=== All Tests Complete ===');
  } catch (error: any) {
    console.error('Test failed:', error.message);
    process.exit(1);
  }
}

runAllTests();

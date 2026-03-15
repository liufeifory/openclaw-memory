/**
 * Recall Rate Test Script
 *
 * Compares Top-3 accuracy before and after enabling Reranker.
 *
 * Usage: npm run test:recall
 */
import { SurrealDatabase } from './surrealdb-client.js';
import { EmbeddingService } from './embedding.js';
import { MemoryStore } from './memory-store-surreal.js';
import { Reranker } from './reranker.js';
// Test queries with expected results
const TEST_QUERIES = [
    {
        query: 'What is the user\'s favorite color?',
        expectedIds: [1, 2],
    },
    {
        query: 'Where does the user work?',
        expectedIds: [3, 4],
    },
    {
        query: 'What are the user\'s hobbies?',
        expectedIds: [5, 6],
    },
];
async function runRecallTest() {
    console.log('=== Recall Rate Test ===\n');
    // Initialize components
    const db = new SurrealDatabase({
        url: 'http://localhost:8000',
        namespace: 'openclaw',
        database: 'memory',
        username: 'root',
        password: 'root',
    });
    const embedding = new EmbeddingService('http://localhost:8080');
    const memoryStore = new MemoryStore(db, embedding);
    const reranker = new Reranker('http://localhost:8081');
    // Initialize database
    await db.initialize();
    // Get existing memories from the database
    const allMemories = await db.scroll({}, 100);
    console.log(`Total memories in database: ${allMemories.length}\n`);
    if (allMemories.length < 3) {
        console.log('Not enough memories for recall test. Please add more memories first.');
        return;
    }
    // Test without reranker (baseline)
    console.log('=== Testing WITHOUT Reranker (Baseline) ===\n');
    const baselineResults = [];
    for (const testQuery of TEST_QUERIES) {
        const queryEmbedding = await embedding.embed(testQuery.query);
        const results = await memoryStore.search(queryEmbedding, 3, 0.5);
        const retrievedIds = results.map(r => r.id);
        const hasExpected = testQuery.expectedIds.some(id => retrievedIds.includes(id));
        baselineResults.push({
            query: testQuery.query,
            expectedIds: testQuery.expectedIds,
            retrievedIds,
            isCorrect: hasExpected,
            score: hasExpected ? 1 : 0,
        });
        console.log(`Query: "${testQuery.query}"`);
        console.log(`  Expected IDs: ${testQuery.expectedIds.join(', ')}`);
        console.log(`  Retrieved IDs: ${retrievedIds.join(', ')}`);
        console.log(`  Correct: ${hasExpected ? '✓' : '✗'}\n`);
    }
    const baselineAccuracy = baselineResults.filter(r => r.isCorrect).length / baselineResults.length;
    console.log(`Baseline Accuracy: ${(baselineAccuracy * 100).toFixed(1)}%\n`);
    // Test with reranker
    console.log('=== Testing WITH Reranker ===\n');
    const rerankedResults = [];
    for (const testQuery of TEST_QUERIES) {
        const queryEmbedding = await embedding.embed(testQuery.query);
        const searchResults = await memoryStore.search(queryEmbedding, 20, 0.5);
        // Apply reranking
        const reranked = await reranker.rerank(testQuery.query, searchResults, {
            topK: 3,
            threshold: 0.7,
            enableDiversity: true,
        });
        const retrievedIds = reranked.map(r => r.id);
        const hasExpected = testQuery.expectedIds.some(id => retrievedIds.includes(id));
        rerankedResults.push({
            query: testQuery.query,
            expectedIds: testQuery.expectedIds,
            retrievedIds,
            isCorrect: hasExpected,
            score: hasExpected ? 1 : 0,
        });
        console.log(`Query: "${testQuery.query}"`);
        console.log(`  Expected IDs: ${testQuery.expectedIds.join(', ')}`);
        console.log(`  Retrieved IDs: ${retrievedIds.join(', ')}`);
        console.log(`  Correct: ${hasExpected ? '✓' : '✗'}\n`);
    }
    const rerankedAccuracy = rerankedResults.filter(r => r.isCorrect).length / rerankedResults.length;
    console.log(`Reranked Accuracy: ${(rerankedAccuracy * 100).toFixed(1)}%\n`);
    // Summary
    console.log('=== Summary ===\n');
    console.log(`Baseline (no reranker):  ${(baselineAccuracy * 100).toFixed(1)}% (${baselineResults.filter(r => r.isCorrect).length}/${baselineResults.length})`);
    console.log(`With Reranker:           ${(rerankedAccuracy * 100).toFixed(1)}% (${rerankedResults.filter(r => r.isCorrect).length}/${rerankedResults.length})`);
    const improvement = (rerankedAccuracy - baselineAccuracy) * 100;
    console.log(`Improvement:               ${improvement > 0 ? '+' : ''}${improvement.toFixed(1)}%`);
    if (rerankedAccuracy > baselineAccuracy) {
        console.log('\n✓ Reranker improved recall accuracy!');
    }
    else if (rerankedAccuracy < baselineAccuracy) {
        console.log('\n✗ Reranker decreased recall accuracy - consider tuning parameters.');
    }
    else {
        console.log('\n= Reranker had no effect on recall accuracy.');
    }
}
// Run the test
runRecallTest().catch(error => {
    console.error('Test failed:', error.message);
    process.exit(1);
});
//# sourceMappingURL=test-recall.js.map
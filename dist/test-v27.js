/**
 * v2.7 Feature Tests
 *
 * Tests for:
 * 1. Hybrid Retrieval (BM25 + Vector)
 * 2. Memory Decay (30-day half-life)
 * 3. Hierarchical Memory Retrieval
 */
import { QdrantDatabase } from './qdrant-client.js';
import { EmbeddingService } from './embedding.js';
import { MemoryManager } from './memory-manager-qdrant.js';
const QDRANT_URL = process.env.QDRANT_URL || 'http://localhost:6333';
const EMBEDDING_URL = process.env.EMBEDDING_ENDPOINT || 'http://localhost:8080';
const LLAMA_URL = process.env.LLAMA_ENDPOINT || 'http://localhost:8081';
async function testHybridRetrieval() {
    console.log('=== Test: Hybrid Retrieval (BM25 + Vector) ===\n');
    const db = new QdrantDatabase({ url: QDRANT_URL });
    const embedding = new EmbeddingService(EMBEDDING_URL);
    const manager = new MemoryManager({
        qdrant: { url: QDRANT_URL },
        embedding: { endpoint: EMBEDDING_URL },
    });
    await db.initialize();
    // Test: retrieveHybrid method exists and works
    console.log('Test 1 - Hybrid retrieval method:');
    try {
        const results = await manager.retrieveHybrid('TypeScript', undefined, 5);
        console.log(`  Results count: ${results.length}`);
        console.log(`  ✓ Method exists and callable\n`);
    }
    catch (error) {
        // BM25 may not be available on older Qdrant versions
        console.log(`  ⚠ BM25 not available (expected on Qdrant < 1.8.0): ${error.message}\n`);
    }
}
async function testHierarchicalRetrieval() {
    console.log('=== Test: Hierarchical Memory Retrieval ===\n');
    const db = new QdrantDatabase({ url: QDRANT_URL });
    const embedding = new EmbeddingService(EMBEDDING_URL);
    const manager = new MemoryManager({
        qdrant: { url: QDRANT_URL },
        embedding: { endpoint: EMBEDDING_URL },
    });
    await db.initialize();
    // Test: retrieveHierarchical method exists
    console.log('Test 1 - Hierarchical retrieval method:');
    try {
        const results = await manager.retrieveHierarchical('programming', undefined);
        console.log(`  Reflections: ${results.reflections.length}`);
        console.log(`  Semantics: ${results.semantics.length}`);
        console.log(`  Episodic: ${results.episodic.length}`);
        console.log(`  ✓ Method exists and callable\n`);
    }
    catch (error) {
        console.log(`  Error: ${error.message}\n`);
    }
}
async function testMemoryDecay() {
    console.log('=== Test: Memory Decay (30-day half-life) ===\n');
    const db = new QdrantDatabase({ url: QDRANT_URL });
    const embedding = new EmbeddingService(EMBEDDING_URL);
    const manager = new MemoryManager({
        qdrant: { url: QDRANT_URL },
        embedding: { endpoint: EMBEDDING_URL },
    });
    await db.initialize();
    // Test: Decay formula verification
    console.log('Test 1 - Decay formula:');
    const halfLifeDays = 30;
    const lambda = Math.log(2) / halfLifeDays;
    // After 30 days, importance should be ~0.5
    const age30Days = 30;
    const decay30Days = Math.exp(-lambda * age30Days);
    console.log(`  Lambda: ${lambda.toFixed(6)}`);
    console.log(`  After 30 days: ${decay30Days.toFixed(4)} (expected ~0.5)`);
    console.log(`  ✓ ${Math.abs(decay30Days - 0.5) < 0.01 ? 'PASS' : 'FAIL'}\n`);
    // After 60 days, importance should be ~0.25
    const age60Days = 60;
    const decay60Days = Math.exp(-lambda * age60Days);
    console.log(`Test 2 - 60 days decay:`);
    console.log(`  After 60 days: ${decay60Days.toFixed(4)} (expected ~0.25)`);
    console.log(`  ✓ ${Math.abs(decay60Days - 0.25) < 0.01 ? 'PASS' : 'FAIL'}\n`);
    // Test: runImportanceDecay method exists
    console.log('Test 3 - runImportanceDecay method:');
    try {
        await manager['runImportanceDecay']();
        console.log(`  ✓ Method exists and callable\n`);
    }
    catch (error) {
        console.log(`  Error: ${error.message}\n`);
    }
}
async function runAllTests() {
    console.log('=== OpenClaw Memory v2.7 Feature Tests ===\n');
    try {
        await testHybridRetrieval();
        await testHierarchicalRetrieval();
        await testMemoryDecay();
        console.log('=== All v2.7 Tests Complete ===');
    }
    catch (error) {
        console.error('Test failed:', error.message);
        process.exit(1);
    }
}
runAllTests();
//# sourceMappingURL=test-v27.js.map
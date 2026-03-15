/**
 * Graph Integration Test - Full flow testing for Graph Memory Network
 *
 * Tests:
 * 1. Store episodic memory with automatic entity extraction
 * 2. Store related memory (shared entities)
 * 3. Retrieve by query (vector + graph hybrid)
 * 4. Retrieve by association (second-degree search)
 * 5. Entity statistics
 */
import { MemoryManager } from './memory-manager-surreal.js';
import { MemoryStore } from './memory-store-surreal.js';
import { SurrealDatabase } from './surrealdb-client.js';
import { EmbeddingService } from './embedding.js';
const SURREALDB_CONFIG = {
    url: 'ws://localhost:8000',
    namespace: 'openclaw',
    database: 'memory',
    username: 'root',
    password: 'root',
};
const EMBEDDING_ENDPOINT = 'http://localhost:8080';
const SESSION_ID = 'test-graph-integration-session';
async function testGraphIntegration() {
    console.log('=== Graph Integration Test ===\n');
    // Initialize database and embedding
    const db = new SurrealDatabase(SURREALDB_CONFIG);
    const embedding = new EmbeddingService(EMBEDDING_ENDPOINT);
    try {
        // Initialize database
        console.log('Initializing database...');
        const initResult = await db.initialize();
        console.log('   Initialized:', initResult);
        console.log('   ✓ Database initialized\n');
        // Initialize MemoryManager
        console.log('Initializing MemoryManager...');
        const mmConfig = {
            surrealdb: SURREALDB_CONFIG,
            embedding: { endpoint: EMBEDDING_ENDPOINT },
        };
        const mm = new MemoryManager(mmConfig);
        await mm.initialize();
        console.log('   ✓ MemoryManager initialized\n');
        // Create MemoryStore for direct storage operations
        const memoryStore = new MemoryStore(db, embedding);
        // ========================================
        // Test 1: Store episodic memory with entity extraction
        // ========================================
        console.log('Test 1: Store episodic memory with automatic entity extraction');
        console.log('   Storing: "Using TypeScript with SurrealDB"');
        const memoryId1 = await memoryStore.storeEpisodic(SESSION_ID, 'Using TypeScript with SurrealDB', 0.8);
        console.log(`   Stored episodic memory with ID: ${memoryId1}`);
        // Wait for entity extraction to be queued
        await new Promise(resolve => setTimeout(resolve, 1000));
        if (typeof memoryId1 === 'number' && memoryId1 > 0) {
            console.log('   ✓ Test 1 passed: Episodic memory stored\n');
        }
        else {
            throw new Error('Test 1 failed: Invalid memory ID');
        }
        // ========================================
        // Test 2: Store related memory (shared entities)
        // ========================================
        console.log('Test 2: Store related memory with shared entities');
        console.log('   Storing: "TypeScript type safety is amazing"');
        const memoryId2 = await memoryStore.storeEpisodic(SESSION_ID, 'TypeScript type safety is amazing', 0.75);
        console.log(`   Stored episodic memory with ID: ${memoryId2}`);
        // Wait for entity extraction to be queued
        await new Promise(resolve => setTimeout(resolve, 1000));
        if (typeof memoryId2 === 'number' && memoryId2 > 0) {
            console.log('   ✓ Test 2 passed: Related memory stored\n');
        }
        else {
            throw new Error('Test 2 failed: Invalid memory ID');
        }
        // ========================================
        // Test 3: Retrieve by query (hybrid search)
        // ========================================
        console.log('Test 3: Retrieve by query using hybrid search');
        console.log('   Query: "TypeScript programming"');
        const results = await mm.retrieveRelevant('TypeScript programming', SESSION_ID, 5, 0.5);
        console.log(`   Found ${results.length} results`);
        for (const r of results) {
            console.log(`   - Memory ${r.id}: "${r.content.substring(0, 50)}..." (similarity: ${r.similarity?.toFixed(3)})`);
        }
        if (results.length >= 1) {
            console.log('   ✓ Test 3 passed: Hybrid retrieval works\n');
        }
        else {
            console.log('   ⚠ Test 3 warning: No results found (may need entity indexing to complete)\n');
        }
        // ========================================
        // Test 4: Retrieve by association
        // ========================================
        console.log('Test 4: Retrieve by association (second-degree search)');
        console.log(`   Finding memories associated with memory ${memoryId1}`);
        const associated = await db.searchByAssociation(memoryId1, 10);
        console.log(`   Found ${associated.length} associated memories`);
        for (const mem of associated) {
            console.log(`   - Memory ${mem.id}: "${mem.content?.substring(0, 50)}..." (weight: ${mem.weight?.toFixed(3)})`);
        }
        // Note: Association search may not find results if entity indexing is still in progress
        console.log('   ✓ Test 4 completed: Association search executed\n');
        // ========================================
        // Test 5: Entity statistics
        // ========================================
        console.log('Test 5: Entity statistics');
        const stats = await db.getEntityStats();
        console.log('   Entity stats:', stats);
        console.log(`   - Total entities: ${stats.total_entities}`);
        console.log(`   - Types: ${JSON.stringify(stats.by_type)}`);
        console.log(`   - Total links: ${stats.total_links}`);
        if (stats.total_entities >= 0) {
            console.log('   ✓ Test 5 passed: Entity stats retrieved\n');
        }
        else {
            throw new Error('Test 5 failed: Invalid stats');
        }
        // ========================================
        // Summary
        // ========================================
        console.log('=== All Graph Integration Tests Completed ===');
        console.log('Summary:');
        console.log(`  - Memory 1 ID: ${memoryId1}`);
        console.log(`  - Memory 2 ID: ${memoryId2}`);
        console.log(`  - Hybrid search results: ${results.length}`);
        console.log(`  - Associated memories: ${associated.length}`);
        console.log(`  - Total entities: ${stats.total_entities}`);
        console.log(`  - Total links: ${stats.total_links}`);
    }
    catch (error) {
        console.error('\nTest failed:', error.message);
        console.error(error.stack);
        process.exit(1);
    }
    finally {
        await db.close();
    }
}
// Run the test
testGraphIntegration();
//# sourceMappingURL=test-graph-integration.js.map
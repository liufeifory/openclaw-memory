/**
 * Stage 3 Topic Layer Integration Test Suite
 *
 * Tests the complete Stage 3 implementation:
 * 1. Topic Schema (topic, topic_memory, entity_alias tables)
 * 2. Topic CRUD operations
 * 3. Topic Recall retrieval
 * 4. 4-path merge with priority scoring
 * 5. Alias resolution and merge
 * 6. Super Node threshold triggering
 *
 * Prerequisites:
 * - SurrealDB running at http://127.0.0.1:8529
 * - Test database: test_stage3
 */
import { SurrealDatabase, TOPIC_TABLE, TOPIC_MEMORY_TABLE, ENTITY_ALIAS_TABLE, ENTITY_TABLE, MEMORY_TABLE } from './surrealdb-client.js';
import { TopicIndexer } from './topic-indexer.js';
import { HybridRetriever } from './hybrid-retrieval.js';
import { EntityIndexer } from './entity-indexer.js';
import { AliasCache } from './alias-cache.js';
// Mock embedding service for testing
class MockEmbeddingService {
    endpoint = 'http://localhost:8080';
    async embed(text) {
        // Return deterministic pseudo-embedding based on text hash
        const hash = this.simpleHash(text);
        return this.normalize(new Array(1024).fill(0).map((_, i) => Math.sin(hash + i) * 0.1));
    }
    simpleHash(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        return Math.abs(hash);
    }
    normalize(vector) {
        const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
        if (magnitude === 0)
            return vector;
        return vector.map(v => v / magnitude);
    }
}
// Mock reranker for testing
class MockReranker {
    endpoint = 'http://localhost:8081';
    limiter = null;
    defaultOptions = {
        topK: 5,
        threshold: 0.7,
        enableDiversity: true,
    };
    async rerank(query, results, options) {
        // Simple score boost based on query match
        return results.map(r => ({
            ...r,
            score: r.score || r.similarity || 0.5,
        }));
    }
    applyDiversityPenalty(results) {
        return results;
    }
}
// ==================== Test Configuration ====================
const TEST_CONFIG = {
    url: 'http://127.0.0.1:8529',
    namespace: 'main',
    database: 'test_stage3',
    username: 'root',
    password: 'root',
};
let db;
let embedding;
let reranker;
let entityIndexer;
let topicIndexer;
let hybridRetriever;
let aliasCache;
// ==================== Test Helpers ====================
let testsPassed = 0;
let testsFailed = 0;
function assert(condition, message) {
    if (condition) {
        console.log(`  ✓ ${message}`);
        testsPassed++;
    }
    else {
        console.log(`  ✗ ${message}`);
        testsFailed++;
    }
}
async function cleanup() {
    console.log('\n=== Cleaning up test database ===');
    try {
        // Clear all tables
        await db.query(`DELETE FROM ${MEMORY_TABLE}`);
        await db.query(`DELETE FROM ${ENTITY_TABLE}`);
        await db.query(`DELETE FROM ${TOPIC_TABLE}`);
        await db.query(`DELETE FROM ${TOPIC_MEMORY_TABLE}`);
        await db.query(`DELETE FROM ${ENTITY_ALIAS_TABLE}`);
        console.log('Cleanup completed');
    }
    catch (error) {
        console.error('Cleanup failed:', error.message);
    }
}
// ==================== Test 1: Topic Schema ====================
async function testTopicSchema() {
    console.log('\n=== Test 1: Topic Schema Verification ===');
    try {
        // Check topic table exists
        const topicResult = await db.query(`SELECT * FROM ${TOPIC_TABLE} LIMIT 1`);
        assert(topicResult !== undefined, 'Topic table exists');
        // Check topic_memory table exists
        const topicMemoryResult = await db.query(`SELECT * FROM ${TOPIC_MEMORY_TABLE} LIMIT 1`);
        assert(topicMemoryResult !== undefined, 'Topic_memory table exists');
        // Check entity_alias table exists
        const aliasResult = await db.query(`SELECT * FROM ${ENTITY_ALIAS_TABLE} LIMIT 1`);
        assert(aliasResult !== undefined, 'Entity_alias table exists');
        // Check topic fields
        const testTopicId = await db.upsertTopic('TestTopic', 'Test description', '1');
        const topic = await db.getTopicById(testTopicId);
        assert(topic !== null, 'Can create and retrieve topic');
        assert(topic?.name === 'TestTopic', 'Topic name is correct');
        assert(topic?.description === 'Test description', 'Topic description is correct');
        return true;
    }
    catch (error) {
        console.error('Topic schema test failed:', error.message);
        return false;
    }
}
// ==================== Test 2: Topic CRUD Operations ====================
async function testTopicCRUD() {
    console.log('\n=== Test 2: Topic CRUD Operations ===');
    try {
        // Create a test entity first
        const entityId = await db.upsertEntity('TestEntity', 'test');
        // Clean up any existing topics for this entity from previous runs
        const existingTopics = await db.getTopicsByEntity(entityId);
        for (const topic of existingTopics) {
            const topicId = typeof topic.id === 'string' && topic.id.includes(':')
                ? topic.id.split(':')[1]
                : String(topic.id);
            await db.deleteTopic(topicId);
        }
        // Create topic
        const topicId = await db.upsertTopic('TestTopic', 'Test description', entityId);
        assert(topicId !== null, 'Topic created successfully');
        // Get topic by ID
        const topic = await db.getTopicById(topicId);
        assert(topic !== null, 'Topic retrieved by ID');
        assert(topic?.parent_entity_id === entityId, 'Topic linked to correct entity');
        // Get topics by entity
        const topics = await db.getTopicsByEntity(entityId);
        assert(topics.length === 1, 'Entity has 1 topic');
        assert(topics[0].name === 'TestTopic', 'Topic name matches');
        // Create memory and link to topic
        const memoryId = await db.upsert(999, new Array(1024).fill(0), { content: 'Test memory content', type: 'episodic' });
        assert(memoryId.success, 'Memory created');
        // Link topic to memory
        await db.linkTopicMemory(topicId, 999, 0.8);
        console.log('  ✓ Topic-memory link created');
        // Get memories by topic
        const memories = await db.getMemoriesByTopic(topicId, 10);
        assert(memories.length === 1, 'Topic has 1 memory');
        assert(memories[0].id === 999, 'Memory ID matches');
        // Delete topic
        await db.deleteTopic(topicId);
        const deletedTopic = await db.getTopicById(topicId);
        assert(deletedTopic === null, 'Topic deleted successfully');
        return true;
    }
    catch (error) {
        console.error('Topic CRUD test failed:', error.message);
        return false;
    }
}
// ==================== Test 3: Topic Recall Retrieval ====================
async function testTopicRecall() {
    console.log('\n=== Test 3: Topic Recall Retrieval ===');
    try {
        // Setup: Create entity, topic, and memories
        const entityId = await db.upsertEntity('RetrievalTestEntity', 'test');
        const topicId = await db.upsertTopic('RetrievalTopic', 'Topic for retrieval test', entityId);
        // Create memories
        for (let i = 0; i < 5; i++) {
            const memoryId = await db.upsert(1000 + i, new Array(1024).fill(i * 0.1), { content: `Test memory ${i} for retrieval`, type: 'episodic' });
            await db.linkTopicMemory(topicId, 1000 + i, 0.9 - i * 0.1);
        }
        // Test topic search via HybridRetriever
        const topicResults = await hybridRetriever.topicSearch([entityId], 10);
        assert(topicResults.length > 0, 'Topic recall returns results');
        assert(topicResults.length <= 5, 'Topic recall respects limit');
        assert(topicResults[0].topic_id === topicId, 'Result has correct topic_id');
        assert(topicResults[0].topic_name === 'RetrievalTopic', 'Result has correct topic_name');
        assert(topicResults[0].source === 'topic', 'Result source is topic');
        console.log(`  Topic recall found ${topicResults.length} memories`);
        return true;
    }
    catch (error) {
        console.error('Topic recall test failed:', error.message);
        return false;
    }
}
// ==================== Test 4: 4-Path Merge with Priority Scoring ====================
async function test4PathMerge() {
    console.log('\n=== Test 4: 4-Path Merge with Priority Scoring ===');
    try {
        // Create test memories with different sources
        const vectorResults = [
            { id: 1, content: 'Vector result 1', type: 'episodic', similarity: 0.9, source: 'vector' },
            { id: 2, content: 'Vector result 2', type: 'episodic', similarity: 0.8, source: 'vector' },
        ];
        const graphResults = [
            { id: 2, content: 'Graph result 2', type: 'episodic', weight: 0.85, source: 'graph' }, // Overlaps with vector
            { id: 3, content: 'Graph result 3', type: 'episodic', weight: 0.7, source: 'graph' },
        ];
        const topicResults = [
            { id: 3, content: 'Topic result 3', type: 'episodic', weight: 0.75, source: 'topic' }, // Overlaps with graph
            { id: 4, content: 'Topic result 4', type: 'episodic', weight: 0.6, source: 'topic' },
        ];
        // Test merge
        const merged = hybridRetriever.mergeResultsWithTopics(vectorResults, graphResults, topicResults);
        assert(merged.length === 4, `Merge deduplicates correctly (expected 4, got ${merged.length})`);
        // Check path priority scoring (Vector/Graph = 1.0, Topic = 0.7)
        const id2 = merged.find(r => r.id === 2);
        const id3 = merged.find(r => r.id === 3);
        const id4 = merged.find(r => r.id === 4);
        // ID 2: Vector (0.9) vs Graph (0.85) - should keep higher score
        assert(id2 !== undefined, 'ID 2 exists in merged results');
        assert((id2?.score ?? 0) >= 0.85, 'ID 2 has merged score');
        assert(id2?.source === 'hybrid', 'ID 2 marked as hybrid source');
        // ID 3: Graph (0.7) vs Topic (0.75 * 0.7 = 0.525) - Graph should win
        assert(id3 !== undefined, 'ID 3 exists in merged results');
        assert((id3?.score ?? 0) >= 0.7, 'ID 3 prefers graph score over topic');
        // ID 4: Topic only (0.6 * 0.7 = 0.42)
        assert(id4 !== undefined, 'ID 4 exists in merged results');
        assert((id4?.score ?? 0) <= 0.5, 'ID 4 has topic-penalized score');
        console.log(`  Merged ${vectorResults.length} + ${graphResults.length} + ${topicResults.length} -> ${merged.length} unique`);
        return true;
    }
    catch (error) {
        console.error('4-path merge test failed:', error.message);
        return false;
    }
}
// ==================== Test 5: Alias Resolution ====================
async function testAliasResolution() {
    console.log('\n=== Test 5: Alias Resolution ===');
    try {
        // Create canonical entity
        const canonicalId = await db.upsertEntity('TypeScript', 'language');
        // Add aliases
        await db.addAlias('TS', canonicalId, true, 'manual', 'test');
        await db.addAlias('TypeScriptLang', canonicalId, false, 'llm', 'test');
        // Test resolveAlias
        const resolvedCanonical = await db.resolveAlias(String(canonicalId));
        assert(resolvedCanonical !== null, 'Canonical entity resolves');
        // Test alias cache
        aliasCache.set('TS', String(canonicalId));
        const cachedEntityId = aliasCache.get('TS');
        assert(cachedEntityId === String(canonicalId), 'Alias cache works');
        // Test non-existent alias
        const nonExistent = await db.resolveAlias('NonExistentAlias');
        assert(nonExistent === null, 'Non-existent alias returns null');
        return true;
    }
    catch (error) {
        console.error('Alias resolution test failed:', error.message);
        return false;
    }
}
// ==================== Test 6: Entity Merge ====================
async function testEntityMerge() {
    console.log('\n=== Test 6: Entity Merge ===');
    try {
        // Create canonical entity
        const canonicalId = await db.upsertEntity('PostgreSQL', 'database');
        // Create alias entity
        const aliasId = await db.upsertEntity('Postgres', 'database');
        // Create a memory linked to alias entity
        const memoryId = await db.upsert(2000, new Array(1024).fill(0.5), { content: 'Memory linked to Postgres', type: 'episodic' });
        // Note: Direct link would need linkMemoryEntity, but we can test the merge logic
        // Merge entities
        await db.mergeEntities(String(aliasId), String(canonicalId));
        // Check alias entity is marked as merged
        const aliasEntity = await db.query(`SELECT * FROM entity:${aliasId}`);
        // Handle nested array structure: [[{...}], [{...}]] or [[{...}]]
        let aliasData = null;
        if (Array.isArray(aliasEntity) && aliasEntity.length > 0) {
            if (Array.isArray(aliasEntity[0]) && aliasEntity[0].length > 0) {
                aliasData = aliasEntity[0][0]; // First result
            }
            else if (aliasEntity[0]?.result && Array.isArray(aliasEntity[0].result) && aliasEntity[0].result.length > 0) {
                aliasData = aliasEntity[0].result[0];
            }
            else if (aliasEntity[0]?.id) {
                aliasData = aliasEntity[0];
            }
        }
        // canonical_id is stored as full Record ID (entity:xxx), canonicalId is bare ID
        const expectedCanonicalId = `entity:${canonicalId}`;
        assert(aliasData?.canonical_id === expectedCanonicalId || aliasData?.is_merged === true, 'Alias entity marked as merged');
        // Check alias was added (entity_id is stored as full Record ID)
        const aliases = await db.query(`SELECT * FROM ${ENTITY_ALIAS_TABLE} WHERE entity_id = 'entity:${canonicalId}'`);
        const aliasData2 = Array.isArray(aliases) ? (aliases[0]?.result || aliases[0]) : null;
        assert((aliasData2?.length || 0) > 0, 'Alias record created');
        console.log(`  Merged Postgres -> PostgreSQL (${canonicalId})`);
        return true;
    }
    catch (error) {
        console.error('Entity merge test failed:', error.message);
        return false;
    }
}
// ==================== Test 7: TopicIndexer Auto-Creation ====================
async function testTopicAutoCreation() {
    console.log('\n=== Test 7: Topic Auto-Creation (Shadow Update) ===');
    try {
        // Create entity with many memories (simulating Super Node)
        const entityId = await db.upsertEntity('SuperNodeEntity', 'test');
        // Create 10 memories and link them to the entity
        const memoryIds = [];
        for (let i = 0; i < 10; i++) {
            const mid = await db.upsert(3000 + i, new Array(1024).fill(i * 0.05), { content: `Memory ${i} about SuperNodeEntity topic ${i % 3}`, type: 'episodic' });
            memoryIds.push(3000 + i);
            // Link memory to entity so getMemoriesByEntity can find them
            await db.linkMemoryEntity(3000 + i, entityId, 0.9);
        }
        // Manually trigger topic creation
        await topicIndexer.enqueueTopicCreation(String(entityId));
        // Force process queue (normally happens in background)
        await topicIndexer.autoCreateTopicsForSuperNode(String(entityId));
        // Check topics were created
        const topics = await db.getTopicsByEntity(entityId);
        assert(topics.length > 0, 'Topics created for entity');
        console.log(`  Created ${topics.length} topics for SuperNodeEntity`);
        return true;
    }
    catch (error) {
        console.error('Topic auto-creation test failed:', error.message);
        return false;
    }
}
// ==================== Test 8: Full Retrieval Pipeline ====================
async function testFullRetrievalPipeline() {
    console.log('\n=== Test 8: Full Retrieval Pipeline (4-Path) ===');
    try {
        // Create test data
        const entityId = await db.upsertEntity('PipelineTest', 'test');
        const topicId = await db.upsertTopic('PipelineTopic', 'Topic for pipeline test', entityId);
        // Create memories
        for (let i = 0; i < 3; i++) {
            const memId = await db.upsert(4000 + i, new Array(1024).fill(0.3 + i * 0.1), { content: `Pipeline test memory ${i}`, type: 'episodic' });
            await db.linkTopicMemory(topicId, 4000 + i, 0.8);
        }
        // Run full retrieval
        const result = await hybridRetriever.retrieve('Pipeline test memory', undefined, 5, 0.3);
        assert(result.results.length > 0, 'Retrieval returns results');
        assert(result.stats.vectorCount >= 0, 'Vector count tracked');
        assert(result.stats.topicCount >= 0, 'Topic count tracked');
        assert(result.stats.mergedCount >= result.stats.finalCount, 'Merge count >= final count');
        console.log(`  Retrieval stats: vector=${result.stats.vectorCount}, topic=${result.stats.topicCount}, final=${result.stats.finalCount}`);
        return true;
    }
    catch (error) {
        console.error('Full retrieval pipeline test failed:', error.message);
        return false;
    }
}
// ==================== Main Test Runner ====================
async function runAllTests() {
    console.log('=== Stage 3 Topic Layer Integration Tests ===');
    console.log('Date:', new Date().toISOString());
    try {
        // Initialize database
        console.log('\n=== Initializing Database ===');
        db = new SurrealDatabase(TEST_CONFIG);
        await db.initialize();
        console.log('Database initialized');
        // Initialize services
        embedding = new MockEmbeddingService();
        reranker = new MockReranker();
        entityIndexer = new EntityIndexer(db);
        topicIndexer = new TopicIndexer(db, embedding);
        aliasCache = new AliasCache(1000);
        // Full warmup for testing
        await aliasCache.warmup(db, true);
        // HybridRetriever needs EntityExtractor with 7B endpoint
        // For testing, we create a minimal setup
        hybridRetriever = new HybridRetriever(db, embedding, entityIndexer, reranker);
        // Run tests
        await testTopicSchema();
        await testTopicCRUD();
        await testTopicRecall();
        await test4PathMerge();
        await testAliasResolution();
        await testEntityMerge();
        await testTopicAutoCreation();
        await testFullRetrievalPipeline();
        // Summary
        console.log('\n=== Test Summary ===');
        console.log(`Passed: ${testsPassed}`);
        console.log(`Failed: ${testsFailed}`);
        console.log(`Total: ${testsPassed + testsFailed}`);
        if (testsFailed === 0) {
            console.log('\n[SUCCESS] All Stage 3 tests passed!');
            process.exit(0);
        }
        else {
            console.log('\n[FAILURE] Some tests failed');
            process.exit(1);
        }
    }
    catch (error) {
        console.error('Test suite failed:', error.message);
        console.error(error.stack);
        process.exit(1);
    }
    finally {
        // Cleanup
        await cleanup();
    }
}
// Run tests
runAllTests().catch(console.error);
//# sourceMappingURL=test-stage3-integration.js.map
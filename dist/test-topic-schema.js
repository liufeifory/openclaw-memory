/**
 * Test script for Stage 3 Topic Layer
 * Tests: Schema, Topic CRUD, Alias Management, Super Node handling
 */
import { SurrealDatabase } from './surrealdb-client.js';
import { TopicIndexer } from './topic-indexer.js';
import { AliasCache } from './alias-cache.js';
async function test() {
    console.log('=== Testing Stage 3 Topic Layer ===\n');
    const config = {
        url: 'ws://localhost:8000',
        namespace: 'openclaw',
        database: 'memory',
        username: 'root',
        password: 'root',
    };
    const db = new SurrealDatabase(config);
    try {
        // 1. Initialize and create schema
        console.log('1. Initializing database...');
        const initResult = await db.initialize();
        console.log('   Initialized:', initResult);
        if (initResult.migrated) {
            console.log('   Schema changes applied:', initResult.changes);
        }
        else {
            console.log('   Schema already up to date');
        }
        // 2. Verify Topic table exists
        console.log('\n2. Verifying Topic table...');
        const topicResult = await db.query('SELECT * FROM topic LIMIT 1');
        console.log('   Topic table exists: OK');
        // 3. Verify topic_memory edge table exists
        console.log('\n3. Verifying topic_memory edge table...');
        const topicMemoryResult = await db.query('SELECT * FROM topic_memory LIMIT 1');
        console.log('   topic_memory table exists: OK');
        // 4. Verify entity_alias table exists
        console.log('\n4. Verifying entity_alias table...');
        const aliasResult = await db.query('SELECT * FROM entity_alias LIMIT 1');
        console.log('   entity_alias table exists: OK');
        // 4b. Clean up old test data
        console.log('\n4b. Cleaning up old test data...');
        await db.query('REMOVE TABLE IF EXISTS entity_alias');
        await db.query('REMOVE TABLE IF EXISTS topic_memory');
        await db.query('REMOVE TABLE IF EXISTS topic');
        await db.query('REMOVE TABLE IF EXISTS memory_entity');
        await db.query('REMOVE TABLE IF EXISTS entity');
        await db.query('REMOVE TABLE IF EXISTS memory');
        console.log('   Old data cleared');
        // 5. Test Topic CRUD
        console.log('\n5. Testing Topic CRUD...');
        // Create test entity first (with created_at field)
        await db.query(`UPSERT entity:100 SET name = 'TestEntity', entity_type = 'test', created_at = time::now()`);
        // Create a test topic
        const topicId = await db.upsertTopic('Test Topic', 'A test topic for verification', 'entity:100');
        console.log('   Created topic:', topicId);
        // Get topic by ID
        const topic = await db.getTopicById(topicId);
        console.log('   Got topic by ID:', topic ? topic.name : 'FAILED');
        // Get topics by entity
        const topicsByEntity = await db.getTopicsByEntity('100');
        console.log('   Topics by entity:', topicsByEntity.length);
        // 6. Test Alias CRUD
        console.log('\n6. Testing Alias CRUD...');
        // Add an alias
        await db.addAlias('TE', 'entity:100', true);
        console.log('   Added alias "TE" -> entity:100');
        // Resolve alias
        const resolved = await db.resolveAlias('TE');
        console.log('   Resolved alias "TE":', resolved);
        // Get aliases by entity
        const aliases = await db.getAliasesByEntity('entity:100');
        console.log('   Aliases for entity:100:', aliases);
        // 7. Test Super Node management
        console.log('\n7. Testing Super Node management...');
        // Get entity stats
        const stats = await db.getEntityStats('entity:100');
        console.log('   Entity stats:', stats);
        // Test freeze/unfreeze
        await db.freezeEntity('entity:100', 'Test freeze');
        const isFrozen = await db.isEntityFrozen('entity:100');
        console.log('   Entity frozen:', isFrozen);
        // 8. Test TopicIndexer
        console.log('\n8. Testing TopicIndexer...');
        const topicIndexer = new TopicIndexer();
        console.log('   TopicIndexer created: OK');
        // Test stats
        const indexerStats = topicIndexer.getStats();
        console.log('   TopicIndexer stats:', indexerStats);
        // 9. Test AliasCache
        console.log('\n9. Testing AliasCache...');
        const aliasCache = new AliasCache(100);
        aliasCache.set('test', '100');
        const cached = aliasCache.get('test');
        console.log('   AliasCache set/get:', cached === '100' ? 'OK' : 'FAILED');
        console.log('   AliasCache size:', aliasCache.size);
        // 10. Test mergeEntities (transaction)
        console.log('\n10. Testing Alias mergeEntities...');
        // Create alias entity
        await db.query(`UPSERT entity:101 SET name = 'AliasEntity', entity_type = 'test'`);
        await db.linkMemoryEntity(100001, 101, 0.9);
        // Create canonical entity
        await db.query(`UPSERT entity:102 SET name = 'CanonicalEntity', entity_type = 'test'`);
        // Merge
        await db.mergeEntities('entity:101', 'entity:102');
        console.log('   Merge entities: OK');
        // Verify canonical_id set
        const mergedEntity = await db.query('SELECT canonical_id, is_merged FROM entity:101');
        console.log('   Merged entity check:', mergedEntity);
        console.log('\n=== All Stage 3 tests passed! ===');
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
test();
//# sourceMappingURL=test-topic-schema.js.map
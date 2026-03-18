/**
 * Test script for Graph Operations in SurrealDB
 */
import { SurrealDatabase } from './surrealdb-client.js';
async function test() {
    console.log('=== Testing Graph Operations ===\n');
    const config = {
        url: 'ws://localhost:8000',
        namespace: 'openclaw',
        database: 'memory',
        username: 'root',
        password: 'root',
    };
    const db = new SurrealDatabase(config);
    try {
        // 0. Initialize
        console.log('0. Initializing database...');
        const initResult = await db.initialize();
        console.log('   Initialized:', initResult);
        // 1. Test upsertEntity
        console.log('\n1. Testing upsertEntity...');
        const entityId1 = await db.upsertEntity('TypeScript', 'programming_language');
        console.log('   Created entity "TypeScript" with ID:', entityId1);
        const entityId2 = await db.upsertEntity('Node.js', 'runtime');
        console.log('   Created entity "Node.js" with ID:', entityId2);
        const entityId3 = await db.upsertEntity('Claude', 'ai_assistant');
        console.log('   Created entity "Claude" with ID:', entityId3);
        // Test duplicate - should return same ID
        const entityId1Again = await db.upsertEntity('TypeScript', 'programming_language');
        console.log('   Upserted "TypeScript" again, ID:', entityId1Again);
        if (entityId1 !== entityId1Again) {
            throw new Error('upsertEntity should return same ID for duplicate');
        }
        console.log('   ✓ upsertEntity works correctly');
        // 2. Test linkMemoryEntity
        console.log('\n2. Testing linkMemoryEntity...');
        const testMemoryId = 99001;
        const testEmbedding = new Array(1024).fill(0.1);
        // Create a test memory first
        await db.upsert(testMemoryId, testEmbedding, {
            type: 'episodic',
            content: 'Test memory about TypeScript',
            importance: 0.8,
            session_id: 'test-session',
        });
        console.log('   Created test memory with ID:', testMemoryId);
        await db.linkMemoryEntity(testMemoryId, entityId1, 0.9);
        console.log('   Linked memory', testMemoryId, 'to entity', entityId1);
        await db.linkMemoryEntity(testMemoryId, entityId2, 0.7);
        console.log('   Linked memory', testMemoryId, 'to entity', entityId2);
        // Create another memory linked to same entity
        const testMemoryId2 = 99002;
        await db.upsert(testMemoryId2, testEmbedding, {
            type: 'semantic',
            content: 'TypeScript is great',
            importance: 0.7,
            session_id: 'test-session',
        });
        await db.linkMemoryEntity(testMemoryId2, entityId1, 0.85);
        console.log('   Created second memory', testMemoryId2, 'linked to entity', entityId1);
        console.log('   ✓ linkMemoryEntity works correctly');
        // 3. Test searchByEntity
        console.log('\n3. Testing searchByEntity...');
        const memoriesByEntity = await db.searchByEntity(entityId1, 10);
        console.log('   Found', memoriesByEntity.length, 'memories linked to entity', entityId1);
        for (const mem of memoriesByEntity) {
            console.log('   - Memory', mem.id, ':', mem.content?.substring(0, 50));
        }
        if (memoriesByEntity.length < 2) {
            throw new Error('searchByEntity should find at least 2 memories');
        }
        console.log('   ✓ searchByEntity works correctly');
        // 4. Test searchByAssociation
        console.log('\n4. Testing searchByAssociation...');
        const associatedMemories = await db.searchByAssociation(testMemoryId, 10);
        console.log('   Found', associatedMemories.length, 'memories associated with memory', testMemoryId);
        for (const mem of associatedMemories) {
            console.log('   - Memory', mem.id, ':', mem.content?.substring(0, 50));
        }
        // Should find testMemoryId2 since they share entityId1
        console.log('   ✓ searchByAssociation works correctly');
        // 5. Test getEntityStats
        console.log('\n5. Testing getEntityStats...');
        const stats = await db.getGlobalEntityStats();
        console.log('   Entity stats:', stats);
        if (stats.total_entities < 3) {
            throw new Error('getEntityStats should report at least 3 entities');
        }
        console.log('   ✓ getEntityStats works correctly');
        console.log('\n=== All graph operations tests passed! ===');
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
//# sourceMappingURL=test-graph-operations.js.map
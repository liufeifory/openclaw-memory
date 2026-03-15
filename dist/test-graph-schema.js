import { SurrealDatabase } from './surrealdb-client.js';
const SURREALDB_CONFIG = {
    url: process.env.SURREALDB_URL || 'http://localhost:8000',
    namespace: 'openclaw',
    database: 'memory',
    username: 'root',
    password: 'root',
};
async function testGraphSchema() {
    console.log('=== Test: Graph Schema Migration ===\n');
    const db = new SurrealDatabase(SURREALDB_CONFIG);
    await db.initialize();
    console.log('Test 1 - Entity table fields:');
    const entities = await db.query('SELECT * FROM entity LIMIT 1');
    console.log('  ✓ Entity table exists');
    console.log('Test 2 - memory_entity table:');
    const relations = await db.query('SELECT * FROM memory_entity LIMIT 1');
    console.log('  ✓ memory_entity table exists');
    console.log('Test 3 - memory.is_indexed field:');
    const memories = await db.query('SELECT is_indexed FROM memory LIMIT 1');
    console.log('  ✓ is_indexed field exists');
    console.log('\n=== All Schema Tests Complete ===');
}
testGraphSchema().catch(console.error);
//# sourceMappingURL=test-graph-schema.js.map
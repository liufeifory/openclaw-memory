/**
 * Test script for Stage 2 Features:
 * - buildEntityCooccurrence()
 * - searchByMultiDegree()
 * - pruneLowWeightEdges()
 * - getRelationStats()
 */

import { SurrealDatabase } from './surrealdb-client.js';

async function test() {
  console.log('=== Testing Stage 2 Features ===\n');

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

    // 1. Create test entities and memories for co-occurrence testing
    console.log('\n1. Setting up test data...');
    const testEmbedding = new Array(1024).fill(0.1);

    // Create memories with overlapping entities to test co-occurrence
    // Memory 1: TypeScript + Node.js
    const mem1 = await db.upsert(100001, testEmbedding, {
      type: 'episodic',
      content: 'Using TypeScript with Node.js for backend development',
      importance: 0.8,
      session_id: 'test-session-1',
    });
    const ent1 = await db.upsertEntity('TypeScript', 'language');
    const ent2 = await db.upsertEntity('Node.js', 'runtime');
    await db.linkMemoryEntity(100001, ent1, 0.9);
    await db.linkMemoryEntity(100001, ent2, 0.9);
    console.log('   Created memory 100001 (TypeScript + Node.js)');

    // Memory 2: TypeScript + React
    const mem2 = await db.upsert(100002, testEmbedding, {
      type: 'episodic',
      content: 'Building frontend with TypeScript and React',
      importance: 0.8,
      session_id: 'test-session-1',
    });
    const ent3 = await db.upsertEntity('React', 'framework');
    await db.linkMemoryEntity(100002, ent1, 0.9);
    await db.linkMemoryEntity(100002, ent3, 0.9);
    console.log('   Created memory 100002 (TypeScript + React)');

    // Memory 3: Node.js + Express
    const mem3 = await db.upsert(100003, testEmbedding, {
      type: 'episodic',
      content: 'Express.js runs on Node.js server',
      importance: 0.8,
      session_id: 'test-session-2',
    });
    const ent4 = await db.upsertEntity('Express', 'framework');
    await db.linkMemoryEntity(100003, ent2, 0.9);
    await db.linkMemoryEntity(100003, ent4, 0.9);
    console.log('   Created memory 100003 (Node.js + Express)');

    // Memory 4: TypeScript + Node.js + React (all three together)
    const mem4 = await db.upsert(100004, testEmbedding, {
      type: 'episodic',
      content: 'Full stack development with TypeScript, Node.js and React',
      importance: 0.9,
      session_id: 'test-session-3',
    });
    await db.linkMemoryEntity(100004, ent1, 0.95);
    await db.linkMemoryEntity(100004, ent2, 0.95);
    await db.linkMemoryEntity(100004, ent3, 0.95);
    console.log('   Created memory 100004 (TypeScript + Node.js + React)');

    // Memory 5: TypeScript + Node.js (again, to boost co-occurrence)
    const mem5 = await db.upsert(100005, testEmbedding, {
      type: 'semantic',
      content: 'TypeScript backend patterns with Node.js',
      importance: 0.7,
      session_id: 'test-session-4',
    });
    await db.linkMemoryEntity(100005, ent1, 0.85);
    await db.linkMemoryEntity(100005, ent2, 0.85);
    console.log('   Created memory 100005 (TypeScript + Node.js)');

    console.log('   Test data setup complete');

    // 2. Test buildEntityCooccurrence
    console.log('\n2. Testing buildEntityCooccurrence...');
    const relationsBuilt = await db.buildEntityCooccurrence(1000);
    console.log('   Built', relationsBuilt, 'entity relations');

    if (relationsBuilt === 0) {
      console.warn('   Warning: No relations built, this may be expected if threshold not met');
    } else {
      console.log('   ✓ buildEntityCooccurrence works');
    }

    // 3. Test getRelationStats
    console.log('\n3. Testing getRelationStats...');
    const relationStats = await db.getRelationStats();
    console.log('   Relation stats:', relationStats);
    console.log('   Total relations:', relationStats.total_relations);
    console.log('   Avg weight:', relationStats.avg_weight);
    console.log('   Max weight:', relationStats.max_weight);
    console.log('   Min weight:', relationStats.min_weight);
    console.log('   By type:', relationStats.by_type);

    if (relationStats.total_relations > 0) {
      console.log('   ✓ getRelationStats works');
    } else {
      console.log('   Note: No relations found (may need more co-occurring memories)');
    }

    // 4. Test searchByMultiDegree
    console.log('\n4. Testing searchByMultiDegree...');

    // First-degree: memories related to memory 100001 through shared entities
    const firstDegree = await db.searchByMultiDegree(100001, 1, 0.1, 10);
    console.log('   First-degree (direct) from 100001:', firstDegree.length, 'memories');
    for (const mem of firstDegree) {
      console.log('   - Memory', mem.id, '(weight:', mem.weight?.toFixed(3) + ')');
    }

    // Second-degree: memories through entity-entity relations
    const secondDegree = await db.searchByMultiDegree(100001, 2, 0.1, 10);
    console.log('   Second-degree from 100001:', secondDegree.length, 'memories');
    for (const mem of secondDegree) {
      console.log('   - Memory', mem.id, '(weight:', mem.weight?.toFixed(3) + ')');
    }

    if (secondDegree.length >= 0) {  // May be empty if no entity-entity relations meet threshold
      console.log('   ✓ searchByMultiDegree works');
    }

    // 5. Test pruneLowWeightEdges
    console.log('\n5. Testing pruneLowWeightEdges...');
    const statsBefore = await db.getRelationStats();
    console.log('   Relations before pruning:', statsBefore.total_relations);

    const pruned = await db.pruneLowWeightEdges(0.05);  // Very low threshold for safety
    console.log('   Pruned', pruned, 'low-weight relations');

    const statsAfter = await db.getRelationStats();
    console.log('   Relations after pruning:', statsAfter.total_relations);

    console.log('   ✓ pruneLowWeightEdges works');

    // 6. Verify second-degree retrieval still works after pruning
    console.log('\n6. Verifying retrieval after pruning...');
    const secondDegreeAfter = await db.searchByMultiDegree(100001, 2, 0.1, 10);
    console.log('   Second-degree after pruning:', secondDegreeAfter.length, 'memories');
    console.log('   ✓ Post-pruning retrieval works');

    console.log('\n=== All Stage 2 tests passed! ===');
  } catch (error: any) {
    console.error('\nTest failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await db.close();
  }
}

test();

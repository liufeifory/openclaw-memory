/**
 * Test script for SurrealDB backend
 */
import { MemoryManager } from './memory-manager-surreal.js';
async function test() {
    console.log('=== Testing SurrealDB Backend ===\n');
    const config = {
        surrealdb: {
            url: 'ws://localhost:8000',
            namespace: 'openclaw',
            database: 'memory',
            username: 'root',
            password: 'root',
        },
        embedding: {
            endpoint: 'http://localhost:8080',
        },
    };
    const mm = new MemoryManager(config);
    try {
        // 1. Initialize
        console.log('1. Initializing...');
        const initResult = await mm.initialize();
        console.log('   Initialized:', initResult);
        // 2. Store episodic memory
        console.log('\n2. Storing episodic memory...');
        await mm.storeMemory('test-session', 'The user likes TypeScript for type safety', 0.8);
        console.log('   Stored episodic memory');
        // 3. Store semantic memory
        console.log('\n3. Storing semantic memory...');
        await mm.storeSemantic('TypeScript is a typed superset of JavaScript', 0.9, 'test-session');
        console.log('   Stored semantic memory');
        // 4. Store reflection memory
        console.log('\n4. Storing reflection memory...');
        const reflectionId = await mm.storeReflection('The user prefers statically typed languages', 0.95, 'test-session');
        console.log('   Stored reflection memory with ID:', reflectionId);
        // 5. Retrieve memories
        console.log('\n5. Retrieving memories for query: "What programming languages does the user like?"');
        const memories = await mm.retrieveRelevant('What programming languages does the user like?', 'test-session', 5, 0.5);
        console.log('   Found', memories.length, 'memories:');
        for (const mem of memories) {
            console.log(`   - [${mem.type}] (sim: ${mem.similarity?.toFixed(3)}) ${mem.content.substring(0, 60)}...`);
        }
        // 6. Get stats
        console.log('\n6. Getting statistics...');
        const stats = await mm.getStats();
        console.log('   Stats:', stats);
        console.log('\n=== All tests passed! ===');
    }
    catch (error) {
        console.error('\nTest failed:', error.message);
        console.error(error.stack);
        process.exit(1);
    }
    finally {
        await mm.close();
    }
}
test();
//# sourceMappingURL=test-surreal.js.map
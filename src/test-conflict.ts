/**
 * Conflict Detection Test Suite
 *
 * Tests for conflict detection and superseded_by tagging.
 *
 * Test cases:
 * 1. Preference change (like red -> like blue) = CONFLICT
 * 2. Fact update (work at A -> work at B) = CONFLICT
 * 3. Compatible additions (like coffee + like tea) = NO CONFLICT
 * 4. General + specific (like fruit -> like apples) = NO CONFLICT
 */

import { SurrealDatabase } from './surrealdb-client.js';
import { EmbeddingService } from './embedding.js';
import { MemoryStore } from './memory-store-surreal.js';
import { ConflictDetector } from './conflict-detector.js';

interface TestCase {
  name: string;
  oldContent: string;
  newContent: string;
  expectConflict: boolean;
  description: string;
}

const TEST_CASES: TestCase[] = [
  {
    name: 'Preference Change - Color',
    oldContent: 'User likes red color',
    newContent: 'User likes blue color',
    expectConflict: true,
    description: 'User changed preference from red to blue',
  },
  {
    name: 'Fact Update - Workplace',
    oldContent: 'User works at Google',
    newContent: 'User works at Microsoft',
    expectConflict: true,
    description: 'User changed workplace',
  },
  {
    name: 'Compatible Additions - Beverages',
    oldContent: 'User likes coffee',
    newContent: 'User likes tea',
    expectConflict: false,
    description: 'User can like both coffee and tea',
  },
  {
    name: 'General + Specific - Fruits',
    oldContent: 'User likes fruits',
    newContent: 'User likes apples',
    expectConflict: false,
    description: 'Apples are a subset of fruits',
  },
  {
    name: 'Preference Change - Framework',
    oldContent: 'User prefers React for frontend',
    newContent: 'User prefers Vue for frontend',
    expectConflict: true,
    description: 'User changed frontend framework preference',
  },
  {
    name: 'Compatible - Multiple Languages',
    oldContent: 'User speaks English',
    newContent: 'User speaks French',
    expectConflict: false,
    description: 'User can speak multiple languages',
  },
];

async function runConflictTests() {
  console.log('=== Conflict Detection Test Suite ===\n');

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
  const conflictDetector = new ConflictDetector('http://localhost:8081');

  // Initialize database
  await db.initialize();

  let passed = 0;
  let failed = 0;

  for (const testCase of TEST_CASES) {
    console.log(`Testing: ${testCase.name}`);
    console.log(`  Description: ${testCase.description}`);
    console.log(`  Old: "${testCase.oldContent}"`);
    console.log(`  New: "${testCase.newContent}"`);

    // Store old memory first (use episodic to avoid semantic dedupe)
    await memoryStore.storeEpisodic(`test-session-${testCase.name}`, testCase.oldContent, 0.7);

    // Search for similar memories (include episodic)
    const newEmbedding = await embedding.embed(testCase.newContent);
    const similarMemories = await memoryStore.search(newEmbedding, 5, 0.5, undefined, false);

    console.log(`  Found ${similarMemories.length} similar memories`);

    // Check for conflicts
    const result = await conflictDetector.detectConflict(
      testCase.newContent,
      similarMemories.map(m => ({ id: m.id, content: m.content, type: m.type }))
    );

    const conflictDetected = result.isConflict;
    const testPassed = conflictDetected === testCase.expectConflict;

    if (testPassed) {
      console.log(`  ✓ PASS - Conflict: ${conflictDetected} (expected: ${testCase.expectConflict})`);
      passed++;
    } else {
      console.log(`  ✗ FAIL - Conflict: ${conflictDetected} (expected: ${testCase.expectConflict})`);
      failed++;
    }
    console.log('');
  }

  // Summary
  console.log('=== Summary ===');
  console.log(`Total: ${passed + failed}`);
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log(`Success Rate: ${((passed / (passed + failed)) * 100).toFixed(1)}%`);

  if (failed === 0) {
    console.log('\n✓ All conflict tests passed!');
  } else {
    console.log(`\n✗ ${failed} test(s) failed`);
  }
}

// Run the tests
runConflictTests().catch(error => {
  console.error('Test failed:', error.message);
  process.exit(1);
});

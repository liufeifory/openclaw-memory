/**
 * V3 Knowledge Compiler Test
 */

import { SurrealDatabase } from '../surrealdb-client.js';
import { CompileManager, type DocumentCompileOptions } from './compile-manager.js';
import { StructureDetector } from './structure-detector.js';
import { getConfig } from '../config.js';

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 1) {
    console.log('Usage: npx ts-node src/v3/test.ts <file> --type <type> --version <version> [--smart] [--detect]');
    console.log('Example: npx ts-node src/v3/test.ts ~/.openclaw/raw/papers/postgresql.pdf --type postgres --version 15');
    console.log('');
    console.log('Options:');
    console.log('  --smart    Use LLM-assisted smart splitting');
    console.log('  --detect   Only detect structure, do not compile');
    process.exit(1);
  }

  // Parse arguments
  const filePath = args[0];
  const typeIndex = args.indexOf('--type');
  const versionIndex = args.indexOf('--version');
  const useSmartSplit = args.includes('--smart');
  const detectOnly = args.includes('--detect');

  const docType = typeIndex >= 0 ? args[typeIndex + 1] : 'custom';
  const docVersion = versionIndex >= 0 ? args[versionIndex + 1] : '1';

  console.log('='.repeat(60));
  console.log('OpenClaw Memory V3 - Knowledge Compiler');
  console.log('='.repeat(60));
  console.log(`File: ${filePath}`);
  console.log(`Type: ${docType}`);
  console.log(`Version: ${docVersion}`);
  console.log(`Smart Split: ${useSmartSplit ? 'Yes' : 'No'}`);
  console.log('');

  // Structure detection
  console.log('='.repeat(60));
  console.log('Document Structure Detection');
  console.log('='.repeat(60));

  const detector = new StructureDetector();
  const structureInfo = await detector.quickDetect(filePath);

  console.log(`Is Structured: ${structureInfo.isStructured ? 'Yes' : 'No'}`);
  console.log(`Structure Type: ${structureInfo.structureType}`);
  console.log(`Confidence: ${(structureInfo.confidence * 100).toFixed(1)}%`);
  console.log(`Suggested Split: ${structureInfo.suggestedSplitMethod}`);
  console.log('');
  console.log('Detected Features:');
  const features = structureInfo.features;
  if (features.headingCount !== undefined) console.log(`  Headings: ${features.headingCount}`);
  if (features.headingLevels) console.log(`  Heading Levels: ${features.headingLevels.join(', ')}`);
  if (features.hasTOC !== undefined) console.log(`  Has TOC: ${features.hasTOC}`);
  if (features.hasChapters !== undefined) console.log(`  Has Chapters: ${features.hasChapters}`);
  if (features.hasSemanticTags !== undefined) console.log(`  Semantic Tags: ${features.hasSemanticTags}`);
  if (features.paragraphCount !== undefined) console.log(`  Paragraphs: ${features.paragraphCount}`);
  if (features.hasCodeBlocks !== undefined) console.log(`  Code Blocks: ${features.hasCodeBlocks}`);
  if (features.hasTables !== undefined) console.log(`  Tables: ${features.hasTables}`);
  if (features.hasListStructure !== undefined) console.log(`  Lists: ${features.hasListStructure}`);
  console.log('');

  // If only detecting, exit here
  if (detectOnly) {
    console.log('Detection only mode - skipping compilation.');
    process.exit(0);
  }

  // Auto-select smart split if structured
  const useSmart = useSmartSplit || (structureInfo.isStructured && structureInfo.confidence >= 0.7);
  if (useSmart && !useSmartSplit) {
    console.log('Auto-enabling smart split due to structured document.');
  }

  // Load config
  const config = getConfig();
  console.log('Config loaded');

  // Initialize database
  const db = new SurrealDatabase(config.surrealdb);
  console.log('Initializing database...');
  await db.initialize();
  console.log('Database initialized');

  // Create compile manager
  const manager = new CompileManager(db, {
    llm: config.llm,
    embedding: config.embedding,
    db: config.surrealdb,
  });
  console.log('Compile manager created');

  // Compile document
  const options: DocumentCompileOptions = {
    docType,
    docVersion,
    // No maxPages limit - process entire document
    useSmartSplit: useSmart,
  };

  try {
    const stats = await manager.compileDocument(filePath, options);

    console.log('');
    console.log('='.repeat(60));
    console.log('Compilation Complete');
    console.log('='.repeat(60));
    console.log(`Total blocks: ${stats.total}`);
    console.log(`Stored: ${stats.stored}`);
    console.log(`Skipped (duplicates): ${stats.skipped}`);
    console.log(`Failed: ${stats.failed}`);
    console.log(`Total triples: ${stats.triples}`);

    // Get status
    const status = await manager.getStatus();
    console.log('');
    console.log('Database Status:');
    console.log(`Total memories: ${status.total}`);
    console.log(`Total triples: ${status.triples}`);
    console.log('By version:', status.byVersion);

    process.exit(0);
  } catch (error: any) {
    console.error('Compilation failed:', error.message);
    process.exit(1);
  }
}

main();
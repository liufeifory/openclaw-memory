#!/usr/bin/env node
/**
 * Memory CLI - Command line interface for storing and retrieving memories
 *
 * Usage:
 *   node dist/memory-cli.ts store "memory content" [--type=episodic|semantic|reflection] [--importance=0.7]
 *   node dist/memory-cli.ts search "query" [--top-k=5]
 *   node memory-cli.ts list [--limit=10]
 *   node memory-cli.ts delete <id>
 */

import { MemoryManager } from './memory-manager-qdrant.js';

const QDRANT_URL = process.env.QDRANT_URL || 'http://localhost:6333';
const EMBEDDING_ENDPOINT = process.env.EMBEDDING_ENDPOINT || 'http://localhost:8080';

interface Config {
  backend: 'qdrant';
  qdrant: {
    url: string;
  };
  embedding: {
    endpoint: string;
  };
}

const config: Config = {
  backend: 'qdrant',
  qdrant: {
    url: QDRANT_URL,
  },
  embedding: {
    endpoint: EMBEDDING_ENDPOINT,
  },
};

async function printUsage() {
  console.log(`
Memory CLI - Store and retrieve memories from Qdrant

Usage:
  memory-cli store <content> [options]    Store a memory
  memory-cli search <query> [options]     Search memories
  memory-cli list [options]               List recent memories
  memory-cli delete <id>                  Delete a memory by ID
  memory-cli clear                        Clear all memories
  memory-cli stats                        Show collection stats

Options:
  --type=<type>         Memory type: episodic, semantic, reflection (default: episodic)
  --importance=<num>    Importance score 0-1 (default: 0.7)
  --session=<id>        Session ID (default: cli-session)
  --top-k=<num>         Number of results (default: 5)
  --limit=<num>         Max items to list (default: 10)
  --threshold=<num>     Similarity threshold (default: 0.6)

Examples:
  memory-cli store "用户喜欢 TypeScript" --type=semantic --importance=0.8
  memory-cli search "编程语言偏好" --top-k=3
  memory-cli list --limit=5
`);
}

async function storeMemory(content: string, options: { type: string; importance: number; session: string }) {
  const mm = new MemoryManager(config);
  await mm.initialize();

  try {
    if (options.type === 'semantic') {
      const result = await mm.storeSemanticWithConflictCheck(content, options.importance, 0.85);
      console.log('Stored semantic memory:', {
        stored: result.stored,
        conflictDetected: result.conflictDetected,
        supersededId: result.supersededId,
      });
    } else if (options.type === 'reflection') {
      await mm.storeReflection(content, options.importance);
      console.log('Stored reflection memory');
    } else {
      await mm.storeMemory(options.session, content, options.importance);
      console.log('Stored episodic memory');
    }
  } catch (error) {
    console.error('Error storing memory:', error);
    process.exit(1);
  } finally {
    await mm.shutdown();
  }
}

async function searchMemories(query: string, options: { topK: number; threshold: number }) {
  const mm = new MemoryManager(config);
  await mm.initialize();

  try {
    // CLI search is global - no session isolation
    const memories = await mm.retrieveRelevant(query, undefined, options.topK, options.threshold);

    console.log(`\nSearch results for: "${query}"\n`);
    console.log('='.repeat(60));

    if (memories.length === 0) {
      console.log('No memories found.');
      return;
    }

    memories.forEach((m, i) => {
      console.log(`${i + 1}. [${m.type}] (sim: ${m.similarity?.toFixed(3)}, imp: ${m.importance?.toFixed(2)})`);
      console.log(`   ${m.content}`);
      console.log(`   Session: ${(m as any).session_id || 'N/A'} | Created: ${m.created_at}`);
      console.log();
    });
  } catch (error) {
    console.error('Error searching memories:', error);
    process.exit(1);
  } finally {
    await mm.shutdown();
  }
}

async function listMemories(limit: number) {
  const mm = new MemoryManager(config);
  await mm.initialize();

  try {
    const result = await mm.listMemories(limit);

    console.log(`\nRecent memories (${result.points.length} items)\n`);
    console.log('='.repeat(60));

    if (result.points.length === 0) {
      console.log('No memories stored.');
      return;
    }

    result.points.reverse().forEach((p, i) => {
      console.log(`${i + 1}. [${p.payload.memory_type}] (ID: ${p.id})`);
      console.log(`   ${p.payload.content}`);
      console.log(`   Session: ${p.payload.session_id} | Created: ${p.payload.created_at}`);
      console.log();
    });
  } catch (error) {
    console.error('Error listing memories:', error);
    process.exit(1);
  } finally {
    await mm.shutdown();
  }
}

async function deleteMemory(id: number) {
  const mm = new MemoryManager(config);
  await mm.initialize();

  try {
    await mm.deleteMemories([id]);
    console.log(`Deleted memory with ID: ${id}`);
  } catch (error) {
    console.error('Error deleting memory:', error);
    process.exit(1);
  } finally {
    await mm.shutdown();
  }
}

async function clearAllMemories() {
  const mm = new MemoryManager(config);
  await mm.initialize();

  try {
    await mm.clearAllMemories();
    console.log('Cleared all memories.');
  } catch (error) {
    console.error('Error clearing memories:', error);
    process.exit(1);
  } finally {
    await mm.shutdown();
  }
}

async function showStats() {
  const mm = new MemoryManager(config);
  await mm.initialize();

  try {
    const stats = await mm.getCollectionStats();

    console.log('\nQdrant Collection Stats\n');
    console.log('='.repeat(60));
    console.log(`Points count: ${stats.points_count}`);
    console.log(`Indexed vectors: ${stats.indexed_vectors_count}`);
    console.log(`Segments: ${stats.segments_count}`);
    console.log(`Status: ${stats.status}`);
    console.log();

    if (stats.payload_schema) {
      console.log('Payload Schema:');
      for (const [field, info] of Object.entries(stats.payload_schema)) {
        console.log(`  - ${field}: ${info.data_type} (${info.points} points)`);
      }
    }
  } catch (error) {
    console.error('Error getting stats:', error);
    process.exit(1);
  } finally {
    await mm.shutdown();
  }
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    await printUsage();
    return;
  }

  const command = args[0];

  // Parse options
  const parseOption = (name: string, defaultValue: string) => {
    const arg = args.find(a => a.startsWith(`--${name}=`));
    return arg ? arg.split('=')[1] : defaultValue;
  };

  switch (command) {
    case 'store': {
      const content = args[1];
      if (!content) {
        console.error('Error: Content is required');
        await printUsage();
        process.exit(1);
      }
      await storeMemory(content, {
        type: parseOption('type', 'episodic'),
        importance: parseFloat(parseOption('importance', '0.7')),
        session: parseOption('session', 'cli-session'),
      });
      break;
    }

    case 'search': {
      const query = args[1];
      if (!query) {
        console.error('Error: Query is required');
        await printUsage();
        process.exit(1);
      }
      await searchMemories(query, {
        topK: parseInt(parseOption('top-k', '5')),
        threshold: parseFloat(parseOption('threshold', '0.6')),
      });
      break;
    }

    case 'list': {
      await listMemories(parseInt(parseOption('limit', '10')));
      break;
    }

    case 'delete': {
      const id = parseInt(args[1]);
      if (isNaN(id)) {
        console.error('Error: Valid ID is required');
        await printUsage();
        process.exit(1);
      }
      await deleteMemory(id);
      break;
    }

    case 'clear': {
      await clearAllMemories();
      break;
    }

    case 'stats': {
      await showStats();
      break;
    }

    default:
      console.error(`Unknown command: ${command}`);
      await printUsage();
      process.exit(1);
  }
}

main().catch(console.error);

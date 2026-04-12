#!/usr/bin/env node
/* eslint-disable no-console -- CLI tool needs console output */
/**
 * Memory CLI - Command line interface for storing and retrieving memories
 *
 * Usage:
 *   node dist/memory-cli.ts store "memory content" [--type=episodic|semantic|reflection] [--importance=0.7]
 *   node dist/memory-cli.ts search "query" [--top-k=5]
 *   node memory-cli.ts list [--limit=10]
 *   node memory-cli.ts delete <id>
 */

import { MemoryManager } from './memory-manager-surreal.js';
import { getConfig } from './config.js';
import { ServiceFactory } from './service-factory.js';

async function printUsage() {
  console.log(`
Memory CLI - Store and retrieve memories with SurrealDB

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

Environment Variables:
  SURREALDB_URL         SurrealDB URL (default: http://localhost:8001)
  EMBEDDING_ENDPOINT    Embedding service URL (default: http://localhost:8000/v1/embeddings)
  EMBEDDING_MODEL       Embedding model (default: bge-m3-mlx-fp16)

  Cloud LLM (required):
  LLM_PROVIDER          Cloud provider: bailian | openai | deepseek | custom
  LLM_BASE_URL          Cloud API base URL
  LLM_API_KEY           Cloud API key
  LLM_MODEL             Cloud model name (default: qwen-plus)

Examples:
  memory-cli store "用户喜欢 TypeScript" --type=semantic --importance=0.8
  memory-cli search "编程语言偏好" --top-k=3
  memory-cli list --limit=5
`);
}

async function storeMemory(content: string, options: { type: string; importance: number; session: string }) {
  const config = getConfig();
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
    await mm.dispose();
    await ServiceFactory.dispose();
  }
}

async function searchMemories(query: string, options: { topK: number; threshold: number }) {
  const config = getConfig();
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
      console.log(`   Session: ${m.session_id ?? 'N/A'} | Created: ${m.created_at}`);
      console.log();
    });
  } catch (error) {
    console.error('Error searching memories:', error);
    process.exit(1);
  } finally {
    await mm.dispose();
    await ServiceFactory.dispose();
  }
}

async function listMemories(_limit: number) {
  const config = getConfig();
  const mm = new MemoryManager(config);
  await mm.initialize();

  try {
    const stats = await mm.getStats();
    console.log(`\nRecent memories (Total: ${stats.total_count})\n`);
    console.log('='.repeat(60));
    console.log(`Episodic: ${stats.episodic_count}`);
    console.log(`Semantic: ${stats.semantic_count}`);
    console.log(`Reflection: ${stats.reflection_count}`);
    console.log('\nNote: Use search command to find specific memories');
  } catch (error) {
    console.error('Error listing memories:', error);
    process.exit(1);
  } finally {
    await mm.dispose();
    await ServiceFactory.dispose();
  }
}

async function showStats() {
  const config = getConfig();
  const mm = new MemoryManager(config);
  await mm.initialize();

  try {
    const stats = await mm.getStats();

    console.log('\nSurrealDB Memory Stats\n');
    console.log('='.repeat(60));
    console.log(`Episodic memories: ${stats.episodic_count}`);
    console.log(`Semantic memories: ${stats.semantic_count}`);
    console.log(`Reflection memories: ${stats.reflection_count}`);
    console.log(`Total memories: ${stats.total_count}`);
    console.log();
  } catch (error) {
    console.error('Error getting stats:', error);
    process.exit(1);
  } finally {
    await mm.dispose();
    await ServiceFactory.dispose();
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
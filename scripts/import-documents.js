#!/usr/bin/env node
/**
 * Import documents from ~/.openclaw/documents into memory system
 *
 * Usage:
 *   npm run import:docs
 *   node scripts/import-documents.js
 */

import { DocumentParser } from '../dist/document-parser.js';
import { DocumentSplitter } from '../dist/document-splitter.js';
import { MemoryManager } from '../dist/memory-manager-surreal.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Try to load config from openclaw.json, fallback to defaults
function loadConfig() {
  const configPath = path.join(process.env.HOME, '.openclaw', 'openclaw.json');
  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    const pluginConfig = config?.plugins?.entries?.['openclaw-memory']?.config;

    if (pluginConfig) {
      return {
        backend: 'surrealdb',
        surrealdb: pluginConfig.surrealdb,
        embedding: pluginConfig.embedding,
        llm: pluginConfig.llm,
        documentImport: pluginConfig.documentImport
      };
    }
  } catch (e) {
    console.log('Note: Could not load openclaw.json, using default config');
  }

  // Default config
  return {
    backend: 'surrealdb',
    surrealdb: {
      url: 'ws://localhost:8000/rpc',
      namespace: 'openclaw',
      database: 'memory',
      username: 'root',
      password: 'root'
    },
    embedding: {
      endpoint: 'http://localhost:8080'
    },
    llm: {
      endpoint: 'http://localhost:8082'
    },
    documentImport: {
      chunkSize: 500,
      chunkOverlap: 50
    }
  };
}

async function importDocument(memoryManager, parser, splitter, filePath) {
  console.log(`\n=== Importing: ${filePath} ===`);

  try {
    // Parse document
    const parsed = await parser.parse(filePath);
    console.log(`Parsed ${parsed.metadata.type} file: ${parsed.content.length} chars`);

    // Split into chunks
    const chunks = splitter.split(parsed.content, filePath);
    console.log(`Split into ${chunks.length} chunks`);

    // Store each chunk
    let stored = 0;
    for (const chunk of chunks) {
      await memoryManager.storeSemantic(
        chunk.content,
        0.7,
        `doc:${filePath}`
      );
      stored++;
    }

    console.log(`[SUCCESS] Imported ${stored} chunks from ${path.basename(filePath)}`);
    return stored;
  } catch (error) {
    console.error(`[ERROR] Failed to import ${filePath}: ${error.message}`);
    return 0;
  }
}

async function main() {
  const CONFIG = loadConfig();
  const docsDir = path.join(process.env.HOME, '.openclaw', 'documents');
  const chunkSize = CONFIG.documentImport?.chunkSize || 500;
  const chunkOverlap = CONFIG.documentImport?.chunkOverlap || 50;

  console.log(`Scanning documents directory: ${docsDir}`);

  // Check if directory exists
  try {
    await fs.access(docsDir);
  } catch {
    console.error(`Documents directory does not exist: ${docsDir}`);
    console.error('Tip: mkdir -p ~/.openclaw/documents');
    process.exit(1);
  }

  // Get list of files
  const files = await fs.readdir(docsDir);
  const supportedFiles = files.filter(f =>
    f.toLowerCase().endsWith('.pdf') ||
    f.toLowerCase().endsWith('.docx') ||
    f.toLowerCase().endsWith('.md') ||
    f.toLowerCase().endsWith('.markdown')
  );

  console.log(`Found ${supportedFiles.length} supported files: ${supportedFiles.join(', ')}`);

  if (supportedFiles.length === 0) {
    console.log('No files to import');
    process.exit(0);
  }

  // Initialize memory manager
  console.log('\nInitializing memory manager...');
  const memoryManager = new MemoryManager(CONFIG);
  await memoryManager.initialize();
  console.log('Memory manager initialized');

  // Initialize parser and splitter
  const parser = new DocumentParser();
  const splitter = new DocumentSplitter(chunkSize, chunkOverlap);

  // Import each file
  let totalChunks = 0;
  let failedFiles = 0;
  for (const file of supportedFiles) {
    const filePath = path.join(docsDir, file);
    const chunks = await importDocument(memoryManager, parser, splitter, filePath);
    if (chunks > 0) {
      totalChunks += chunks;
    } else {
      failedFiles++;
    }
  }

  console.log(`\n=== Import Complete ===`);
  console.log(`Total chunks imported: ${totalChunks}`);
  if (failedFiles > 0) {
    console.log(`Failed files: ${failedFiles}`);
  }

  // Cleanup
  await memoryManager.dispose();
  console.log('Memory manager disposed');
}

main().catch(console.error);

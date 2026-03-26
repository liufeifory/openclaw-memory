/**
 * Import local SQLite memories to SurrealDB
 */
import { Surreal } from 'surrealdb';
import sqlite3 from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const MEMORY_DIR = '/Users/liufei/.openclaw/memory';
const SURREALDB_CONFIG = {
  url: 'ws://localhost:8000/rpc',
  namespace: 'openclaw',
  database: 'memory',
  username: 'root',
  password: 'root'
};

async function importMemories() {
  console.log('Connecting to SurrealDB...');
  const client = new Surreal();
  await client.connect(SURREALDB_CONFIG.url);
  await client.signin({
    username: SURREALDB_CONFIG.username,
    password: SURREALDB_CONFIG.password
  });
  await client.use({
    namespace: SURREALDB_CONFIG.namespace,
    database: SURREALDB_CONFIG.database
  });
  console.log('Connected to SurrealDB');

  // Get list of SQLite files
  const files = fs.readdirSync(MEMORY_DIR).filter(f => f.endsWith('.sqlite'));
  console.log(`Found ${files.length} SQLite memory files: ${files.join(', ')}`);

  let totalImported = 0;
  let totalChunks = 0;

  for (const file of files) {
    const agentId = file.replace('.sqlite', '');
    const dbPath = path.join(MEMORY_DIR, file);

    console.log(`\nProcessing ${agentId}...`);

    try {
      const db = sqlite3(dbPath, { readonly: true });

      // Get all chunks
      const chunks = db.prepare('SELECT text, source, path, start_line, end_line FROM chunks').all();

      if (chunks.length === 0) {
        console.log(`  No chunks found in ${agentId}`);
        continue;
      }

      console.log(`  Found ${chunks.length} chunks`);
      totalChunks += chunks.length;

      // Import each chunk as a semantic memory
      for (const chunk of chunks) {
        try {
          // Check if memory already exists (by content hash)
          const contentHash = Buffer.from(chunk.text).toString('base64').substring(0, 32);

          await client.create('memory', {
            type: 'semantic',
            content: chunk.text,
            source: chunk.source,
            path: chunk.path,
            start_line: chunk.start_line,
            end_line: chunk.end_line,
            agent_id: agentId,
            content_hash: contentHash,
            created_at: new Date().toISOString()
          });

          totalImported++;

          if (totalImported % 100 === 0) {
            console.log(`  Imported ${totalImported} memories...`);
          }
        } catch (err) {
          // Skip duplicates
          if (err.message.includes('duplicate')) {
            continue;
          }
          console.error(`  Error importing chunk: ${err.message}`);
        }
      }

      db.close();
      console.log(`  Completed ${agentId}: imported ${chunks.length} memories`);

    } catch (err) {
      console.error(`Error processing ${agentId}: ${err.message}`);
    }
  }

  console.log(`\n=== Import Complete ===`);
  console.log(`Total chunks found: ${totalChunks}`);
  console.log(`Total memories imported: ${totalImported}`);

  // Verify import
  const result = await client.query('SELECT count() as total FROM memory GROUP ALL;');
  console.log(`Total memories in SurrealDB: ${JSON.stringify(result)}`);

  await client.close();
}

importMemories().catch(console.error);

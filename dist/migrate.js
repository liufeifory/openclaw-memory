#!/usr/bin/env node
/**
 * Migrate data from PostgreSQL (pgvector) to Qdrant
 *
 * Usage:
 *   npm run migrate
 */
import pg from 'pg';
import { QdrantDatabase } from './qdrant-client.js';
import { EmbeddingService } from './embedding.js';
const PG_CONFIG = {
    host: process.env.MEMORY_DB_HOST || 'localhost',
    port: parseInt(process.env.MEMORY_DB_PORT || '5432'),
    database: process.env.MEMORY_DB_NAME || 'openclaw_memory',
    user: process.env.MEMORY_DB_USER || 'liufei',
    password: process.env.MEMORY_DB_PASS || '',
};
const QDRANT_CONFIG = {
    url: 'http://localhost:6333',
};
const EMBEDDING_ENDPOINT = 'http://localhost:8080';
async function migrate() {
    console.log('=== pgvector → Qdrant Migration ===\n');
    // Connect to PostgreSQL
    const pgClient = new pg.Client(PG_CONFIG);
    await pgClient.connect();
    console.log('✓ Connected to PostgreSQL');
    // Initialize Qdrant
    const qdrant = new QdrantDatabase(QDRANT_CONFIG);
    await qdrant.initialize();
    console.log('✓ Connected to Qdrant');
    // Initialize embedding service (for re-generating embeddings if needed)
    const embedding = new EmbeddingService(EMBEDDING_ENDPOINT);
    let migrated = 0;
    let failed = 0;
    // Migrate episodic memories
    console.log('\n--- Migrating episodic memories ---');
    try {
        const episodic = await pgClient.query(`
      SELECT m.id, m.session_id, m.content, m.importance, m.access_count, m.created_at,
             e.embedding
      FROM episodic_memory m
      LEFT JOIN memory_embeddings e ON m.id = e.memory_id AND e.memory_type = 'episodic'
    `);
        for (const row of episodic.rows) {
            try {
                let embeddingVec = row.embedding;
                // If no embedding, generate it
                if (!embeddingVec) {
                    console.log(`  Regenerating embedding for memory ${row.id}`);
                    embeddingVec = await embedding.embed(row.content);
                }
                else {
                    // Convert PostgreSQL vector format to array
                    embeddingVec = embeddingVec
                        .replace('[', '')
                        .replace(']', '')
                        .split(',')
                        .map(Number);
                }
                await qdrant.upsert(row.id, embeddingVec, {
                    type: 'episodic',
                    session_id: row.session_id,
                    content: row.content,
                    importance: row.importance,
                    access_count: row.access_count,
                    created_at: row.created_at?.toISOString() || new Date().toISOString(),
                });
                migrated++;
                process.stdout.write(`\r  Migrated: ${migrated}`);
            }
            catch (err) {
                console.error(`\n  ✗ Failed to migrate memory ${row.id}: ${err.message}`);
                failed++;
            }
        }
    }
    catch (err) {
        console.error('Error migrating episodic memories:', err.message);
    }
    // Migrate semantic memories
    console.log('\n\n--- Migrating semantic memories ---');
    try {
        const semantic = await pgClient.query(`
      SELECT m.id, m.content, m.importance, m.access_count, m.created_at,
             e.embedding
      FROM semantic_memory m
      LEFT JOIN memory_embeddings e ON m.id = e.memory_id AND e.memory_type = 'semantic'
    `);
        for (const row of semantic.rows) {
            try {
                let embeddingVec = row.embedding;
                if (!embeddingVec) {
                    console.log(`  Regenerating embedding for memory ${row.id}`);
                    embeddingVec = await embedding.embed(row.content);
                }
                else {
                    embeddingVec = embeddingVec
                        .replace('[', '')
                        .replace(']', '')
                        .split(',')
                        .map(Number);
                }
                await qdrant.upsert(row.id, embeddingVec, {
                    type: 'semantic',
                    content: row.content,
                    importance: row.importance,
                    access_count: row.access_count,
                    created_at: row.created_at?.toISOString() || new Date().toISOString(),
                });
                migrated++;
                process.stdout.write(`\r  Migrated: ${migrated}`);
            }
            catch (err) {
                console.error(`\n  ✗ Failed to migrate memory ${row.id}: ${err.message}`);
                failed++;
            }
        }
    }
    catch (err) {
        console.error('Error migrating semantic memories:', err.message);
    }
    // Migrate reflection memories
    console.log('\n\n--- Migrating reflection memories ---');
    try {
        const reflection = await pgClient.query(`
      SELECT id, summary, importance, created_at
      FROM reflection_memory
    `);
        for (const row of reflection.rows) {
            try {
                const embeddingVec = await embedding.embed(row.summary);
                await qdrant.upsert(row.id, embeddingVec, {
                    type: 'reflection',
                    summary: row.summary,
                    importance: row.importance,
                    access_count: 0,
                    created_at: row.created_at?.toISOString() || new Date().toISOString(),
                });
                migrated++;
                process.stdout.write(`\r  Migrated: ${migrated}`);
            }
            catch (err) {
                console.error(`\n  ✗ Failed to migrate memory ${row.id}: ${err.message}`);
                failed++;
            }
        }
    }
    catch (err) {
        console.error('Error migrating reflection memories:', err.message);
    }
    // Close connections
    await pgClient.end();
    console.log('\n');
    console.log('✓ Disconnected from PostgreSQL');
    // Stats
    const stats = await qdrant.getStats();
    console.log('\n=== Migration Summary ===');
    console.log(`Total migrated: ${migrated}`);
    console.log(`Failed: ${failed}`);
    console.log(`Qdrant total points: ${stats.total_points}`);
    console.log('\n✓ Migration complete!');
    if (failed > 0) {
        process.exit(1);
    }
}
migrate().catch(console.error);
//# sourceMappingURL=migrate.js.map
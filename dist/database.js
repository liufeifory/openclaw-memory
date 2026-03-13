/**
 * Database connection and query handling for PostgreSQL with pgvector.
 */
import pg from 'pg';
const { Pool } = pg;
export class Database {
    pool;
    constructor(config) {
        this.pool = new Pool({
            host: config.host,
            port: config.port,
            database: config.database,
            user: config.user,
            password: config.password,
            max: 20, // Maximum number of clients in the pool
            idleTimeoutMillis: 30000,
            connectionTimeoutMillis: 2000,
        });
        this.pool.on('error', (err) => {
            console.error('Unexpected database pool error:', err);
        });
    }
    async query(sql, params) {
        const client = await this.pool.connect();
        try {
            const result = await client.query(sql, params);
            return result.rows;
        }
        finally {
            client.release();
        }
    }
    async execute(sql, params) {
        const client = await this.pool.connect();
        try {
            await client.query(sql, params);
        }
        finally {
            client.release();
        }
    }
    async close() {
        await this.pool.end();
    }
}
//# sourceMappingURL=database.js.map
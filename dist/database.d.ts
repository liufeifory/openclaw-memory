/**
 * Database connection and query handling for PostgreSQL with pgvector.
 */
export interface DatabaseConfig {
    host: string;
    port: number;
    database: string;
    user: string;
    password: string;
}
export declare class Database {
    private pool;
    constructor(config: DatabaseConfig);
    query<T = any>(sql: string, params?: any[]): Promise<T[]>;
    execute(sql: string, params?: any[]): Promise<void>;
    close(): Promise<void>;
}
//# sourceMappingURL=database.d.ts.map
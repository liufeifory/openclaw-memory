/**
 * OpenClaw Memory Plugin - Native Node.js Implementation
 *
 * Supports PostgreSQL (pgvector), Qdrant, and SurrealDB backends.
 *
 * Features:
 * - Semantic retrieval via vector search
 * - Importance-based ranking
 * - Episodic, semantic, and reflection memories
 * - Message queue + background worker for decoupled storage
 */
interface PgConfig {
    backend?: 'pgvector';
    database: {
        host: string;
        port: number;
        database: string;
        user: string;
        password: string;
    };
    embedding?: {
        endpoint: string;
    };
}
interface QdrantConfig {
    backend: 'qdrant';
    qdrant: {
        url: string;
        port?: number;
        apiKey?: string;
    };
    embedding?: {
        endpoint: string;
    };
}
interface SurrealConfig {
    backend: 'surrealdb';
    surrealdb: {
        url: string;
        namespace: string;
        database: string;
        username: string;
        password: string;
    };
    embedding?: {
        endpoint: string;
    };
}
type MemoryPluginConfig = PgConfig | QdrantConfig | SurrealConfig;
declare const memoryPlugin: {
    id: string;
    name: string;
    description: string;
    kind: string;
    init(config: MemoryPluginConfig): Promise<void>;
    register(api: any): void;
};
export default memoryPlugin;
//# sourceMappingURL=index.d.ts.map
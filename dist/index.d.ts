/**
 * OpenClaw Memory Plugin - Native Node.js Implementation
 *
 * Supports both PostgreSQL (pgvector) and Qdrant backends.
 *
 * Features:
 * - Semantic retrieval via vector search
 * - Importance-based ranking
 * - Episodic, semantic, and reflection memories
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
type MemoryPluginConfig = PgConfig | QdrantConfig;
declare const memoryPlugin: {
    id: string;
    name: string;
    description: string;
    kind: string;
    init(config: MemoryPluginConfig): Promise<void>;
    register(api: any): void;
    shutdown(): Promise<void>;
};
export default memoryPlugin;
//# sourceMappingURL=index.d.ts.map
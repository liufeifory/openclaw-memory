/**
 * OpenClaw Memory Plugin - Native Node.js Implementation
 *
 * Backend: SurrealDB with vector search capabilities.
 *
 * Features:
 * - Semantic retrieval via vector search
 * - Importance-based ranking
 * - Episodic, semantic, and reflection memories
 * - Message queue + background worker for decoupled storage
 */
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
    documentImport?: {
        watchDir?: string;
        chunkSize?: number;
        chunkOverlap?: number;
    };
}
type MemoryPluginConfig = SurrealConfig;
declare const memoryPlugin: {
    id: string;
    name: string;
    description: string;
    kind: string;
    init(config: MemoryPluginConfig): Promise<void>;
    register(api: any): Promise<void>;
    /**
     * Dispose plugin - clean up background workers and close database connections.
     * Called when OpenClaw shuts down or when commands complete.
     */
    dispose(): Promise<void>;
};
export default memoryPlugin;
//# sourceMappingURL=index.d.ts.map
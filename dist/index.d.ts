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
}
type MemoryPluginConfig = SurrealConfig;
declare const memoryPlugin: {
    id: string;
    name: string;
    description: string;
    kind: string;
    init(config: MemoryPluginConfig): Promise<void>;
    register(api: any): Promise<void>;
};
export default memoryPlugin;
//# sourceMappingURL=index.d.ts.map
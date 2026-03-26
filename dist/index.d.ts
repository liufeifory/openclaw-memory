/**
 * OpenClaw Memory Plugin - New SDK Format
 *
 * Backend: SurrealDB with vector search capabilities.
 *
 * Features:
 * - Semantic retrieval via vector search
 * - Importance-based ranking
 * - Episodic, semantic, and reflection memories
 * - Message queue + background worker for decoupled storage
 */
interface PluginEntry {
    id: string;
    name: string;
    description: string;
    kind?: string;
    init?: (config: any) => Promise<void>;
    register: (api: any) => void | Promise<void>;
    dispose?: () => Promise<void>;
}
declare const _default: PluginEntry;
export default _default;
//# sourceMappingURL=index.d.ts.map
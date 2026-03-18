/**
 * LRU Cache for entity aliases
 * User feedback: M4 cold start optimization - cache frequently used aliases
 */
export declare class AliasCache {
    private cache;
    private maxSize;
    constructor(maxSize?: number);
    /**
     * Get entity ID for an alias
     */
    get(alias: string): string | null;
    /**
     * Set alias -> entity mapping
     */
    set(alias: string, entityId: string): void;
    /**
     * Check if alias exists in cache
     */
    has(alias: string): boolean;
    /**
     * Remove an alias from cache
     */
    delete(alias: string): boolean;
    /**
     * Clear entire cache
     */
    clear(): void;
    /**
     * Get cache size
     */
    get size(): number;
    /**
     * Evict least recently used entry
     */
    private evictLRU;
    /**
     * Batch load aliases from DB (startup warmup)
     * User feedback: M4 cold start optimization - load ALL aliases at startup
     */
    warmup(db: any, loadAll?: boolean): Promise<void>;
    /**
     * Extract result from SurrealDB query response
     */
    private extractResult;
    /**
     * Extract string ID from various formats
     */
    private extractStringId;
    /**
     * Get cache statistics
     */
    getStats(): {
        size: number;
        maxSize: number;
        hitRate?: number;
    };
}
//# sourceMappingURL=alias-cache.d.ts.map
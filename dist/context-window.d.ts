/**
 * Context Window Extractor
 *
 * Extracts context windows around entity mentions for LLM relation classification.
 * Reduces token consumption by only including relevant text snippets.
 */
export interface ContextWindowOptions {
    /** Window size in characters before and after entity (default: 100) */
    windowSize?: number;
    /** Maximum number of snippets to return (default: 3) */
    maxSnippets?: number;
    /** Merge overlapping windows (default: true) */
    mergeOverlapping?: boolean;
}
/**
 * Memory item for diverse sampling
 */
export interface MemorySnippet {
    id?: number;
    content: string;
    created_at?: string;
    document_id?: string;
}
/**
 * Extract context windows around entity mentions
 *
 * @param content - Full memory content
 * @param entities - Entity names to find context for
 * @param options - Configuration options
 * @returns Array of context snippets (merged if overlapping)
 */
export declare function extractContextWindow(content: string, entities: string[], options?: ContextWindowOptions): string[];
/**
 * Join context snippets with a separator for LLM prompt
 *
 * @param snippets - Context snippets from extractContextWindow
 * @param separator - Separator string (default: ' | ')
 * @returns Joined string
 */
export declare function joinContextSnippets(snippets: string[], separator?: string): string;
/**
 * Diverse sampling of memory snippets
 * Ensures variety by:
 * 1. Prioritizing different documents (by document_id)
 * 2. Using "head, middle, tail" sampling if documents are insufficient
 *
 * @param memories - Array of memory snippets (should be pre-sorted by created_at)
 * @param targetCount - Target number of samples (default: 3)
 * @returns Diverse subset of memories
 */
export declare function diverseSample<T extends MemorySnippet>(memories: T[], targetCount?: number): T[];
//# sourceMappingURL=context-window.d.ts.map
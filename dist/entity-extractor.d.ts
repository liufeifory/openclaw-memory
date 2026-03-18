/**
 * Entity Extractor - Three-Layer Funnel Strategy
 *
 * Architecture:
 * Layer 1: Static Cache / Regex (zero cost, ~60% coverage)
 *   ↓
 * Layer 1.5: Mini-Batch Buffer (batch processing, 90% scheduling overhead reduction)
 *   ↓
 * Layer 2: 1B Model Pre-Filter (very low cost, ~30% coverage)
 *   ↓
 * Layer 3: 7B Model Refine (high cost, ~10% coverage)
 *
 * Features:
 * - Alias normalization (Postgres → PostgreSQL, TS → TypeScript)
 * - Mini-batch buffer for LLM calls
 * - Known entity cache (loaded from database periodically)
 * - Layer stats tracking for optimization
 */
/**
 * Extracted entity structure
 */
export interface ExtractedEntity {
    name: string;
    confidence: number;
    source?: 'regex' | 'cache' | '1b' | '8b';
    originalText?: string;
}
/**
 * Layer statistics for tracking hit rates
 */
export interface LayerStats {
    layer1Hits: number;
    layer1Total: number;
    layer2Hits: number;
    layer2Total: number;
    layer3Hits: number;
    layer3Total: number;
    totalEntities: number;
}
/**
 * Alias normalization rules
 * Maps common aliases to canonical names
 */
export declare const ALIAS_RULES: Record<string, string>;
/**
 * Entity Extractor with three-layer funnel strategy
 */
export declare class EntityExtractor {
    private endpoint1B;
    private endpoint7B;
    private limiter1B;
    private limiter7B;
    private knownEntities;
    private buffer;
    private stats;
    private readonly bufferFlushInterval;
    private readonly minBatchSize;
    constructor(endpoint1B?: string, endpoint7B?: string);
    /**
     * Start periodic buffer flush
     */
    private startPeriodicFlush;
    /**
     * Add known entities to the cache (loaded from database periodically)
     */
    addKnownEntities(entities: Array<{
        name: string;
        confidence: number;
    }>): void;
    /**
     * Get known entity cache size
     */
    getKnownCacheSize(): number;
    /**
     * Get layer statistics
     */
    getLayerStats(): LayerStats;
    /**
     * Get buffer statistics
     */
    getBufferStats(): {
        size: number;
        oldest?: number;
    };
    /**
     * Normalize text using alias rules
     */
    normalizeText(text: string): string;
    /**
     * Layer 1: Static regex matching against known patterns
     * Zero-cost, high-coverage extraction
     */
    layer1_RegexMatch(text: string): ExtractedEntity[];
    /**
     * Add item to mini-batch buffer for Layer 2 processing
     */
    addToBuffer(text: string, confidence: number): void;
    /**
     * Flush mini-batch buffer through Layer 2 (1B model)
     */
    flushBuffer(): Promise<void>;
    /**
     * Layer 2: 1B Model Pre-Filter
     * Low-cost filtering to eliminate obvious non-entities
     * Returns boolean array indicating which texts should proceed to Layer 3
     */
    layer2_1BFilter(texts: string[]): Promise<boolean[]>;
    /**
     * Build batch filter prompt for 1B model
     */
    private buildBatchFilterPrompt;
    /**
     * Parse batch filter response
     */
    private parseBatchFilterResponse;
    /**
     * Layer 3: 7B Model Refine
     * High-quality entity extraction with proper noun detection
     */
    layer3_7BRefine(text: string): Promise<ExtractedEntity[]>;
    /**
     * Build refine prompt for 8B model
     */
    private buildRefinePrompt;
    /**
     * Parse refine response from 8B model
     */
    private parseRefineResponse;
    /**
     * Fallback entity extraction from plain text response
     */
    private extractEntitiesFromPlain;
    /**
     * Check if word is a stop word (should not be extracted as entity)
     */
    private isStopWord;
    /**
     * Main extraction method - three-layer funnel
     * 1. First check Layer 1 (regex) - fast path
     * 2. Add remaining text to buffer for Layer 2 (1B model)
     * 3. For high-confidence items, use Layer 3 (8B model)
     */
    extract(text: string): Promise<ExtractedEntity[]>;
    /**
     * Batch extract with mini-batch buffering
     */
    batchExtract(texts: string[], useBuffer?: boolean): Promise<ExtractedEntity[][]>;
    /**
     * Clear known entity cache
     */
    clearKnownCache(): void;
    /**
     * Get all statistics including buffer and cache info
     */
    getFullStats(): LayerStats & {
        knownCacheSize: number;
        bufferSize: number;
    };
    /**
     * Public method to call 7B LLM endpoint directly
     * Used by EntityIndexer for relation classification
     *
     * @param prompt - The prompt to send to the 7B model
     * @param timeout - Timeout in milliseconds (default: 10000)
     * @returns Parsed JSON response from the model
     */
    call7B(prompt: string, timeout?: number): Promise<any>;
}
//# sourceMappingURL=entity-extractor.d.ts.map
/**
 * Entity Extractor - Two-Layer Architecture
 *
 * Architecture:
 * Layer 1: Static Cache / Regex (zero cost, ~60% coverage)
 *   ↓
 * Layer 2: 7B Model Refine (high quality, ~40% coverage)
 *
 * Features:
 * - Alias normalization (Postgres → PostgreSQL, TS → TypeScript)
 * - Known entity cache (loaded from database periodically)
 * - Layer stats tracking for optimization
 */
import { LLMClient } from './llm-client.js';
/**
 * Extracted entity structure
 */
export interface ExtractedEntity {
    name: string;
    entity_type?: string;
    confidence: number;
    source?: 'regex' | 'cache' | '7b';
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
    totalEntities: number;
}
/**
 * Alias normalization rules
 * Maps common aliases to canonical names
 */
export declare const ALIAS_RULES: Record<string, string>;
/**
 * Entity Extractor with two-layer architecture
 */
export declare class EntityExtractor {
    private client;
    private limiter7B;
    private knownEntities;
    private stats;
    constructor(client: LLMClient);
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
     * Normalize text using alias rules
     */
    normalizeText(text: string): string;
    /**
     * Layer 1: Static regex matching against known patterns
     * Zero-cost, high-coverage extraction
     */
    layer1_RegexMatch(text: string): ExtractedEntity[];
    /**
     * Layer 2: 7B Model Refine
     * High-quality entity extraction with proper noun detection
     */
    layer2_7BRefine(text: string): Promise<ExtractedEntity[]>;
    /**
     * Build refine prompt for 7B model
     */
    private buildRefinePrompt;
    /**
     * Parse refine response from 7B model
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
     * Main extraction method - two-layer architecture
     * 1. First check Layer 1 (regex) - fast path
     * 2. If not found, use Layer 2 (7B model) for deep extraction
     */
    extract(text: string): Promise<ExtractedEntity[]>;
    /**
     * Batch extract - direct extraction without buffering
     */
    batchExtract(texts: string[], useBuffer?: boolean): Promise<ExtractedEntity[][]>;
    /**
     * Clear known entity cache
     */
    clearKnownCache(): void;
    /**
     * Get all statistics including cache info
     */
    getFullStats(): LayerStats & {
        knownCacheSize: number;
    };
    /**
     * Dispose - clear resources
     */
    dispose(): void;
    /**
     * Delegate completeJson to internal LLM client
     * Used by EntityIndexer for relation classification
     */
    completeJson<T>(prompt: string, taskType: string, options?: any): Promise<T>;
}
//# sourceMappingURL=entity-extractor.d.ts.map
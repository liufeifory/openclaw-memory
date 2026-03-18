/**
 * Document Splitter - splits documents into semantically coherent chunks.
 *
 * Segmentation strategy (in priority order):
 * 1. Paragraph boundaries - preserve document structure
 * 2. Sentence boundaries - avoid cutting sentences
 * 3. Semantic similarity - group related sentences together
 */
export interface DocumentChunk {
    content: string;
    index: number;
    totalChunks: number;
    metadata: {
        source: string;
        chunkType: 'paragraph' | 'sentence' | 'semantic';
    };
}
export interface SemanticSplitterOptions {
    chunkSize: number;
    chunkOverlap: number;
    minChunkSize: number;
    maxChunkSize: number;
}
export declare class DocumentSplitter {
    private options;
    constructor(chunkSize?: number, chunkOverlap?: number);
    /**
     * Split content into semantically coherent chunks.
     * Uses a hierarchical approach:
     * 1. Split by paragraphs (preserves document structure)
     * 2. Group paragraphs by semantic similarity
     * 3. Split oversized chunks at sentence boundaries
     */
    split(content: string, source: string): DocumentChunk[];
    /**
     * Extract paragraphs from content.
     * Handles various line ending styles and removes empty paragraphs.
     */
    private extractParagraphs;
    /**
     * Group paragraphs by semantic similarity.
     * Uses simple heuristics: topic sentences, repeated keywords, and proximity.
     */
    private groupBySemantics;
    /**
     * Detect if there's a topic shift between two paragraphs.
     * Uses keyword overlap and structural cues.
     */
    private detectTopicShift;
    /**
     * Extract important keywords from text.
     */
    private extractKeywords;
    /**
     * Calculate overlap ratio between two sets.
     */
    private calculateOverlap;
    /**
     * Split text at sentence boundaries.
     */
    private splitBySentences;
    /**
     * Split an oversized chunk that couldn't be handled by normal splitting.
     */
    private splitOversizedChunk;
    /**
     * Merge adjacent small chunks to avoid fragmentation.
     */
    private mergeSmallChunks;
    private createChunk;
}
//# sourceMappingURL=document-splitter.d.ts.map
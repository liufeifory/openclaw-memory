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

export class DocumentSplitter {
  private options: SemanticSplitterOptions;

  constructor(
    chunkSize: number = 500,
    chunkOverlap: number = 50,
  ) {
    this.options = {
      chunkSize,
      chunkOverlap,
      minChunkSize: Math.floor(chunkSize * 0.3),  // Minimum 30% of target
      maxChunkSize: Math.floor(chunkSize * 1.5),  // Maximum 150% of target
    };
  }

  /**
   * Split content into semantically coherent chunks.
   * Uses a hierarchical approach:
   * 1. Split by paragraphs (preserves document structure)
   * 2. Group paragraphs by semantic similarity
   * 3. Split oversized chunks at sentence boundaries
   */
  split(content: string, source: string): DocumentChunk[] {
    // Step 1: Split into paragraphs
    const paragraphs = this.extractParagraphs(content);

    // Step 2: Group paragraphs into semantic chunks
    const semanticGroups = this.groupBySemantics(paragraphs);

    // Step 3: Process each group (split if too large, merge if too small)
    const chunks: DocumentChunk[] = [];

    for (const group of semanticGroups) {
      const groupText = group.join('\n\n');

      if (groupText.length > this.options.maxChunkSize) {
        // Split large group at sentence boundaries
        const splitChunks = this.splitBySentences(groupText, source);
        chunks.push(...splitChunks);
      } else {
        // Keep group as one chunk
        chunks.push(this.createChunk(groupText.trim(), chunks.length, source, 'semantic'));
      }
    }

    // Step 4: Merge small adjacent chunks
    const mergedChunks = this.mergeSmallChunks(chunks, source);

    // Step 5: Handle any remaining oversized chunks
    const finalChunks: DocumentChunk[] = [];
    for (const chunk of mergedChunks) {
      if (chunk.content.length > this.options.maxChunkSize * 1.2) {
        finalChunks.push(...this.splitOversizedChunk(chunk.content, source));
      } else {
        finalChunks.push(chunk);
      }
    }

    // Update indices
    finalChunks.forEach((c, i) => {
      c.index = i;
      c.totalChunks = finalChunks.length;
    });

    return finalChunks;
  }

  /**
   * Extract paragraphs from content.
   * Handles various line ending styles and removes empty paragraphs.
   */
  private extractParagraphs(content: string): string[] {
    return content
      .split(/\n\n+/)
      .map(p => p.trim())
      .filter(p => p.length > 0);
  }

  /**
   * Group paragraphs by semantic similarity.
   * Uses simple heuristics: topic sentences, repeated keywords, and proximity.
   */
  private groupBySemantics(paragraphs: string[]): string[][] {
    if (paragraphs.length === 0) return [];

    const groups: string[][] = [[paragraphs[0]]];
    let currentGroupSize = paragraphs[0].length;

    for (let i = 1; i < paragraphs.length; i++) {
      const paragraph = paragraphs[i];
      const prevParagraph = paragraphs[i - 1];

      // Check if we should start a new group
      const shouldStartNewGroup =
        currentGroupSize + paragraph.length > this.options.maxChunkSize ||
        this.detectTopicShift(prevParagraph, paragraph);

      if (shouldStartNewGroup) {
        groups.push([paragraph]);
        currentGroupSize = paragraph.length;
      } else {
        groups[groups.length - 1].push(paragraph);
        currentGroupSize += paragraph.length;
      }
    }

    return groups;
  }

  /**
   * Detect if there's a topic shift between two paragraphs.
   * Uses keyword overlap and structural cues.
   */
  private detectTopicShift(prev: string, curr: string): boolean {
    // Extract keywords from each paragraph
    const prevKeywords = this.extractKeywords(prev);
    const currKeywords = this.extractKeywords(curr);

    // Calculate keyword overlap
    const overlap = this.calculateOverlap(prevKeywords, currKeywords);

    // Low overlap suggests topic shift
    return overlap < 0.2;
  }

  /**
   * Extract important keywords from text.
   */
  private extractKeywords(text: string): Set<string> {
    // Remove common words and extract significant terms
    const stopWords = new Set([
      'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
      'of', 'with', 'by', 'from', 'is', 'are', 'was', 'were', 'be', 'been',
      'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
      'could', 'should', 'may', 'might', 'must', 'shall', 'can', 'need',
      'it', 'its', 'this', 'that', 'these', 'those', 'i', 'you', 'he', 'she',
      'we', 'they', 'what', 'which', 'who', 'whom', 'whose', 'where', 'when',
      'why', 'how', 'all', 'each', 'every', 'both', 'few', 'more', 'most',
      'other', 'some', 'such', 'no', 'not', 'only', 'same', 'so', 'than',
      'too', 'very', 'just', 'also', 'now', 'here', 'there', 'then', 'once'
    ]);

    const words = text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 3 && !stopWords.has(w));

    return new Set(words.slice(0, 20)); // Take top 20 unique words
  }

  /**
   * Calculate overlap ratio between two sets.
   */
  private calculateOverlap(set1: Set<string>, set2: Set<string>): number {
    if (set1.size === 0 || set2.size === 0) return 0;

    let intersection = 0;
    for (const item of set1) {
      if (set2.has(item)) intersection++;
    }

    return intersection / Math.max(set1.size, set2.size);
  }

  /**
   * Split text at sentence boundaries.
   */
  private splitBySentences(text: string, source: string): DocumentChunk[] {
    // Split on sentence boundaries (., !, ? followed by space or end)
    const sentences = text
      .split(/(?<=[.!?])\s+|\n+/)
      .map(s => s.trim())
      .filter(s => s.length > 0);

    const chunks: DocumentChunk[] = [];
    let currentChunk = '';

    for (const sentence of sentences) {
      if (currentChunk.length + sentence.length > this.options.chunkSize) {
        if (currentChunk.length >= this.options.minChunkSize) {
          chunks.push(this.createChunk(currentChunk.trim(), chunks.length, source, 'sentence'));
        }
        currentChunk = sentence;
      } else {
        currentChunk = (currentChunk ? ' ' : '') + sentence;
      }
    }

    if (currentChunk.trim()) {
      chunks.push(this.createChunk(currentChunk.trim(), chunks.length, source, 'sentence'));
    }

    return chunks;
  }

  /**
   * Split an oversized chunk that couldn't be handled by normal splitting.
   */
  private splitOversizedChunk(content: string, source: string): DocumentChunk[] {
    // Try to split at paragraph boundaries first
    const paragraphs = content.split(/\n\n+/).filter(p => p.trim().length > 0);

    if (paragraphs.length > 1) {
      // Split into multiple chunks at paragraph boundaries
      const chunks: DocumentChunk[] = [];
      let currentChunk = '';

      for (const paragraph of paragraphs) {
        if (currentChunk.length + paragraph.length > this.options.chunkSize) {
          if (currentChunk.trim()) {
            chunks.push(this.createChunk(currentChunk.trim(), chunks.length, source, 'paragraph'));
          }
          currentChunk = paragraph;
        } else {
          currentChunk += '\n\n' + paragraph;
        }
      }

      if (currentChunk.trim()) {
        chunks.push(this.createChunk(currentChunk.trim(), chunks.length, source, 'paragraph'));
      }

      return chunks;
    }

    // Fall back to sentence-based splitting
    return this.splitBySentences(content, source);
  }

  /**
   * Merge adjacent small chunks to avoid fragmentation.
   */
  private mergeSmallChunks(chunks: DocumentChunk[], source: string): DocumentChunk[] {
    if (chunks.length <= 1) return chunks;

    const merged: DocumentChunk[] = [];
    let currentChunk = chunks[0];

    for (let i = 1; i < chunks.length; i++) {
      const nextChunk = chunks[i];

      // Merge if combined size is reasonable and both are small
      const combinedSize = currentChunk.content.length + nextChunk.content.length;

      if (combinedSize <= this.options.chunkSize &&
          currentChunk.content.length < this.options.minChunkSize) {
        // Merge
        currentChunk = {
          ...currentChunk,
          content: currentChunk.content + '\n\n' + nextChunk.content,
        };
      } else {
        // Keep separate
        merged.push(currentChunk);
        currentChunk = nextChunk;
      }
    }

    merged.push(currentChunk);
    return merged;
  }

  private createChunk(
    content: string,
    index: number,
    source: string,
    chunkType: 'paragraph' | 'sentence' | 'semantic' = 'paragraph'
  ): DocumentChunk {
    return {
      content,
      index,
      totalChunks: -1, // Will be set later
      metadata: {
        source,
        chunkType,
      },
    };
  }
}

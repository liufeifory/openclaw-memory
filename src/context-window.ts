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
export function extractContextWindow(
  content: string,
  entities: string[],
  options: ContextWindowOptions = {}
): string[] {
  const {
    windowSize = 100,
    maxSnippets = 3,
    mergeOverlapping = true
  } = options;

  const snippets: Array<{ start: number; end: number; text: string }> = [];

  for (const entity of entities) {
    // Case-insensitive search
    const lowerContent = content.toLowerCase();
    const lowerEntity = entity.toLowerCase();

    let startIndex = 0;
    while (true) {
      const index = lowerContent.indexOf(lowerEntity, startIndex);
      if (index === -1) break;

      // Calculate window boundaries
      const windowStart = Math.max(0, index - windowSize);
      const windowEnd = Math.min(content.length, index + entity.length + windowSize);

      // Extract and trim the window
      const windowText = content.substring(windowStart, windowEnd).trim();

      snippets.push({
        start: windowStart,
        end: windowEnd,
        text: windowText
      });

      startIndex = index + 1;
    }
  }

  if (snippets.length === 0) {
    // Return truncated content if no entities found
    return [content.substring(0, windowSize * 2)];
  }

  // Sort by start position
  snippets.sort((a, b) => a.start - b.start);

  // Merge overlapping windows if enabled
  if (mergeOverlapping) {
    const merged: Array<{ start: number; end: number; text: string }> = [];

    for (const snippet of snippets) {
      if (merged.length === 0) {
        merged.push(snippet);
      } else {
        const last = merged[merged.length - 1];
        // Check for overlap or adjacency
        if (snippet.start <= last.end) {
          // Merge: extend the last window
          if (snippet.end > last.end) {
            last.end = snippet.end;
            last.text = content.substring(last.start, last.end).trim();
          }
        } else {
          merged.push(snippet);
        }
      }
    }

    // Return merged texts, limited to maxSnippets
    return merged.slice(0, maxSnippets).map(s => s.text);
  }

  // Return unique snippets, limited to maxSnippets
  const uniqueSnippets = snippets.filter(
    (s, i, arr) => i === 0 || s.start !== arr[i - 1].start
  );

  return uniqueSnippets.slice(0, maxSnippets).map(s => s.text);
}

/**
 * Join context snippets with a separator for LLM prompt
 *
 * @param snippets - Context snippets from extractContextWindow
 * @param separator - Separator string (default: ' | ')
 * @returns Joined string
 */
export function joinContextSnippets(snippets: string[], separator: string = ' | '): string {
  return snippets.join(separator);
}

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
export function diverseSample<T extends MemorySnippet>(
  memories: T[],
  targetCount: number = 3
): T[] {
  if (memories.length <= targetCount) {
    return memories;
  }

  // Strategy 1: Deduplicate by document_id, prefer memories from different documents
  const byDocument = new Map<string, T>();
  for (const mem of memories) {
    const docId = mem.document_id || `unknown_${mem.id || memories.indexOf(mem)}`;
    if (!byDocument.has(docId)) {
      byDocument.set(docId, mem);
    }
  }

  if (byDocument.size >= targetCount) {
    // Have enough different documents, return them
    return Array.from(byDocument.values()).slice(0, targetCount);
  }

  // Strategy 2: If not enough documents, use "head, middle, tail" sampling
  const result: T[] = [];
  const step = Math.floor(memories.length / targetCount);

  for (let i = 0; i < targetCount; i++) {
    const index = Math.min(i * step, memories.length - 1);
    result.push(memories[index]);
  }

  return result;
}

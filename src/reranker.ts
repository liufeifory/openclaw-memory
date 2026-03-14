/**
 * Reranker using Llama-3.2-1B-Instruct
 *
 * Reranks vector search results based on query relevance.
 */

import { LLMLimiter } from './llm-limiter.js';

const RERANK_PROMPT = `Rank these memory snippets by relevance to the query.
Output ONLY the indices in order (0-based), most relevant first.

Query: {{query}}

Memories:
{{memories}}

Ranking (indices only, e.g., "2 0 1"): `;

export interface RerankResult {
  id: number;
  content: string;
  score: number;  // New reranked score
  type: string;
  // Original MemoryWithSimilarity fields for compatibility
  similarity?: number;
  importance?: number;
  created_at?: Date;
  access_count?: number;
}

export interface RerankInput {
  id: number;
  content: string;
  type: string;
  score?: number;  // Optional for compatibility
  similarity?: number;
  importance?: number;
  created_at?: Date;
  access_count?: number;
}

export class Reranker {
  private endpoint: string;
  private limiter: LLMLimiter;

  constructor(endpoint: string = 'http://localhost:8081', limiter?: LLMLimiter) {
    this.endpoint = endpoint;
    this.limiter = limiter ?? new LLMLimiter({ maxConcurrent: 2, minInterval: 100 });
  }

  /**
   * Rerank search results by relevance.
   * @param query - The search query
   * @param results - Array of search results with id, content, score
   * @returns Reranked results with new relevance scores
   */
  async rerank(
    query: string,
    results: RerankInput[]
  ): Promise<RerankResult[]> {
    if (results.length <= 1) {
      return results.map(r => ({ ...r, score: r.similarity ?? r.score ?? 0.5 }));
    }

    // Take top 10 for reranking (1B model context limit)
    const topResults = results.slice(0, 10);

    const memoriesText = topResults
      .map((r, i) => `[${i}] [${r.type}] ${r.content.substring(0, 100)}`)
      .join('\n');

    const prompt = RERANK_PROMPT
      .replace('{{query}}', query)
      .replace('{{memories}}', memoriesText);

    try {
      const result = await this.limiter.execute(async () => {
        const response = await fetch(`${this.endpoint}/completion`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: prompt,
            n_predict: 50,
            temperature: 0.1,
            top_p: 0.9,
          }),
        });
        return await response.json();
      }) as any;

      const output = (result.content || result.generated_text || '').trim();

      const rankedIndices = this.parseRanking(output, topResults.length);

      // Assign new scores based on rank
      return rankedIndices.map((originalIndex, rank) => {
        const original = topResults[originalIndex];
        return {
          id: original.id,
          content: original.content,
          score: 1.0 - (rank * 0.1),  // Rank 0 = 1.0, Rank 1 = 0.9, etc.
          type: original.type,
          similarity: original.similarity ?? original.score ?? 0.5,
          importance: original.importance,
          created_at: original.created_at,
          access_count: original.access_count,
        };
      });
    } catch (error: any) {
      console.error('[Reranker] LLM failed, using original scores:', error.message);
      // Return original results with original scores
      return topResults.map(r => ({
        ...r,
        score: r.similarity ?? r.score ?? 0.5,
      }));
    }
  }

  /**
   * Parse ranking indices from LLM output.
   */
  private parseRanking(output: string, maxItems: number): number[] {
    // Extract numbers from output
    const numbers = output.match(/\d+/g);
    if (numbers) {
      const indices = numbers
        .map(n => parseInt(n, 10))
        .filter(n => n >= 0 && n < maxItems);

      // Remove duplicates while preserving order
      const unique = [...new Set(indices)];

      // Add missing indices
      for (let i = 0; i < maxItems; i++) {
        if (!unique.includes(i)) {
          unique.push(i);
        }
      }

      return unique;
    }

    // Default: return original order
    return Array.from({ length: maxItems }, (_, i) => i);
  }
}

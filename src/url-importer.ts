/**
 * URL Importer - imports content from URLs.
 */

import { logInfo, logError } from './maintenance-logger.js';
import { DocumentParser } from './document-parser.js';
import { DocumentSplitter } from './document-splitter.js';
import type { MemoryManager } from './memory-manager-surreal.js';

export class UrlImporter {
  constructor(
    private parser: DocumentParser,
    private splitter: DocumentSplitter,
    private memoryManager: MemoryManager,
  ) {}

  /**
   * Import content from a URL.
   * @param url - The URL to import
   * @param sessionId - Optional session ID for grouping (defaults to url:${url})
   * @returns Number of chunks imported
   */
  async import(url: string, sessionId?: string): Promise<number> {
    logInfo(`[UrlImporter] Importing ${url}`);

    try {
      // Parse URL
      const parsed = await this.parser.parseUrl(url);

      // Split into chunks
      const chunks = this.splitter.split(parsed.content, url);

      // Store each chunk
      const effectiveSessionId = sessionId || `url:${url}`;
      for (const chunk of chunks) {
        await this.memoryManager.storeSemantic(chunk.content, 0.7, effectiveSessionId);
      }

      logInfo(`[UrlImporter] Imported ${url}: ${chunks.length} chunks`);
      return chunks.length;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logError(`[UrlImporter] Failed to import ${url}: ${errorMessage}`);
      throw error;
    }
  }
}

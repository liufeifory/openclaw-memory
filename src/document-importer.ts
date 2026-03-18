/**
 * Document Importer - Unified entry point for document import functionality.
 */

export { DocumentParser, type ParsedDocument } from './document-parser.js';
export { DocumentSplitter, type DocumentChunk } from './document-splitter.js';
export { DocumentWatcher } from './document-watcher.js';
export { UrlImporter } from './url-importer.js';

import { DocumentParser } from './document-parser.js';
import { DocumentSplitter } from './document-splitter.js';
import { DocumentWatcher } from './document-watcher.js';
import { UrlImporter } from './url-importer.js';
import type { MemoryManager } from './memory-manager-surreal.js';

export interface DocumentImporterConfig {
  watchDir?: string;
  chunkSize?: number;
  chunkOverlap?: number;
}

export function createDocumentImporter(
  memoryManager: MemoryManager,
  config?: DocumentImporterConfig,
): { watcher?: DocumentWatcher; urlImporter: UrlImporter } {
  const parser = new DocumentParser();
  const splitter = new DocumentSplitter(
    config?.chunkSize || 500,
    config?.chunkOverlap || 50,
  );

  const result: any = {
    urlImporter: new UrlImporter(parser, splitter, memoryManager),
  };

  if (config?.watchDir) {
    result.watcher = new DocumentWatcher(
      config.watchDir,
      parser,
      splitter,
      memoryManager,
    );
  }

  return result;
}

/**
 * Document Importer - Unified entry point for document import functionality.
 */
export { DocumentParser, type ParsedDocument } from './document-parser.js';
export { DocumentSplitter, type DocumentChunk } from './document-splitter.js';
export { DocumentWatcher } from './document-watcher.js';
export { UrlImporter } from './url-importer.js';
import { DocumentWatcher } from './document-watcher.js';
import { UrlImporter } from './url-importer.js';
import type { MemoryManager } from './memory-manager-surreal.js';
export interface DocumentImporterConfig {
    watchDir?: string;
    chunkSize?: number;
    chunkOverlap?: number;
}
export declare function createDocumentImporter(memoryManager: MemoryManager, config?: DocumentImporterConfig): {
    watcher?: DocumentWatcher;
    urlImporter: UrlImporter;
};
//# sourceMappingURL=document-importer.d.ts.map
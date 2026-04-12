/* eslint-disable @typescript-eslint/no-explicit-any -- Database query returns have flexible SurrealDB formats */
/**
 * Document Importer - Unified entry point for document import functionality.
 */
export { DocumentParser } from './document-parser.js';
export { DocumentSplitter } from './document-splitter.js';
export { DocumentWatcher } from './document-watcher.js';
export { UrlImporter } from './url-importer.js';
import { DocumentParser } from './document-parser.js';
import { DocumentSplitter } from './document-splitter.js';
import { DocumentWatcher } from './document-watcher.js';
import { UrlImporter } from './url-importer.js';
export function createDocumentImporter(memoryManager, config) {
    const parser = new DocumentParser();
    const splitter = new DocumentSplitter(config?.chunkSize || 500, config?.chunkOverlap || 50);
    const result = {
        urlImporter: new UrlImporter(parser, splitter, memoryManager),
    };
    if (config?.watchDir) {
        result.watcher = new DocumentWatcher(config.watchDir, parser, splitter, memoryManager);
    }
    return result;
}
//# sourceMappingURL=document-importer.js.map
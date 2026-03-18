/**
 * URL Importer - imports content from URLs.
 */
import { DocumentParser } from './document-parser.js';
import { DocumentSplitter } from './document-splitter.js';
import type { MemoryManager } from './memory-manager-surreal.js';
export declare class UrlImporter {
    private parser;
    private splitter;
    private memoryManager;
    constructor(parser: DocumentParser, splitter: DocumentSplitter, memoryManager: MemoryManager);
    /**
     * Import content from a URL.
     * @param url - The URL to import
     * @param sessionId - Optional session ID for grouping (defaults to url:${url})
     * @returns Number of chunks imported
     */
    import(url: string, sessionId?: string): Promise<number>;
}
//# sourceMappingURL=url-importer.d.ts.map
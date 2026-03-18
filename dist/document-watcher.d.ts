/**
 * Document Watcher - monitors a directory for new documents and auto-imports them.
 */
import { DocumentParser } from './document-parser.js';
import { DocumentSplitter } from './document-splitter.js';
import type { MemoryManager } from './memory-manager-surreal.js';
export declare class DocumentWatcher {
    private watchDir;
    private parser;
    private splitter;
    private memoryManager;
    private watcher;
    private processedFiles;
    private supportedExtensions;
    constructor(watchDir: string, parser: DocumentParser, splitter: DocumentSplitter, memoryManager: MemoryManager);
    /**
     * Start watching the directory.
     */
    start(): void;
    /**
     * Stop watching.
     */
    stop(): void;
    private isSupportedFile;
    private handleNewFile;
    private handleFileChange;
    private handleFileDeleted;
    private processFile;
}
//# sourceMappingURL=document-watcher.d.ts.map
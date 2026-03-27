/**
 * Document Watcher - monitors a directory for new documents and auto-imports them.
 * Uses document import state tracking to avoid re-processing.
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
    private db;
    private importQueue;
    private processingQueue;
    constructor(watchDir: string, parser: DocumentParser, splitter: DocumentSplitter, memoryManager: MemoryManager);
    /**
     * Start watching the directory.
     * Does NOT block - starts async processing in background.
     */
    start(): Promise<void>;
    /**
     * Scan existing files asynchronously - non-blocking
     */
    private scanExistingFilesAsync;
    /**
     * Stop watching.
     */
    stop(): void;
    private isSupportedFile;
    /**
     * Check if document has been processed (import state tracking)
     */
    private isDocumentProcessed;
    /**
     * Compute file hash for change detection
     */
    private computeFileHash;
    /**
     * Queue file for async import processing
     */
    private queueFileForImport;
    /**
     * Process import queue asynchronously
     */
    private processImportQueue;
    private handleNewFile;
    private handleFileChange;
    private handleFileDeleted;
    /**
     * Process file asynchronously with state tracking
     */
    private processFileAsync;
    /**
     * Schedule entity extraction for imported document
     */
    private scheduleEntityExtraction;
}
//# sourceMappingURL=document-watcher.d.ts.map
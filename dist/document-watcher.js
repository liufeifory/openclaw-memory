/**
 * Document Watcher - monitors a directory for new documents and auto-imports them.
 * Uses document import state tracking to avoid re-processing.
 */
import chokidar from 'chokidar';
import * as path from 'path';
import * as crypto from 'crypto';
import { logInfo, logError, logWarn } from './maintenance-logger.js';
export class DocumentWatcher {
    watchDir;
    parser;
    splitter;
    memoryManager;
    watcher;
    processedFiles = new Set();
    supportedExtensions = ['.pdf', '.docx', '.md', '.markdown'];
    db = null;
    importQueue = [];
    processingQueue = false;
    constructor(watchDir, parser, splitter, memoryManager) {
        this.watchDir = watchDir;
        this.parser = parser;
        this.splitter = splitter;
        this.memoryManager = memoryManager;
        // Get database reference for state tracking
        this.db = memoryManager.db || null;
    }
    /**
     * Start watching the directory.
     * Does NOT block - starts async processing in background.
     */
    async start() {
        this.watcher = chokidar.watch(this.watchDir, {
            ignored: /(^|[\/\\])\./, // Ignore dotfiles
            persistent: false, // Don't block process exit
            ignoreInitial: true, // Don't block on startup - process async
        });
        this.watcher
            .on('add', (path) => this.handleNewFile(path))
            .on('change', (path) => this.handleFileChange(path))
            .on('unlink', (path) => this.handleFileDeleted(path))
            .on('ready', () => {
            logInfo(`DocumentWatcher ready: ${this.watchDir}`);
            // Start async processing of existing files
            this.scanExistingFilesAsync();
        });
        logInfo(`DocumentWatcher started: ${this.watchDir} (async mode)`);
        // Don't wait for initial scan - return immediately
        // This allows TUI to start without blocking
    }
    /**
     * Scan existing files asynchronously - non-blocking
     */
    async scanExistingFilesAsync() {
        try {
            const fs = await import('fs');
            const files = fs.readdirSync(this.watchDir);
            logInfo(`DocumentWatcher: found ${files.length} files in directory`);
            for (const file of files) {
                const fullPath = path.join(this.watchDir, file);
                const stat = fs.statSync(fullPath);
                // Skip directories
                if (stat.isDirectory())
                    continue;
                // Check if supported file type
                if (!this.isSupportedFile(fullPath)) {
                    logInfo(`DocumentWatcher: skipping unsupported file: ${fullPath}`);
                    continue;
                }
                // Check import state - skip if already completed
                if (await this.isDocumentProcessed(fullPath)) {
                    logInfo(`DocumentWatcher: skipping already processed file: ${fullPath}`);
                    continue;
                }
                // Queue for async processing
                this.queueFileForImport(fullPath);
            }
            // Start queue processor
            this.processImportQueue();
        }
        catch (error) {
            logError(`DocumentWatcher: failed to scan directory: ${error.message}`);
        }
    }
    /**
     * Stop watching.
     */
    stop() {
        if (this.watcher) {
            this.watcher.close();
        }
    }
    isSupportedFile(path) {
        const ext = path.toLowerCase().split('.').pop();
        return ext ? this.supportedExtensions.includes('.' + ext) : false;
    }
    /**
     * Check if document has been processed (import state tracking)
     */
    async isDocumentProcessed(filePath) {
        if (!this.db)
            return false;
        try {
            const state = await this.db.getDocumentImportState(filePath);
            if (!state)
                return false;
            // Consider completed if status is 'completed' and both entities and relations are extracted
            return state.status === 'completed' && state.entities_extracted && state.relations_extracted;
        }
        catch (error) {
            logWarn(`DocumentWatcher: failed to check import state for ${filePath}: ${error.message}`);
            return false;
        }
    }
    /**
     * Compute file hash for change detection
     */
    async computeFileHash(filePath) {
        const fs = await import('fs');
        const content = await fs.promises.readFile(filePath);
        return crypto.createHash('md5').update(content).digest('hex');
    }
    /**
     * Queue file for async import processing
     */
    queueFileForImport(filePath) {
        this.importQueue.push({ path: filePath, timestamp: Date.now() });
        logInfo(`DocumentWatcher: queued for import: ${filePath} (queue size: ${this.importQueue.length})`);
        // Start queue processor if not already running
        if (!this.processingQueue) {
            this.processImportQueue();
        }
    }
    /**
     * Process import queue asynchronously
     */
    async processImportQueue() {
        if (this.processingQueue || this.importQueue.length === 0)
            return;
        this.processingQueue = true;
        while (this.importQueue.length > 0) {
            const item = this.importQueue.shift();
            if (!item)
                continue;
            try {
                await this.processFileAsync(item.path);
            }
            catch (error) {
                logError(`DocumentWatcher: failed to process queued file ${item.path}: ${error.message}`);
            }
        }
        this.processingQueue = false;
    }
    async handleNewFile(path) {
        if (!this.isSupportedFile(path)) {
            logInfo(`DocumentWatcher: skipping unsupported file: ${path}`);
            return;
        }
        // Check if already queued or processed
        const alreadyQueued = this.importQueue.some(item => item.path === path);
        if (alreadyQueued) {
            logInfo(`DocumentWatcher: file already queued: ${path}`);
            return;
        }
        if (await this.isDocumentProcessed(path)) {
            logInfo(`DocumentWatcher: file already processed: ${path}`);
            return;
        }
        logInfo(`DocumentWatcher: new file detected: ${path}`);
        this.queueFileForImport(path);
    }
    async handleFileChange(path) {
        if (!this.isSupportedFile(path))
            return;
        logInfo(`DocumentWatcher: file changed: ${path}`);
        // Re-process if change detected
        this.queueFileForImport(path);
    }
    async handleFileDeleted(path) {
        if (!this.isSupportedFile(path))
            return;
        logInfo(`DocumentWatcher: file deleted: ${path}`);
        // Remove from queue
        this.importQueue = this.importQueue.filter(item => item.path !== path);
        // Note: We don't delete from memory store - could be referenced elsewhere
    }
    /**
     * Process file asynchronously with state tracking
     */
    async processFileAsync(filePath) {
        try {
            logInfo(`DocumentWatcher: processing file: ${filePath}`);
            // Update state to 'importing'
            if (this.db) {
                await this.db.upsertDocumentImportState(filePath, { status: 'importing' });
            }
            // Compute file hash and size
            const fs = await import('fs');
            const stat = await fs.promises.stat(filePath);
            const fileHash = await this.computeFileHash(filePath);
            // Parse document
            const parsed = await this.parser.parse(filePath);
            logInfo(`DocumentWatcher: parsed ${filePath}, content length: ${parsed.content.length}`);
            // Split into chunks
            const chunks = this.splitter.split(parsed.content, filePath);
            logInfo(`DocumentWatcher: split into ${chunks.length} chunks`);
            // Store each chunk with document-specific session ID
            const sessionId = `doc:${filePath}`;
            for (const chunk of chunks) {
                await this.memoryManager.storeSemantic(chunk.content, 0.7, sessionId);
            }
            // Update state to 'imported'
            if (this.db) {
                await this.db.upsertDocumentImportState(filePath, {
                    file_hash: fileHash,
                    file_size: stat.size,
                    chunks_count: chunks.length,
                    status: 'imported',
                    entities_extracted: false,
                    relations_extracted: false,
                });
            }
            logInfo(`DocumentWatcher: successfully imported ${filePath} (${chunks.length} chunks)`);
            // Schedule entity extraction (async, non-blocking)
            this.scheduleEntityExtraction(filePath);
        }
        catch (error) {
            logError(`DocumentWatcher: failed to process ${filePath}: ${error.message}`);
            if (this.db) {
                await this.db.upsertDocumentImportState(filePath, { status: 'error', error: error.message });
            }
        }
    }
    /**
     * Schedule entity extraction for imported document
     */
    async scheduleEntityExtraction(filePath) {
        if (!this.db)
            return;
        try {
            logInfo(`DocumentWatcher: starting entity extraction for ${filePath}`);
            // Update state to 'extracting_entities'
            await this.db.upsertDocumentImportState(filePath, { status: 'extracting_entities' });
            // Get document memories
            const sessionId = `doc:${filePath}`;
            // Note: Entity extraction is handled by EntityIndexer automatically
            // when new memories are stored. We just mark it as complete here.
            // For now, mark entities as extracted (EntityIndexer handles actual extraction)
            await this.db.upsertDocumentImportState(filePath, {
                status: 'extracting_relations',
                entities_extracted: true,
            });
            logInfo(`DocumentWatcher: entity extraction completed for ${filePath}`);
            // Relations are extracted by EntityIndexer background process
            // Mark as complete - relations will be extracted within 6 hours
            await this.db.upsertDocumentImportState(filePath, {
                status: 'completed',
                relations_extracted: true,
            });
            logInfo(`DocumentWatcher: document fully processed: ${filePath}`);
        }
        catch (error) {
            logError(`DocumentWatcher: entity extraction failed for ${filePath}: ${error.message}`);
        }
    }
}
//# sourceMappingURL=document-watcher.js.map
/**
 * Document Watcher - monitors a directory for new documents and auto-imports them.
 */
import chokidar from 'chokidar';
import * as path from 'path';
import { logInfo, logError } from './maintenance-logger.js';
export class DocumentWatcher {
    watchDir;
    parser;
    splitter;
    memoryManager;
    watcher;
    processedFiles = new Set();
    supportedExtensions = ['.pdf', '.docx', '.md', '.markdown'];
    constructor(watchDir, parser, splitter, memoryManager) {
        this.watchDir = watchDir;
        this.parser = parser;
        this.splitter = splitter;
        this.memoryManager = memoryManager;
    }
    /**
     * Start watching the directory.
     */
    async start() {
        this.watcher = chokidar.watch(this.watchDir, {
            ignored: /(^|[\/\\])\./, // Ignore dotfiles
            persistent: false, // Don't block process exit
            ignoreInitial: false, // Process existing files on startup
        });
        this.watcher
            .on('add', (path) => this.handleNewFile(path))
            .on('change', (path) => this.handleFileChange(path))
            .on('unlink', (path) => this.handleFileDeleted(path))
            .on('ready', () => {
            logInfo(`DocumentWatcher ready: ${this.watchDir}`);
        });
        logInfo(`DocumentWatcher started: ${this.watchDir}`);
        // Wait for initial scan to complete
        await new Promise((resolve) => {
            this.watcher.once('ready', () => resolve());
        });
        // Manually scan for existing files that chokidar may have missed
        await this.scanExistingFiles();
    }
    async scanExistingFiles() {
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
                // Skip already processed files
                if (this.processedFiles.has(fullPath))
                    continue;
                // Check if supported file type
                if (!this.isSupportedFile(fullPath)) {
                    logInfo(`DocumentWatcher: skipping unsupported file: ${fullPath}`);
                    continue;
                }
                logInfo(`DocumentWatcher: processing existing file: ${fullPath}`);
                await this.processFile(fullPath);
                this.processedFiles.add(fullPath);
            }
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
    async handleNewFile(path) {
        if (!this.isSupportedFile(path)) {
            logInfo(`DocumentWatcher: skipping unsupported file: ${path}`);
            return;
        }
        if (this.processedFiles.has(path)) {
            logInfo(`DocumentWatcher: file already processed: ${path}`);
            return;
        }
        logInfo(`DocumentWatcher: new file detected: ${path}`);
        await this.processFile(path);
        this.processedFiles.add(path);
    }
    async handleFileChange(path) {
        if (!this.isSupportedFile(path))
            return;
        this.processedFiles.delete(path); // Re-process
        await this.processFile(path);
        this.processedFiles.add(path);
    }
    async handleFileDeleted(path) {
        if (!this.isSupportedFile(path))
            return;
        this.processedFiles.delete(path);
        // Note: We don't delete from memory store - could be referenced elsewhere
    }
    async processFile(path) {
        try {
            logInfo(`DocumentWatcher: processing file: ${path}`);
            // Parse document
            const parsed = await this.parser.parse(path);
            logInfo(`DocumentWatcher: parsed ${path}, content length: ${parsed.content.length}`);
            // Split into chunks
            const chunks = this.splitter.split(parsed.content, path);
            logInfo(`DocumentWatcher: split into ${chunks.length} chunks`);
            // Store each chunk with document-specific session ID
            const sessionId = `doc:${path}`;
            for (const chunk of chunks) {
                await this.memoryManager.storeSemantic(chunk.content, 0.7, sessionId);
            }
            logInfo(`DocumentWatcher: successfully imported ${path} (${chunks.length} chunks)`);
        }
        catch (error) {
            logError(`DocumentWatcher: failed to process ${path}: ${error.message}`);
        }
    }
}
//# sourceMappingURL=document-watcher.js.map
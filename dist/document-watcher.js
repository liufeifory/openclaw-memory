/**
 * Document Watcher - monitors a directory for new documents and auto-imports them.
 */
import chokidar from 'chokidar';
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
    start() {
        this.watcher = chokidar.watch(this.watchDir, {
            ignored: /(^|[\/\\])\./, // Ignore dotfiles
            persistent: true,
            ignoreInitial: true,
        });
        this.watcher
            .on('add', (path) => this.handleNewFile(path))
            .on('change', (path) => this.handleFileChange(path))
            .on('unlink', (path) => this.handleFileDeleted(path));
        console.log(`[DocumentWatcher] Watching ${this.watchDir}`);
    }
    /**
     * Stop watching.
     */
    stop() {
        if (this.watcher) {
            this.watcher.close();
            console.log('[DocumentWatcher] Stopped watching');
        }
    }
    isSupportedFile(path) {
        const ext = path.toLowerCase().split('.').pop();
        return ext ? this.supportedExtensions.includes('.' + ext) : false;
    }
    async handleNewFile(path) {
        if (!this.isSupportedFile(path))
            return;
        if (this.processedFiles.has(path))
            return;
        console.log(`[DocumentWatcher] New file: ${path}`);
        await this.processFile(path);
        this.processedFiles.add(path);
    }
    async handleFileChange(path) {
        if (!this.isSupportedFile(path))
            return;
        console.log(`[DocumentWatcher] File changed: ${path}`);
        this.processedFiles.delete(path); // Re-process
        await this.processFile(path);
        this.processedFiles.add(path);
    }
    async handleFileDeleted(path) {
        if (!this.isSupportedFile(path))
            return;
        console.log(`[DocumentWatcher] File deleted: ${path}`);
        this.processedFiles.delete(path);
        // Note: We don't delete from memory store - could be referenced elsewhere
    }
    async processFile(path) {
        try {
            // Parse document
            const parsed = await this.parser.parse(path);
            // Split into chunks
            const chunks = this.splitter.split(parsed.content, path);
            // Store each chunk with document-specific session ID
            const sessionId = `doc:${path}`;
            for (const chunk of chunks) {
                await this.memoryManager.storeSemantic(chunk.content, 0.7, sessionId);
            }
            console.log(`[DocumentWatcher] Processed ${path}: ${chunks.length} chunks`);
        }
        catch (error) {
            console.error(`[DocumentWatcher] Failed to process ${path}:`, error.message);
        }
    }
}
//# sourceMappingURL=document-watcher.js.map
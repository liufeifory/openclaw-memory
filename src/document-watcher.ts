/**
 * Document Watcher - monitors a directory for new documents and auto-imports them.
 */

import chokidar from 'chokidar';
import { DocumentParser } from './document-parser.js';
import { DocumentSplitter } from './document-splitter.js';
import type { MemoryManager } from './memory-manager-surreal.js';

export class DocumentWatcher {
  private watcher: any;
  private processedFiles = new Set<string>();
  private supportedExtensions = ['.pdf', '.docx', '.md', '.markdown'];

  constructor(
    private watchDir: string,
    private parser: DocumentParser,
    private splitter: DocumentSplitter,
    private memoryManager: MemoryManager,
  ) {}

  /**
   * Start watching the directory.
   */
  start(): void {
    this.watcher = chokidar.watch(this.watchDir, {
      ignored: /(^|[\/\\])\./, // Ignore dotfiles
      persistent: true,
      ignoreInitial: true,
    });

    this.watcher
      .on('add', (path: string) => this.handleNewFile(path))
      .on('change', (path: string) => this.handleFileChange(path))
      .on('unlink', (path: string) => this.handleFileDeleted(path));

    console.log(`[DocumentWatcher] Watching ${this.watchDir}`);
  }

  /**
   * Stop watching.
   */
  stop(): void {
    if (this.watcher) {
      this.watcher.close();
      console.log('[DocumentWatcher] Stopped watching');
    }
  }

  private isSupportedFile(path: string): boolean {
    const ext = path.toLowerCase().split('.').pop();
    return ext ? this.supportedExtensions.includes('.' + ext) : false;
  }

  private async handleNewFile(path: string): Promise<void> {
    if (!this.isSupportedFile(path)) return;
    if (this.processedFiles.has(path)) return;

    console.log(`[DocumentWatcher] New file: ${path}`);
    await this.processFile(path);
    this.processedFiles.add(path);
  }

  private async handleFileChange(path: string): Promise<void> {
    if (!this.isSupportedFile(path)) return;

    console.log(`[DocumentWatcher] File changed: ${path}`);
    this.processedFiles.delete(path); // Re-process
    await this.processFile(path);
    this.processedFiles.add(path);
  }

  private async handleFileDeleted(path: string): Promise<void> {
    if (!this.isSupportedFile(path)) return;

    console.log(`[DocumentWatcher] File deleted: ${path}`);
    this.processedFiles.delete(path);
    // Note: We don't delete from memory store - could be referenced elsewhere
  }

  private async processFile(path: string): Promise<void> {
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
    } catch (error: any) {
      console.error(`[DocumentWatcher] Failed to process ${path}:`, error.message);
    }
  }
}

/**
 * URL Importer - imports content from URLs.
 */
import { logInfo, logError } from './maintenance-logger.js';
export class UrlImporter {
    parser;
    splitter;
    memoryManager;
    constructor(parser, splitter, memoryManager) {
        this.parser = parser;
        this.splitter = splitter;
        this.memoryManager = memoryManager;
    }
    /**
     * Import content from a URL.
     * @param url - The URL to import
     * @param sessionId - Optional session ID for grouping (defaults to url:${url})
     * @returns Number of chunks imported
     */
    async import(url, sessionId) {
        logInfo(`[UrlImporter] Importing ${url}`);
        try {
            // Parse URL
            const parsed = await this.parser.parseUrl(url);
            // Split into chunks
            const chunks = this.splitter.split(parsed.content, url);
            // Store each chunk
            const effectiveSessionId = sessionId || `url:${url}`;
            for (const chunk of chunks) {
                await this.memoryManager.storeSemantic(chunk.content, 0.7, effectiveSessionId);
            }
            logInfo(`[UrlImporter] Imported ${url}: ${chunks.length} chunks`);
            return chunks.length;
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            logError(`[UrlImporter] Failed to import ${url}: ${errorMessage}`);
            throw error;
        }
    }
}
//# sourceMappingURL=url-importer.js.map
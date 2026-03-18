/**
 * URL Importer - imports content from URLs.
 */
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
        console.log(`[UrlImporter] Importing ${url}`);
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
            console.log(`[UrlImporter] Imported ${url}: ${chunks.length} chunks`);
            return chunks.length;
        }
        catch (error) {
            console.error(`[UrlImporter] Failed to import ${url}:`, error.message);
            throw error;
        }
    }
}
//# sourceMappingURL=url-importer.js.map
/**
 * Document Parser - extracts text content from PDF, Word, Markdown, and HTML.
 */
export interface ParsedDocument {
    content: string;
    metadata: {
        source: string;
        type: 'pdf' | 'word' | 'markdown' | 'html';
        path?: string;
        url?: string;
    };
}
export declare class DocumentParser {
    /**
     * Parse a document from a local file path.
     * Auto-detects file type based on extension.
     */
    parse(filePath: string): Promise<ParsedDocument>;
    /**
     * Parse content from a URL (HTML to text).
     */
    parseUrl(url: string): Promise<ParsedDocument>;
    /**
     * Parse PDF file using pdf-parse.
     */
    private parsePdf;
    /**
     * Parse Word document using mammoth.
     */
    private parseWord;
    /**
     * Parse Markdown file (plain text read).
     */
    private parseMarkdown;
    /**
     * Simple HTML to text conversion (strip tags).
     */
    private htmlToText;
}
//# sourceMappingURL=document-parser.d.ts.map
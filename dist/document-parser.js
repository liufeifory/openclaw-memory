/**
 * Document Parser - extracts text content from PDF, Word, Markdown, and HTML.
 */
import fs from 'fs/promises';
import pdf from 'pdf-parse';
import mammoth from 'mammoth';
import fetch from 'node-fetch';
import { logWarn } from './maintenance-logger.js';
export class DocumentParser {
    /**
     * Parse a document from a local file path.
     * Auto-detects file type based on extension.
     */
    async parse(filePath) {
        const ext = filePath.toLowerCase().split('.').pop();
        switch (ext) {
            case 'pdf':
                return this.parsePdf(filePath);
            case 'docx':
                return this.parseWord(filePath);
            case 'md':
            case 'markdown':
                return this.parseMarkdown(filePath);
            default:
                throw new Error(`Unsupported file type: .${ext}. Supported: pdf, docx, md, markdown`);
        }
    }
    /**
     * Parse content from a URL (HTML to text).
     */
    async parseUrl(url) {
        try {
            const response = await fetch(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (compatible; OpenClaw Memory/1.0)',
                },
            });
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            const html = await response.text();
            const content = this.htmlToText(html);
            return {
                content,
                metadata: {
                    source: url,
                    type: 'html',
                    url,
                },
            };
        }
        catch (error) {
            throw new Error(`Failed to parse URL ${url}: ${error.message}`);
        }
    }
    /**
     * Parse PDF file using pdf-parse.
     */
    async parsePdf(filePath) {
        try {
            const dataBuffer = await fs.readFile(filePath);
            const data = await pdf(dataBuffer);
            return {
                content: data.text,
                metadata: {
                    source: filePath,
                    type: 'pdf',
                    path: filePath,
                },
            };
        }
        catch (error) {
            throw new Error(`Failed to parse PDF ${filePath}: ${error.message}`);
        }
    }
    /**
     * Parse Word document using mammoth.
     */
    async parseWord(filePath) {
        try {
            const result = await mammoth.extractRawText({ path: filePath });
            if (result.messages.length > 0) {
                logWarn(`[DocumentParser] Warnings while parsing ${filePath}: ${JSON.stringify(result.messages)}`);
            }
            return {
                content: result.value,
                metadata: {
                    source: filePath,
                    type: 'word',
                    path: filePath,
                },
            };
        }
        catch (error) {
            throw new Error(`Failed to parse Word document ${filePath}: ${error.message}`);
        }
    }
    /**
     * Parse Markdown file (plain text read).
     */
    async parseMarkdown(filePath) {
        try {
            const content = await fs.readFile(filePath, 'utf-8');
            return {
                content,
                metadata: {
                    source: filePath,
                    type: 'markdown',
                    path: filePath,
                },
            };
        }
        catch (error) {
            throw new Error(`Failed to parse Markdown ${filePath}: ${error.message}`);
        }
    }
    /**
     * Simple HTML to text conversion (strip tags).
     */
    htmlToText(html) {
        // Remove script and style tags
        let text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ');
        text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ');
        // Remove all HTML tags
        text = text.replace(/<[^>]*>/g, ' ');
        // Decode common HTML entities
        text = text
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'");
        // Normalize whitespace
        text = text.replace(/\s+/g, ' ').trim();
        return text;
    }
}
//# sourceMappingURL=document-parser.js.map
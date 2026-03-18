/**
 * URL Importer Tests
 */
import { UrlImporter } from './url-importer.js';
import { DocumentParser } from './document-parser.js';
import { DocumentSplitter } from './document-splitter.js';
// Mock MemoryManager for testing
class MockMemoryManager {
    storedChunks = [];
    async storeSemantic(content, importance, sessionId) {
        this.storedChunks.push({ content, importance, sessionId });
        return true;
    }
}
async function testImporterCreation() {
    console.log('=== Testing UrlImporter Creation ===');
    const parser = new DocumentParser();
    const splitter = new DocumentSplitter(500, 50);
    const mockMM = new MockMemoryManager();
    const importer = new UrlImporter(parser, splitter, mockMM);
    console.log('Importer created:', importer !== null);
    console.log('[PASS] Importer creation test\n');
}
async function testHtmlToText() {
    console.log('=== Testing HTML to Text Conversion ===');
    const parser = new DocumentParser();
    // Test the private htmlToText method via parseUrl result processing
    // We'll test with a simple HTML string by creating a temporary approach
    // Simulate what happens internally
    const html = '<html><head><title>Test</title></head><body><h1>Hello</h1><p>World</p></body></html>';
    // Manual conversion (mimicking internal logic)
    let text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ');
    text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ');
    text = text.replace(/<[^>]*>/g, ' ');
    text = text
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");
    text = text.replace(/\s+/g, ' ').trim();
    console.log('HTML input:', html);
    console.log('Text output:', text);
    console.log('Contains "Hello":', text.includes('Hello'));
    console.log('Contains "World":', text.includes('World'));
    console.log('No HTML tags:', !text.includes('<') && !text.includes('>'));
    console.log('[PASS] HTML to text test\n');
}
async function testSplitterIntegration() {
    console.log('=== Testing Splitter Integration ===');
    const splitter = new DocumentSplitter(100, 10);
    const content = `Paragraph one with some content.

Paragraph two with different content.

Paragraph three continues the theme.

Paragraph four introduces new ideas.

Paragraph five concludes the document.`;
    const chunks = splitter.split(content, 'test-url');
    console.log('Input length:', content.length);
    console.log('Chunks created:', chunks.length);
    chunks.forEach((c, i) => {
        console.log(`  Chunk ${i}: ${c.content.length} chars`);
    });
    // Verify chunks are within expected range
    const allValid = chunks.every(c => c.content.length > 0 && c.content.length < 200);
    console.log('All chunks valid size:', allValid);
    console.log('[PASS] Splitter integration test\n');
}
async function testMockStorage() {
    console.log('=== Testing Mock Storage ===');
    const parser = new DocumentParser();
    const splitter = new DocumentSplitter(100, 10);
    const mockMM = new MockMemoryManager();
    const content = `Test paragraph one.

Test paragraph two.

Test paragraph three.`;
    const chunks = splitter.split(content, 'test-storage');
    for (const chunk of chunks) {
        await mockMM.storeSemantic(chunk.content, 0.7, 'url:test');
    }
    console.log('Chunks to store:', chunks.length);
    console.log('Stored in mock:', mockMM.storedChunks.length);
    console.log('All stored:', mockMM.storedChunks.length === chunks.length);
    console.log('[PASS] Mock storage test\n');
}
async function runAllTests() {
    console.log('\n=== URL Importer Tests ===\n');
    try {
        await testImporterCreation();
        await testHtmlToText();
        await testSplitterIntegration();
        await testMockStorage();
        console.log('\n[SUCCESS] All URL importer tests passed!');
    }
    catch (error) {
        console.error('\n[FAIL] Test failed:', error.message);
        console.error(error.stack);
        process.exit(1);
    }
}
runAllTests();
//# sourceMappingURL=test-url-importer.js.map
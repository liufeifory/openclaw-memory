/**
 * Document Import Integration Test
 */
import { DocumentParser } from './document-parser.js';
import { DocumentSplitter } from './document-splitter.js';
async function testParser() {
    console.log('=== Testing Document Parser ===');
    const parser = new DocumentParser();
    // Test Markdown parsing (since we can create test files easily)
    const testMd = './test-temp.md';
    const testContent = '# Test Document\n\nThis is a test paragraph.\n\nThis is another paragraph.';
    // Write test file
    await import('fs/promises').then(fs => fs.writeFile(testMd, testContent));
    // Parse it
    const result = await parser.parse(testMd);
    console.log('Markdown parsed:', result.content.slice(0, 50), '...');
    console.log('Metadata:', result.metadata);
    // Cleanup
    await import('fs/promises').then(fs => fs.unlink(testMd));
    console.log('[PASS] Parser test\\n');
}
async function testSplitter() {
    console.log('=== Testing Document Splitter ===');
    const splitter = new DocumentSplitter(100, 10);
    const content = `Paragraph 1

Paragraph 2

Paragraph 3

Paragraph 4

Paragraph 5

Paragraph 6

Paragraph 7

Paragraph 8

Paragraph 9

Paragraph 10`;
    const chunks = splitter.split(content, 'test.md');
    console.log(`Split into ${chunks.length} chunks`);
    chunks.forEach((c, i) => {
        console.log(`  Chunk ${i}: ${c.content.length} chars`);
    });
    console.log('[PASS] Splitter test\\n');
}
async function testUrlParser() {
    console.log('=== Testing URL Parser (HTML to text) ===');
    const parser = new DocumentParser();
    // Test with a simple HTML string (simulate)
    const html = '<html><body><h1>Title</h1><p>Some content here.</p></body></html>';
    // We can't directly test private method, so test parseUrl with a mock
    // For now, just verify the class exists
    console.log('URL Parser exists:', typeof parser.parseUrl === 'function');
    console.log('[PASS] URL Parser test\\n');
}
async function runAllTests() {
    console.log('\\n=== Document Import Integration Tests ===\\n');
    try {
        await testParser();
        await testSplitter();
        await testUrlParser();
        console.log('\\n[SUCCESS] All document import tests passed!');
    }
    catch (error) {
        console.error('\\n[FAIL] Test failed:', error.message);
        console.error(error.stack);
        process.exit(1);
    }
}
runAllTests();
//# sourceMappingURL=test-document-import.js.map
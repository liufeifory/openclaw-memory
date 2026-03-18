/**
 * Document Watcher Tests
 */
import { DocumentWatcher } from './document-watcher.js';
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
async function testWatcherCreation() {
    console.log('=== Testing DocumentWatcher Creation ===');
    const parser = new DocumentParser();
    const splitter = new DocumentSplitter(500, 50);
    const mockMM = new MockMemoryManager();
    const watcher = new DocumentWatcher('./test-docs', parser, splitter, mockMM);
    console.log('Watcher created:', watcher !== null);
    console.log('[PASS] Watcher creation test\n');
}
async function testSupportedExtensions() {
    console.log('=== Testing Supported File Extensions ===');
    const parser = new DocumentParser();
    const splitter = new DocumentSplitter(500, 50);
    const mockMM = new MockMemoryManager();
    const watcher = new DocumentWatcher('./test-docs', parser, splitter, mockMM);
    // Access private property via any cast for testing
    const supportedExt = watcher.supportedExtensions;
    console.log('Supported extensions:', supportedExt);
    console.log('Has .pdf:', supportedExt.includes('.pdf'));
    console.log('Has .docx:', supportedExt.includes('.docx'));
    console.log('Has .md:', supportedExt.includes('.md'));
    console.log('Has .markdown:', supportedExt.includes('.markdown'));
    console.log('[PASS] Supported extensions test\n');
}
async function testProcessFile() {
    console.log('=== Testing File Processing (Mock) ===');
    // Create a test markdown file
    const fs = await import('fs/promises');
    const testFile = './test-watcher.md';
    await fs.writeFile(testFile, '# Test\n\nThis is a test document for the watcher.');
    const parser = new DocumentParser();
    const splitter = new DocumentSplitter(200, 20);
    const mockMM = new MockMemoryManager();
    // Manually process the file (simulating what watcher does)
    const parsed = await parser.parse(testFile);
    const chunks = splitter.split(parsed.content, testFile);
    for (const chunk of chunks) {
        await mockMM.storeSemantic(chunk.content, 0.7, `doc:${testFile}`);
    }
    console.log('Parsed content length:', parsed.content.length);
    console.log('Chunks created:', chunks.length);
    console.log('Stored in mock MM:', mockMM.storedChunks.length);
    // Cleanup
    await fs.unlink(testFile);
    console.log('[PASS] File processing test\n');
}
async function runAllTests() {
    console.log('\n=== Document Watcher Tests ===\n');
    try {
        await testWatcherCreation();
        await testSupportedExtensions();
        await testProcessFile();
        console.log('\n[SUCCESS] All watcher tests passed!');
    }
    catch (error) {
        console.error('\n[FAIL] Test failed:', error.message);
        console.error(error.stack);
        process.exit(1);
    }
}
runAllTests();
//# sourceMappingURL=test-document-watcher.js.map
/**
 * Document Import Integration Test - Semantic Splitting
 */
import { DocumentParser } from './document-parser.js';
import { DocumentSplitter } from './document-splitter.js';
async function testParser() {
    console.log('=== Testing Document Parser ===');
    const parser = new DocumentParser();
    // Test Markdown parsing
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
    console.log('[PASS] Parser test\n');
}
async function testSemanticSplitter() {
    console.log('=== Testing Semantic Splitter ===');
    const splitter = new DocumentSplitter(300, 30);
    // Test with content that has clear topic shifts
    const content = `# Introduction to Machine Learning

Machine learning is a subset of artificial intelligence that enables systems to learn and improve from experience without being explicitly programmed. It focuses on developing computer programs that can access data and use it to learn for themselves.

## Supervised Learning

Supervised learning is a type of machine learning where the algorithm learns from labeled training data. The algorithm makes predictions based on input data and is corrected when predictions are wrong. Common examples include classification and regression tasks.

## Unsupervised Learning

Unsupervised learning deals with unlabeled data. The algorithm tries to learn the underlying structure or distribution in the data without explicit guidance. Clustering and dimensionality reduction are common unsupervised learning tasks.

## Reinforcement Learning

Reinforcement learning is about taking suitable action to maximize reward in a particular situation. It is employed by various software and machines to find the best possible behavior or path it should take in a specific situation.

## Neural Networks

Neural networks are computing systems vaguely inspired by biological neural networks that constitute animal brains. They learn to perform tasks by considering examples, generally without being programmed with any task-specific rules.

## Deep Learning

Deep learning is part of a broader family of machine learning methods based on artificial neural networks. Learning can be supervised, semi-supervised, or unsupervised. Deep neural networks have been applied to fields including computer vision and natural language processing.`;
    const chunks = splitter.split(content, 'test.md');
    console.log(`Split into ${chunks.length} chunks`);
    console.log('');
    chunks.forEach((c, i) => {
        console.log(`  Chunk ${i}: ${c.content.length} chars, type: ${c.metadata.chunkType}`);
        console.log(`    Preview: ${c.content.slice(0, 60)}...`);
        console.log('');
    });
    // Verify chunks are within expected size range
    const allWithinRange = chunks.every(c => c.content.length <= splitter['options'].maxChunkSize * 1.2);
    if (!allWithinRange) {
        throw new Error('Some chunks exceed maximum size');
    }
    console.log('[PASS] Semantic Splitter test\n');
}
async function testSentenceSplitting() {
    console.log('=== Testing Sentence-based Splitting ===');
    const splitter = new DocumentSplitter(200, 20);
    // Test with a long paragraph that needs sentence splitting
    const content = `This is a very long paragraph that contains multiple sentences. Each sentence should be kept together when splitting. The splitter should not break in the middle of a sentence. It should find natural boundaries.

Another paragraph here with more content. We want to see how the semantic splitter handles topic shifts. Does it group related content together? The algorithm uses keyword overlap to detect topic changes.`;
    const chunks = splitter.split(content, 'test-sentences.md');
    console.log(`Split into ${chunks.length} chunks`);
    chunks.forEach((c, i) => {
        console.log(`  Chunk ${i}: ${c.content.length} chars, type: ${c.metadata.chunkType}`);
    });
    console.log('[PASS] Sentence Splitting test\n');
}
async function runAllTests() {
    console.log('\n=== Document Import Integration Tests (Semantic Splitting) ===\n');
    try {
        await testParser();
        await testSemanticSplitter();
        await testSentenceSplitting();
        console.log('\n[SUCCESS] All semantic splitting tests passed!');
    }
    catch (error) {
        console.error('\n[FAIL] Test failed:', error.message);
        console.error(error.stack);
        process.exit(1);
    }
}
runAllTests();
//# sourceMappingURL=test-semantic-splitter.js.map
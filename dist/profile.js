#!/usr/bin/env node
/**
 * Performance profiling script for OpenClaw Memory Plugin
 *
 * Analyzes latency of:
 * - Embedding generation
 * - Vector search
 * - Full retrieval pipeline
 */
import { EmbeddingService } from './embedding.js';
import { MemoryManager } from './memory-manager-qdrant.js';
const EMBEDDING_ENDPOINT = process.env.EMBEDDING_ENDPOINT || 'http://localhost:8080';
const QDRANT_CONFIG = {
    qdrant: { url: process.env.QDRANT_URL || 'http://localhost:6333' },
    embedding: { endpoint: EMBEDDING_ENDPOINT },
};
const TEST_QUERIES = [
    '用户想学习什么编程语言',
    '用户喜欢什么技术',
    '今天天气如何',
    '用户的工作是什么',
];
async function profileEmbedding(text) {
    const embedding = new EmbeddingService(EMBEDDING_ENDPOINT);
    const start = Date.now();
    await embedding.embed(text);
    return Date.now() - start;
}
async function profileSearch(manager, query, topK = 5) {
    const start = Date.now();
    await manager.retrieveRelevant(query, undefined, topK, 0.6);
    return Date.now() - start;
}
async function runProfiles() {
    console.log('=== OpenClaw Memory Performance Profile ===\n');
    // Profile embedding
    console.log('[Embedding 性能测试]');
    const embeddingTimes = [];
    for (const query of TEST_QUERIES) {
        const time = await profileEmbedding(query);
        embeddingTimes.push(time);
        console.log(`  "${query.substring(0, 15)}...": ${time}ms`);
    }
    const avgEmbedding = embeddingTimes.reduce((a, b) => a + b, 0) / embeddingTimes.length;
    console.log(`  Average: ${avgEmbedding.toFixed(2)}ms\n`);
    // Profile full search
    console.log('[完整检索性能测试]');
    const manager = new MemoryManager(QDRANT_CONFIG);
    await manager.initialize();
    const searchTimes = [];
    for (const query of TEST_QUERIES) {
        const time = await profileSearch(manager, query);
        searchTimes.push(time);
        console.log(`  "${query.substring(0, 15)}...": ${time}ms`);
    }
    const avgSearch = searchTimes.reduce((a, b) => a + b, 0) / searchTimes.length;
    console.log(`  Average: ${avgSearch.toFixed(2)}ms\n`);
    // Summary
    console.log('[性能摘要]');
    console.log(`  Embedding 平均耗时：${avgEmbedding.toFixed(2)}ms`);
    console.log(`  检索平均耗时：${avgSearch.toFixed(2)}ms`);
    console.log(`  端到端平均耗时：${(avgEmbedding + avgSearch).toFixed(2)}ms`);
    await manager.shutdown();
}
// Cold start test
async function profileColdStart() {
    console.log('\n=== Cold Start Profile ===\n');
    const start = Date.now();
    const manager = new MemoryManager(QDRANT_CONFIG);
    console.log(`  Constructor: ${Date.now() - start}ms`);
    const initStart = Date.now();
    await manager.initialize();
    console.log(`  Initialize: ${Date.now() - initStart}ms`);
    const searchStart = Date.now();
    await manager.retrieveRelevant('test', undefined, 1, 0.5);
    console.log(`  First search: ${Date.now() - searchStart}ms`);
    await manager.shutdown();
}
async function main() {
    try {
        await runProfiles();
        await profileColdStart();
        console.log('\n=== Profile Complete ===');
    }
    catch (error) {
        console.error('Profile failed:', error.message);
        process.exit(1);
    }
}
main();
//# sourceMappingURL=profile.js.map
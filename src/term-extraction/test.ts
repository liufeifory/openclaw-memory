/**
 * Term Extraction Test - 术语抽取测试
 */

import { TermExtractionPipeline } from './pipeline.js';
import { DomainDetector } from './domain-detector.js';
import { logInfo } from '../maintenance-logger.js';

// ============================================================
// Test Domain Detection
// ============================================================

function testDomainDetection() {
  logInfo('\n=== Domain Detection Test ===');

  const detector = new DomainDetector();

  // Database text
  const dbText = `
    PostgreSQL uses WAL (Write-Ahead Logging) to ensure data integrity.
    The checkpoint process periodically writes dirty buffers to disk.
    pg_stat_activity shows current database connections.
    VACUUM reclaims storage space from deleted tuples.
  `;

  const dbResult = detector.detect(dbText);
  logInfo(`Database text: ${dbResult.domain} (confidence: ${dbResult.confidence.toFixed(2)})`);

  // AI text
  const aiText = `
    The Transformer architecture revolutionized NLP with self-attention mechanisms.
    Fine-tuning BERT on domain-specific data improves performance.
    LLM like GPT-4 can generate human-like text.
    PyTorch and TensorFlow are popular deep learning frameworks.
  `;

  const aiResult = detector.detect(aiText);
  logInfo(`AI text: ${aiResult.domain} (confidence: ${aiResult.confidence.toFixed(2)})`);

  // Mixed text
  const mixedText = `
    The system uses a combination of approaches to solve problems.
    Data processing is important for modern applications.
    Performance optimization helps improve results.
  `;

  const mixedResult = detector.detect(mixedText);
  logInfo(`Mixed text: ${mixedResult.domain} (confidence: ${mixedResult.confidence.toFixed(2)})`);
}

// ============================================================
// Test Term Extraction
// ============================================================

function testTermExtraction() {
  logInfo('\n=== Term Extraction Test ===');

  const pipeline = new TermExtractionPipeline({
    statistical: {
      maxN: 2,
      minFreq: 1,
      minLength: 3,
      maxLength: 50,
    },
    candidate: {
      topK: 50,
      minScore: 0.5,
    },
    llm: {
      enabled: false,
      batchSize: 50,
      timeout: 120000,
      temperature: 0,
      maxTokens: 2000,
    },
    cache: {
      enabled: true,
      maxSize: 10000,
    },
  });

  // Load seed terms (cold start)
  pipeline.loadSeedTerms([
    { term: 'WAL', type: 'concept', domain: 'database' },
    { term: 'checkpoint', type: 'component', domain: 'database' },
    { term: 'Transformer', type: 'component', domain: 'ai' },
    { term: 'BERT', type: 'component', domain: 'ai' },
  ]);

  // Test database text
  const dbText = `
    PostgreSQL uses WAL (Write-Ahead Logging) to ensure data integrity.
    The checkpoint process periodically writes dirty buffers to disk.
    pg_stat_activity shows current database connections.
    pg_class stores relation metadata.
    pg_dump creates backup files.
    user-defined functions are powerful.
    not-null constraint is important.
    b-tree index is common.
    VACUUM reclaims storage space.
    GIN index is used for full-text search.
    MVCC ensures transaction isolation.
  `;

  const dbResult = pipeline.extract(dbText);

  logInfo(`\nDomain: ${dbResult.domain} (confidence: ${dbResult.domainConfidence.toFixed(2)})`);
  logInfo(`Stats: candidates=${dbResult.stats.candidates}, filtered=${dbResult.stats.filtered}, cached=${dbResult.stats.cached}, final=${dbResult.stats.final}`);
  logInfo(`Timing: ${dbResult.timing.total}ms`);

  logInfo('\nTerms:');
  for (const term of dbResult.terms.slice(0, 20)) {
    logInfo(`  ${term.term} | ${term.type} | ${term.label} | freq=${term.freq} | score=${term.score.toFixed(2)} | source=${term.source}`);
  }

  // Test cache stats
  const cacheStats = pipeline.getCacheStats();
  logInfo(`\nCache stats: size=${cacheStats.size}, hits=${cacheStats.hits}, misses=${cacheStats.misses}, hitRate=${cacheStats.hitRate.toFixed(2)}`);

  // Test AI text
  const aiText = `
    The Transformer architecture uses self-attention mechanisms.
    Fine-tuning BERT improves model performance on specific tasks.
    PyTorch is a popular deep learning framework.
    Embedding layers convert tokens to dense vectors.
    Attention mechanism computes weighted representations.
    Neural network layers transform input features.
  `;

  const aiResult = pipeline.extract(aiText);

  logInfo(`\nAI Domain: ${aiResult.domain} (confidence: ${aiResult.domainConfidence.toFixed(2)})`);
  logInfo(`AI Terms:`);
  for (const term of aiResult.terms.slice(0, 10)) {
    logInfo(`  ${term.term} | ${term.type} | ${term.label} | score=${term.score.toFixed(2)}`);
  }
}

// ============================================================
// Run Tests
// ============================================================

testDomainDetection();
testTermExtraction();

logInfo('\n=== Tests Complete ===');
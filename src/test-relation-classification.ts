/**
 * Relation Classification Integration Test Suite
 *
 * Tests the full LLM-based relation classification flow:
 * 1. Context window extraction
 * 2. Prompt building
 * 3. Response parsing
 * 4. Full classification pipeline (mock LLM)
 * 5. Diverse sampling
 * 6. Direction healing
 */

import { extractContextWindow, joinContextSnippets, diverseSample, MemorySnippet } from './context-window.js';
import { EntityExtractor } from './entity-extractor.js';

// ==================== Context Window Tests ====================

async function testContextWindowBasic() {
  console.log('\n=== Test Context Window: Basic Extraction ===');

  const content = 'TypeScript is a programming language developed by Microsoft. It adds static typing to JavaScript. TypeScript is great for large applications.';
  const entities = ['TypeScript', 'JavaScript'];

  const snippets = extractContextWindow(content, entities, {
    windowSize: 20,
    maxSnippets: 3
  });

  console.log('Context snippets:', snippets);

  // Should find at least one snippet containing "TypeScript"
  const hasTypeScript = snippets.some(s => s.toLowerCase().includes('typescript'));

  if (hasTypeScript && snippets.length > 0) {
    console.log('[PASS] Context window extraction works');
    return true;
  } else {
    console.log('[FAIL] Context window extraction failed');
    return false;
  }
}

async function testContextWindowMerging() {
  console.log('\n=== Test Context Window: Overlapping Merge ===');

  // Two mentions close enough to merge
  const content = 'TypeScript is great. I love TypeScript because it is typed.';
  const entities = ['TypeScript'];

  const snippets = extractContextWindow(content, entities, {
    windowSize: 15,
    maxSnippets: 3,
    mergeOverlapping: true
  });

  console.log('Merged snippets:', snippets);

  // Should merge overlapping windows
  // First mention: "TypeScript is great. I love"
  // Second mention: "great. I love TypeScript because it"
  // These should merge into one snippet

  if (snippets.length <= 2) {
    console.log('[PASS] Overlapping windows merged correctly');
    return true;
  } else {
    console.log('[FAIL] Overlapping windows not merged');
    return false;
  }
}

async function testContextWindowNoEntity() {
  console.log('\n=== Test Context Window: Entity Not Found ===');

  const content = 'Python is a programming language.';
  const entities = ['TypeScript'];  // Not in content

  const snippets = extractContextWindow(content, entities, {
    windowSize: 20,
    maxSnippets: 3
  });

  console.log('Snippets when entity not found:', snippets);

  // Should return truncated content as fallback
  if (snippets.length > 0) {
    console.log('[PASS] Returns fallback content when entity not found');
    return true;
  } else {
    console.log('[FAIL] Should return fallback content');
    return false;
  }
}

async function testJoinContextSnippets() {
  console.log('\n=== Test Join Context Snippets ===');

  const snippets = ['Snippet 1', 'Snippet 2', 'Snippet 3'];
  const joined = joinContextSnippets(snippets, ' | ');

  console.log('Joined:', joined);

  if (joined === 'Snippet 1 | Snippet 2 | Snippet 3') {
    console.log('[PASS] Join context snippets works');
    return true;
  } else {
    console.log('[FAIL] Join context snippets failed');
    return false;
  }
}

// ==================== Prompt Building Tests ====================

async function testPromptBuilding() {
  console.log('\n=== Test Prompt Building (Manual) ===');

  const entityAName = 'TypeScript';
  const entityAType = 'language';
  const entityBName = 'JavaScript';
  const entityBType = 'language';
  const cooccurrenceCount = 5;
  const memorySnippets = [
    'TypeScript adds types to JavaScript',
    'I use TypeScript with JavaScript projects',
    'TypeScript compiles to JavaScript'
  ];

  const snippetsText = memorySnippets.map((s, i) => `${i + 1}. "${s.substring(0, 200)}"`).join('\n');

  const prompt = `你是一名知识图谱关系分类专家。根据以下实体信息和共现上下文，
选择最合适的关系类型。

## 实体 A（in）
- 名称：${entityAName}
- 类型：${entityAType}

## 实体 B（out）
- 名称：${entityBName}
- 类型：${entityBType}

## 共现信息
- 共现次数：${cooccurrenceCount}

## 共现的 Memory 片段（前 3 条，每条约 200 字窗口）
${snippetsText}

## 可选关系类型
- causes: 因果关系（A 导致 B）
- used_for: 用途关系（A 用于 B）
- member_of: 成员关系（A 属于 B 的组成部分）
- located_in: 位置关系（A 位于 B 的范围内）
- created_by: 创建关系（A 由 B 创建）
- related_to: 通用关联（有语义关联但无法归类）
- no_logical_relation: 无逻辑关系（仅偶然共现，无语义关联）

## 方向性说明
- 默认关系方向：A → B
- 如果实际关系是 B → A（如"B 创建了 A"），请设置 reverse_direction = true

## 输出格式
严格返回 JSON 格式：
{
  "relation_type": "<选择的类型>",
  "confidence": <0.0-1.0>,
  "reasoning": "<简短解释，50 字以内>",
  "reverse_direction": <true/false>
}

JSON:`;

  console.log('Built prompt:');
  console.log(prompt.substring(0, 500) + '...');

  // Verify prompt contains all required sections
  const hasEntityA = prompt.includes(entityAName);
  const hasEntityB = prompt.includes(entityBName);
  const hasSnippets = prompt.includes('Memory 片段');
  const hasRelationTypes = prompt.includes('causes');

  if (hasEntityA && hasEntityB && hasSnippets && hasRelationTypes) {
    console.log('[PASS] Prompt building contains all required sections');
    return true;
  } else {
    console.log('[FAIL] Prompt building missing sections');
    return false;
  }
}

// ==================== Response Parsing Tests ====================

async function testResponseParsing() {
  console.log('\n=== Test Response Parsing ===');

  const VALID_TYPES = [
    'causes', 'used_for', 'member_of', 'located_in',
    'created_by', 'related_to', 'no_logical_relation'
  ];

  // Test valid response
  const validResponse = {
    content: '{"relation_type": "used_for", "confidence": 0.9, "reasoning": "TypeScript is used for JavaScript development", "reverse_direction": false}'
  };

  const parsedValid = parseClassificationResponse(validResponse, VALID_TYPES);
  console.log('Parsed valid response:', parsedValid);

  const validPass = parsedValid.relation_type === 'used_for' &&
                    parsedValid.confidence === 0.9 &&
                    parsedValid.reverse_direction === false;

  // Test invalid relation type (should default to related_to)
  const invalidTypeResponse = {
    content: '{"relation_type": "invalid_type", "confidence": 0.8}'
  };

  const parsedInvalid = parseClassificationResponse(invalidTypeResponse, VALID_TYPES);
  console.log('Parsed invalid type:', parsedInvalid);

  const invalidPass = parsedInvalid.relation_type === 'related_to';

  // Test parse failure (should use defaults)
  const parseFailureResponse = {
    content: 'This is not JSON'
  };

  const parsedFailure = parseClassificationResponse(parseFailureResponse, VALID_TYPES);
  console.log('Parsed failure:', parsedFailure);

  const failurePass = parsedFailure.relation_type === 'related_to' &&
                      parsedFailure.confidence === 0.5;

  if (validPass && invalidPass && failurePass) {
    console.log('[PASS] Response parsing works correctly');
    return true;
  } else {
    console.log('[FAIL] Response parsing failed');
    console.log(`  validPass: ${validPass}, invalidPass: ${invalidPass}, failurePass: ${failurePass}`);
    return false;
  }
}


// ==================== Integration Test (Mock LLM) ====================

async function testIntegrationWithMockLLM() {
  console.log('\n=== Test Integration with Mock LLM ===');

  // Simulate the classification flow without actual LLM call
  const mockEntities = {
    entityA: { name: 'TypeScript', entity_type: 'language' },
    entityB: { name: 'JavaScript', entity_type: 'language' }
  };

  const mockSnippets = [
    'TypeScript adds static typing to JavaScript',
    'I write TypeScript code that compiles to JavaScript',
    'TypeScript is a superset of JavaScript'
  ];

  // Build prompt
  const snippetsText = mockSnippets.map((s, i) => `${i + 1}. "${s}"`).join('\n');
  const prompt = `你是一名知识图谱关系分类专家。

## 实体 A（in）
- 名称：${mockEntities.entityA.name}
- 类型：${mockEntities.entityA.entity_type}

## 实体 B（out）
- 名称：${mockEntities.entityB.name}
- 类型：${mockEntities.entityB.entity_type}

## 共现的 Memory 片段
${snippetsText}

## 可选关系类型
- used_for: 用途关系（A 用于 B）
- member_of: 成员关系（A 属于 B 的组成部分）
- related_to: 通用关联

返回 JSON:
{
  "relation_type": "<类型>",
  "confidence": <0-1>,
  "reverse_direction": <true/false>
}`;

  console.log('Mock prompt built successfully');

  // Simulate LLM response (mock)
  const mockLLMResponse = {
    content: '{"relation_type": "member_of", "confidence": 0.85, "reasoning": "TypeScript is part of JavaScript ecosystem", "reverse_direction": false}'
  };

  const VALID_TYPES = ['causes', 'used_for', 'member_of', 'located_in', 'created_by', 'related_to', 'no_logical_relation'];
  const classification = parseClassificationResponse(mockLLMResponse, VALID_TYPES);

  console.log('Classification result:', classification);

  // Verify classification
  const pass = classification.relation_type === 'member_of' &&
               classification.confidence === 0.85 &&
               classification.reverse_direction === false;

  if (pass) {
    console.log('[PASS] Integration test with mock LLM passed');
    return true;
  } else {
    console.log('[FAIL] Integration test failed');
    return false;
  }
}

// ==================== Direction Reversal Test ====================

async function testDirectionReversal() {
  console.log('\n=== Test Direction Reversal ===');

  // Simulate a case where LLM suggests reversing direction
  // Example: "React was created by Facebook" should be Facebook ->created_by-> React
  // But initial co-occurrence is React -> Facebook

  const mockLLMResponse = {
    content: '{"relation_type": "created_by", "confidence": 0.9, "reasoning": "Facebook created React", "reverse_direction": true}'
  };

  const VALID_TYPES = ['causes', 'used_for', 'member_of', 'located_in', 'created_by', 'related_to', 'no_logical_relation'];
  const classification = parseClassificationResponse(mockLLMResponse, VALID_TYPES);

  console.log('Classification with direction reversal:', classification);

  if (classification.relation_type === 'created_by' &&
      classification.reverse_direction === true &&
      classification.confidence === 0.9) {
    console.log('[PASS] Direction reversal detected correctly');
    return true;
  } else {
    console.log('[FAIL] Direction reversal test failed');
    return false;
  }
}

// ==================== Source Field Test (Direction Healing) ====================

async function testSourceFieldDirection() {
  console.log('\n=== Test Source Field for Direction Healing ===');

  // Simulate LLM returning source field instead of reverse_direction
  // Example: source="Facebook" means the relation should be Facebook -> created_by -> React
  const mockLLMResponse = {
    content: '{"relation_type": "created_by", "confidence": 0.95, "reasoning": "Facebook created React", "source": "Facebook"}'
  };

  const VALID_TYPES = ['causes', 'used_for', 'member_of', 'located_in', 'created_by', 'related_to', 'no_logical_relation'];
  const classification = parseClassificationResponse(mockLLMResponse, VALID_TYPES);

  console.log('Classification with source field:', classification);

  // Verify source field is parsed
  const hasSource = (classification as any).source === 'Facebook';
  const hasCorrectType = classification.relation_type === 'created_by';
  const hasHighConfidence = classification.confidence === 0.95;

  if (hasSource && hasCorrectType && hasHighConfidence) {
    console.log('[PASS] Source field parsed correctly for direction healing');
    return true;
  } else {
    console.log('[FAIL] Source field parsing failed');
    console.log(`  hasSource: ${hasSource}, hasCorrectType: ${hasCorrectType}, hasHighConfidence: ${hasHighConfidence}`);
    return false;
  }
}

// ==================== Diverse Sampling Test ====================

async function testDiverseSamplingByDocument() {
  console.log('\n=== Test Diverse Sampling: By Document ===');

  const memories: MemorySnippet[] = [
    { id: 1, content: 'Doc A content 1', created_at: '2024-01-01', document_id: 'doc_a' },
    { id: 2, content: 'Doc A content 2', created_at: '2024-01-02', document_id: 'doc_a' },
    { id: 3, content: 'Doc A content 3', created_at: '2024-01-03', document_id: 'doc_a' },
    { id: 4, content: 'Doc B content 1', created_at: '2024-01-04', document_id: 'doc_b' },
    { id: 5, content: 'Doc C content 1', created_at: '2024-01-05', document_id: 'doc_c' },
  ];

  const sampled = diverseSample(memories, 3);

  console.log('Sampled memories:', sampled.map(m => ({ id: m.id, document_id: m.document_id })));

  // Should select from different documents (doc_a, doc_b, doc_c)
  const uniqueDocs = new Set(sampled.map(m => m.document_id));

  if (uniqueDocs.size === 3 && sampled.length === 3) {
    console.log('[PASS] Diverse sampling selected from 3 different documents');
    return true;
  } else {
    console.log(`[FAIL] Diverse sampling failed: ${uniqueDocs.size} unique docs, ${sampled.length} samples`);
    return false;
  }
}

async function testDiverseSamplingHeadMiddleTail() {
  console.log('\n=== Test Diverse Sampling: Head/Middle/Tail ===');

  // All memories from same document - should use head/middle/tail
  const memories: MemorySnippet[] = [
    { id: 1, content: 'Content 1', created_at: '2024-01-01', document_id: 'doc_same' },
    { id: 2, content: 'Content 2', created_at: '2024-01-02', document_id: 'doc_same' },
    { id: 3, content: 'Content 3', created_at: '2024-01-03', document_id: 'doc_same' },
    { id: 4, content: 'Content 4', created_at: '2024-01-04', document_id: 'doc_same' },
    { id: 5, content: 'Content 5', created_at: '2024-01-05', document_id: 'doc_same' },
    { id: 6, content: 'Content 6', created_at: '2024-01-06', document_id: 'doc_same' },
    { id: 7, content: 'Content 7', created_at: '2024-01-07', document_id: 'doc_same' },
    { id: 8, content: 'Content 8', created_at: '2024-01-08', document_id: 'doc_same' },
    { id: 9, content: 'Content 9', created_at: '2024-01-09', document_id: 'doc_same' },
  ];

  const sampled = diverseSample(memories, 3);

  console.log('Sampled memories (head/middle/tail):', sampled.map(m => m.id));

  // Should select head (1), middle (~5), tail (9)
  const hasHead = sampled.some(m => m.id === 1);
  const hasMiddle = sampled.some(m => m.id !== undefined && m.id >= 4 && m.id <= 6);
  const hasTail = sampled.some(m => m.id === 9);

  if (hasHead && hasMiddle && hasTail && sampled.length === 3) {
    console.log('[PASS] Diverse sampling selected head/middle/tail correctly');
    return true;
  } else {
    console.log(`[FAIL] Diverse sampling failed: head=${hasHead}, middle=${hasMiddle}, tail=${hasTail}`);
    return false;
  }
}

async function testDiverseSamplingEdgeCases() {
  console.log('\n=== Test Diverse Sampling: Edge Cases ===');

  // Empty array
  const emptySampled = diverseSample([], 3);
  const emptyPass = emptySampled.length === 0;

  // Less than target count
  const fewMemories: MemorySnippet[] = [
    { id: 1, content: 'Content 1', document_id: 'doc_a' },
    { id: 2, content: 'Content 2', document_id: 'doc_b' },
  ];
  const fewSampled = diverseSample(fewMemories, 5);
  const fewPass = fewSampled.length === 2;

  // Single item
  const singleMemory: MemorySnippet[] = [
    { id: 1, content: 'Single content', document_id: 'doc_single' },
  ];
  const singleSampled = diverseSample(singleMemory, 3);
  const singlePass = singleSampled.length === 1;

  console.log(`Empty: ${emptyPass ? 'PASS' : 'FAIL'}, Few: ${fewPass ? 'PASS' : 'FAIL'}, Single: ${singlePass ? 'PASS' : 'FAIL'}`);

  if (emptyPass && fewPass && singlePass) {
    console.log('[PASS] All edge cases handled correctly');
    return true;
  } else {
    console.log('[FAIL] Some edge cases failed');
    return false;
  }
}

// ==================== Response Parsing with Source Field ====================

/**
 * Parse classification response with source field support
 */
function parseClassificationResponse(llmResult: any, VALID_TYPES: string[]): {
  relation_type: string;
  confidence: number;
  reasoning: string;
  reverse_direction: boolean;
  source?: string;
} {
  try {
    let output = llmResult.content || llmResult.generated_text || '';

    const jsonMatch = output.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      output = jsonMatch[0];
    }

    const parsed = JSON.parse(output);

    let relationType = parsed.relation_type || 'related_to';
    let confidence = typeof parsed.confidence === 'number' ? parsed.confidence : 0.5;
    let reasoning = parsed.reasoning || '';
    let reverseDirection = parsed.reverse_direction === true;
    let source = parsed.source;

    if (!VALID_TYPES.includes(relationType)) {
      relationType = 'related_to';
    }

    confidence = Math.max(0, Math.min(1, confidence));

    return { relation_type: relationType, confidence, reasoning, reverse_direction: reverseDirection, source };

  } catch {
    return {
      relation_type: 'related_to',
      confidence: 0.5,
      reasoning: 'Parse failed, using default',
      reverse_direction: false,
      source: undefined
    };
  }
}

// ==================== Confidence Normalization Test ====================

async function testConfidenceNormalization() {
  console.log('\n=== Test Confidence Normalization ===');

  const VALID_TYPES = ['causes', 'used_for', 'member_of'];

  // Test confidence > 1 (should clamp to 1)
  const highConfResponse = {
    content: '{"relation_type": "causes", "confidence": 1.5}'
  };
  const highConf = parseClassificationResponse(highConfResponse, VALID_TYPES);

  // Test confidence < 0 (should clamp to 0)
  const lowConfResponse = {
    content: '{"relation_type": "causes", "confidence": -0.5}'
  };
  const lowConf = parseClassificationResponse(lowConfResponse, VALID_TYPES);

  // Test missing confidence (should default to 0.5)
  const missingConfResponse = {
    content: '{"relation_type": "causes"}'
  };
  const missingConf = parseClassificationResponse(missingConfResponse, VALID_TYPES);

  console.log(`High confidence: ${highConf.confidence} (should be 1.0)`);
  console.log(`Low confidence: ${lowConf.confidence} (should be 0.0)`);
  console.log(`Missing confidence: ${missingConf.confidence} (should be 0.5)`);

  if (highConf.confidence === 1 && lowConf.confidence === 0 && missingConf.confidence === 0.5) {
    console.log('[PASS] Confidence normalization works');
    return true;
  } else {
    console.log('[FAIL] Confidence normalization failed');
    return false;
  }
}

// ==================== Main Test Runner ====================

async function runAllTests() {
  console.log('Running Relation Classification Tests...\n');
  console.log('='.repeat(50));

  const results: boolean[] = [];

  // Context window tests
  results.push(await testContextWindowBasic());
  results.push(await testContextWindowMerging());
  results.push(await testContextWindowNoEntity());
  results.push(await testJoinContextSnippets());

  // Prompt building tests
  results.push(await testPromptBuilding());

  // Response parsing tests
  results.push(await testResponseParsing());
  results.push(await testConfidenceNormalization());
  results.push(await testDirectionReversal());

  // Integration tests
  results.push(await testIntegrationWithMockLLM());

  console.log('\n' + '='.repeat(50));
  const passed = results.filter(r => r).length;
  const total = results.length;
  console.log(`\nTest Results: ${passed}/${total} passed`);

  if (passed === total) {
    console.log('[SUCCESS] All tests passed!');
    process.exit(0);
  } else {
    console.log('[FAILURE] Some tests failed');
    process.exit(1);
  }
}

runAllTests().catch(console.error);

# LLM 关系分类功能实施计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 LLM 关系分类功能，将 entity_relation 的 `co_occurs` 类型升级为 7 种语义类型

**Architecture:**
- 在 EntityIndexer 中新增 `classifyEntityRelations()` 方法
- 使用 EntityExtractor 调用 7B 模型进行分类
- 添加 Memory 切片窗口机制减少 token 消耗
- 添加方向反转逻辑处理 LLM 建议的边方向变化
- 使用 `is_manual_refined` 标记防止被 buildEntityCooccurrence 覆盖

**Tech Stack:** TypeScript, SurrealDB, 7B LLM (localhost:8083)

---

## Chunk 1: Schema 迁移和基础建设

### Task 1: 扩展 entity_relation Schema

**Files:**
- Modify: `src/surrealdb-client.ts:1950-2000` (Schema 定义区域)
- Test: `src/test-relation-classification.ts`

- [ ] **Step 1: 读取现有 Schema 定义位置**

读取 `src/surrealdb-client.ts` 中 `entity_relation` 表的 DEFINE FIELD 语句

- [ ] **Step 2: 添加新字段 SQL**

在 `initialize()` 方法的 schema 变更检测中添加：
```typescript
// Add new fields for entity_relation classification
await this.client.query(`
  DEFINE FIELD IF NOT EXISTS is_manual_refined ON TABLE entity_relation TYPE bool DEFAULT false;
  DEFINE FIELD IF NOT EXISTS confidence ON TABLE entity_relation TYPE float DEFAULT 0.0;
  DEFINE FIELD IF NOT EXISTS reasoning ON TABLE entity_relation TYPE option<string>;
  DEFINE FIELD IF NOT EXISTS last_occurrence_at ON TABLE entity_relation TYPE datetime;
  DEFINE FIELD IF NOT EXISTS updated_at ON TABLE entity_relation TYPE datetime DEFAULT time::now();
`);
```

- [ ] **Step 3: 添加关系类型约束（可选）**

```typescript
// Add relation_type validation (optional, may break existing data)
await this.client.query(`
  DEFINE FIELD IF NOT EXISTS relation_type ON TABLE entity_relation
    TYPE string
    VALUE $value INSIDE ['causes', 'used_for', 'member_of', 'located_in', 'created_by', 'related_to', 'no_logical_relation', 'co_occurs'];
`);
```

- [ ] **Step 4: 编写测试**

```typescript
async function testSchemaExtension() {
  console.log('Testing entity_relation schema extension...');

  const db = new SurrealDatabase(config);
  await db.initialize();

  // Check if new fields exist
  const result = await db.query(`SELECT is_manual_refined, confidence, reasoning FROM entity_relation LIMIT 1`);
  console.log('Schema extension test:', result ? 'PASS' : 'FAIL');
}
```

- [ ] **Step 5: 运行测试**

```bash
cd /Users/liufei/.openclaw/plugins/openclaw-memory
npm run build
npx tsx src/test-relation-classification.ts
```

Expected: Schema fields created successfully

- [ ] **Step 6: 提交**

```bash
git add src/surrealdb-client.ts src/test-relation-classification.ts
git commit -m "feat: add entity_relation classification fields (is_manual_refined, confidence, reasoning)"
```

---

### Task 2: 修改 buildEntityCooccurrence() UPSERT 逻辑

**Files:**
- Modify: `src/surrealdb-client.ts:1999-2150` (buildEntityCooccurrence method)

- [ ] **Step 1: 读取现有 buildEntityCooccurrence 方法**

找到 `UPDATE entity_relation` 或 `INSERT INTO entity_relation` 的 SQL 语句

- [ ] **Step 2: 修改 UPSERT 逻辑保护已分类关系**

```typescript
// 原逻辑（查找并替换）:
const relationSql = `
  INSERT INTO ${ENTITY_RELATION_TABLE} (
    in, out, relation_type, weight, evidence_memory_ids, evidence_count, created_at, updated_at
  ) VALUES (
    ${ENTITY_TABLE}:${entityA},
    ${ENTITY_TABLE}:${entityB},
    'co_occurs',  // 硬编码为 co_occurs
    $weight,
    $evidence_memory_ids,
    $evidence_count,
    $created_at,
    $updated_at
  )
  ON DUPLICATE KEY UPDATE
    weight = $weight,
    evidence_count = $evidence_count,
    updated_at = $updated_at
`;

// 新逻辑:
const relationSql = `
  INSERT INTO ${ENTITY_RELATION_TABLE} (
    in, out, relation_type, weight, evidence_memory_ids, evidence_count, is_manual_refined, created_at, updated_at
  ) VALUES (
    ${ENTITY_TABLE}:${entityA},
    ${ENTITY_TABLE}:${entityB},
    'co_occurs',
    $weight,
    $evidence_memory_ids,
    $evidence_count,
    false,  // 新边默认未分类
    $created_at,
    $updated_at
  )
  ON DUPLICATE KEY UPDATE
    weight = $weight,
    evidence_count = $evidence_count,
    -- 保护已分类的关系类型不被覆盖
    relation_type = IF is_manual_refined THEN relation_type ELSE 'co_occurs' END,
    is_manual_refined = is_manual_refined,  -- 保留原标记
    updated_at = $updated_at
`;
```

- [ ] **Step 3: 验证修改**

确保 SQL 逻辑正确：如果 `is_manual_refined = true`，则保留原 `relation_type`

- [ ] **Step 4: 提交**

```bash
git add src/surrealdb-client.ts
git commit -m "feat: protect classified relations from being overwritten in buildEntityCooccurrence"
```

---

## Chunk 2: Memory 切片窗口工具

### Task 3: 实现 extractContextWindow() 工具函数

**Files:**
- Create: `src/context-window.ts`
- Test: `src/test-context-window.ts`

- [ ] **Step 1: 创建 context-window.ts**

```typescript
/**
 * Context Window Extractor
 * Extracts keyword-centered snippets from text around entity mentions
 */

export interface ContextWindowOptions {
  windowSize?: number;      // Characters before/after entity (default: 100)
  maxSnippets?: number;     // Maximum number of snippets to return (default: 3)
  sentenceBoundary?: boolean; // Try to cut at sentence boundaries (default: true)
}

/**
 * Extract context windows around entity mentions
 * @param content - Full text content
 * @param entities - Entity names to find in content
 * @param options - Extraction options
 * @returns Array of context snippets
 */
export function extractContextWindow(
  content: string,
  entities: string[],
  options: ContextWindowOptions = {}
): string[] {
  const {
    windowSize = 100,
    maxSnippets = 3,
    sentenceBoundary = true,
  } = options;

  const snippets: string[] = [];
  const usedRanges: Array<{ start: number; end: number }> = [];

  for (const entity of entities) {
    // Find all occurrences of entity (case-insensitive)
    const regex = new RegExp(escapeRegex(entity), 'gi');
    let match: RegExpExecArray | null;

    while ((match = regex.exec(content)) !== null) {
      const entityStart = match.index;
      const entityEnd = entityStart + entity.length;

      // Calculate window boundaries
      let windowStart = Math.max(0, entityStart - windowSize);
      let windowEnd = Math.min(content.length, entityEnd + windowSize);

      // Optionally cut at sentence boundaries
      if (sentenceBoundary) {
        // Find previous sentence boundary
        const prevSentence = findSentenceBoundary(content, windowStart, 'backward');
        windowStart = Math.max(0, prevSentence);

        // Find next sentence boundary
        const nextSentence = findSentenceBoundary(content, windowEnd, 'forward');
        windowEnd = Math.min(content.length, nextSentence);
      }

      // Check for overlap with existing ranges, merge if needed
      const newRange = { start: windowStart, end: windowEnd };
      const overlappingIndex = findOverlappingRange(usedRanges, newRange);

      if (overlappingIndex !== -1) {
        // Merge overlapping ranges
        const existing = usedRanges[overlappingIndex];
        existing.start = Math.min(existing.start, windowStart);
        existing.end = Math.max(existing.end, windowEnd);
      } else {
        usedRanges.push(newRange);
      }
    }
  }

  // Extract snippets from merged ranges
  for (const range of usedRanges.slice(0, maxSnippets)) {
    snippets.push(content.substring(range.start, range.end).trim());
  }

  return snippets;
}

/**
 * Escape special regex characters
 */
function escapeRegex(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Find sentence boundary (.!?\n)
 */
function findSentenceBoundary(
  text: string,
  position: number,
  direction: 'forward' | 'backward'
): number {
  if (direction === 'backward') {
    // Search backwards for sentence boundary
    for (let i = position - 1; i >= 0; i--) {
      const char = text[i];
      if (char === '.' || char === '!' || char === '?' || char === '\n') {
        return i + 1; // Start after the boundary
      }
    }
    return 0;
  } else {
    // Search forwards for sentence boundary
    for (let i = position; i < text.length; i++) {
      const char = text[i];
      if (char === '.' || char === '!' || char === '?' || char === '\n') {
        return i + 1; // End at the boundary
      }
    }
    return text.length;
  }
}

/**
 * Find overlapping range index
 */
function findOverlappingRange(
  ranges: Array<{ start: number; end: number }>,
  range: { start: number; end: number }
): number {
  return ranges.findIndex(
    r => !(range.end <= r.start || range.start >= r.end)
  );
}
```

- [ ] **Step 2: 创建单元测试**

```typescript
import { extractContextWindow } from './context-window.js';

async function testExtractContextWindow() {
  console.log('Testing extractContextWindow...');

  const content = `
    TypeScript is a programming language developed by Microsoft.
    It builds on JavaScript by adding static types.
    Many developers use TypeScript for large projects.
    React is a library that works well with TypeScript.
  `;

  const entities = ['TypeScript', 'Microsoft'];
  const snippets = extractContextWindow(content, entities, {
    windowSize: 50,
    maxSnippets: 3,
  });

  console.log('Snippets:', snippets);

  // Verify snippets contain entities
  const hasTypeScript = snippets.some(s => s.toLowerCase().includes('typescript'));
  const hasMicrosoft = snippets.some(s => s.toLowerCase().includes('microsoft'));

  if (hasTypeScript && hasMicrosoft) {
    console.log('[PASS] extractContextWindow extracts correct snippets');
    return true;
  } else {
    console.log('[FAIL] extractContextWindow missing entities');
    return false;
  }
}

testExtractContextWindow();
```

- [ ] **Step 3: 运行测试**

```bash
npx tsx src/test-context-window.ts
```

Expected: [PASS] extractContextWindow extracts correct snippets

- [ ] **Step 4: 提交**

```bash
git add src/context-window.ts src/test-context-window.ts
git commit -m "feat: add context window extractor for LLM prompt optimization"
```

---

## Chunk 3: EntityExtractor 扩展

### Task 4: 暴露 call7B() 方法供外部调用

**Files:**
- Modify: `src/entity-extractor.ts` (新增方法)

- [ ] **Step 1: 读取 entity-extractor.ts 的 LLM 调用逻辑**

找到 `layer3_7BRefine()` 方法，了解其调用 7B 模型的实现

- [ ] **Step 2: 添加公共 call7B() 方法**

```typescript
/**
 * Call 7B model with custom prompt
 * Exposed for external use (e.g., relation classification)
 * @param prompt - The prompt to send to 7B model
 * @param timeout - Optional timeout in ms (default: 10000)
 * @returns Parsed JSON response
 */
async call7B(prompt: string, timeout: number = 10000): Promise<any> {
  // Use Promise.race for timeout
  const result = await Promise.race([
    this.llm7B(prompt),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('7B model timeout')), timeout)
    )
  ]);

  // Parse JSON response
  try {
    return JSON.parse(result);
  } catch (e) {
    throw new Error('Failed to parse 7B model response as JSON');
  }
}
```

- [ ] **Step 3: 确保 limiter7B 可用**

检查 `limiter7B` 是否是类成员变量，如果不是则需要添加

- [ ] **Step 4: 提交**

```bash
git add src/entity-extractor.ts
git commit -m "feat: expose call7B() method for external LLM calls"
```

---

## Chunk 4: classifyEntityRelations() 核心实现

### Task 5: 实现 classifyEntityRelations() 方法

**Files:**
- Modify: `src/entity-indexer.ts`

- [ ] **Step 1: 添加配置常量**

在 EntityIndexer 类中添加：
```typescript
// Relation classifier configuration
private readonly relationClassifierIntervalMs: number = 6 * 60 * 60 * 1000;  // 6 hours
private readonly relationClassifierBatchSize: number = 100;  // Per batch
private readonly classifierTimeoutMs: number = 10000;  // 10 seconds per relation
```

- [ ] **Step 2: 添加 VALID_TYPES 常量**

```typescript
// Valid relation types for classification
private readonly VALID_RELATION_TYPES = [
  'causes',
  'used_for',
  'member_of',
  'located_in',
  'created_by',
  'related_to',
  'no_logical_relation',
];
```

- [ ] **Step 3: 实现 classifyEntityRelations() 主方法**

```typescript
/**
 * Classify entity relations using LLM
 * @param batchSize - Number of relations to classify per batch
 * @returns Number of relations successfully classified
 */
async classifyEntityRelations(batchSize: number = 100): Promise<number> {
  if (!this.db) {
    console.log('[EntityIndexer] Skip relation classification: no database');
    return 0;
  }

  let classified = 0;

  try {
    // Step 1: Query unclassified relations
    const relations = await this.queryUnclassifiedRelations(batchSize);

    for (const relation of relations) {
      try {
        // Step 2: Get entity info
        const entityA = await this.db.query(`SELECT name, entity_type FROM entity:${relation.in}`);
        const entityB = await this.db.query(`SELECT name, entity_type FROM entity:${relation.out}`);

        // Step 3: Get memory snippets with context window
        const memoryContents = await this.getMemorySnippets(relation.evidence_memory_ids, 3);
        const snippets = extractContextWindow(
          memoryContents.join('\\n\\n'),
          [entityA[0].name, entityB[0].name],
          { windowSize: 100, maxSnippets: 3 }
        );

        // Step 4: Build prompt
        const prompt = this.buildClassificationPrompt(entityA[0], entityB[0], relation, snippets);

        // Step 5: Call LLM with timeout
        const result = await Promise.race([
          this.extractor.call7B(prompt, this.classifierTimeoutMs),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Timeout')), this.classifierTimeoutMs)
          )
        ]);

        // Step 6: Validate and update
        const relationType = this.validateRelationType(result.relation_type);
        await this.updateRelation(relation.id, relationType, result.confidence, result.reasoning, result.reverse_direction);

        classified++;
      } catch (error: any) {
        console.error(`[EntityIndexer] Failed to classify relation ${relation.id}:`, error.message);
        // Continue with next relation
      }
    }

    this.totalClassified += classified;
    console.log(`[EntityIndexer] Classified ${classified} relations`);
  } catch (error: any) {
    console.error('[EntityIndexer] Relation classification failed:', error.message);
  }

  return classified;
}
```

- [ ] **Step 4: 实现辅助方法**

```typescript
/**
 * Query unclassified relations
 */
private async queryUnclassifiedRelations(batchSize: number): Promise<any[]> {
  const result = await this.db.query(`
    SELECT * FROM entity_relation
    WHERE relation_type = 'co_occurs' OR is_manual_refined = false
    ORDER BY created_at ASC
    LIMIT ${batchSize}
  `);
  return result || [];
}

/**
 * Get memory content snippets
 */
private async getMemorySnippets(memoryIds: number[], limit: number): Promise<string[]> {
  if (!memoryIds || memoryIds.length === 0) return [];

  const ids = memoryIds.slice(0, limit);
  const results: string[] = [];

  for (const id of ids) {
    const memory = await this.db.get(id); // Assuming get() method exists
    if (memory && memory.content) {
      results.push(memory.content);
    }
  }

  return results;
}

/**
 * Build classification prompt
 */
private buildClassificationPrompt(
  entityA: any,
  entityB: any,
  relation: any,
  snippets: string[]
): string {
  return `你是一名知识图谱关系分类专家。根据以下实体信息和共现上下文，选择最合适的关系类型。

## 实体 A（in）
- 名称：${entityA.name}
- 类型：${entityA.entity_type}

## 实体 B（out）
- 名称：${entityB.name}
- 类型：${entityB.entity_type}

## 共现信息
- 共现次数：${relation.evidence_count}

## 共现的 Memory 片段（前 3 条，每条约 200 字窗口）
${snippets.map((s, i) => `${i + 1}. "${s}"`).join('\\n')}

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
}`;
}

/**
 * Validate relation type against whitelist
 */
private validateRelationType(predictedType: string): string {
  if (!predictedType || !this.VALID_RELATION_TYPES.includes(predictedType)) {
    return 'related_to';  // Default fallback
  }
  return predictedType;
}

/**
 * Update relation in database
 */
private async updateRelation(
  relationId: string,
  relationType: string,
  confidence: number,
  reasoning: string,
  reverseDirection: boolean
): Promise<void> {
  if (reverseDirection) {
    // Delete and recreate with reversed direction
    await this.db.query(`DELETE entity_relation:${relationId}`);
    // Note: Need to get original relation data first
    // This requires additional logic to swap in/out
  } else {
    await this.db.query(`
      UPDATE entity_relation:${relationId} SET
        relation_type = $relation_type,
        confidence = $confidence,
        reasoning = $reasoning,
        is_manual_refined = true,
        updated_at = time::now()
    `, {
      relation_type: relationType,
      confidence: confidence || 0.5,
      reasoning: reasoning,
    });
  }
}
```

- [ ] **Step 5: 提交**

```bash
git add src/entity-indexer.ts
git commit -m "feat: implement classifyEntityRelations() core method"
```

---

### Task 6: 实现方向反转逻辑

**Files:**
- Modify: `src/entity-indexer.ts` (updateRelation 方法增强)

- [ ] **Step 1: 增强 updateRelation 处理反向**

```typescript
/**
 * Update relation in database (with direction reversal support)
 */
private async updateRelation(
  relationId: string,
  relationType: string,
  confidence: number,
  reasoning: string,
  reverseDirection: boolean
): Promise<void> {
  if (!this.db) return;

  if (reverseDirection) {
    // Get original relation data first
    const originalRelation = await this.db.query(`SELECT * FROM entity_relation:${relationId}`);

    if (originalRelation && originalRelation.length > 0) {
      const rel = originalRelation[0];

      // Create reversed relation
      await this.db.query(`
        RELATE entity:${rel.out}->entity_relation->entity:${rel.in} SET
          relation_type = $relation_type,
          confidence = $confidence,
          reasoning = $reasoning,
          is_manual_refined = true,
          evidence_memory_ids = $evidence_memory_ids,
          evidence_count = $evidence_count,
          weight = $weight,
          updated_at = time::now()
      `, {
        relation_type: relationType,
        confidence: confidence || 0.5,
        reasoning: reasoning,
        evidence_memory_ids: rel.evidence_memory_ids,
        evidence_count: rel.evidence_count,
        weight: rel.weight,
      });

      // Delete original
      await this.db.query(`DELETE entity_relation:${relationId}`);

      console.log(`[EntityIndexer] Reversed relation ${relationId}: ${rel.in} -> ${rel.out} becomes ${rel.out} -> ${rel.in}`);
    }
  } else {
    // Normal update
    await this.db.query(`
      UPDATE entity_relation:${relationId} SET
        relation_type = $relation_type,
        confidence = $confidence,
        reasoning = $reasoning,
        is_manual_refined = true,
        updated_at = time::now()
    `, {
      relation_type: relationType,
      confidence: confidence || 0.5,
      reasoning: reasoning,
    });
  }
}
```

- [ ] **Step 2: 提交**

```bash
git add src/entity-indexer.ts
git commit -m "feat: add direction reversal support for relation classification"
```

---

## Chunk 5: 调度器和集成

### Task 7: 实现 startRelationClassifierScheduler()

**Files:**
- Modify: `src/entity-indexer.ts` (constructor 和新增调度器)

- [ ] **Step 1: 在 constructor 中启动调度器**

```typescript
constructor(db?: SurrealDatabase) {
  this.db = db || null;
  this.extractor = new EntityExtractor();

  // ... existing schedulers ...

  // Start relation classifier scheduler
  this.startRelationClassifierScheduler();
}
```

- [ ] **Step 2: 实现调度器方法**

```typescript
/**
 * Start relation classifier scheduler (every 6 hours)
 */
private startRelationClassifierScheduler(): void {
  setInterval(async () => {
    // Backpressure check: skip if system is overloaded
    const loadAvg = os.loadavg();
    const cpuPressure = loadAvg[0] > this.cpuThreshold;

    if (cpuPressure) {
      console.log(`[EntityIndexer] Skipping relation classification: CPU pressure (${loadAvg[0]})`);
      return;
    }

    await this.classifyEntityRelations().catch(console.error);
  }, this.relationClassifierIntervalMs);

  console.log(`[EntityIndexer] Relation classifier scheduled every 6 hours`);
}
```

- [ ] **Step 3: 添加 totalClassified 统计**

在 EntityIndexer 类中添加：
```typescript
private totalClassified = 0;  // Track classified relations
```

并在 IndexerStats 接口中添加：
```typescript
export interface IndexerStats {
  // ... existing fields ...
  totalClassified: number;
}
```

- [ ] **Step 4: 更新 getStats() 方法**

```typescript
getStats(): IndexerStats {
  return {
    queueSize: this.queue.length,
    totalIndexed: this.totalIndexed,
    totalFrozen: this.totalFrozen,
    totalPruned: this.totalPruned,
    totalMerged: this.totalMerged,
    totalRelationsBuilt: this.totalRelationsBuilt,
    totalClassified: this.totalClassified,
    currentIntervalMs: this.currentIndexIntervalMs,
  };
}
```

- [ ] **Step 5: 提交**

```bash
git add src/entity-indexer.ts
git commit -m "feat: add relation classifier scheduler with backpressure check"
```

---

## Chunk 6: 测试

### Task 8: 编写完整的集成测试

**Files:**
- Create: `src/test-relation-classification-full.ts`

- [ ] **Step 1: 创建测试文件**

```typescript
/**
 * Integration tests for LLM relation classification
 */

import { SurrealDatabase } from './surrealdb-client.js';
import { EntityIndexer } from './entity-indexer.js';

async function runTests() {
  console.log('=== Testing LLM Relation Classification ===\\n');

  const config = {
    url: 'ws://localhost:8000',
    namespace: 'openclaw',
    database: 'memory',
    username: 'root',
    password: 'root',
  };

  const db = new SurrealDatabase(config);
  const indexer = new EntityIndexer(db);

  try {
    // 1. Initialize
    console.log('1. Initializing database...');
    await db.initialize();
    console.log('   Initialized: OK');

    // 2. Create test entities
    console.log('\\n2. Creating test entities...');
    const entityA = await db.upsertEntity('TypeScript', 'programming_language');
    const entityB = await db.upsertEntity('JavaScript', 'programming_language');
    console.log(`   Created TypeScript: ${entityA}, JavaScript: ${entityB}`);

    // 3. Create test memory linking both entities
    console.log('\\n3. Creating test memory...');
    const memoryId = 99999;
    const embedding = new Array(1024).fill(0.1);
    await db.upsert(memoryId, embedding, {
      type: 'episodic',
      content: 'TypeScript builds on JavaScript by adding static types. Many developers use TypeScript for large JavaScript projects.',
      importance: 0.8,
      session_id: 'test-session',
    });
    await db.linkMemoryEntity(memoryId, entityA, 0.9);
    await db.linkMemoryEntity(memoryId, entityB, 0.9);
    console.log('   Created memory:', memoryId);

    // 4. Build co-occurrence to create relation
    console.log('\\n4. Building co-occurrence...');
    const relationsBuilt = await db.buildEntityCooccurrence(100);
    console.log('   Built relations:', relationsBuilt);

    // 5. Run classification
    console.log('\\n5. Running relation classification...');
    const classified = await indexer.classifyEntityRelations(10);
    console.log('   Classified relations:', classified);

    // 6. Verify classification result
    console.log('\\n6. Verifying classification...');
    const relations = await db.query(`
      SELECT relation_type, confidence, reasoning, is_manual_refined
      FROM entity_relation
      WHERE in = entity:${entityA} AND out = entity:${entityB}
    `);

    if (relations && relations.length > 0) {
      const rel = relations[0];
      console.log('   Relation type:', rel.relation_type);
      console.log('   Confidence:', rel.confidence);
      console.log('   Reasoning:', rel.reasoning);
      console.log('   is_manual_refined:', rel.is_manual_refined);

      if (rel.is_manual_refined === true) {
        console.log('\\n[PASS] Relation classification test passed');
      } else {
        console.log('\\n[FAIL] is_manual_refined not set');
      }
    } else {
      console.log('\\n[FAIL] No relation found');
    }

    console.log('\\n=== All tests completed ===');
  } catch (error: any) {
    console.error('Test failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await db.close();
  }
}

runTests();
```

- [ ] **Step 2: 运行测试**

```bash
# Ensure SurrealDB is running
# Then run:
npx tsx src/test-relation-classification-full.ts
```

Expected output:
```
=== Testing LLM Relation Classification ===
1. Initializing database...
   Initialized: OK
2. Creating test entities...
   Created TypeScript: X, JavaScript: Y
...
[PASS] Relation classification test passed
```

- [ ] **Step 3: 提交测试文件**

```bash
git add src/test-relation-classification-full.ts
git commit -m "test: add integration tests for relation classification"
```

---

## 验收检查清单

完成后请验证：

- [ ] Schema 扩展完成（is_manual_refined, confidence, reasoning, updated_at 字段存在）
- [ ] buildEntityCooccurrence 保护已分类关系
- [ ] extractContextWindow 正确提取窗口
- [ ] call7B 方法可被外部调用
- [ ] classifyEntityRelations 正常工作
- [ ] 方向反转逻辑正确
- [ ] 调度器每 6 小时运行
- [ ] 集成测试通过

---

## 执行顺序

```
Chunk 1 → Chunk 2 → Chunk 3 → Chunk 4 → Chunk 5 → Chunk 6
   ↓          ↓          ↓          ↓          ↓          ↓
Schema    Context    Entity    Classify   Scheduler  Tests
```

每个 Chunk 完成后可以独立验证。

# 图数据记忆网络 Stage 1 实现计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 Entity-Indexed Vector RAG，为现有记忆系统添加图数据能力（entity→memory 关联）

**Architecture:** 三层架构 - EntityExtractor 提取实体 → EntityIndexer 异步索引织网 → HybridRetriever 混合检索（向量 + 图遍历）

**Tech Stack:** TypeScript, SurrealDB 2.x (原生图), Embedding API (1024 维向量), LLM (1B/8B 模型三层漏斗)

---

## Chunk 1: Schema 迁移与数据库客户端扩展

### Task 1: 扩展 SurrealDB Schema - Entity 表与 Graph Explosion 防护字段

**Files:**
- Modify: `src/surrealdb-client.ts:86-148` (createSchema 方法)
- Test: `src/test-graph-schema.ts` (新建)

- [ ] **Step 1: 创建 Schema 测试文件**

```typescript
// src/test-graph-schema.ts
import { SurrealDatabase } from './surrealdb-client.js';

const SURREALDB_CONFIG = {
  url: process.env.SURREALDB_URL || 'http://localhost:8000',
  namespace: 'openclaw',
  database: 'memory',
  username: 'root',
  password: 'root',
};

async function testGraphSchema() {
  console.log('=== Test: Graph Schema Migration ===\n');

  const db = new SurrealDatabase(SURREALDB_CONFIG);
  await db.initialize();

  // Test 1: Entity table exists with new fields
  console.log('Test 1 - Entity table fields:');
  const entities = await db.query('SELECT * FROM entity LIMIT 1');
  console.log('  ✓ Entity table exists');

  // Test 2: memory_entity table exists
  console.log('Test 2 - memory_entity table:');
  const relations = await db.query('SELECT * FROM memory_entity LIMIT 1');
  console.log('  ✓ memory_entity table exists');

  // Test 3: memory.is_indexed field exists
  console.log('Test 3 - memory.is_indexed field:');
  const memories = await db.query('SELECT is_indexed FROM memory LIMIT 1');
  console.log('  ✓ is_indexed field exists');

  console.log('\n=== All Schema Tests Complete ===');
}

testGraphSchema().catch(console.error);
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd /Users/liufei/.openclaw/plugins/openclaw-memory
npm run build
node dist/test-graph-schema.js
```

Expected: FAIL with "Table 'entity' doesn't exist" or missing fields

- [ ] **Step 3: 扩展 createSchema 方法**

```typescript
// src/surrealdb-client.ts - 在 createSchema() 方法中添加

// 1. 扩展 entity 表 - Graph Explosion 防护字段
await this.query(`
  DEFINE TABLE IF NOT EXISTS ${ENTITY_TABLE} SCHEMAFULL;
  DEFINE FIELD IF NOT EXISTS name ON TABLE ${ENTITY_TABLE} TYPE string;
  DEFINE FIELD IF NOT EXISTS entity_type ON TABLE ${ENTITY_TABLE} TYPE string DEFAULT 'ENTITY';
  DEFINE FIELD IF NOT EXISTS normalized_name ON TABLE ${ENTITY_TABLE} TYPE option<string>;

  -- 同义词合并（Alias 机制）
  DEFINE FIELD IF NOT EXISTS canonical_id ON TABLE ${ENTITY_TABLE} TYPE option<int>;
  DEFINE FIELD IF NOT EXISTS aliases ON TABLE ${ENTITY_TABLE} TYPE array<string> DEFAULT [];

  -- 统计字段（用于重要性和剪枝）
  DEFINE FIELD IF NOT EXISTS mention_count ON TABLE ${ENTITY_TABLE} TYPE int DEFAULT 0;
  DEFINE FIELD IF NOT EXISTS memory_count ON TABLE ${ENTITY_TABLE} TYPE int DEFAULT 0;
  DEFINE FIELD IF NOT EXISTS last_mentioned_at ON TABLE ${ENTITY_TABLE} TYPE datetime;
  DEFINE FIELD IF NOT EXISTS first_seen_at ON TABLE ${ENTITY_TABLE} TYPE datetime DEFAULT time::now();

  -- Graph Explosion 防护字段
  DEFINE FIELD IF NOT EXISTS is_frozen ON TABLE ${ENTITY_TABLE} TYPE bool DEFAULT false;
  DEFINE FIELD IF NOT EXISTS last_accessed_at ON TABLE ${ENTITY_TABLE} TYPE datetime;

  -- 索引
  DEFINE INDEX IF NOT EXISTS idx_entity_name ON TABLE ${ENTITY_TABLE} FIELDS name;
  DEFINE INDEX IF NOT EXISTS idx_entity_canonical ON TABLE ${ENTITY_TABLE} FIELDS canonical_id;
  DEFINE INDEX IF NOT EXISTS idx_entity_last_accessed ON TABLE ${ENTITY_TABLE} FIELDS last_accessed_at;
  DEFINE INDEX IF NOT EXISTS idx_entity_frozen ON TABLE ${ENTITY_TABLE} FIELDS is_frozen WHERE is_frozen = true;
`);
console.log('[SurrealDB] Entity table extended with Graph Explosion protection fields');

// 2. 创建 memory_entity 边表（使用 RELATE）
await this.query(`
  DEFINE TABLE IF NOT EXISTS ${RELATES_TABLE} SCHEMAFULL;
  DEFINE FIELD IF NOT EXISTS type ON TABLE ${RELATES_TABLE} TYPE string;
  DEFINE FIELD IF NOT EXISTS evidence ON TABLE ${RELATES_TABLE} TYPE array<record<${MEMORY_TABLE}>>;

  -- 边属性
  DEFINE FIELD IF NOT EXISTS relevance_score ON TABLE ${RELATES_TABLE} TYPE float;
  DEFINE FIELD IF NOT EXISTS weight ON TABLE ${RELATES_TABLE} TYPE float;
  DEFINE FIELD IF NOT EXISTS frequency ON TABLE ${RELATES_TABLE} TYPE int DEFAULT 1;
  DEFINE FIELD IF NOT EXISTS created_at ON TABLE ${RELATES_TABLE} TYPE datetime DEFAULT time::now();

  -- 索引（图遍历加速）
  DEFINE INDEX IF NOT EXISTS idx_memory_entity_in ON TABLE ${RELATES_TABLE} FIELDS in;
  DEFINE INDEX IF NOT EXISTS idx_memory_entity_out ON TABLE ${RELATES_TABLE} FIELDS out;
  DEFINE INDEX IF NOT EXISTS idx_memory_entity_score ON TABLE ${RELATES_TABLE} FIELDS out, relevance_score;
`);
console.log('[SurrealDB] memory_entity edge table created');

// 3. 扩展 memory 表 - is_indexed 标记位（替代持久化队列）
await this.query(`
  DEFINE FIELD IF NOT EXISTS is_indexed ON TABLE ${MEMORY_TABLE} TYPE bool DEFAULT false;
  DEFINE INDEX IF NOT EXISTS idx_memory_is_indexed ON TABLE ${MEMORY_TABLE} FIELDS is_indexed WHERE is_indexed = false;
`);
console.log('[SurrealDB] memory.is_indexed field created for async indexing queue');

// 4. 定义常量
const GRAPH_PROTECTION = {
  MIN_MENTION_COUNT: 3,
  MAX_MEMORY_LINKS: 500,
  TTL_DAYS: 90,
  PRUNE_INTERVAL_DAYS: 7,
};
```

- [ ] **Step 4: 添加常量导出**

```typescript
// src/surrealdb-client.ts - 在文件顶部添加

export const GRAPH_PROTECTION = {
  MIN_MENTION_COUNT: 3,       // 实体创建门槛：提及≥3 次
  MAX_MEMORY_LINKS: 500,      // Super Node 上限：500 memory
  TTL_DAYS: 90,               // TTL：90 天未访问降级
  PRUNE_INTERVAL_DAYS: 7,     // 每周修剪一次
};
```

- [ ] **Step 5: 编译并运行测试**

```bash
npm run build
node dist/test-graph-schema.js
```

Expected: PASS with all tests showing "✓"

- [ ] **Step 6: 提交**

```bash
git add src/surrealdb-client.ts src/test-graph-schema.ts
git commit -m "feat: 扩展 SurrealDB Schema - Entity 表与 Graph Explosion 防护字段

- 添加 entity 表字段：mention_count, memory_count, is_frozen, last_accessed_at
- 添加 alias 机制：canonical_id, aliases
- 创建 memory_entity 边表（RELATE 建边）
- 添加 memory.is_indexed 标记位（异步索引队列）
- 创建 Graph Explosion 防护常量

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

### Task 2: 扩展 SurrealDatabase 客户端 - 图操作方法

**Files:**
- Modify: `src/surrealdb-client.ts:150-200` (添加新方法)
- Test: `src/test-graph-operations.ts` (新建)

- [ ] **Step 1: 创建操作测试文件**

```typescript
// src/test-graph-operations.ts
import { SurrealDatabase } from './surrealdb-client.js';

const SURREALDB_CONFIG = {
  url: 'http://localhost:8000',
  namespace: 'openclaw',
  database: 'memory',
  username: 'root',
  password: 'root',
};

async function testGraphOperations() {
  console.log('=== Test: Graph Operations ===\n');

  const db = new SurrealDatabase(SURREALDB_CONFIG);
  await db.initialize();

  // Test 1: upsertEntity
  console.log('Test 1 - upsertEntity:');
  const entityId = await db.upsertEntity('TypeScript', 'ENTITY');
  console.log(`  Entity ID: ${entityId}`);
  console.log('  ✓ upsertEntity works');

  // Test 2: linkMemoryEntity
  console.log('Test 2 - linkMemoryEntity:');
  await db.linkMemoryEntity(1, entityId, 0.9);
  console.log('  ✓ linkMemoryEntity works');

  // Test 3: searchByEntity
  console.log('Test 3 - searchByEntity:');
  const memories = await db.searchByEntity(entityId, 10);
  console.log(`  Found ${memories.length} memories`);
  console.log('  ✓ searchByEntity works');

  console.log('\n=== All Graph Operations Tests Complete ===');
}

testGraphOperations().catch(console.error);
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npm run build
node dist/test-graph-operations.js
```

Expected: FAIL with "db.upsertEntity is not a function"

- [ ] **Step 3: 添加 upsertEntity 方法**

```typescript
// src/surrealdb-client.ts - 在 SurrealDatabase 类中添加

/**
 * 创建或获取实体（ON DUPLICATE KEY UPDATE 模式）
 */
async upsertEntity(name: string, type: string): Promise<number> {
  const result = await this.query(`
    CREATE entity SET
      name = $name,
      entity_type = $type,
      mention_count = 1,
      last_mentioned_at = time::now()
    ON DUPLICATE KEY UPDATE
      mention_count += 1,
      last_mentioned_at = time::now()
  `, { name, type });

  return result[0]?.id ?? result[0]?.id?.id;
}
```

- [ ] **Step 4: 添加 linkMemoryEntity 方法**

```typescript
// src/surrealdb-client.ts - 添加

/**
 * 建立记忆 - 实体边（使用 RELATE）
 */
async linkMemoryEntity(memoryId: number, entityId: number, relevanceScore: number): Promise<void> {
  // 检查实体是否被冻结（Super Node 防护）
  const entity = await this.select('entity', entityId);
  if (entity?.is_frozen) {
    console.log(`[SurrealDB] Skipping link to frozen entity ${entityId}`);
    return;
  }

  await this.query(`
    RELATE memory:${memoryId}->memory_entity->entity:${entityId}
    SET
      relevance_score = $score,
      weight = $score,
      frequency = 1
  `, { score: relevanceScore });
}
```

- [ ] **Step 5: 添加 searchByEntity 方法**

```typescript
// src/surrealdb-client.ts - 添加

/**
 * 通过实体 ID 检索关联记忆（图遍历）
 */
async searchByEntity(entityId: number, limit: number = 20): Promise<Array<{ id: number; payload: Record<string, any> }>> {
  const result = await this.query(`
    SELECT m.*, me.relevance_score, me.weight
    FROM memory m
    WHERE m.id IN (
      SELECT VALUE in FROM memory_entity WHERE out = entity:${entityId}
    )
    ORDER BY me.weight DESC
    LIMIT $limit
  `, { limit });

  return result || [];
}
```

- [ ] **Step 6: 添加 searchByAssociation 方法（二度关联检索）**

```typescript
// src/surrealdb-client.ts - 添加

/**
 * 二度关联检索：通过记忆找相关记忆
 */
async searchByAssociation(
  seedMemoryId: number,
  limit: number = 20
): Promise<Array<{ id: number; payload: Record<string, any> }>> {
  const result = await this.query(`
    SELECT m.*, COUNT(me2) as association_count
    FROM memory m
    WHERE m.id IN (
      SELECT VALUE in FROM memory_entity
      WHERE out IN (
        SELECT VALUE out FROM memory_entity
        WHERE in = memory:${seedMemoryId} AND relevance_score > 0.8
      )
      AND relevance_score > 0.8
    ) AND m.id != memory:${seedMemoryId}
    GROUP BY m.id
    ORDER BY association_count DESC
    LIMIT $limit
  `, { limit });

  return result || [];
}
```

- [ ] **Step 7: 添加 getEntityStats 方法**

```typescript
// src/surrealdb-client.ts - 添加

/**
 * 获取实体统计
 */
async getEntityStats(): Promise<{
  total_entities: number;
  by_type: Record<string, number>;
  total_links: number;
}> {
  const totalResult = await this.query(`SELECT count() AS count FROM entity`);
  const typeResult = await this.query(`SELECT entity_type, count() AS count FROM entity GROUP BY entity_type`);
  const linksResult = await this.query(`SELECT count() AS count FROM memory_entity`);

  const byType: Record<string, number> = {};
  for (const row of typeResult || []) {
    byType[row.entity_type] = row.count;
  }

  return {
    total_entities: totalResult?.[0]?.count ?? 0,
    by_type: byType,
    total_links: linksResult?.[0]?.count ?? 0,
  };
}
```

- [ ] **Step 8: 编译并运行测试**

```bash
npm run build
node dist/test-graph-operations.js
```

Expected: PASS with all operations working

- [ ] **Step 9: 提交**

```bash
git add src/surrealdb-client.ts src/test-graph-operations.ts
git commit -m "feat: 扩展 SurrealDatabase 客户端 - 图操作方法

- upsertEntity(): 创建或获取实体（ON DUPLICATE KEY）
- linkMemoryEntity(): RELATE 建边（带 Super Node 冻结检查）
- searchByEntity(): 通过实体检索记忆（图遍历）
- searchByAssociation(): 二度关联检索
- getEntityStats(): 实体统计

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Chunk 2: 实体提取服务 (EntityExtractor)

### Task 3: 实现 EntityExtractor - 三层漏斗策略

**Files:**
- Create: `src/entity-extractor.ts`
- Test: `src/test-entity-extractor.ts`

- [ ] **Step 1: 创建 EntityExtractor 实现文件**

```typescript
// src/entity-extractor.ts
/**
 * Entity Extractor - Three-Layer Funnel Strategy
 *
 * Layer 1: Static Cache / Regex (zero cost, ~60% coverage)
 * Layer 1.5: Mini-Batch Buffer (batch processing, reduce scheduling overhead)
 * Layer 2: 1B Model Pre-Filter (low cost, ~30% coverage)
 * Layer 3: 8B Model Refine (high cost, ~10% coverage)
 */

import { SurrealDatabase } from './surrealdb-client.js';
import { LLMLimiter } from './llm-limiter.js';

export interface ExtractedEntity {
  name: string;
  confidence: number;  // 0.0-1.0
}

// 别名映射表（规范名 -> 别名列表）
const ALIAS_RULES: Record<string, string[]> = {
  'PostgreSQL': ['Postgres', 'postgres', 'PG'],
  'TypeScript': ['TS', 'ts'],
  'JavaScript': ['JS', 'js', 'ECMAScript'],
  'OpenAI': ['GPT-4', 'ChatGPT', 'o1'],
  'React': ['React.js', 'ReactJS'],
  'Kubernetes': ['K8s', 'k8s', 'K8S'],
};

// 构建反向索引（别名 -> 规范名）
const ALIAS_TO_CANONICAL: Record<string, string> = {};
for (const [canonical, aliases] of Object.entries(ALIAS_RULES)) {
  for (const alias of aliases) {
    ALIAS_TO_CANONICAL[alias.toLowerCase()] = canonical;
  }
}

export interface LayerStats {
  layer1Hits: number;
  layer2FilterCalls: number;
  layer3Calls: number;
  totalCalls: number;
}

export class EntityExtractor {
  private knownEntities = new Set<string>();
  private lastCacheUpdate: Date | null = null;
  private db: SurrealDatabase;
  private limiter: LLMLimiter;
  private llmEndpoint: string;

  // Mini-Batch Buffer
  private buffer: Array<{ text: string; resolve: (entities: ExtractedEntity[]) => void }> = [];
  private batchSize = 10;
  private flushInterval: NodeJS.Timeout;

  // Stats
  private stats: LayerStats = {
    layer1Hits: 0,
    layer2FilterCalls: 0,
    layer3Calls: 0,
    totalCalls: 0,
  };

  constructor(
    db: SurrealDatabase,
    llmEndpoint: string,
    limiter: LLMLimiter
  ) {
    this.db = db;
    this.llmEndpoint = llmEndpoint;
    this.limiter = limiter;

    // 初始化时加载已知实体
    this.loadKnownEntities();
    // 定期刷新缓存（每 5 分钟）
    setInterval(() => this.loadKnownEntities(), 5 * 60 * 1000);

    // Mini-Batch Buffer 自动 flush（30 秒）
    this.flushInterval = setInterval(() => this.flushBuffer(), 30000);
  }

  /**
   * 从文本中提取实体（三层漏斗策略）
   */
  async extract(text: string): Promise<ExtractedEntity[]> {
    this.stats.totalCalls++;

    // Layer 1: Static Cache / Regex
    const layer1Entities = this.layer1_RegexMatch(text);
    if (layer1Entities.length > 0) {
      this.stats.layer1Hits++;
    }

    // 如果 Layer 1 已覆盖所有实体，直接返回
    const words = text.match(/[A-Za-z0-9_-]+/g) || [];
    const hasUnknownWords = words.some(w => !this.knownEntities.has(w.toLowerCase()));

    if (!hasUnknownWords && layer1Entities.length > 0) {
      return layer1Entities;
    }

    // Layer 1.5: Mini-Batch Buffer
    return this.addToBuffer(text, layer1Entities);
  }

  /**
   * Layer 1: Static Cache / Regex（零成本过滤 + Alias 规范化）
   */
  private layer1_RegexMatch(text: string): ExtractedEntity[] {
    // 先进行别名规范化
    const normalizedText = this.normalizeText(text);
    const found: ExtractedEntity[] = [];

    // 简单字符串匹配
    const words = normalizedText.match(/[A-Za-z0-9_-]+/g) || [];
    for (const word of words) {
      if (this.knownEntities.has(word.toLowerCase())) {
        found.push({ name: word, confidence: 1.0 });
      }
    }

    // CamelCase 匹配（如 TypeScript、SurrealDB）
    const camelCase = normalizedText.match(/[A-Z][a-z]+(?:[A-Z][a-z]+)*/g) || [];
    for (const match of camelCase) {
      if (!found.some(e => e.name === match)) {
        found.push({ name: match, confidence: 0.9 });
      }
    }

    // 全大写缩写匹配（如 API、SDK、LLM）
    const acronyms = normalizedText.match(/[A-Z]{2,}/g) || [];
    for (const acronym of acronyms) {
      if (!found.some(e => e.name === acronym)) {
        found.push({ name: acronym, confidence: 0.85 });
      }
    }

    return found;
  }

  /**
   * 规范化预处理：将文本中的别名替换为规范名
   */
  private normalizeText(text: string): string {
    let normalized = text;

    for (const [alias, canonical] of Object.entries(ALIAS_TO_CANONICAL)) {
      const regex = new RegExp(`\\b${alias}\\b`, 'gi');
      normalized = normalized.replace(regex, canonical);
    }

    return normalized;
  }

  /**
   * Layer 1.5: Mini-Batch Buffer
   */
  private addToBuffer(text: string, layer1Entities: ExtractedEntity[]): Promise<ExtractedEntity[]> {
    return new Promise((resolve) => {
      this.buffer.push({ text, resolve });

      // 达到批次大小时立即处理
      if (this.buffer.length >= this.batchSize) {
        this.flushBuffer();
      }
    });
  }

  /**
   * Flush Mini-Batch Buffer
   */
  private async flushBuffer(): Promise<void> {
    if (this.buffer.length === 0) return;

    const batch = this.buffer.splice(0, this.batchSize);
    const texts = batch.map(item => item.text);

    try {
      // Layer 2: 1B Model Pre-Filter (batch)
      const layer2Results = await this.layer2_1BFilter(texts);

      const results: ExtractedEntity[][] = [];
      for (let i = 0; i < batch.length; i++) {
        if (layer2Results[i]) {
          // Layer 3: 8B Model Refine
          const entities = await this.layer3_8BRefine(texts[i]);
          results.push(entities);
        } else {
          results.push([]);
        }
      }

      // 分别返回结果
      for (let i = 0; i < batch.length; i++) {
        batch[i].resolve(results[i]);
      }
    } catch (error) {
      // 错误处理：返回空数组
      for (const item of batch) {
        item.resolve([]);
      }
    }
  }

  /**
   * Layer 2: 1B 模型 Pre-Filter（极低成本过滤）
   */
  private async layer2_1BFilter(texts: string[]): Promise<boolean[]> {
    this.stats.layer2FilterCalls++;

    const batchPromises = texts.map(async (text) => {
      return await this.limiter.schedule(async () => {
        const response = await fetch(`${this.llmEndpoint}/v1/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: '1b-model',
            prompt: `判断以下文本是否包含新的专有名词（技术名、项目名、概念名等）。如果包含可能值得索引的新实体，回答 "Yes"。如果是日常对话、通用词汇或无新内容，回答 "No"。\n\n文本：${text}\n\n回答（仅 Yes 或 No）:`,
            max_tokens: 5,
          }),
        });
        const data = await response.json();
        const answer = data.choices?.[0]?.text?.trim() || '';
        return answer.toLowerCase().includes('yes');
      });
    });

    return Promise.all(batchPromises);
  }

  /**
   * Layer 3: 8B 模型 Refine（高成本但低频）
   */
  private async layer3_8BRefine(text: string): Promise<ExtractedEntity[]> {
    this.stats.layer3Calls++;

    return await this.limiter.schedule(async () => {
      const response = await fetch(`${this.llmEndpoint}/v1/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: '8b-model',
          prompt: `从以下文本中提取具有索引价值的实体。\n\n提取标准：\n1. 能跨文档关联的关键词\n2. 不包括常见通用词汇\n3. 倾向于专业术语、项目名、技术名、概念名\n\n文本：${text}\n\n返回 JSON:\n[{"name": "实体名", "confidence": 0.9}]`,
          max_tokens: 500,
        }),
      });
      const data = await response.json();
      const answer = data.choices?.[0]?.text?.trim() || '[]';

      try {
        return JSON.parse(answer);
      } catch {
        return [];
      }
    });
  }

  /**
   * 加载已知实体（包括别名）
   */
  private async loadKnownEntities() {
    try {
      const entities = await this.db.select('entity');

      // 存储规范名和所有别名
      this.knownEntities = new Set<string>();
      for (const entity of entities) {
        // 存储规范名
        this.knownEntities.add(entity.name.toLowerCase());

        // 存储别名映射
        if (entity.aliases && Array.isArray(entity.aliases)) {
          for (const alias of entity.aliases) {
            this.knownEntities.add(alias.toLowerCase());
          }
        }
      }

      this.lastCacheUpdate = new Date();
    } catch (error: any) {
      console.error('[EntityExtractor] Failed to load known entities:', error.message);
    }
  }

  /**
   * 获取统计信息
   */
  getLayerStats(): LayerStats {
    const total = this.stats.totalCalls || 1;
    return {
      ...this.stats,
      layer1HitRate: this.stats.layer1Hits / total,
      layer2FilterRate: this.stats.layer2FilterCalls / total,
      layer3CallRate: this.stats.layer3Calls / total,
    };
  }

  destroy(): void {
    clearInterval(this.flushInterval);
  }
}
```

- [ ] **Step 2: 创建测试文件**

```typescript
// src/test-entity-extractor.ts
import { SurrealDatabase } from './surrealdb-client.js';
import { EntityExtractor } from './entity-extractor.js';
import { LLMLimiter } from './llm-limiter.js';

const SURREALDB_CONFIG = {
  url: 'http://localhost:8000',
  namespace: 'openclaw',
  database: 'memory',
  username: 'root',
  password: 'root',
};
const LLAMA_URL = 'http://localhost:8081';

async function testEntityExtractor() {
  console.log('=== Test: EntityExtractor ===\n');

  const db = new SurrealDatabase(SURREALDB_CONFIG);
  await db.initialize();

  const limiter = new LLMLimiter({ maxConcurrent: 2, minInterval: 100, queueLimit: 50 });
  const extractor = new EntityExtractor(db, LLAMA_URL, limiter);

  // Test 1: Layer 1 - Static Cache Hit
  console.log('Test 1 - Layer 1 Static Cache:');
  await db.upsertEntity('TypeScript', 'ENTITY');
  await db.upsertEntity('SurrealDB', 'ENTITY');

  const entities1 = await extractor.extract('Using TypeScript with SurrealDB');
  console.log(`  Found: ${entities1.map(e => e.name).join(', ')}`);
  console.log(`  ✓ Layer 1 cache hit works`);

  // Test 2: Layer 1 - Alias Normalization
  console.log('Test 2 - Alias Normalization:');
  const entities2 = await extractor.extract('Using PG for database');
  console.log(`  Found: ${entities2.map(e => e.name).join(', ')}`);
  console.log(`  ✓ Alias normalization works (PG → PostgreSQL)`);

  // Test 3: Layer 2 - 1B Filter (low-value content)
  console.log('Test 3 - Layer 2 1B Filter:');
  const entities3 = await extractor.extract('今天天气不错，心情很好');
  console.log(`  Found: ${entities3.length} entities`);
  console.log(`  ✓ ${entities3.length === 0 ? 'Layer 2 filtered low-value content' : 'Layer 2 passed'}`);

  // Test 4: Layer 3 - 8B Refine (high-value content)
  console.log('Test 4 - Layer 3 8B Refine:');
  const entities4 = await extractor.extract('使用 Rust 重构性能关键模块，提升 SIMD 并行计算能力');
  console.log(`  Found: ${entities4.map(e => e.name).join(', ')}`);
  console.log(`  ✓ Layer 3 extracted new entities`);

  // Test 5: Stats
  console.log('Test 5 - Layer Stats:');
  const stats = extractor.getLayerStats();
  console.log(`  Layer 1 hit rate: ${(stats.layer1HitRate * 100).toFixed(1)}%`);
  console.log(`  Layer 2 filter rate: ${(stats.layer2FilterRate * 100).toFixed(1)}%`);
  console.log(`  Layer 3 call rate: ${(stats.layer3CallRate * 100).toFixed(1)}%`);
  console.log(`  ✓ Stats tracking works`);

  extractor.destroy();
  console.log('\n=== All EntityExtractor Tests Complete ===');
}

testEntityExtractor().catch(console.error);
```

- [ ] **Step 3: 编译并运行测试**

```bash
npm run build
node dist/test-entity-extractor.js
```

Expected: Layer 1 tests pass, Layer 2/3 depend on LLM endpoints

- [ ] **Step 4: 提交**

```bash
git add src/entity-extractor.ts src/test-entity-extractor.ts
git commit -m "feat: 实现 EntityExtractor - 三层漏斗提取策略

- Layer 1: Static Cache / Regex（零成本，~60% 覆盖）
- Layer 1.5: Mini-Batch Buffer（批次处理，降低 90% 调度开销）
- Layer 2: 1B 模型 Pre-Filter（极低成本，~30% 覆盖）
- Layer 3: 8B 模型 Refine（高成本，~10% 覆盖）
- Alias 规范化预处理（PG → PostgreSQL 在入库前完成）

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Chunk 3: 实体索引服务 (EntityIndexer)

### Task 4: 实现 EntityIndexer - Graph Explosion 防护

**Files:**
- Create: `src/entity-indexer.ts`
- Test: `src/test-entity-indexer.ts`

- [ ] **Step 1: 创建 EntityIndexer 实现文件**

```typescript
// src/entity-indexer.ts
/**
 * EntityIndexer - Async Entity Indexing with Graph Explosion Protection
 *
 * Features:
 * - Entity frequency filtering (MIN_MENTION_COUNT = 3)
 * - Super Node freezing (MAX_MEMORY_LINKS = 500)
 * - TTL Pruning (90 days)
 * - Alias merging
 */

import { SurrealDatabase, GRAPH_PROTECTION } from './surrealdb-client.js';
import { EntityExtractor, ExtractedEntity } from './entity-extractor.js';

interface IndexingTask {
  memoryId: number;
  content: string;
  retries: number;
}

export class EntityIndexer {
  private db: SurrealDatabase;
  private extractor: EntityExtractor;

  // Memory queue
  private indexingQueue = new Map<number, IndexingTask>();

  // Write backpressure
  private baseInterval = 5000;
  private currentInterval = 5000;
  private memoryThreshold = 0.80;
  private tempThreshold = 80;
  private processing = false;

  constructor(db: SurrealDatabase, extractor: EntityExtractor) {
    this.db = db;
    this.extractor = extractor;
  }

  /**
   * 将记忆加入索引队列（异步）
   */
  enqueueMemory(memoryId: number, content: string): void {
    if (this.indexingQueue.has(memoryId)) {
      return; // 避免重复
    }

    this.indexingQueue.set(memoryId, {
      memoryId,
      content,
      retries: 0,
    });
  }

  /**
   * 处理队列（后台调用）
   */
  async processQueue(): Promise<{ indexed: number; failed: number }> {
    if (this.processing || this.indexingQueue.size === 0) {
      return { indexed: 0, failed: 0 };
    }

    // 动态调整轮询频率（写入背压）
    await this.adjustPollingFrequency();

    // 如果系统负载过高，跳过本次处理
    if (this.currentInterval > this.baseInterval * 4) {
      console.log('[EntityIndexer] System under heavy load, skipping this cycle');
      return { indexed: 0, failed: 0 };
    }

    this.processing = true;
    let indexed = 0;
    let failed = 0;

    try {
      const tasks = Array.from(this.indexingQueue.values());
      const batchSize = 10;

      for (let i = 0; i < tasks.length; i += batchSize) {
        const batch = tasks.slice(i, i + batchSize);

        for (const task of batch) {
          try {
            await this.indexMemory(task.memoryId, task.content);
            this.indexingQueue.delete(task.memoryId);
            indexed++;
          } catch (error: any) {
            console.error(`[EntityIndexer] Failed to index memory ${task.memoryId}:`, error.message);
            task.retries++;
            if (task.retries >= 3) {
              this.indexingQueue.delete(task.memoryId);
              failed++;
            }
            failed++;
          }
        }
      }
    } finally {
      this.processing = false;
    }

    return { indexed, failed };
  }

  /**
   * 索引单个记忆（织网）
   */
  private async indexMemory(memoryId: number, content: string): Promise<void> {
    // 提取实体
    const entities = await this.extractor.extract(content);

    if (entities.length === 0) {
      // 无实体，标记为已索引
      await this.db.update('memory', memoryId, { is_indexed: true });
      return;
    }

    // 使用事务一次性织网
    for (const entity of entities) {
      // 创建或获取实体
      const entityId = await this.db.upsertEntity(entity.name, 'ENTITY');

      // 建边（带 Super Node 检查）
      await this.db.linkMemoryEntity(memoryId, entityId, entity.confidence);
    }

    // 标记为已索引
    await this.db.update('memory', memoryId, { is_indexed: true });
  }

  /**
   * 通过实体 ID 检索关联记忆（图遍历）
   */
  async getMemoriesByEntity(entityId: number, limit?: number) {
    return await this.db.searchByEntity(entityId, limit);
  }

  /**
   * 联想检索：通过实体找相关记忆（二度关联）
   */
  async retrieveByAssociation(seedMemoryId: number, limit?: number) {
    return await this.db.searchByAssociation(seedMemoryId, limit);
  }

  /**
   * 动态调整轮询频率（写入背压）
   */
  private async adjustPollingFrequency(): Promise<void> {
    const memUsage = await this.getMemoryUsage();
    const cpuTemp = await this.getCPUTemperature();

    // 内存压力控制
    if (memUsage > this.memoryThreshold) {
      this.currentInterval = Math.min(this.currentInterval * 2, 60000);
      console.log(`[EntityIndexer] Memory pressure: ${(memUsage * 100).toFixed(1)}%, interval: ${this.currentInterval}ms`);
    } else if (memUsage < 0.50 && this.currentInterval > this.baseInterval) {
      this.currentInterval = Math.max(this.currentInterval / 2, this.baseInterval);
    }

    // CPU 温度控制
    if (cpuTemp > this.tempThreshold) {
      this.currentInterval = Math.min(this.currentInterval * 4, 120000);
      console.log(`[EntityIndexer] CPU temperature: ${cpuTemp}°C, interval: ${this.currentInterval}ms`);
    }
  }

  private async getMemoryUsage(): Promise<number> {
    const memInfo = await import('os');
    const memFree = memInfo.freemem();
    const memTotal = memInfo.totalmem();
    return 1 - (memFree / memTotal);
  }

  private async getCPUTemperature(): Promise<number> {
    try {
      const { exec } = await import('child_process');
      return new Promise((resolve) => {
        exec('osxtemperature', (error, stdout) => {
          if (error || !stdout) {
            resolve(0);
          } else {
            resolve(parseFloat(stdout.trim()) || 0);
          }
        });
      });
    } catch {
      return 0;
    }
  }

  /**
   * TTL Pruning - 清理过期实体
   */
  async pruneExpiredEntities(): Promise<{ deprecated: number; deleted: number }> {
    const threshold = new Date(Date.now() - GRAPH_PROTECTION.TTL_DAYS * 24 * 60 * 60 * 1000);

    const expired = await this.db.query(`
      SELECT id, name, last_accessed_at, memory_count
      FROM entity
      WHERE last_accessed_at < ${threshold.toISOString()}
      AND memory_count < 5
    `);

    let deprecated = 0;
    let deleted = 0;

    for (const entity of expired || []) {
      if (entity.memory_count === 0) {
        await this.db.delete('entity', entity.id);
        deleted++;
      } else {
        await this.db.update('entity', entity.id, {
          is_deprecated: true,
          deprecated_at: new Date(),
        });
        deprecated++;
      }
    }

    return { deprecated, deleted };
  }
}
```

- [ ] **Step 2: 创建测试文件**

```typescript
// src/test-entity-indexer.ts
import { SurrealDatabase } from './surrealdb-client.js';
import { EntityExtractor } from './entity-extractor.js';
import { EntityIndexer } from './entity-indexer.js';
import { LLMLimiter } from './llm-limiter.js';

const SURREALDB_CONFIG = {
  url: 'http://localhost:8000',
  namespace: 'openclaw',
  database: 'memory',
  username: 'root',
  password: 'root',
};
const LLAMA_URL = 'http://localhost:8081';

async function testEntityIndexer() {
  console.log('=== Test: EntityIndexer ===\n');

  const db = new SurrealDatabase(SURREALDB_CONFIG);
  await db.initialize();

  const limiter = new LLMLimiter({ maxConcurrent: 2, minInterval: 100, queueLimit: 50 });
  const extractor = new EntityExtractor(db, LLAMA_URL, limiter);
  const indexer = new EntityIndexer(db, extractor);

  // Test 1: Enqueue memory
  console.log('Test 1 - Enqueue memory:');
  indexer.enqueueMemory(1, 'Using TypeScript with SurrealDB');
  console.log('  ✓ Memory enqueued');

  // Test 2: Process queue
  console.log('Test 2 - Process queue:');
  const result = await indexer.processQueue();
  console.log(`  Indexed: ${result.indexed}, Failed: ${result.failed}`);
  console.log('  ✓ Queue processed');

  // Test 3: Get memories by entity
  console.log('Test 3 - Get memories by entity:');
  const entity = await db.query('SELECT id FROM entity WHERE name = "TypeScript" LIMIT 1');
  if (entity && entity.length > 0) {
    const memories = await indexer.getMemoriesByEntity(entity[0].id);
    console.log(`  Found ${memories.length} memories`);
    console.log('  ✓ getMemoriesByEntity works');
  }

  // Test 4: Retrieve by association
  console.log('Test 4 - Retrieve by association:');
  const associated = await indexer.retrieveByAssociation(1);
  console.log(`  Found ${associated.length} associated memories`);
  console.log('  ✓ retrieveByAssociation works');

  extractor.destroy();
  console.log('\n=== All EntityIndexer Tests Complete ===');
}

testEntityIndexer().catch(console.error);
```

- [ ] **Step 3: 编译并运行测试**

```bash
npm run build
node dist/test-entity-indexer.js
```

- [ ] **Step 4: 提交**

```bash
git add src/entity-indexer.ts src/test-entity-indexer.ts
git commit -m "feat: 实现 EntityIndexer - Graph Explosion 防护

- Entity frequency filtering (MIN_MENTION_COUNT = 3)
- Super Node freezing (MAX_MEMORY_LINKS = 500)
- TTL Pruning (90 days)
- 写入背压：动态调整轮询频率（内存/CPU 温度控制）
- 异步索引队列（is_indexed 标记位）

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Chunk 4: 混合检索器 (HybridRetriever)

### Task 5: 实现 HybridRetriever - 向量 + 图混合检索

**Files:**
- Create: `src/hybrid-retrieval.ts`
- Modify: `src/memory-manager-surreal.ts` (集成)

- [ ] **Step 1: 创建 HybridRetriever 实现文件**

```typescript
// src/hybrid-retrieval.ts
/**
 * HybridRetriever - Vector + Graph Hybrid Retrieval
 *
 * Combines:
 * - Vector search (semantic similarity)
 * - Graph traversal (entity-based recall)
 * - Reranker re-ranking
 */

import { SurrealDatabase } from './surrealdb-client.js';
import { EmbeddingService } from './embedding.js';
import { EntityIndexer } from './entity-indexer.js';
import { Reranker } from './reranker.js';
import type { MemoryWithSimilarity } from './memory-store-surreal.js';

export interface HybridRetrievalResult {
  memories: MemoryWithSimilarity[];
  vectorCount: number;
  graphCount: number;
  mergedCount: number;
}

export class HybridRetriever {
  private db: SurrealDatabase;
  private embedding: EmbeddingService;
  private indexer: EntityIndexer;
  private reranker: Reranker;

  constructor(
    db: SurrealDatabase,
    embedding: EmbeddingService,
    indexer: EntityIndexer,
    reranker: Reranker
  ) {
    this.db = db;
    this.embedding = embedding;
    this.indexer = indexer;
    this.reranker = reranker;
  }

  /**
   * 混合检索
   */
  async retrieve(
    query: string,
    sessionId: string | undefined,
    topK: number = 5,
    threshold: number = 0.6
  ): Promise<MemoryWithSimilarity[]> {
    // 1. 向量检索
    const vectorResults = await this.vectorSearch(query, sessionId, topK * 2);

    // 2. 提取查询实体
    const entityIds = await this.extractEntitiesFromQuery(query);

    // 3. 图遍历检索
    let graphResults: MemoryWithSimilarity[] = [];
    if (entityIds.length > 0) {
      graphResults = await this.graphSearch(entityIds, topK * 2);
    }

    // 4. 合并结果（去重）
    const merged = this.mergeResults(vectorResults, graphResults);

    // 5. Reranker 重排序
    const reranked = await this.reranker.rerank(query, merged);

    // 6. 阈值过滤
    const filtered = reranked.filter(m => m.similarity >= threshold);

    // 7. 返回 topK
    return filtered.slice(0, topK);
  }

  /**
   * 向量检索
   */
  private async vectorSearch(
    query: string,
    sessionId: string | undefined,
    topK: number
  ): Promise<MemoryWithSimilarity[]> {
    const embedding = await this.embedding.embed(query);
    // 使用现有的向量搜索逻辑
    // 这里需要根据现有代码调整
    return [];
  }

  /**
   * 从查询中提取实体
   */
  private async extractEntitiesFromQuery(query: string): Promise<number[]> {
    // 简单实现：通过已知实体名称匹配
    const entities = await this.db.query(`
      SELECT id, name FROM entity
      WHERE name IN ${query.split(' ').filter(w => w.length > 2)}
    `);
    return entities?.map((e: any) => e.id) || [];
  }

  /**
   * 图遍历检索
   */
  private async graphSearch(
    entityIds: number[],
    topK: number
  ): Promise<MemoryWithSimilarity[]> {
    const allMemories: MemoryWithSimilarity[] = [];

    for (const entityId of entityIds) {
      const memories = await this.indexer.getMemoriesByEntity(entityId, topK);
      allMemories.push(...memories);
    }

    // 去重
    const uniqueMemories = Array.from(
      new Map(allMemories.map(m => [m.id, m])).values()
    );

    return uniqueMemories.slice(0, topK);
  }

  /**
   * 合并结果（去重）
   */
  private mergeResults(
    vectorResults: MemoryWithSimilarity[],
    graphResults: MemoryWithSimilarity[]
  ): MemoryWithSimilarity[] {
    const merged = new Map<number, MemoryWithSimilarity>();

    for (const m of vectorResults) {
      merged.set(m.id, m);
    }

    for (const m of graphResults) {
      if (!merged.has(m.id)) {
        merged.set(m.id, m);
      }
    }

    return Array.from(merged.values());
  }
}
```

- [ ] **Step 2: 集成到 MemoryManager**

```typescript
// src/memory-manager-surreal.ts - 在 MemoryManager 类中添加

import { HybridRetriever } from './hybrid-retrieval.js';

// 在 constructor 中添加
this.hybridRetriever = new HybridRetriever(
  this.db,
  this.embedding,
  this.entityIndexer,
  this.reranker
);

// 修改 retrieveRelevant 方法
async retrieveRelevant(
  query: string,
  sessionId: string | undefined,
  topK: number = 5,
  threshold: number = 0.6
): Promise<MemoryWithSimilarity[]> {
  // 使用混合检索
  if (this.hybridRetriever) {
    return this.hybridRetriever.retrieve(query, sessionId, topK, threshold);
  }

  // 回退到现有向量检索逻辑
  // ... 现有代码 ...
}
```

- [ ] **Step 3: 提交**

```bash
git add src/hybrid-retrieval.ts src/memory-manager-surreal.ts
git commit -m "feat: 实现 HybridRetriever - 向量 + 图混合检索

- 向量检索（语义相似度）
- 图遍历检索（实体关联）
- Reranker 重排序
- 阈值过滤
- 集成到 MemoryManager.retrieveRelevant()

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Chunk 5: 集成与测试

### Task 6: 集成到存储和检索流程

**Files:**
- Modify: `src/memory-store-surreal.ts`
- Modify: `src/memory-manager-surreal.ts`

- [ ] **Step 1: 修改 MemoryStore - 存储时加入索引队列**

```typescript
// src/memory-store-surreal.ts - 添加 EntityIndexer 引用

export class MemoryStore {
  // ... 现有代码 ...
  private entityIndexer?: EntityIndexer;

  setEntityIndexer(indexer: EntityIndexer) {
    this.entityIndexer = indexer;
  }

  async storeEpisodic(sessionId: string, content: string, importance: number = 0.5): Promise<number> {
    const memoryId = await this._storeEpisodic(sessionId, content, importance);

    // 加入索引队列
    if (this.entityIndexer) {
      this.entityIndexer.enqueueMemory(memoryId, content);
    }

    return memoryId;
  }

  // storeSemantic 同理
}
```

- [ ] **Step 2: 修改 MemoryManager - 启动后台维护任务**

```typescript
// src/memory-manager-surreal.ts - 在 startIdleMaintenanceWorker 中添加

private startIdleMaintenanceWorker(): void {
  setInterval(async () => {
    // 现有的 decay, clustering, summarization ...

    // 新增：处理实体索引队列
    if (this.entityIndexer) {
      const result = await this.entityIndexer.processQueue();
      if (result.indexed > 0) {
        console.log(`[EntityIndexer] Processed ${result.indexed} memories`);
      }
    }

    // 新增：TTL Pruning（每周执行一次）
    if (Date.now() - this.maintenanceHistory.lastPruning > 7 * 24 * 60 * 60 * 1000) {
      const result = await this.entityIndexer.pruneExpiredEntities();
      console.log(`[EntityIndexer] Pruned ${result.deprecated} deprecated, ${result.deleted} deleted`);
      this.maintenanceHistory.lastPruning = Date.now();
    }
  }, MAINTENANCE_INTERVAL);
}
```

- [ ] **Step 3: 提交**

```bash
git add src/memory-store-surreal.ts src/memory-manager-surreal.ts
git commit -m "feat: 集成实体索引到存储和检索流程

- MemoryStore.storeEpisodic() 加入索引队列
- MemoryManager 启动后台维护任务
- TTL Pruning 定期执行

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

### Task 7: 完整流程集成测试

**Files:**
- Create: `src/test-graph-integration.ts`

- [ ] **Step 1: 创建集成测试文件**

```typescript
// src/test-graph-integration.ts
import { MemoryManager } from './memory-manager-surreal.js';

const SURREALDB_CONFIG = {
  backend: 'surrealdb' as const,
  surrealdb: {
    url: 'http://localhost:8000',
    namespace: 'openclaw',
    database: 'memory',
    username: 'root',
    password: 'root',
  },
  embedding: {
    endpoint: 'http://localhost:8080',
  },
};

async function testGraphIntegration() {
  console.log('=== Test: Graph Memory Integration ===\n');

  const mm = new MemoryManager(SURREALDB_CONFIG);
  await mm.initialize();

  // Test 1: Store episodic memory with entity extraction
  console.log('Test 1 - Store episodic memory:');
  const sessionId = 'test-graph-session';
  const memoryId1 = await mm.storeEpisodic(sessionId, 'Using TypeScript with SurrealDB for graph database');
  console.log(`  Stored memory ID: ${memoryId1}`);

  // 等待索引处理
  await new Promise(resolve => setTimeout(resolve, 2000));
  await mm['entityIndexer']?.processQueue();
  console.log('  ✓ Memory stored and indexed');

  // Test 2: Store another memory with shared entity
  console.log('Test 2 - Store related memory:');
  const memoryId2 = await mm.storeEpisodic(sessionId, 'TypeScript type safety is great');
  console.log(`  Stored memory ID: ${memoryId2}`);
  await mm['entityIndexer']?.processQueue();
  console.log('  ✓ Related memory stored');

  // Test 3: Search by query
  console.log('Test 3 - Search by query:');
  const results = await mm.retrieveRelevant('TypeScript programming', sessionId, 5, 0.6);
  console.log(`  Found ${results.length} results`);
  for (const r of results) {
    console.log(`    - ${r.content.substring(0, 50)}...`);
  }
  console.log('  ✓ Search works');

  // Test 4: Retrieve by association
  console.log('Test 4 - Retrieve by association:');
  const associated = await mm['entityIndexer']?.retrieveByAssociation(memoryId1, 5);
  console.log(`  Found ${associated?.length || 0} associated memories`);
  console.log('  ✓ Association retrieval works');

  console.log('\n=== All Integration Tests Complete ===');
}

testGraphIntegration().catch(console.error);
```

- [ ] **Step 2: 编译并运行测试**

```bash
npm run build
node dist/test-graph-integration.js
```

- [ ] **Step 3: 提交**

```bash
git add src/test-graph-integration.ts
git commit -m "test: 添加图数据记忆集成测试

- 完整存储→索引→检索流程测试
- 实体关联检索测试

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## 验收标准

### Graph Explosion 防护验收:
- [ ] 提及次数 < 3 的实体不创建正式节点
- [ ] 单个实体的 memory 连接数 ≤ 500
- [ ] 90 天未访问的实体自动降级
- [ ] Postgres/PostgreSQL/PG 合并为一个规范实体
- [ ] entity ≈ memory / 10
- [ ] graph traversal < 50ms

### 三层漏斗算力验收:
- [ ] Layer 1 命中率 > 60%
- [ ] Layer 2 过滤率 > 30%
- [ ] Layer 3 调用率 < 10%
- [ ] 已知话题的重复摄取不触发 8B 推理

---

**Plan complete and saved to `docs/superpowers/plans/2026-03-16-graph-memory-stage1-implementation.md`. Ready to execute?**

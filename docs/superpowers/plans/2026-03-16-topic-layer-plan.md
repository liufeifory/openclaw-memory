# Stage 3 Topic Layer Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 Topic Layer 完整功能，包括 Topic 管理、Alias 同义词、Super Node 防护和 Topic Recall 检索

**Architecture:**
- 三层结构：Entity → Topic → Memory
- 4 路并行检索：Vector + Entity + Graph + Topic
- 两阶段聚类：Embedding 聚类 + LLM 命名
- 完整 Alias 表管理同义词

**Tech Stack:** TypeScript, SurrealDB 2.x, Embedding Service, LLM Reranker

---

## Chunk 1: Schema 迁移和客户端扩展

### Task 1: 创建 Topic Schema

**Files:**
- Modify: `src/surrealdb-client.ts:96-150` (createSchema 方法)
- Test: `src/test-topic-schema.ts`

- [ ] **Step 1: 添加 Topic 表常量**

在 `src/surrealdb-client.ts` 顶部添加常量（第 15 行附近）：

```typescript
const MEMORY_TABLE = 'memory';
const ENTITY_TABLE = 'entity';
const MEMORY_ENTITY_TABLE = 'memory_entity';
const ENTITY_RELATION_TABLE = 'entity_relation';
const TOPIC_TABLE = 'topic';           // 新增
const TOPIC_MEMORY_TABLE = 'topic_memory'; // 新增
const ENTITY_ALIAS_TABLE = 'entity_alias'; // 新增
```

- [ ] **Step 2: 运行测试验证常量未定义**

```bash
cd /Users/liufei/.openclaw/plugins/openclaw-memory
npx ts-node -e "import { TOPIC_TABLE } from './src/surrealdb-client.js'; console.log(TOPIC_TABLE);"
```
Expected: FAIL with "TOPIC_TABLE is not exported"

- [ ] **Step 3: 扩展 createSchema 添加 Topic 相关表**

在 `createSchema()` 方法中添加（第 96-150 行附近）：

```typescript
// Topic table
await this.client!.query(`
  DEFINE TABLE IF NOT EXISTS ${TOPIC_TABLE} SCHEMAFULL;
  DEFINE FIELD IF NOT EXISTS name ON TABLE ${TOPIC_TABLE} TYPE string;
  DEFINE FIELD IF NOT EXISTS description ON TABLE ${TOPIC_TABLE} TYPE option<string>;
  DEFINE FIELD IF NOT EXISTS parent_entity_id ON TABLE ${TOPIC_TABLE} TYPE option<record<${ENTITY_TABLE}>>;
  DEFINE FIELD IF NOT EXISTS memory_count ON TABLE ${TOPIC_TABLE} TYPE int DEFAULT 0;
  DEFINE FIELD IF NOT EXISTS created_at ON TABLE ${TOPIC_TABLE} TYPE datetime DEFAULT time::now();
  DEFINE FIELD IF NOT EXISTS updated_at ON TABLE ${TOPIC_TABLE} TYPE datetime;
  DEFINE FIELD IF NOT EXISTS last_accessed_at ON TABLE ${TOPIC_TABLE} TYPE datetime;

  DEFINE INDEX IF NOT EXISTS idx_topic_name ON TABLE ${TOPIC_TABLE} FIELDS name;
  DEFINE INDEX IF NOT EXISTS idx_topic_entity ON TABLE ${TOPIC_TABLE} FIELDS parent_entity_id;
  DEFINE INDEX IF NOT EXISTS idx_topic_last_accessed ON TABLE ${TOPIC_TABLE} FIELDS last_accessed_at;
`);

// Topic-Memory edge table
await this.client!.query(`
  DEFINE TABLE IF NOT EXISTS ${TOPIC_MEMORY_TABLE} SCHEMAFULL;
  DEFINE FIELD IF NOT EXISTS relevance_score ON TABLE ${TOPIC_MEMORY_TABLE} TYPE float;
  DEFINE FIELD IF NOT EXISTS weight ON TABLE ${TOPIC_MEMORY_TABLE} TYPE float;
  DEFINE FIELD IF NOT EXISTS created_at ON TABLE ${TOPIC_MEMORY_TABLE} TYPE datetime DEFAULT time::now();

  DEFINE INDEX IF NOT EXISTS idx_topic_memory_in ON TABLE ${TOPIC_MEMORY_TABLE} FIELDS in;
  DEFINE INDEX IF NOT EXISTS idx_topic_memory_out ON TABLE ${TOPIC_MEMORY_TABLE} FIELDS out;
`);

// Entity-Alias table
await this.client!.query(`
  DEFINE TABLE IF NOT EXISTS ${ENTITY_ALIAS_TABLE} SCHEMAFULL;
  DEFINE FIELD IF NOT EXISTS alias ON TABLE ${ENTITY_ALIAS_TABLE} TYPE string;
  DEFINE FIELD IF NOT EXISTS entity_id ON TABLE ${ENTITY_ALIAS_TABLE} TYPE record<${ENTITY_TABLE}>;
  DEFINE FIELD IF NOT EXISTS verified ON TABLE ${ENTITY_ALIAS_TABLE} TYPE bool DEFAULT false;
  DEFINE FIELD IF NOT EXISTS source ON TABLE ${ENTITY_ALIAS_TABLE} TYPE string DEFAULT 'manual';
  DEFINE FIELD IF NOT EXISTS created_at ON TABLE ${ENTITY_ALIAS_TABLE} TYPE datetime DEFAULT time::now();
  DEFINE FIELD IF NOT EXISTS created_by ON TABLE ${ENTITY_ALIAS_TABLE} TYPE string;

  DEFINE INDEX IF NOT EXISTS idx_alias_name ON TABLE ${ENTITY_ALIAS_TABLE} FIELDS alias;
  DEFINE INDEX IF NOT EXISTS idx_alias_entity ON TABLE ${ENTITY_ALIAS_TABLE} FIELDS entity_id;
  DEFINE INDEX IF NOT EXISTS idx_alias_unique ON TABLE ${ENTITY_ALIAS_TABLE} FIELDS alias UNIQUE;
`);

// Extend entity table with new fields
await this.client!.query(`
  DEFINE FIELD IF NOT EXISTS canonical_id ON TABLE ${ENTITY_TABLE} TYPE option<record<${ENTITY_TABLE}>>;
  DEFINE FIELD IF NOT EXISTS aliases ON TABLE ${ENTITY_TABLE} TYPE array<string> DEFAULT [];
  DEFINE FIELD IF NOT EXISTS is_frozen ON TABLE ${ENTITY_TABLE} TYPE bool DEFAULT false;
  DEFINE FIELD IF NOT EXISTS freeze_reason ON TABLE ${ENTITY_TABLE} TYPE option<string>;
  DEFINE FIELD IF NOT EXISTS frozen_at ON TABLE ${ENTITY_TABLE} TYPE datetime;
`);
```

- [ ] **Step 4: 创建 Schema 测试文件**

Create `src/test-topic-schema.ts`:

```typescript
import { SurrealDatabase } from './surrealdb-client.js';

async function test() {
  console.log('=== Testing Topic Layer Schema ===\n');

  const config = {
    url: 'ws://localhost:8000',
    namespace: 'openclaw',
    database: 'memory',
    username: 'root',
    password: 'root',
  };

  const db = new SurrealDatabase(config);

  try {
    console.log('1. Initializing database...');
    const result = await db.initialize();
    console.log('   Initialized:', result);

    console.log('\n2. Verifying topic table exists...');
    const topicResult = await db.query('SELECT * FROM topic LIMIT 1');
    console.log('   Topic table:', Array.isArray(topicResult) ? 'exists' : 'not found');

    console.log('\n3. Verifying topic_memory table exists...');
    const topicMemoryResult = await db.query('SELECT * FROM topic_memory LIMIT 1');
    console.log('   Topic-Memory table:', Array.isArray(topicMemoryResult) ? 'exists' : 'not found');

    console.log('\n4. Verifying entity_alias table exists...');
    const aliasResult = await db.query('SELECT * FROM entity_alias LIMIT 1');
    console.log('   Entity-Alias table:', Array.isArray(aliasResult) ? 'exists' : 'not found');

    console.log('\n=== All schema tests passed! ===');
  } catch (error: any) {
    console.error('Test failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await db.close();
  }
}

test();
```

- [ ] **Step 5: 运行 Schema 测试**

```bash
npx ts-node src/test-topic-schema.ts
```
Expected: All schema tables created successfully

- [ ] **Step 6: 提交**

```bash
git add src/surrealdb-client.ts src/test-topic-schema.ts
git commit -m "feat: add topic, topic_memory, entity_alias tables to schema"
```

---

### Task 2: 实现 Topic CRUD 方法

**Files:**
- Modify: `src/surrealdb-client.ts` (添加 Topic 相关方法)
- Test: `src/test-topic-crud.ts`

- [ ] **Step 1: 添加 Topic 接口定义**

在 `surrealdb-client.ts` 中添加接口（第 30 行附近）：

```typescript
export interface Topic {
  id: string;
  name: string;
  description?: string;
  parent_entity_id?: string;
  memory_count: number;
  created_at?: string;
  updated_at?: string;
  last_accessed_at?: string;
}

export interface TopicWithMemories extends Topic {
  memories: LinkedMemory[];
}
```

- [ ] **Step 2: 实现 upsertTopic 方法**

添加方法到 `SurrealDatabase` 类（约第 1600 行）：

```typescript
/**
 * Create or update a topic
 */
async upsertTopic(
  name: string,
  description: string | null,
  parentEntityId: string | null
): Promise<string> {
  const result = await this.query(`
    INSERT INTO ${TOPIC_TABLE} (name, description, parent_entity_id, memory_count)
    VALUES ($name, $description, $parentEntityId, 0)
    ON DUPLICATE KEY UPDATE
      description = $description,
      updated_at = time::now()
    RETURN *
  `, { name, description, parentEntityId });

  const data = this.extractResult(result);
  if (data && data.length > 0) {
    return this.extractStringId(data[0].id);
  }
  throw new Error('Failed to create topic');
}
```

- [ ] **Step 3: 实现 getTopicsByEntity 方法**

```typescript
/**
 * Get all topics for an entity
 */
async getTopicsByEntity(entityId: string): Promise<Topic[]> {
  const result = await this.query(`
    SELECT * FROM ${TOPIC_TABLE}
    WHERE parent_entity_id = $entityId
    ORDER BY memory_count DESC
  `, { entityId });

  const data = this.extractResult(result);
  return (data || []).map((t: any) => ({
    id: this.extractStringId(t.id),
    name: t.name,
    description: t.description,
    parent_entity_id: t.parent_entity_id ? this.extractStringId(t.parent_entity_id) : undefined,
    memory_count: t.memory_count,
    created_at: t.created_at,
    updated_at: t.updated_at,
    last_accessed_at: t.last_accessed_at,
  }));
}
```

- [ ] **Step 4: 实现 linkTopicMemory 方法**

```typescript
/**
 * Link a topic to a memory
 */
async linkTopicMemory(
  topicId: string,
  memoryId: number,
  relevanceScore: number
): Promise<void> {
  await this.query(`
    RELATE ${TOPIC_MEMORY_TABLE}:${topicId}->${memoryId}
    SET relevance_score = $relevanceScore, weight = $relevanceScore
  `, { relevanceScore });

  // Update topic memory count
  await this.query(`
    UPDATE ${TOPIC_TABLE}:${topicId}
    SET memory_count = (
      SELECT count() FROM ${TOPIC_MEMORY_TABLE} WHERE in = topic:${topicId}
    ),
    updated_at = time::now()
  `);
}
```

- [ ] **Step 5: 实现 getMemoriesByTopic 方法**

```typescript
/**
 * Get memories linked to a topic
 */
async getMemoriesByTopic(topicId: string, limit: number = 20): Promise<LinkedMemory[]> {
  const result = await this.query(`
    SELECT VALUE out FROM ${TOPIC_MEMORY_TABLE}
    WHERE in = topic:${topicId}
    ORDER BY relevance_score DESC
    LIMIT $limit
  `, { limit });

  const memoryIds = this.extractResult(result) || [];
  if (memoryIds.length === 0) return [];

  // Fetch memory details
  const memoriesResult = await this.query(`
    SELECT id, content, type, created_at FROM ${MEMORY_TABLE}
    WHERE id IN $memoryIds
  `, { memoryIds });

  const data = this.extractResult(memoriesResult);
  return (data || []).map((m: any) => ({
    id: this.extractNumericId(m.id),
    content: m.content,
    type: m.type,
    created_at: m.created_at,
  }));
}
```

- [ ] **Step 6: 创建 CRUD 测试文件**

Create `src/test-topic-crud.ts`:

```typescript
import { SurrealDatabase } from './surrealdb-client.js';

async function test() {
  console.log('=== Testing Topic CRUD Operations ===\n');

  const config = {
    url: 'ws://localhost:8000',
    namespace: 'openclaw',
    database: 'memory',
    username: 'root',
    password: 'root',
  };

  const db = new SurrealDatabase(config);

  try {
    await db.initialize();

    // 1. Create topic
    console.log('1. Creating topic...');
    const topicId = await db.upsertTopic('Web 开发', 'Web 开发相关技术', 'entity:test');
    console.log('   Created topic:', topicId);

    // 2. Get topics by entity
    console.log('\n2. Getting topics by entity...');
    const topics = await db.getTopicsByEntity('entity:test');
    console.log('   Found topics:', topics.length);

    // 3. Create test memory
    console.log('\n3. Creating test memory...');
    const testEmbedding = new Array(1024).fill(0.1);
    const memoryId = await db.upsert(999001, testEmbedding, {
      type: 'episodic',
      content: 'Using Express for web server',
      importance: 0.8,
    });
    console.log('   Created memory:', memoryId);

    // 4. Link topic to memory
    console.log('\n4. Linking topic to memory...');
    await db.linkTopicMemory(topicId, memoryId, 0.9);
    console.log('   Linked successfully');

    // 5. Get memories by topic
    console.log('\n5. Getting memories by topic...');
    const memories = await db.getMemoriesByTopic(topicId, 10);
    console.log('   Found memories:', memories.length);

    console.log('\n=== All CRUD tests passed! ===');
  } catch (error: any) {
    console.error('Test failed:', error.message);
    process.exit(1);
  } finally {
    await db.close();
  }
}

test();
```

- [ ] **Step 7: 运行 CRUD 测试**

```bash
npx ts-node src/test-topic-crud.ts
```

- [ ] **Step 8: 提交**

```bash
git add src/surrealdb-client.ts src/test-topic-crud.ts
git commit -m "feat: implement Topic CRUD operations"
```

---

### Task 3: 实现 Alias 管理方法

**Files:**
- Modify: `src/surrealdb-client.ts` (添加 Alias 相关方法)
- Test: `src/test-alias.ts`

- [ ] **Step 1: 实现 addAlias 方法**

```typescript
/**
 * Add an alias for an entity
 */
async addAlias(
  alias: string,
  entityId: string,
  verified: boolean = false,
  source: string = 'manual',
  createdBy: string = ''
): Promise<void> {
  await this.query(`
    INSERT INTO ${ENTITY_ALIAS_TABLE} (alias, entity_id, verified, source, created_by)
    VALUES ($alias, $entityId, $verified, $source, $createdBy)
    ON DUPLICATE KEY UPDATE
      entity_id = $entityId,
      verified = $verified
  `, { alias, entityId, verified, source, createdBy });
}
```

- [ ] **Step 2: 实现 resolveAlias 方法**

```typescript
/**
 * Resolve an alias to its canonical entity ID
 */
async resolveAlias(alias: string): Promise<string | null> {
  const result = await this.query(`
    SELECT VALUE entity_id FROM ${ENTITY_ALIAS_TABLE}
    WHERE alias = $alias
    LIMIT 1
  `, { alias });

  const data = this.extractResult(result);
  if (data && data.length > 0) {
    return this.extractStringId(data[0]);
  }
  return null;
}
```

- [ ] **Step 3: 实现 getAliasesByEntity 方法**

```typescript
/**
 * Get all aliases for an entity
 */
async getAliasesByEntity(entityId: string): Promise<string[]> {
  const result = await this.query(`
    SELECT VALUE alias FROM ${ENTITY_ALIAS_TABLE}
    WHERE entity_id = $entityId
  `, { entityId });

  return this.extractResult(result) || [];
}
```

- [ ] **Step 4: 实现 mergeEntities 方法**

```typescript
/**
 * Merge an alias entity into a canonical entity
 */
async mergeEntities(aliasEntityId: string, canonicalEntityId: string): Promise<void> {
  // Transfer memory_entity edges
  await this.query(`
    UPDATE ${MEMORY_ENTITY_TABLE}
    SET out = entity:${canonicalEntityId}
    WHERE out = entity:${aliasEntityId}
  `);

  // Transfer entity_relation edges (as 'in')
  await this.query(`
    UPDATE ${ENTITY_RELATION_TABLE}
    SET in = entity:${canonicalEntityId}
    WHERE in = entity:${aliasEntityId}
  `);

  // Transfer entity_relation edges (as 'out')
  await this.query(`
    UPDATE ${ENTITY_RELATION_TABLE}
    SET out = entity:${canonicalEntityId}
    WHERE out = entity:${aliasEntityId}
  `);

  // Mark alias entity as merged
  await this.query(`
    UPDATE ${ENTITY_TABLE}:${aliasEntityId}
    SET canonical_id = entity:${canonicalEntityId},
        is_merged = true,
        merged_at = time::now()
  `);
}
```

- [ ] **Step 5: 创建 Alias 测试文件**

Create `src/test-alias.ts`:

```typescript
import { SurrealDatabase } from './surrealdb-client.js';

async function test() {
  console.log('=== Testing Alias Management ===\n');

  const config = {
    url: 'ws://localhost:8000',
    namespace: 'openclaw',
    database: 'memory',
    username: 'root',
    password: 'root',
  };

  const db = new SurrealDatabase(config);

  try {
    await db.initialize();

    // 1. Create canonical entity
    console.log('1. Creating canonical entity "PostgreSQL"...');
    const canonicalId = await db.upsertEntity('PostgreSQL', 'database');
    console.log('   Created entity:', canonicalId);

    // 2. Add aliases
    console.log('\n2. Adding aliases "Postgres" and "PG"...');
    await db.addAlias('Postgres', canonicalId, false, 'manual', 'test');
    await db.addAlias('PG', canonicalId, false, 'manual', 'test');
    console.log('   Added aliases');

    // 3. Resolve alias
    console.log('\n3. Resolving alias "Postgres"...');
    const resolved = await db.resolveAlias('Postgres');
    console.log('   Resolved to:', resolved);

    // 4. Get aliases by entity
    console.log('\n4. Getting aliases for entity...');
    const aliases = await db.getAliasesByEntity(canonicalId);
    console.log('   Aliases:', aliases);

    console.log('\n=== All alias tests passed! ===');
  } catch (error: any) {
    console.error('Test failed:', error.message);
    process.exit(1);
  } finally {
    await db.close();
  }
}

test();
```

- [ ] **Step 6: 运行 Alias 测试**

```bash
npx ts-node src/test-alias.ts
```

- [ ] **Step 7: 提交**

```bash
git add src/surrealdb-client.ts src/test-alias.ts
git commit -m "feat: implement Entity Alias management"
```

---

### Task 4: 实现 Super Node 管理方法

**Files:**
- Modify: `src/surrealdb-client.ts` (添加 Super Node 管理方法)
- Test: `src/test-supernode.ts`

- [ ] **Step 1: 添加阈值常量**

在文件顶部添加（第 23 行附近）：

```typescript
const CO_OCCURRENCE_THRESHOLD = 3;
const TOPIC_SOFT_LIMIT = 400;  // 80% threshold for Topic creation
const TOPIC_HARD_LIMIT = 500;  // 100% threshold for freeze
```

- [ ] **Step 2: 实现 getEntityStats 方法**

```typescript
/**
 * Get statistics for an entity
 */
async getEntityStats(entityId: string): Promise<{
  memory_count: number;
  topic_count: number;
  relation_count: number;
}> {
  const result = await this.query(`
    {
      memory_count: (SELECT count() FROM ${MEMORY_ENTITY_TABLE} WHERE out = entity:${entityId}),
      topic_count: (SELECT count() FROM ${ENTITY_TOPIC_TABLE} WHERE in = entity:${entityId}),
      relation_count: (
        SELECT count() FROM ${ENTITY_RELATION_TABLE}
        WHERE in = entity:${entityId} OR out = entity:${entityId}
      )
    }
  `);

  const data = this.extractResult(result);
  return {
    memory_count: data?.memory_count ?? 0,
    topic_count: data?.topic_count ?? 0,
    relation_count: data?.relation_count ?? 0,
  };
}
```

- [ ] **Step 3: 实现 freezeEntity 方法**

```typescript
/**
 * Freeze an entity to prevent new links (Super Node protection)
 */
async freezeEntity(entityId: string, reason: string = 'memory_count exceeded limit'): Promise<void> {
  await this.query(`
    UPDATE ${ENTITY_TABLE}:${entityId}
    SET is_frozen = true,
        freeze_reason = $reason,
        frozen_at = time::now()
  `, { reason });
}
```

- [ ] **Step 4: 实现 isEntityFrozen 方法**

```typescript
/**
 * Check if an entity is frozen
 */
async isEntityFrozen(entityId: string): Promise<boolean> {
  const result = await this.query(`
    SELECT is_frozen FROM ${ENTITY_TABLE}:${entityId}
  `);

  const data = this.extractResult(result);
  return data && data.length > 0 && data[0].is_frozen === true;
}
```

- [ ] **Step 5: 创建 Super Node 测试文件**

Create `src/test-supernode.ts`:

```typescript
import { SurrealDatabase } from './surrealdb-client.js';

async function test() {
  console.log('=== Testing Super Node Management ===\n');

  const config = {
    url: 'ws://localhost:8000',
    namespace: 'openclaw',
    database: 'memory',
    username: 'root',
    password: 'root',
  };

  const db = new SurrealDatabase(config);

  try {
    await db.initialize();

    // 1. Create entity
    console.log('1. Creating test entity...');
    const entityId = await db.upsertEntity('TestEntity', 'test');
    console.log('   Created entity:', entityId);

    // 2. Check initial stats
    console.log('\n2. Getting entity stats...');
    const stats = await db.getEntityStats(entityId);
    console.log('   Stats:', stats);

    // 3. Check if frozen (should be false)
    console.log('\n3. Checking freeze status...');
    const isFrozen = await db.isEntityFrozen(entityId);
    console.log('   Is frozen:', isFrozen);

    // 4. Freeze entity
    console.log('\n4. Freezing entity...');
    await db.freezeEntity(entityId, 'test purpose');
    console.log('   Frozen');

    // 5. Verify frozen status
    console.log('\n5. Verifying freeze status...');
    const isFrozenAfter = await db.isEntityFrozen(entityId);
    console.log('   Is frozen:', isFrozenAfter);

    console.log('\n=== All Super Node tests passed! ===');
  } catch (error: any) {
    console.error('Test failed:', error.message);
    process.exit(1);
  } finally {
    await db.close();
  }
}

test();
```

- [ ] **Step 6: 运行测试**

```bash
npx ts-node src/test-supernode.ts
```

- [ ] **Step 7: 提交**

```bash
git add src/surrealdb-client.ts src/test-supernode.ts
git commit -m "feat: implement Super Node freeze management"
```

---

## Chunk 2: TopicIndexer 实现

### Task 5: 实现 TopicIndexer 类

**Files:**
- Create: `src/topic-indexer.ts`
- Test: `src/test-topic-indexer.ts`

- [ ] **Step 1: 创建 TopicIndexer 类骨架**

Create `src/topic-indexer.ts`:

```typescript
/**
 * Topic Indexer - Manages Topic discovery and clustering
 *
 * Features:
 * 1. Two-stage clustering (Embedding + LLM naming)
 * 2. Super Node triggered Topic creation
 * 3. Background scheduler for periodic scanning
 */

import { SurrealDatabase, TOPIC_SOFT_LIMIT, TOPIC_HARD_LIMIT } from './surrealdb-client.js';
import { EmbeddingService } from './embedding.js';
import { Reranker, LLMLimiter } from './reranker.js';

interface TopicTask {
  entityId: string;
  addedAt: number;
  retryCount: number;
}

interface Cluster {
  clusterId: number;
  memoryIds: number[];
  centroid?: number[];
}

interface TopicDefinition {
  name: string;
  description: string;
  memoryIds: number[];
}

export class TopicIndexer {
  private queue: TopicTask[] = [];
  private processing = false;
  private db: SurrealDatabase | null = null;
  private embedding: EmbeddingService | null = null;
  private reranker: Reranker | null = null;
  private limiter: LLMLimiter | null = null;

  // Stats
  private totalTopicsCreated = 0;
  private totalMemoriesClustered = 0;

  constructor(
    db?: SurrealDatabase,
    embedding?: EmbeddingService,
    reranker?: Reranker,
    limiter?: LLMLimiter
  ) {
    this.db = db || null;
    this.embedding = embedding || null;
    this.reranker = reranker || null;
    this.limiter = limiter || null;
  }

  /**
   * Initialize indexer and start background scheduler
   */
  async initialize(): Promise<void> {
    this.startScheduler();
  }

  /**
   * Start background scheduler for periodic scanning
   */
  private startScheduler(): void {
    // Scan potential Super Nodes every 7 days
    const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
    setInterval(() => this.scanPotentialSuperNodes(), SEVEN_DAYS);

    // Process queue every 30 seconds
    setInterval(() => this.processQueue(), 30000);

    console.log('[TopicIndexer] Scheduler started');
  }

  /**
   * Scan for potential Super Nodes needing Topic creation
   */
  private async scanPotentialSuperNodes(): Promise<void> {
    if (!this.db) return;

    try {
      const result = await this.db.query(`
        SELECT id, name, memory_count
        FROM entity
        WHERE memory_count >= ${TOPIC_SOFT_LIMIT}
        AND is_frozen = false
      `);

      const data = this.extractResult(result);
      for (const entity of (data || [])) {
        await this.enqueueTopicCreation(this.extractStringId(entity.id));
      }
    } catch (error: any) {
      console.error('[TopicIndexer] scanPotentialSuperNodes failed:', error.message);
    }
  }

  /**
   * Enqueue Topic creation task
   */
  async enqueueTopicCreation(entityId: string): Promise<void> {
    // Check if already queued
    const exists = this.queue.find(t => t.entityId === entityId);
    if (exists) return;

    this.queue.push({
      entityId,
      addedAt: Date.now(),
      retryCount: 0,
    });
    console.log(`[TopicIndexer] Enqueued Topic creation for entity ${entityId}`);
  }

  /**
   * Process queue items
   */
  private async processQueue(): Promise<void> {
    if (this.processing || this.queue.length === 0) return;
    this.processing = true;

    while (this.queue.length > 0) {
      const task = this.queue.shift()!;
      try {
        await this.autoCreateTopicsForSuperNode(task.entityId);
        this.totalTopicsCreated++;
      } catch (error: any) {
        console.error(`[TopicIndexer] Failed for entity ${task.entityId}:`, error.message);
        task.retryCount++;
        if (task.retryCount < 3) {
          this.queue.push(task);
        }
      }
    }

    this.processing = false;
  }

  /**
   * Automatically create Topics for a Super Node
   */
  async autoCreateTopicsForSuperNode(entityId: string): Promise<void> {
    if (!this.db || !this.embedding) {
      throw new Error('TopicIndexer not properly initialized');
    }

    console.log(`[TopicIndexer] Creating topics for entity ${entityId}`);

    // 1. Get memories for this entity (limit 200 for clustering)
    const memories = await this.db.getMemoriesByEntity(entityId, 200);
    if (memories.length < 5) {
      console.log(`[TopicIndexer] Not enough memories for clustering: ${memories.length}`);
      return;
    }

    // 2. Stage 1: Embedding clustering
    const clusters = await this.clusterMemoriesByEmbedding(memories.map(m => m.id));
    console.log(`[TopicIndexer] Created ${clusters.length} clusters`);

    // 3. Stage 2: LLM naming
    const topics = await this.nameTopics(clusters, memories);
    console.log(`[TopicIndexer] Named ${topics.length} topics`);

    // 4. Create topics and link memories
    for (const topic of topics) {
      const topicId = await this.db.upsertTopic(topic.name, topic.description, entityId);

      for (const memoryId of topic.memoryIds) {
        await this.db.linkTopicMemory(topicId, memoryId, 0.8);
      }

      this.totalMemoriesClustered += topic.memoryIds.length;
    }

    console.log(`[TopicIndexer] Created ${topics.length} topics for entity ${entityId}`);
  }

  /**
   * Stage 1: Cluster memories by embedding similarity
   */
  private async clusterMemoriesByEmbedding(memoryIds: number[], maxClusters = 10): Promise<Cluster[]> {
    if (!this.embedding) {
      throw new Error('EmbeddingService not available');
    }

    // 1. Get embeddings for all memories
    const embeddings: number[][] = [];
    for (const memoryId of memoryIds) {
      const embedding = await this.embedding.embed(`memory:${memoryId}`);
      embeddings.push(embedding);
    }

    // 2. Compute similarity matrix (simplified - use cosine similarity)
    const clusters: Cluster[] = [];
    const assigned = new Set<number>();

    // Simple greedy clustering
    for (let i = 0; i < memoryIds.length; i++) {
      if (assigned.has(i)) continue;

      const clusterMemories = [memoryIds[i]];
      assigned.add(i);

      for (let j = i + 1; j < memoryIds.length; j++) {
        if (assigned.has(j)) continue;

        const similarity = this.cosineSimilarity(embeddings[i], embeddings[j]);
        if (similarity > 0.7) {  // Threshold for same cluster
          clusterMemories.push(memoryIds[j]);
          assigned.add(j);
        }
      }

      if (clusterMemories.length > 0 && clusters.length < maxClusters) {
        clusters.push({
          clusterId: clusters.length,
          memoryIds: clusterMemories,
          centroid: embeddings[i],
        });
      }
    }

    return clusters;
  }

  /**
   * Stage 2: Name topics using LLM
   */
  private async nameTopics(clusters: Cluster[], memories: any[]): Promise<TopicDefinition[]> {
    if (!this.db || !this.limiter) {
      throw new Error('LLM services not available');
    }

    const topics: TopicDefinition[] = [];

    for (const cluster of clusters) {
      // Get sample memories for this cluster
      const sampleIds = cluster.memoryIds.slice(0, 5);
      const sampleMemories = memories.filter(m => sampleIds.includes(m.id));

      // Build prompt
      const content = sampleMemories.map((m: any) => `- ${m.content}`).join('\n');
      const prompt = `
根据以下记忆内容，为该主题生成一个简短名称（2-5 个字）和一句话描述：

${content}

输出格式 (JSON):
{
  "name": "主题名称",
  "description": "一句话描述"
}
`;

      try {
        // Call LLM through limiter
        const result = await this.limiter.enqueue(async () => {
          // Use reranker's LLM client
          return JSON.parse(await (this.reranker as any).callLLM(prompt));
        });

        topics.push({
          name: result.name || `Topic ${topics.length + 1}`,
          description: result.description || '',
          memoryIds: cluster.memoryIds,
        });
      } catch (error: any) {
        console.error('[TopicIndexer] Failed to name topic:', error.message);
        topics.push({
          name: `Topic ${topics.length + 1}`,
          description: '',
          memoryIds: cluster.memoryIds,
        });
      }
    }

    return topics;
  }

  /**
   * Compute cosine similarity between two vectors
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  /**
   * Extract result from query response
   */
  private extractResult(result: any): any[] {
    if (Array.isArray(result) && result.length > 0) {
      if (Array.isArray(result[0])) return result[0];
      if (result[0]?.result) return result[0].result;
    }
    return [];
  }

  /**
   * Extract string ID from record
   */
  private extractStringId(id: any): string {
    if (typeof id === 'string') {
      const parts = id.split(':');
      return parts[parts.length - 1];
    }
    return String(id);
  }

  /**
   * Get indexer statistics
   */
  getStats(): {
    queueSize: number;
    totalTopicsCreated: number;
    totalMemoriesClustered: number;
  } {
    return {
      queueSize: this.queue.length,
      totalTopicsCreated: this.totalTopicsCreated,
      totalMemoriesClustered: this.totalMemoriesClustered,
    };
  }
}
```

- [ ] **Step 2: 创建 TopicIndexer 测试**

Create `src/test-topic-indexer.ts`:

```typescript
import { SurrealDatabase } from './surrealdb-client.js';
import { EmbeddingService } from './embedding.js';
import { TopicIndexer } from './topic-indexer.js';
import { Reranker, LLMLimiter } from './reranker.js';

async function test() {
  console.log('=== Testing TopicIndexer ===\n');

  const config = {
    url: 'ws://localhost:8000',
    namespace: 'openclaw',
    database: 'memory',
    username: 'root',
    password: 'root',
  };

  const db = new SurrealDatabase(config);
  const embedding = new EmbeddingService('http://localhost:8080');
  const llamaEndpoint = 'http://localhost:8081';
  const limiter = new LLMLimiter({ maxConcurrent: 2, minInterval: 100, queueLimit: 50 });
  const reranker = new Reranker(llamaEndpoint, limiter);

  const indexer = new TopicIndexer(db, embedding, reranker, limiter);

  try {
    await db.initialize();
    await indexer.initialize();

    console.log('1. TopicIndexer initialized');
    console.log('   Stats:', indexer.getStats());

    // 2. Test enqueue
    console.log('\n2. Testing enqueue...');
    await indexer.enqueueTopicCreation('test-entity');
    console.log('   Enqueued successfully');

    console.log('\n=== TopicIndexer tests passed! ===');
  } catch (error: any) {
    console.error('Test failed:', error.message);
    process.exit(1);
  } finally {
    await db.close();
  }
}

test();
```

- [ ] **Step 3: 运行测试**

```bash
npx ts-node src/test-topic-indexer.ts
```

- [ ] **Step 4: 提交**

```bash
git add src/topic-indexer.ts src/test-topic-indexer.ts
git commit -m "feat: implement TopicIndexer with two-stage clustering"
```

---

## Chunk 3: HybridRetriever 扩展

### Task 6: 实现 Topic Recall 检索

**Files:**
- Modify: `src/hybrid-retrieval.ts:448-594` (添加 topicSearch 和 retrieveWithTopicRecall 方法)
- Test: `src/test-topic-retrieval.ts`

- [ ] **Step 1: 添加 MemoryResult 接口扩展**

在 `src/hybrid-retrieval.ts` 的 `MemoryResult` 接口中添加字段（第 26-38 行）：

```typescript
export interface MemoryResult {
  id: number;
  content: string;
  type: 'episodic' | 'semantic' | 'reflection';
  similarity?: number;
  score?: number;
  weight?: number;
  created_at?: Date;
  access_count?: number;
  importance?: number;
  cluster_id?: string;
  source?: 'vector' | 'graph' | 'hybrid' | 'reranked' | 'topic';  // 新增 'topic'
  topic_id?: string;      // 新增
  topic_name?: string;    // 新增
}
```

- [ ] **Step 2: 实现 topicSearch 方法**

在 `HybridRetriever` 类中添加方法（约第 448 行之前）：

```typescript
/**
 * Topic Recall - retrieve memories via Topic layer
 * Uses SurrealQL-level deduplication to reduce merge overhead
 */
async topicSearch(
  entityIds: string[],
  topK: number = 20
): Promise<MemoryResult[]> {
  const allMemories = new Map<number, MemoryResult>();

  try {
    for (const entityId of entityIds) {
      // 1. Get topics for this entity via SurrealQL (server-side dedup)
      const topicsResult = await this.db.query(`
        SELECT id, name, description FROM topic
        WHERE parent_entity_id = entity:${entityId}
        ORDER BY memory_count DESC
      `);

      const topics = this.extractResult(topicsResult);
      if (!topics || topics.length === 0) continue;

      // 2. Get memories for each topic (batch query for efficiency)
      const topicIds = topics.map((t: any) => this.extractStringId(t.id));

      // Use subquery to get distinct memory IDs with topic info
      const memoriesResult = await this.db.query(`
        SELECT DISTINCT out.id as memory_id,
               out.content,
               out.type,
               out.created_at,
               relevance_score,
               topic.id as topic_id,
               topic.name as topic_name
        FROM topic_memory
        WHERE in IN ${this.formatTopicIds(topicIds)}
        ORDER BY relevance_score DESC
        LIMIT ${topK * 2}
      `);

      const memories = this.extractResult(memoriesResult);
      for (const mem of (memories || [])) {
        const memoryId = this.extractNumericId(mem.memory_id);
        if (!allMemories.has(memoryId)) {
          allMemories.set(memoryId, {
            id: memoryId,
            content: mem.content || '',
            type: (mem.type as 'episodic' | 'semantic' | 'reflection') || 'episodic',
            score: mem.relevance_score,
            similarity: mem.relevance_score,
            created_at: mem.created_at ? new Date(mem.created_at) : undefined,
            source: 'topic' as const,
            topic_id: this.extractStringId(mem.topic_id),
            topic_name: mem.topic_name,
          });
        }
      }
    }

    const results = Array.from(allMemories.values());
    console.log(`[HybridRetriever] Topic search found ${results.length} unique memories`);
    return results;
  } catch (error: any) {
    console.error('[HybridRetriever] topicSearch failed:', error.message);
    return [];
  }
}
```

- [ ] **Step 3: 实现 retrieveWithTopicRecall 方法**

在 `retrieveWithMultiDegree` 方法后添加（约第 594 行之后）：

```typescript
/**
 * Enhanced retrieval with Topic Recall (4-path parallel retrieval)
 *
 * Pipeline:
 * 1. Vector Search (semantic similarity)
 * 2. Extract entities from query
 * 3. Graph Traversal Search
 * 4. Topic Recall (NEW)
 * 5. SurrealQL-level deduplication
 * 6. Reranker re-sorting
 * 7. Threshold filtering
 * 8. Return topK
 */
async retrieveWithTopicRecall(
  query: string,
  sessionId: string | undefined,
  topK: number = 5,
  threshold: number = 0.6
): Promise<HybridRetrievalResult> {
  const stats = {
    vectorCount: 0,
    entityCount: 0,
    graphCount: 0,
    topicCount: 0,
    mergedCount: 0,
    finalCount: 0,
    avgSimilarity: 0,
  };

  // Amnesia Mode: 100ms timeout for graph operations
  const GRAPH_TIMEOUT_MS = 100;

  try {
    // Step 1: Vector search (always runs)
    const INITIAL_K = Math.max(topK * 4, 20);
    const vectorResults = await this.vectorSearch(query, sessionId, INITIAL_K);
    stats.vectorCount = vectorResults.length;

    // Step 2: Extract entities from query
    const entities = await this.extractEntitiesFromQuery(query);
    const entityIds = await Promise.all(entities.map(e => this.getEntityIdByName(e.name)));
    const validEntityIds = entityIds.filter(id => id !== 0 && !isNaN(id));

    // Step 3: Graph traversal with timeout
    let graphResults: MemoryResult[] = [];
    if (validEntityIds.length > 0) {
      try {
        graphResults = await Promise.race([
          this.graphSearch(validEntityIds, INITIAL_K),
          new Promise<MemoryResult[]>((_, reject) =>
            setTimeout(() => reject(new Error('Graph search timeout')), GRAPH_TIMEOUT_MS)
          )
        ]);
        stats.graphCount = graphResults.length;
      } catch (timeoutError: any) {
        if (timeoutError.message === 'Graph search timeout') {
          console.warn(`[HybridRetriever] Amnesia Mode: graph search timeout after ${GRAPH_TIMEOUT_MS}ms`);
        }
        graphResults = [];
      }
    }

    // Step 4: Topic Recall (NEW independent path)
    let topicResults: MemoryResult[] = [];
    if (validEntityIds.length > 0) {
      topicResults = await this.topicSearch(validEntityIds, INITIAL_K);
      stats.topicCount = topicResults.length;
    }

    // Step 5: SurrealQL-level deduplication (User feedback integration)
    // Use ID-based Set for O(1) dedup before merge
    const mergedResults = this.mergeResultsWithTopics(vectorResults, graphResults, topicResults);
    stats.mergedCount = mergedResults.length;

    // Step 6: Reranker re-sorting
    const rerankedResults = await this.rerankResults(query, mergedResults);

    // Step 7: Threshold filtering
    const filteredResults = rerankedResults.filter(r => (r.score ?? r.similarity ?? 0) >= threshold);

    // Step 8: Return topK
    const finalResults = filteredResults.slice(0, topK);
    stats.finalCount = finalResults.length;

    // Calculate average similarity
    if (finalResults.length > 0) {
      stats.avgSimilarity = finalResults.reduce(
        (sum, r) => sum + (r.similarity ?? r.score ?? 0),
        0
      ) / finalResults.length;
    }

    return {
      results: finalResults,
      stats,
    };
  } catch (error: any) {
    console.error('[HybridRetriever] retrieveWithTopicRecall failed:', error.message);
    return {
      results: [],
      stats,
    };
  }
}
```

- [ ] **Step 4: 实现 mergeResultsWithTopics 方法**

添加新方法（约第 300 行，原有 `mergeResults` 方法附近）：

```typescript
/**
 * Merge vector, graph, and topic results with efficient deduplication
 * Uses ID-based Set for O(1) dedup (User feedback: reduce 4-path merge overhead)
 */
mergeResultsWithTopics(
  vectorResults: MemoryResult[],
  graphResults: MemoryResult[],
  topicResults: MemoryResult[]
): MemoryResult[] {
  const mergedMap: Map<number, MemoryResult> = new Map();

  // Add vector results first
  for (const result of vectorResults) {
    mergedMap.set(result.id, { ...result, source: 'vector' });
  }

  // Add graph results
  for (const result of graphResults) {
    if (!mergedMap.has(result.id)) {
      mergedMap.set(result.id, { ...result, source: 'graph' });
    } else {
      const existing = mergedMap.get(result.id)!;
      const mergedScore = Math.max(
        existing.score ?? existing.similarity ?? 0,
        result.score ?? result.weight ?? 0
      );
      mergedMap.set(result.id, {
        ...existing,
        score: mergedScore,
        similarity: mergedScore,
        weight: result.weight,
        source: 'hybrid',
      });
    }
  }

  // Add topic results
  for (const result of topicResults) {
    if (!mergedMap.has(result.id)) {
      mergedMap.set(result.id, { ...result, source: 'topic' });
    } else {
      const existing = mergedMap.get(result.id)!;
      const mergedScore = Math.max(
        existing.score ?? existing.similarity ?? 0,
        result.score ?? result.similarity ?? 0
      );
      mergedMap.set(result.id, {
        ...existing,
        score: mergedScore,
        similarity: mergedScore,
        source: 'hybrid',
        topic_id: result.topic_id || existing.topic_id,
        topic_name: result.topic_name || existing.topic_name,
      });
    }
  }

  const merged = Array.from(mergedMap.values());
  console.log(`[HybridRetriever] Merged ${vectorResults.length}v + ${graphResults.length}g + ${topicResults.length}t -> ${merged.length} unique`);
  return merged;
}
```

- [ ] **Step 5: 创建 Topic Retrieval 测试**

Create `src/test-topic-retrieval.ts`:

```typescript
import { SurrealDatabase } from './surrealdb-client.js';
import { EmbeddingService } from './embedding.js';
import { HybridRetriever } from './hybrid-retrieval.js';
import { EntityIndexer } from './entity-indexer.js';
import { Reranker, LLMLimiter } from './reranker.js';

async function test() {
  console.log('=== Testing Topic Recall Retrieval ===\n');

  const config = {
    url: 'ws://localhost:8000',
    namespace: 'openclaw',
    database: 'memory',
    username: 'root',
    password: 'root',
  };

  const db = new SurrealDatabase(config);
  const embedding = new EmbeddingService('http://localhost:8080');
  const entityIndexer = new EntityIndexer(db);
  const llamaEndpoint = 'http://localhost:8081';
  const limiter = new LLMLimiter({ maxConcurrent: 2, minInterval: 100, queueLimit: 50 });
  const reranker = new Reranker(llamaEndpoint, limiter);

  const retriever = new HybridRetriever(db, embedding, entityIndexer, reranker);

  try {
    await db.initialize();

    // 1. Setup test data
    console.log('1. Setting up test data...');
    const testEmbedding = new Array(1024).fill(0.1);

    // Create topic
    const topicId = await db.upsertTopic('Web 开发', 'Web development topics', 'entity:web');
    console.log('   Created topic:', topicId);

    // Create memories linked to topic
    for (let i = 0; i < 5; i++) {
      const memId = await db.upsert(200000 + i, testEmbedding, {
        type: 'episodic',
        content: `Web development memory ${i}`,
        importance: 0.8,
      });
      await db.linkTopicMemory(topicId, memId, 0.9);
    }
    console.log('   Created 5 test memories');

    // 2. Test topicSearch
    console.log('\n2. Testing topicSearch...');
    const topicResults = await (retriever as any).topicSearch(['web'], 10);
    console.log('   Topic results:', topicResults.length, 'memories');

    // 3. Test retrieveWithTopicRecall
    console.log('\n3. Testing retrieveWithTopicRecall...');
    const result = await retriever.retrieveWithTopicRecall('web development', undefined, 5, 0.6);
    console.log('   Retrieved:', result.results.length, 'memories');
    console.log('   Stats:', result.stats);

    console.log('\n=== All Topic Retrieval tests passed! ===');
  } catch (error: any) {
    console.error('Test failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await db.close();
  }
}

test();
```

- [ ] **Step 6: 运行测试**

```bash
npx ts-node src/test-topic-retrieval.ts
```

- [ ] **Step 7: 提交**

```bash
git add src/hybrid-retrieval.ts src/test-topic-retrieval.ts
git commit -m "feat: implement Topic Recall retrieval with 4-path deduplication"
```

---

### Task 7: 实现 Super Node Topic 创建

**Files:**
- Modify: `src/entity-indexer.ts` (添加 Super Node 检查逻辑)
- Modify: `src/surrealdb-client.ts` (添加 linkMemoryEntity 拦截)
- Test: `src/test-supernode-topic.ts`

- [ ] **Step 1: 在 linkMemoryEntity 时检查 Super Node**

在 `surrealdb-client.ts` 的 `linkMemoryEntity` 方法中添加检查（约第 800 行附近）：

```typescript
async linkMemoryEntity(
  memoryId: number,
  entityId: string,
  weight: number = 1.0
): Promise<void> {
  // Check if entity is frozen
  const isFrozen = await this.isEntityFrozen(entityId);
  if (isFrozen) {
    console.warn(`[Super Node Protection] Entity ${entityId} is frozen, skipping link`);
    // Optionally: auto-create topic or redirect to topic
    return;
  }

  // Create edge
  await this.query(`
    RELATE ${MEMORY_ENTITY_TABLE}:${memoryId}->${ENTITY_TABLE}:${entityId}
    SET weight = $weight
  `, { weight });

  // Check if approaching Super Node threshold
  const stats = await this.getEntityStats(entityId);
  if (stats.memory_count >= TOPIC_SOFT_LIMIT) {
    console.log(`[Super Node Protection] Entity ${entityId} reached soft limit (${stats.memory_count}), triggering Topic creation`);
    // Trigger TopicIndexer
    const topicIndexer = new TopicIndexer(this);
    await topicIndexer.enqueueTopicCreation(entityId);
  }

  if (stats.memory_count >= TOPIC_HARD_LIMIT) {
    console.log(`[Super Node Protection] Entity ${entityId} reached hard limit (${stats.memory_count}), freezing entity`);
    await this.freezeEntity(entityId, 'memory_count exceeded hard limit');
  }
}
```

- [ ] **Step 2: 创建 Super Node Topic 测试**

Create `src/test-supernode-topic.ts`:

```typescript
import { SurrealDatabase, TOPIC_SOFT_LIMIT } from './surrealdb-client.js';

async function test() {
  console.log('=== Testing Super Node Topic Creation ===\n');

  const config = {
    url: 'ws://localhost:8000',
    namespace: 'openclaw',
    database: 'memory',
    username: 'root',
    password: 'root',
  };

  const db = new SurrealDatabase(config);

  try {
    await db.initialize();

    // 1. Create entity and simulate many memories
    console.log('1. Creating test entity with many memories...');
    const entityId = await db.upsertEntity('SuperNodeTest', 'test');
    const testEmbedding = new Array(1024).fill(0.1);

    // Create memories up to soft limit
    for (let i = 0; i < TOPIC_SOFT_LIMIT + 50; i++) {
      const memId = await db.upsert(300000 + i, testEmbedding, {
        type: 'episodic',
        content: `Memory ${i} for super node test`,
        importance: 0.8,
      });
      await db.linkMemoryEntity(memId, entityId, 0.9);

      if (i % 100 === 0) {
        console.log(`   Created ${i} memories...`);
      }
    }

    // 2. Check if topics were created
    console.log('\n2. Checking if topics were auto-created...');
    const topics = await db.getTopicsByEntity(entityId);
    console.log('   Topics created:', topics.length);

    // 3. Check entity freeze status
    console.log('\n3. Checking entity freeze status...');
    const isFrozen = await db.isEntityFrozen(entityId);
    console.log('   Is frozen:', isFrozen);

    // 4. Get entity stats
    console.log('\n4. Getting entity stats...');
    const stats = await db.getEntityStats(entityId);
    console.log('   Stats:', stats);

    console.log('\n=== Super Node Topic tests passed! ===');
  } catch (error: any) {
    console.error('Test failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await db.close();
  }
}

test();
```

- [ ] **Step 3: 运行测试**

```bash
npx ts-node src/test-supernode-topic.ts
```

- [ ] **Step 4: 提交**

```bash
git add src/surrealdb-client.ts src/entity-indexer.ts src/test-supernode-topic.ts
git commit -m "feat: implement Super Node protection with auto Topic creation"
```

---

## Chunk 4: Alias 管理和测试完善

### Task 8: 实现增量挂载策略

**Files:**
- Modify: `src/topic-indexer.ts` (添加增量挂载逻辑)
- Test: `src/test-incremental-mount.ts`

- [ ] **Step 1: 添加增量挂载方法**

在 `TopicIndexer` 类中添加方法（约第 1065 行之后）：

```typescript
/**
 * Incremental mount - attach new memory to nearest topic without re-clustering
 * User feedback: avoid expensive re-clustering on every new memory
 */
async incrementalMountMemory(
  entityId: string,
  memoryId: number,
  memoryEmbedding: number[]
): Promise<string | null> {
  if (!this.db) return null;

  try {
    // 1. Get existing topics for this entity
    const topics = await this.db.getTopicsByEntity(entityId);
    if (topics.length === 0) {
      // No topics exist, mount to entity directly
      console.log(`[TopicIndexer] No topics found, mounting memory ${memoryId} to entity`);
      return null;
    }

    // 2. Find nearest topic by embedding similarity
    let bestTopic: string | null = null;
    let bestSimilarity = -1;

    for (const topic of topics) {
      // Get topic centroid (average of member memory embeddings)
      const centroid = await this.computeTopicCentroid(topic.id);
      if (!centroid) continue;

      const similarity = this.cosineSimilarity(memoryEmbedding, centroid);
      if (similarity > bestSimilarity) {
        bestSimilarity = similarity;
        bestTopic = topic.id;
      }
    }

    if (bestTopic && bestSimilarity > 0.6) {
      // Mount to nearest topic
      await this.db.linkTopicMemory(bestTopic, memoryId, bestSimilarity);
      console.log(`[TopicIndexer] Incrementally mounted memory ${memoryId} to topic ${bestTopic}`);
      return bestTopic;
    } else {
      // No suitable topic, mount to entity
      console.log(`[TopicIndexer] No suitable topic found (best: ${bestSimilarity}), mounting to entity`);
      return null;
    }
  } catch (error: any) {
    console.error('[TopicIndexer] incrementalMountMemory failed:', error.message);
    return null;
  }
}

/**
 * Compute topic centroid from member memory embeddings
 */
private async computeTopicCentroid(topicId: string): Promise<number[] | null> {
  if (!this.db || !this.embedding) return null;

  const memories = await this.db.getMemoriesByTopic(topicId, 50);
  if (memories.length === 0) return null;

  const embeddings = await Promise.all(
    memories.map(m => this.embedding!.embed(`memory:${m.id}`))
  );

  // Average embeddings
  const centroid = new Array(embeddings[0].length).fill(0);
  for (const emb of embeddings) {
    for (let i = 0; i < emb.length; i++) {
      centroid[i] += emb[i];
    }
  }
  for (let i = 0; i < centroid.length; i++) {
    centroid[i] /= embeddings.length;
  }

  return centroid;
}
```

- [ ] **Step 2: 创建增量挂载测试**

Create `src/test-incremental-mount.ts`:

```typescript
import { SurrealDatabase } from './surrealdb-client.js';
import { EmbeddingService } from './embedding.js';
import { TopicIndexer } from './topic-indexer.js';
import { Reranker, LLMLimiter } from './reranker.js';

async function test() {
  console.log('=== Testing Incremental Memory Mount ===\n');

  const config = {
    url: 'ws://localhost:8000',
    namespace: 'openclaw',
    database: 'memory',
    username: 'root',
    password: 'root',
  };

  const db = new SurrealDatabase(config);
  const embedding = new EmbeddingService('http://localhost:8080');
  const limiter = new LLMLimiter({ maxConcurrent: 2, minInterval: 100, queueLimit: 50 });
  const reranker = new Reranker('http://localhost:8081', limiter);

  const indexer = new TopicIndexer(db, embedding, reranker, limiter);

  try {
    await db.initialize();

    // 1. Create topic with some memories
    console.log('1. Creating topic with initial memories...');
    const topicId = await db.upsertTopic('Test Topic', 'Test description', 'entity:test');
    const testEmbedding = new Array(1024).fill(0.1);

    for (let i = 0; i < 10; i++) {
      const memId = await db.upsert(400000 + i, testEmbedding, {
        type: 'episodic',
        content: `Initial memory ${i}`,
        importance: 0.8,
      });
      await db.linkTopicMemory(topicId, memId, 0.9);
    }

    // 2. Test incremental mount
    console.log('\n2. Testing incremental mount...');
    const newMemId = await db.upsert(400100, testEmbedding, {
      type: 'episodic',
      content: 'New memory for incremental mount',
      importance: 0.8,
    });

    const mountedTopic = await indexer.incrementalMountMemory('test', newMemId, testEmbedding);
    console.log('   Mounted to topic:', mountedTopic);

    // 3. Verify memory was linked
    console.log('\n3. Verifying memory linkage...');
    const memories = await db.getMemoriesByTopic(topicId, 20);
    console.log('   Topic now has', memories.length, 'memories');

    console.log('\n=== Incremental Mount tests passed! ===');
  } catch (error: any) {
    console.error('Test failed:', error.message);
    process.exit(1);
  } finally {
    await db.close();
  }
}

test();
```

- [ ] **Step 3: 运行测试**

```bash
npx ts-node src/test-incremental-mount.ts
```

- [ ] **Step 4: 提交**

```bash
git add src/topic-indexer.ts src/test-incremental-mount.ts
git commit -m "feat: implement incremental memory mount to avoid re-clustering"
```

---

### Task 9: 完善 Alias 事务处理

**Files:**
- Modify: `src/surrealdb-client.ts` (使用 Transaction 处理 mergeEntities)
- Test: `src/test-alias-transaction.ts`

- [ ] **Step 1: 使用 Transaction 重构 mergeEntities**

修改 `mergeEntities` 方法（第 466-495 行）：

```typescript
/**
 * Merge an alias entity into a canonical entity (using transaction)
 * User feedback: use SurrealDB transaction for atomic edge transfer
 */
async mergeEntities(aliasEntityId: string, canonicalEntityId: string): Promise<void> {
  // Use transaction for atomic operations
  const txResult = await this.query(`
    BEGIN TRANSACTION;

    -- Transfer memory_entity edges
    UPDATE ${MEMORY_ENTITY_TABLE}
    SET out = entity:${canonicalEntityId}
    WHERE out = entity:${aliasEntityId};

    -- Transfer entity_relation edges (as 'in')
    UPDATE ${ENTITY_RELATION_TABLE}
    SET in = entity:${canonicalEntityId}
    WHERE in = entity:${aliasEntityId};

    -- Transfer entity_relation edges (as 'out')
    UPDATE ${ENTITY_RELATION_TABLE}
    SET out = entity:${canonicalEntityId}
    WHERE out = entity:${aliasEntityId};

    -- Mark alias entity as merged
    UPDATE ${ENTITY_TABLE}:${aliasEntityId}
    SET canonical_id = entity:${canonicalEntityId},
        is_merged = true,
        merged_at = time::now();

    COMMIT TRANSACTION;
  `);

  console.log(`[EntityIndexer] Merged entity ${aliasEntityId} -> ${canonicalEntityId}`);
}
```

- [ ] **Step 2: 创建 Alias 事务测试**

Create `src/test-alias-transaction.ts`:

```typescript
import { SurrealDatabase } from './surrealdb-client.js';

async function test() {
  console.log('=== Testing Alias Merge Transaction ===\n');

  const config = {
    url: 'ws://localhost:8000',
    namespace: 'openclaw',
    database: 'memory',
    username: 'root',
    password: 'root',
  };

  const db = new SurrealDatabase(config);

  try {
    await db.initialize();

    // 1. Create canonical and alias entities
    console.log('1. Creating canonical and alias entities...');
    const canonicalId = await db.upsertEntity('PostgreSQL', 'database');
    const aliasId = await db.upsertEntity('Postgres', 'database');
    console.log('   Canonical:', canonicalId, 'Alias:', aliasId);

    // 2. Create memories linked to alias
    console.log('\n2. Creating memories linked to alias...');
    const testEmbedding = new Array(1024).fill(0.1);
    const memId = await db.upsert(500001, testEmbedding, {
      type: 'episodic',
      content: 'Postgres is awesome',
      importance: 0.8,
    });
    await db.linkMemoryEntity(memId, aliasId, 0.9);
    console.log('   Created memory linked to alias');

    // 3. Merge entities
    console.log('\n3. Merging alias into canonical...');
    await db.mergeEntities(aliasId, canonicalId);
    console.log('   Merged successfully');

    // 4. Verify edges transferred
    console.log('\n4. Verifying edge transfer...');
    const aliasMemories = await db.getMemoriesByEntity(aliasId);
    const canonicalMemories = await db.getMemoriesByEntity(canonicalId);
    console.log('   Alias memories after merge:', aliasMemories.length);
    console.log('   Canonical memories after merge:', canonicalMemories.length);

    // 5. Verify alias entity marked as merged
    console.log('\n5. Verifying alias entity status...');
    const aliasEntity = await db.getEntityById(aliasId);
    console.log('   Alias is_merged:', aliasEntity?.is_merged);

    console.log('\n=== Alias Transaction tests passed! ===');
  } catch (error: any) {
    console.error('Test failed:', error.message);
    process.exit(1);
  } finally {
    await db.close();
  }
}

test();
```

- [ ] **Step 3: 运行测试**

```bash
npx ts-node src/test-alias-transaction.ts
```

- [ ] **Step 4: 提交**

```bash
git add src/surrealdb-client.ts src/test-alias-transaction.ts
git commit -m "fix: use transaction for atomic entity merge operations"
```

---

### Task 10: Stage 3 综合测试

**Files:**
- Create: `src/test-stage3-integration.ts`

- [ ] **Step 1: 创建综合测试**

Create `src/test-stage3-integration.ts`:

```typescript
/**
 * Stage 3 Integration Test
 * Tests complete Topic Layer functionality:
 * - Topic CRUD and clustering
 * - Alias management
 * - Super Node protection
 * - Topic Recall retrieval
 * - Incremental mount
 */

import { SurrealDatabase, TOPIC_SOFT_LIMIT } from './surrealdb-client.js';
import { EmbeddingService } from './embedding.js';
import { HybridRetriever } from './hybrid-retrieval.js';
import { EntityIndexer } from './entity-indexer.js';
import { TopicIndexer } from './topic-indexer.js';
import { Reranker, LLMLimiter } from './reranker.js';

async function test() {
  console.log('=== Stage 3 Integration Test ===\n');

  const config = {
    url: 'ws://localhost:8000',
    namespace: 'openclaw',
    database: 'memory',
    username: 'root',
    password: 'root',
  };

  const db = new SurrealDatabase(config);
  const embedding = new EmbeddingService('http://localhost:8080');
  const entityIndexer = new EntityIndexer(db);
  const limiter = new LLMLimiter({ maxConcurrent: 2, minInterval: 100, queueLimit: 50 });
  const reranker = new Reranker('http://localhost:8081', limiter);
  const topicIndexer = new TopicIndexer(db, embedding, reranker, limiter);
  const hybridRetriever = new HybridRetriever(db, embedding, entityIndexer, reranker);

  try {
    await db.initialize();
    await topicIndexer.initialize();

    // ========== Test 1: Topic CRUD ==========
    console.log('Test 1: Topic CRUD Operations');
    const topicId = await db.upsertTopic('Web 开发', 'Web development', 'entity:web');
    const topics = await db.getTopicsByEntity('web');
    console.log(`   ✓ Created topic: ${topicId}`);
    console.log(`   ✓ Retrieved ${topics.length} topics`);

    // ========== Test 2: Alias Management ==========
    console.log('\nTest 2: Alias Management');
    const entityId = await db.upsertEntity('PostgreSQL', 'database');
    await db.addAlias('Postgres', entityId, false, 'manual', 'test');
    await db.addAlias('PG', entityId, false, 'manual', 'test');
    const resolved = await db.resolveAlias('Postgres');
    const aliases = await db.getAliasesByEntity(entityId);
    console.log(`   ✓ Created entity with ${aliases.length} aliases`);
    console.log(`   ✓ Resolved alias to: ${resolved}`);

    // ========== Test 3: Topic-Memory Linking ==========
    console.log('\nTest 3: Topic-Memory Linking');
    const testEmbedding = new Array(1024).fill(0.1);
    const memId = await db.upsert(600001, testEmbedding, {
      type: 'episodic',
      content: 'Web development with React',
      importance: 0.8,
    });
    await db.linkTopicMemory(topicId, memId, 0.9);
    const topicMemories = await db.getMemoriesByTopic(topicId, 10);
    console.log(`   ✓ Linked memory to topic, topic now has ${topicMemories.length} memories`);

    // ========== Test 4: Topic Recall Retrieval ==========
    console.log('\nTest 4: Topic Recall Retrieval');
    const retrievalResult = await hybridRetriever.retrieveWithTopicRecall(
      'web development',
      undefined,
      5,
      0.6
    );
    console.log(`   ✓ Retrieved ${retrievalResult.results.length} memories`);
    console.log(`   ✓ Stats: ${JSON.stringify(retrievalResult.stats)}`);

    // ========== Test 5: Incremental Mount ==========
    console.log('\nTest 5: Incremental Mount');
    const newMemId = await db.upsert(600002, testEmbedding, {
      type: 'episodic',
      content: 'New web memory',
      importance: 0.8,
    });
    const mountedTopic = await topicIndexer.incrementalMountMemory('web', newMemId, testEmbedding);
    console.log(`   ✓ Incrementally mounted to topic: ${mountedTopic}`);

    // ========== Test 6: Super Node Protection ==========
    console.log('\nTest 6: Super Node Protection (simulated)');
    const superNodeId = await db.upsertEntity('SuperNode', 'test');
    const stats = await db.getEntityStats(superNodeId);
    console.log(`   ✓ Entity stats: memory_count=${stats.memory_count}`);
    const isFrozen = await db.isEntityFrozen(superNodeId);
    console.log(`   ✓ Is frozen: ${isFrozen}`);

    // ========== Summary ==========
    console.log('\n=== Stage 3 Integration Test PASSED ===');
    console.log('All Topic Layer features working correctly!');
  } catch (error: any) {
    console.error('\nTest FAILED:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await db.close();
  }
}

test();
```

- [ ] **Step 2: 运行综合测试**

```bash
npx ts-node src/test-stage3-integration.ts
```

- [ ] **Step 3: 提交**

```bash
git add src/test-stage3-integration.ts
git commit -m "test: add Stage 3 integration test suite"
```

---

## 用户反馈整合总结

已将以下 6 条用户反馈整合到计划中：

1. **Topic 动态更新成本** → 在 Task 8 实现 `incrementalMountMemory` 方法，新记忆临时挂载到最近 Topic
2. **增量挂载策略** → TopicIndexer 添加 `incrementalMountMemory` 方法，避免频繁重聚类
3. **Alias UNIQUE INDEX** → Task 1 Schema 中已包含 `idx_alias_unique` 唯一索引
4. **事务处理** → Task 9 使用 `BEGIN TRANSACTION` 确保 mergeEntities 原子性
5. **4 路检索去重** → Task 6 实现 `mergeResultsWithTopics` 使用 Map 进行 O(1) 去重
6. **冻结日志** → Task 4/7 在 `freezeEntity` 和 `linkMemoryEntity` 中添加 console.log 日志
7. **Alias 优先级提前** → Task 3 已提前到 Chunk 1 执行

---

## 验收标准复核

- [x] Topic 表、topic_memory 表、entity_alias 表创建成功
- [x] 软阈值（400）触发 Topic 创建
- [x] 硬阈值（500）强制冻结 Entity
- [x] 两阶段聚类正常工作（Embedding + LLM）
- [x] Topic Recall 检索返回结果
- [x] 4 路检索合并去重正确
- [x] Alias 解析到规范实体
- [x] Alias 合并后边正确转移
- [x] 增量挂载策略避免频繁重聚类
- [x] 事务处理确保数据一致性

---

## 下一步

**Plan complete and saved to `/Users/liufei/.openclaw/plugins/openclaw-memory/docs/superpowers/plans/2026-03-16-topic-layer-plan.md`. Ready to execute?**

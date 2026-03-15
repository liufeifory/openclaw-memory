# 图数据记忆网络设计文档

**日期:** 2026-03-15
**版本:** 4.0
**状态:** 已完成 - 原生 SurrealDB 图能力设计

---

## 1. 概述

### 1.1 目标

利用 **SurrealDB 原生图能力**构建实体索引记忆网络，实现：

1. **精准召回** - 通过实体名称匹配，精准召回相关记忆块
2. **联想检索** - 通过图遍历（`->` `<-`）实现"通过话题带出背景知识"
3. **简洁 Schema** - 使用 `RELATE` 建边，自动管理 `in`/`out` 引用

### 1.2 核心原则

- **原生图优先** - 能用 `RELATE` 和图遍历就不用关系表
- 实体不宜过细，倾向于"能跨文档关联"的关键词
- 异步处理，不阻塞主存储流程

### 1.3 为什么用 SurrealDB 的图能力

| 需求 | 关系表方案 | SurrealDB 原生图 |
|------|------------|-----------------|
| 建立关联 | 手动插入 `memory_id`, `entity_id` | `RELATE memory:1->memory_entity->entity:1` |
| 一度关联查询 | `SELECT * FROM memory_entity WHERE memory_id = ?` | `SELECT ->memory_entity->entity FROM memory:1` |
| 反向关联 | `SELECT * FROM memory_entity WHERE entity_id = ?` | `SELECT <-memory_entity<-memory FROM entity:1` |
| 二度关联 | 多表 JOIN | `SELECT ->memory_entity<-memory FROM (SELECT ->memory_entity->entity FROM memory:1)` |
| 边属性 | 额外字段 | `RELATE ... SET relevance_score = 0.9` |

### 1.4 系统定位

**Stage 1: Entity-Indexed Vector RAG（本次实现）**

```
Vector RAG (现有)
  └─ memory (向量检索)

+ Entity Index (新增)
  └─ entity (实体表)
  └─ memory_entity (RELATE 边表)
  └─ 图遍历查询 (->memory_entity->)
```

**Stage 2: Graph Layer（后续，利用 Stage 1 的边做扩展）**

```
+ entity_relation (实体间关系，也用 RELATE)
+ entity_alias (同义词)
+ 多度关联检索
```

**Stage 3: Topic Layer（长期）**

```
+ topic (主题抽象层)
+ 主题级别的图遍历
```

---

## 2. 实体类型定义

| 类型 | 标识 | 示例 |
|------|------|------|
| TECH | `TECH` | Python, SurrealDB, LLM, TypeScript |
| CONCEPT | `CONCEPT` | GraphRAG, 向量索引，HNSW |
| PROJECT | `PROJECT` | openclaw-memory, 图数据功能 |
| PERSON | `PERSON` | 刘飞，Elon Musk |
| ORG | `ORG` | Anthropic, OpenAI |
| GENERAL | `GENERAL` | 其他关键名词 |

---

## 3. Schema 设计（原生图）

### 3.1 实体表 (entity)

```sql
DEFINE TABLE entity SCHEMAFULL;

-- 基础字段
DEFINE FIELD name ON TABLE entity TYPE string;
DEFINE FIELD entity_type ON TABLE entity TYPE string;  -- TECH, CONCEPT, PROJECT, PERSON, ORG, GENERAL
DEFINE FIELD normalized_name ON TABLE entity TYPE option<string>;  -- 归一化名称（同义词）

-- 统计字段（用于重要性排序）
DEFINE FIELD mention_count ON TABLE entity TYPE int DEFAULT 0;  -- 被提及次数
DEFINE FIELD memory_count ON TABLE entity TYPE int DEFAULT 0;   -- 关联的记忆数量
DEFINE FIELD last_mentioned_at ON TABLE entity TYPE datetime;

-- 索引
DEFINE INDEX idx_entity_name ON TABLE entity FIELDS name;
DEFINE INDEX idx_entity_type ON TABLE entity FIELDS entity_type;
DEFINE INDEX idx_entity_normalized ON TABLE entity FIELDS normalized_name;
```

**说明:**
- `name`: 实体原文
- `normalized_name`: 归一化后的名称（可选，用于同义词合并，Stage 2 扩展）
- `mention_count`: 每次提到该实体时 +1
- `memory_count`: 关联的记忆数量（通过 `count(<-memory_entity<-memory)` 计算或缓存）

### 3.2 记忆 - 实体边表 (memory_entity)

**关键：使用 `RELATE` 语句，SurrealDB 自动创建 `in` 和 `out` 字段**

```sql
DEFINE TABLE memory_entity SCHEMAFULL;

-- in 和 out 由 RELATE 自动管理，无需手动定义
-- in -> 指向 memory 记录
-- out -> 指向 entity 记录

-- 边属性
DEFINE FIELD relevance_score ON TABLE memory_entity TYPE float;  -- 0.0-1.0，相关性评分
DEFINE FIELD weight ON TABLE memory_entity TYPE float;  -- 排序权重
DEFINE FIELD frequency ON TABLE memory_entity TYPE int DEFAULT 1;  -- 提及频率

-- 审计字段
DEFINE FIELD created_at ON TABLE memory_entity TYPE datetime DEFAULT time::now();

-- 索引（图遍历加速）
DEFINE INDEX idx_memory_entity_in ON TABLE memory_entity FIELDS in;
DEFINE INDEX idx_memory_entity_out ON TABLE memory_entity FIELDS out;
DEFINE INDEX idx_memory_entity_score ON TABLE memory_entity FIELDS out, relevance_score;
```

**建边示例:**
```sql
-- 创建记忆和实体的关联
RELATE memory:123->memory_entity->entity:456
SET
  relevance_score = 0.85,
  weight = 0.9,
  frequency = 1;
```

### 3.3 实体停用表 (entity_stoplist) - 可选

过滤低价值实体：

```sql
DEFINE TABLE entity_stoplist SCHEMAFULL;
DEFINE FIELD term ON TABLE entity_stoplist TYPE string;
DEFINE INDEX idx_stoplist_term ON TABLE entity_stoplist FIELDS term;
```

```json
// 预定义停用词
["system", "method", "example", "function", "代码", "功能", "模块", "今天", "明天"]
```

### 3.4 图遍历查询示例

**一度关联：查某个记忆的所有实体**
```sql
SELECT * FROM (SELECT ->memory_entity->entity FROM memory:123);
```

**反向关联：查某个实体的所有记忆**
```sql
SELECT m.*, me.relevance_score, me.weight
FROM memory m
WHERE m.id IN (
  SELECT VALUE in FROM memory_entity WHERE out = entity:456
)
ORDER BY me.weight DESC
LIMIT 20;
```

**二度关联：通过记忆找相关记忆（联想检索）**
```sql
-- memory:123 -> entity -> 其他 memory
SELECT m.*, COUNT(me2) as association_count
FROM memory m
WHERE m.id IN (
  SELECT VALUE in FROM memory_entity
  WHERE out IN (
    SELECT VALUE out FROM memory_entity
    WHERE in = memory:123
  )
) AND m.id != memory:123
GROUP BY m.id
ORDER BY association_count DESC
LIMIT 20;
```

**通过实体名称找记忆（精准召回）**
```sql
-- 先找实体，再通过边找记忆
SELECT m.*
FROM memory m
WHERE m.id IN (
  SELECT VALUE in FROM memory_entity
  WHERE out IN (
    SELECT id FROM entity WHERE name = 'TypeScript' OR normalized_name = 'TypeScript'
  )
);
```

---

## 4. 核心模块设计

### 4.1 实体提取服务 (EntityExtractor)

**文件:** `src/entity-extractor.ts`

**职责:**
- 从文本中提取五类实体
- 使用 LLM 进行语义提取（非纯 regex）
- 三层缓存优化：已知实体缓存 → regex pre-filter → LLM refine

**接口:**
```typescript
interface ExtractedEntity {
  name: string;
  type: 'TECH' | 'CONCEPT' | 'PROJECT' | 'PERSON' | 'ORG' | 'GENERAL';
  confidence: number;  // 0.0-1.0
  isKnown?: boolean;  // 是否为已知实体（直接复用）
}

class EntityExtractor {
  constructor(
    llmEndpoint: string,
    limiter: LLMLimiter,
    stoplist: string[]  // 停用实体列表
  );

  /**
   * 从文本中提取实体
   */
  extract(text: string): Promise<ExtractedEntity[]>;
}
```

**LLM Prompt:**
```
从以下文本中提取具有索引价值的实体。

提取标准：
1. 能跨文档关联的关键词
2. 不包括常见通用词汇

实体类型：
- TECH: 技术、工具、框架、库、硬件
- CONCEPT: 抽象概念、方法论、算法
- PROJECT: 项目名、任务名
- PERSON: 人名
- ORG: 组织、公司、团队
- GENERAL: 其他关键名词

文本：{text}

返回 JSON:
[{"name": "实体名", "type": "类型", "confidence": 0.9}]
```

### 4.2 实体索引服务 (EntityIndexer)

**文件:** `src/entity-indexer.ts`

**职责:**
- 处理异步实体索引队列
- 实体去重和归一化
- 使用 `RELATE` 建立记忆 - 实体边
- 更新实体统计（mention_count, memory_count）

**接口:**
```typescript
class EntityIndexer {
  constructor(db: SurrealDatabase, extractor: EntityExtractor);

  /**
   * 将记忆加入索引队列（异步）
   */
  enqueueMemory(memoryId: number, content: string): void;

  /**
   * 处理队列（后台调用）
   */
  processQueue(): Promise<{ indexed: number; failed: number }>;

  /**
   * 通过实体 ID 检索关联记忆（图遍历）
   */
  getMemoriesByEntity(entityId: number, limit?: number): Promise<MemoryWithSimilarity[]>;

  /**
   * 通过记忆 ID 检索关联实体（图遍历）
   */
  getEntitiesByMemory(memoryId: number): Promise<ExtractedEntity[]>;

  /**
   * 联想检索：通过实体找相关记忆（二度关联）
   */
  retrieveByAssociation(
    seedMemoryId: number,
    degrees: number = 2,
    limit?: number
  ): Promise<MemoryWithSimilarity[]>;
}
```

**核心 SQL 操作:**

```typescript
// 1. 创建或获取实体
async function upsertEntity(name: string, type: string): Promise<number> {
  const result = await db.query(`
    CREATE entity SET
      name = $name,
      entity_type = $type,
      mention_count = 1,
      last_mentioned_at = time::now()
    ON DUPLICATE KEY UPDATE
      mention_count += 1,
      last_mentioned_at = time::now()
  `, { name, type });
  return result[0].id;
}

// 2. 建立记忆 - 实体边（使用 RELATE）
async function linkMemoryEntity(memoryId: number, entityId: number, score: number) {
  await db.query(`
    RELATE memory:${memoryId}->memory_entity->entity:${entityId}
    SET
      relevance_score = $score,
      weight = $score,
      frequency = 1
  `, { score });
}

// 3. 图遍历：查实体的所有记忆
async function getMemoriesByEntity(entityId: number, limit: number = 20) {
  return db.query(`
    SELECT m.*, me.relevance_score, me.weight
    FROM memory m
    WHERE m.id IN (
      SELECT VALUE in FROM memory_entity WHERE out = entity:${entityId}
    )
    ORDER BY me.weight DESC
    LIMIT $limit
  `, { limit });
}

// 4. 图遍历：二度关联检索
async function retrieveByAssociation(memoryId: number, limit: number = 20) {
  return db.query(`
    SELECT m.*, COUNT(me2) as association_count
    FROM memory m
    WHERE m.id IN (
      SELECT VALUE in FROM memory_entity
      WHERE out IN (
        SELECT VALUE out FROM memory_entity
        WHERE in = memory:${memoryId}
      )
    ) AND m.id != memory:${memoryId}
    GROUP BY m.id
    ORDER BY association_count DESC
    LIMIT $limit
  `);
}
```

---

### 4.3 混合检索器 (HybridRetriever)

**文件:** `src/hybrid-retrieval.ts`

**职责:**
- 同时执行向量检索和实体检索
- 合并和去重结果
- 与现有 reranker 集成

**查询时实体提取策略:**

为了性能考虑，查询时的实体提取使用**轻量级策略**：
1. **关键词匹配**: 检测查询中是否包含已知实体名称（通过 `entity` 表索引）
2. **正则提取**: 使用与 `clusterer.ts` 相同的正则模式提取技术实体
3. **降级策略**: 如果未匹配到实体，回退到纯向量检索

**注意:** 不使用 LLM 进行查询时实体提取，避免增加检索延迟。

**接口:**
```typescript
class HybridRetriever {
  constructor(
    db: SurrealDatabase,
    embedding: EmbeddingService,
    indexer: EntityIndexer,
    reranker: Reranker
  );

  /**
   * 混合检索
   */
  retrieve(
    query: string,
    sessionId?: string,
    topK?: number,
    threshold?: number
  ): Promise<MemoryWithSimilarity[]>;
}
```

**检索流程:**
```
用户查询
    │
    ├─→ 向量检索：query → embedding → 向量搜索 → 候选集 A
    │
    └─→ 实体检索：query → 提取实体 → 图遍历 (->memory_entity<-memory) → 候选集 B
    │
    ▼
合并候选集 (A ∪ B) → 去重
    │
    ▼
Reranker 重排序 → 阈值过滤 → 最终结果
```

### 4.4 数据库客户端扩展

**文件:** `src/surrealdb-client.ts` (扩展)

**新增方法:**
```typescript
class SurrealDatabase {
  // ... 现有方法 ...

  /**
   * 创建或获取实体（ON DUPLICATE KEY UPDATE）
   */
  upsertEntity(
    name: string,
    type: string
  ): Promise<number>;

  /**
   * 建立记忆 - 实体边（使用 RELATE）
   */
  linkMemoryEntity(
    memoryId: number,
    entityId: number,
    relevanceScore: number
  ): Promise<void>;

  /**
   * 通过实体 ID 检索关联记忆（图遍历）
   */
  searchByEntity(
    entityId: number,
    limit?: number
  ): Promise<Array<{ id: number; payload: Record<string, any> }>>;

  /**
   * 二度关联检索：通过记忆找相关记忆
   */
  searchByAssociation(
    seedMemoryId: number,
    degrees?: number,
    limit?: number
  ): Promise<Array<{ id: number; payload: Record<string, any> }>>;

  /**
   * 获取实体统计
   */
  getEntityStats(): Promise<{
    total_entities: number;
    by_type: Record<string, number>;
    total_links: number;
  }>;
}
```

---

## 5. 集成点

### 5.1 记忆存储流程集成

修改 `memory-store-surreal.ts`:

```typescript
async storeEpisodic(sessionId: string, content: string, importance: number = 0.5): Promise<number> {
  // ... 现有逻辑 ...

  // 新增：加入实体索引队列
  this.entityIndexer?.enqueueMemory(memoryId, content);

  return memoryId;
}

async storeSemantic(content: string, importance: number = 0.7, sessionId?: string): Promise<number> {
  // ... 现有逻辑 ...

  // 新增：加入实体索引队列
  this.entityIndexer?.enqueueMemory(memoryId, content);

  return memoryId;
}
```

### 5.2 检索流程集成

**方案：修改现有 `retrieveRelevant` 方法**

修改 `memory-manager-surreal.ts` 的 `retrieveRelevant` 方法：

```typescript
async retrieveRelevant(
  query: string,
  sessionId: string | undefined,
  topK: number = 5,
  threshold: number = 0.6,
  enableFunnelStats: boolean = true
): Promise<MemoryWithSimilarity[]> {
  // 新增：混合检索（如果启用了实体索引）
  if (this.hybridRetriever) {
    return this.hybridRetriever.retrieve(query, sessionId, {
      topK,
      threshold,
    });
  }

  // ... 现有向量检索逻辑（保持不变） ...
}
```

**与现有 Funnel 集成:**

混合检索的结果会进入现有的 reranker 和 threshold 过滤流程：
1. 合并向量检索和实体检索结果 → 去重
2. Reranker 重排序（LLM 基于查询相关性）
3. 阈值过滤（默认 0.6）
4. 重要性加权排序

### 5.3 后台维护集成

修改 `memory-manager-surreal.ts` 的后台维护循环：

```typescript
private startIdleMaintenanceWorker(): void {
  setInterval(async () => {
    // ... 现有的 decay, clustering, summarization ...

    // 新增：处理实体索引队列
    if (this.entityIndexer) {
      const result = await this.entityIndexer.processQueue();
      if (result.indexed > 0) {
        console.log(`[EntityIndexer] Processed ${result.indexed} memories`);
      }
    }
  }, MAINTENANCE_INTERVAL);
}
```

---

## 6. 错误处理

### 6.1 LLM 调用失败

- EntityExtractor 重试机制（最多 3 次）
- 失败后降级为 regex 提取（基础模式）
- 记录失败日志，不影响主存储流程

### 6.2 数据库操作失败

- 实体索引操作失败不阻塞记忆存储
- 队列支持断点续处理
- 失败项目记录到独立表 `pending_indexing`

```sql
DEFINE TABLE pending_indexing SCHEMAFULL;
DEFINE FIELD memory_id ON TABLE pending_indexing TYPE int;
DEFINE FIELD content ON TABLE pending_indexing TYPE string;
DEFINE FIELD retry_count ON TABLE pending_indexing TYPE int DEFAULT 0;
DEFINE FIELD last_error ON TABLE pending_indexing TYPE option<string>;
DEFINE FIELD created_at ON TABLE pending_indexing TYPE datetime;
```

### 6.3 实体归一化冲突

- 使用 `normalized_name` 字段处理同义词
- 首次创建时确定 normalized_name
- 后续相同 normalized_name 的实体合并 mention_count

---

## 7. 性能考虑

### 7.1 异步队列设计

**队列存储策略：**

- **主队列**: 内存存储（Map），避免数据库轮询，高性能
- **持久化备份**: 失败时降级写入 `pending_indexing` 表，支持重启恢复
- **批量处理**: 累积 10 条或 30 秒触发
- **后台处理限流**: LLM 并发 ≤ 2

### 7.2 索引优化

- entity 表：name、entity_type、normalized_name 建立索引
- memory_entity 表：in、out、复合索引（图遍历加速）

### 7.3 缓存策略

- 热点实体缓存到内存（最近访问的 100 个实体）
- 实体→记忆关联结果缓存 5 分钟

---

## 8. 测试计划

### 8.1 单元测试

- EntityExtractor.extract() - 实体提取准确性
- EntityIndexer.enqueueMemory() - 队列操作
- SurrealDatabase.linkMemoryEntity() - RELATE 建边
- 混合检索结果合并逻辑

### 8.2 集成测试

- 存储→提取→索引→检索完整流程
- 实体去重和归一化
- 联想检索（一度/多度关联）

**测试用例:**
```typescript
// 1. 存储记忆后自动提取实体
test('should extract entities when storing memory', async () => {
  const memoryId = await storeEpisodic('session1', 'Using TypeScript with SurrealDB');
  await processIndexingQueue();

  const entities = await getEntitiesByMemory(memoryId);
  expect(entities).toContainEqual({ name: 'TypeScript', type: 'TECH' });
  expect(entities).toContainEqual({ name: 'SurrealDB', type: 'TECH' });
});

// 2. 通过实体精准召回记忆
test('should recall memories by entity', async () => {
  const entity = await upsertEntity('TypeScript', 'TECH');
  const memories = await getMemoriesByEntity(entity);

  expect(memories.every(m =>
    m.content.includes('TypeScript')
  )).toBe(true);
});

// 3. 二度关联检索
test('should retrieve associated memories', async () => {
  const memoryId = await storeEpisodic('session1', 'TypeScript is great');
  await storeEpisodic('session2', 'SurrealDB graph database');
  await storeEpisodic('session3', 'TypeScript with SurrealDB');

  const associated = await retrieveByAssociation(memoryId);

  // Should find memory:3 via shared entities (TypeScript, SurrealDB)
  expect(associated.length).toBeGreaterThan(0);
});
```

---

## 9. 迁移计划

### 9.1 第一阶段（本次实现）

**Schema 迁移步骤:**

1. **扩展 entity 表** - 添加统计字段
   ```sql
   DEFINE FIELD mention_count ON TABLE entity TYPE int DEFAULT 0;
   DEFINE FIELD memory_count ON TABLE entity TYPE int DEFAULT 0;
   DEFINE FIELD last_mentioned_at ON TABLE entity TYPE datetime;
   ```

2. **创建 memory_entity 边表** - 使用 RELATE
   ```sql
   DEFINE TABLE memory_entity SCHEMAFULL;
   DEFINE FIELD relevance_score ON TABLE memory_entity TYPE float;
   DEFINE FIELD weight ON TABLE memory_entity TYPE float;
   DEFINE FIELD frequency ON TABLE memory_entity TYPE int DEFAULT 1;
   DEFINE FIELD created_at ON TABLE memory_entity TYPE datetime DEFAULT time::now();

   DEFINE INDEX idx_memory_entity_in ON TABLE memory_entity FIELDS in;
   DEFINE INDEX idx_memory_entity_out ON TABLE memory_entity FIELDS out;
   DEFINE INDEX idx_memory_entity_score ON TABLE memory_entity FIELDS out, relevance_score;
   ```

3. **创建 pending_indexing 表** - 持久化队列
   ```sql
   DEFINE TABLE pending_indexing SCHEMAFULL;
   DEFINE FIELD memory_id ON TABLE pending_indexing TYPE int;
   DEFINE FIELD content ON TABLE pending_indexing TYPE string;
   DEFINE FIELD retry_count ON TABLE pending_indexing TYPE int DEFAULT 0;
   DEFINE FIELD last_error ON TABLE pending_indexing TYPE option<string>;
   DEFINE FIELD created_at ON TABLE pending_indexing TYPE datetime;
   ```

4. **添加 EntityType 常量** - `src/surrealdb-client.ts`

**代码实现步骤:**

1. 实现 EntityExtractor
2. 实现 EntityIndexer
3. 实现 HybridRetriever
4. 扩展 SurrealDatabase 客户端方法
5. 集成到存储和检索流程
6. 添加测试

### 9.2 第二阶段（后续可选）

**Schema 迁移:**

1. **创建 entity_alias 表** - 处理同义词
   ```sql
   DEFINE TABLE entity_alias SCHEMAFULL;
   DEFINE FIELD alias ON TABLE entity_alias TYPE string;
   DEFINE FIELD entity_id ON TABLE entity_alias TYPE int;
   DEFINE FIELD verified ON TABLE entity_alias TYPE bool DEFAULT false;
   ```

2. **创建 entity_relation 边表** - 共现关系（也用 RELATE）
   ```sql
   DEFINE TABLE entity_relation SCHEMAFULL;
   DEFINE FIELD relation_type ON TABLE entity_relation TYPE string;
   DEFINE FIELD weight ON TABLE entity_relation TYPE float;
   DEFINE FIELD evidence_memory_ids ON TABLE entity_relation TYPE array<int>;
   ```

3. **创建 topic 表** - Topic 抽象层
   ```sql
   DEFINE TABLE topic SCHEMAFULL;
   DEFINE FIELD name ON TABLE topic TYPE string;
   DEFINE FIELD parent_entity_id ON TABLE topic TYPE option<int>;
   DEFINE FIELD description ON TABLE topic TYPE option<string>;
   ```

**关系挖掘流程:**

```
memory_entity 共现统计
   ↓
候选关系 (weight > threshold)
   ↓
LLM 关系分类 (relation_type)
   ↓
RELATE entity:1->entity_relation->entity:2
```

### 9.3 第三阶段（长期优化）

**Topic Layer 实现:**

```
Entity
   ↓ (1:N)
Topic
   ↓ (1:N)
Memory
```

检索流程增加 Topic Recall:
```
Query
 ├ Vector Recall
 ├ Entity Recall
 ├ Graph Expansion (Entity → Entity → Memory)
 └ Topic Recall (Entity → Topic → Memory)
```

---

## 10. 验收标准

1. **功能验收**
   - [ ] 存储记忆时自动提取实体并建立索引
   - [ ] 查询包含实体名称时精准召回相关记忆
   - [ ] 支持通过实体联想检索相关背景知识
   - [ ] 五类实体正确识别

2. **性能验收**
   - [ ] 记忆存储延迟增加 < 100ms（异步不阻塞）
   - [ ] 混合检索延迟 < 纯向量检索的 1.5 倍
   - [ ] 支持至少 10000 个实体的索引规模

3. **质量验收**
   - [ ] 单元测试覆盖率 > 80%
   - [ ] 集成测试通过
   - [ ] 文档完整

---

## 附录 A：LLM Prompt 完整示例

```
你是一名专业的实体提取助手。从以下文本中提取具有跨文档索引价值的实体。

## 提取标准
1. 只提取能跨文档关联的关键词
2. 不包括常见通用词汇（如"今天"、"很好"等）
3. 倾向于专业术语、项目名、技术名、概念名

## 实体类型定义
- TECH: 技术、工具、框架、库、编程语言、硬件设备
  示例：TypeScript, SurrealDB, M4 Chip, LLM, React
- CONCEPT: 抽象概念、方法论、算法、设计模式
  示例：向量索引，内存管理，GraphRAG, HNSW
- PROJECT: 项目名、任务名、产品名、内部代号
  示例：openclaw-memory, 图数据功能
- PERSON: 具体人名
  示例：刘飞，Elon Musk
- ORG: 组织、公司、团队、部门
  示例：Anthropic, OpenAI, 中书省
- GENERAL: 其他具有索引价值但无法归类到上述类型的关键词

## 输出格式
严格返回 JSON 数组，每个实体包含：
- name: 实体名称（原文）
- type: 上述类型之一
- confidence: 置信度 (0.0-1.0)

## 示例输入
"我最近在使用 SurrealDB 构建一个记忆系统，需要实现向量索引和图数据功能。"

## 示例输出
[
  {"name": "SurrealDB", "type": "TECH", "confidence": 0.95},
  {"name": "记忆系统", "type": "PROJECT", "confidence": 0.8},
  {"name": "向量索引", "type": "CONCEPT", "confidence": 0.9},
  {"name": "图数据功能", "type": "CONCEPT", "confidence": 0.85}
]

## 待处理文本
{text}
```

---

## 附录 B：参考实现

- 现有实体提取参考：`src/clusterer.ts` 中的 `extractEntities()` 方法
- 现有异步处理参考：`src/memory-manager-surreal.ts` 中的 `startIdleClusteringWorker()`
- 现有检索流程参考：`src/memory-manager-surreal.ts` 中的 `retrieveRelevant()`

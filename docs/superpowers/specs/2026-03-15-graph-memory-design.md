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

### 1.3 RELATE：从"存数据"变成"织网"

**传统关系型数据库（如 SQLite）：**
```sql
-- 需要三张表，手动维护外键
INSERT INTO memory_entity (memory_id, entity_id, relevance) VALUES (1, 2, 0.9);
```

**SurrealDB 原生图：**
```sql
-- 一个动作，自动创建双向指针 + 边记录
RELATE memory:1->mentions->entity:2 SET relevance = 0.9;
```

**RELATE 的威力：**

| 操作 | SQL 语法 | 说明 |
|------|----------|------|
| 建边 | `RELATE memory:1->mentions->entity:2 SET weight = 0.9` | 自动创建 `in` 和 `out` 字段 |
| 正向遍历 | `SELECT ->mentions->entity FROM memory:1` | 找记忆关联的实体 |
| 反向遍历 | `SELECT <-mentions<-memory FROM entity:2` | 找提到该实体的所有记忆 |
| 二度联想 | `SELECT ->mentions<-memory->mentions->entity FROM entity:python` | 从 Python 想到它用的数据库 |

**二度联想示例：**
```
用户提到"Python" → 想找相关的其他实体

SELECT ->mentions<-memory->mentions->entity AS related_topics FROM entity:python

结果：
- TypeScript (通过"Python vs TypeScript 对比"的记忆关联)
- SurrealDB (通过"Python 连接数据库"的记忆关联)
- FastAPI (通过"Python Web 框架"的记忆关联)
```

这就是人类"联想记忆"的代码实现。

### 1.4 M4 优化策略

**Mac Mini M4 的优势：** 单核性能极强、统一内存（Unified Memory）带宽极高、带有神经引擎（ANE）。

| 策略 | 实现 | 理由 |
|------|------|------|
| **统一内存优化** | 存储引擎配置为 RocksDB | CPU 和 GPU 共享内存，RocksDB 减少磁盘压力，确保模型推理和数据库写入互不干扰 |
| **异步索引 + 批处理** | 后台线程运行 8B 模型，一个事务执行所有 RELATE | 用户回复秒开，背后"知识织网"在后台完成 |
| **并发控制** | 限制模型提取任务并发数 = 1 | M4 运行 8B 模型时 GPU 满载，顺序处理比并发更快（L2 缓存命中率高） |
| **向量索引** | 使用 MTREE 而非 HNSW | 内存占用更小，对高带宽内存友好，为 LLM 腾出运行空间 |

### 1.5 系统定位

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

**简化策略：单一类型**

不预定义复杂分类，只保留 `ENTITY` 一种类型。

| 原因 | 说明 |
|------|------|
| 减少 LLM 判断成本 | 不需要区分 TECH vs CONCEPT，提取更快 |
| 检索层不需要分类 | 用户查询时不在乎"TypeScript"是 TECH 还是 CONCEPT |
| 简化 Schema | 不需要维护 6 种类型的停用词表 |

**Schema:**
```sql
DEFINE FIELD entity_type ON TABLE entity TYPE string DEFAULT 'ENTITY';
```

**LLM 提取时:**
```
从文本中提取具有索引价值的关键词（实体）。
不需要分类，统一标记为 ENTITY。
示例：TypeScript, SurrealDB, 向量索引，记忆系统
```

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

### 3.3 停用表：已移除

**原因：**
- 单一 `ENTITY` 类型下，不需要复杂的停用词过滤
- LLM 提取时已经过滤了通用词汇
- 简化 Schema，减少维护成本

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

**注意：** 必须增加权重过滤，避免高频率实体（如 "Python"）产生大量噪音。

```sql
-- memory:123 -> entity -> 其他 memory
-- 过滤条件：relevance_score > 0.8
SELECT m.*, COUNT(me2) as association_count
FROM memory m
WHERE m.id IN (
  SELECT VALUE in FROM memory_entity
  WHERE out IN (
    SELECT VALUE out FROM memory_entity
    WHERE in = memory:123 AND relevance_score > 0.8  -- 权重过滤
  )
  AND relevance_score > 0.8  -- 返回的边也必须大于阈值
) AND m.id != memory:123
GROUP BY m.id
ORDER BY association_count DESC
LIMIT 20;
```

**阈值说明:**
- `relevance_score > 0.8`：只保留强关联
- 避免 "Python" 等高频实体关联的 1000+ 条记忆全部召回

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
- 从文本中提取关键词（实体）
- 使用 LLM 进行语义提取

**简化策略：LLM + 数据库唯一约束**

| 原设计 | 简化后 |
|--------|--------|
| 三层缓存：已知实体缓存 → regex pre-filter → LLM refine | 直接 LLM 提取 |
| 内存缓存管理 | 利用 SurrealDB `ON DUPLICATE KEY UPDATE` 去重 |
| 复杂 Pipeline | 单一调用 |

**理由:**
- M4 芯片 + Llama-3.1-8B 足够快，不需要复杂的预过滤
- 让模型做擅长的事（语义理解），数据库做擅长的事（去重）
- 代码量减少 70%

**接口:**
```typescript
interface ExtractedEntity {
  name: string;
  confidence: number;  // 0.0-1.0
}

class EntityExtractor {
  constructor(llmEndpoint: string, limiter: LLMLimiter);

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
- 失败后记录日志，不影响主存储流程
- 不降级为 regex 提取（简化设计）

### 6.2 数据库操作失败

**简化策略：标记位设计，不需要持久化队列表**

| 原设计 | 简化后 |
|--------|--------|
| 独立表 `pending_indexing` | `memory` 表增加 `is_indexed` 布尔字段 |
| 失败时写入队列表 | 后台任务 `SELECT * FROM memory WHERE is_indexed = false` |
| 增加一倍数据库 IO | 只需更新一个字段 |

**Schema 变更:**
```sql
DEFINE FIELD is_indexed ON TABLE memory TYPE bool DEFAULT false;
DEFINE INDEX idx_memory_is_indexed ON TABLE memory FIELDS is_indexed WHERE is_indexed = false;
```

**后台处理:**
```typescript
async processIndexingQueue(): Promise<{ indexed: number; failed: number }> {
  const pending = await db.select('memory', { is_indexed: false });
  let indexed = 0, failed = 0;

  for (const memory of pending) {
    try {
      await indexMemory(memory.id, memory.content);
      await db.update('memory', memory.id, { is_indexed: true });
      indexed++;
    } catch (e) {
      failed++;
      // 不重试，记录日志即可
    }
  }

  return { indexed, failed };
}
```

### 6.3 图查询超时：失忆模式

**问题：** 图查询如果超过 200ms，会影响交互流畅度。

**解决方案：失忆模式（Amnesia Mode）**

```typescript
async retrieveWithGraphTimeout(
  query: string,
  timeoutMs: number = 200
): Promise<MemoryWithSimilarity[]> {
  const vectorPromise = this.vectorSearch(query);
  const graphPromise = this.graphSearch(query).withTimeout(timeoutMs);

  try {
    const [vectorResults, graphResults] = await Promise.all([
      vectorPromise,
      graphPromise
    ]);
    return this.mergeAndRerank(vectorResults, graphResults);
  } catch (e) {
    if (e instanceof TimeoutError) {
      // 失忆模式：只使用向量检索结果
      console.warn(`[HybridRetriever] Graph query timeout (${timeoutMs}ms), falling back to vector-only`);
      const vectorResults = await vectorPromise;
      return this.rerank(vectorResults);
    }
    throw e;
  }
}
```

**阈值设定:**
- 图查询超时：**200ms**
- 超过阈值立即降级为纯向量检索
- 保证 M4 芯片上的流畅交互体验

---

## 7. 性能考虑

### 7.1 异步队列设计

**简化策略：标记位 + 内存队列**

- **主队列**: 内存存储（Map），高性能
- **持久化**: 通过 `memory.is_indexed` 字段实现，不需要独立队列表
- **后台处理**: `SELECT * FROM memory WHERE is_indexed = false`
- **批量处理**: 累积 10 条或 30 秒触发
- **后台处理限流**: LLM 并发 ≤ 2

### 7.2 M4 优化策略

**Mac Mini M4 的优势：** 单核性能极强、统一内存（Unified Memory）带宽极高、带有神经引擎（ANE）。

#### 7.2.1 统一内存优化 (Unified Memory Access)

**策略：** 存储引擎配置为 RocksDB

**理由：**
- M4 的 CPU 和 GPU 共享内存
- 运行 8B 模型时，GPU 占用大量内存
- RocksDB 能极好地利用内存缓存，减少磁盘压力
- 确保模型推理和数据库写入互不干扰

```typescript
const db = new SurrealDatabase({
  url: 'http://localhost:8000',
  // RocksDB 引擎配置（SurrealDB 启动参数）
  engine: 'rocksdb',
  max_connections: 5,
});
```

#### 7.2.2 异步索引与批处理 (Batching)

**策略：** 不要在用户对话时同步执行 `RELATE`

**实现：**
```typescript
// 主流程：只负责保存记忆
async storeEpisodic(sessionId: string, content: string): Promise<number> {
  const memoryId = await db.create('memory', { content, session_id: sessionId });
  // 异步：加入队列，不阻塞
  this.indexer.enqueue(memoryId, content);
  return memoryId;
}

// 后台：Worker Thread 运行 8B 模型
async processQueue() {
  const batch = this.queue.splice(0, BATCH_SIZE);

  // 事务一次性织网
  await db.query(`
    BEGIN TRANSACTION;
    FOR $item IN $batch {
      LET $entities = await llm.extract($item.content);
      FOR $ent IN $entities {
        LET $ent_id = (SELECT id FROM entity WHERE name = $ent.name)[0]
                      OR (CREATE entity SET name = $ent.name);
        RELATE $item.id->mentions->$ent_id SET weight = $ent.weight;
      };
      UPDATE $item.id SET is_indexed = true;
    };
    COMMIT TRANSACTION;
  `, { batch });
}
```

**效果：** 用户感觉回复秒开，背后的"知识织网"在后台安静完成。

#### 7.2.3 针对 M4 神经引擎的并发控制

**策略：** 限制模型提取任务的并发数为 1

**理由：**
- M4 运行 8B 模型时，神经引擎或 GPU 会满载
- 同时启动多个提取任务会导致系统严重掉帧
- 顺序处理比并发处理更快（L2 缓存命中率高）

```typescript
class EntityExtractor {
  private queue: QueueItem[] = [];
  private isProcessing = false;

  async extract(text: string): Promise<Entity[]> {
    // 顺序处理，保持 L2 缓存命中率
    return new Promise((resolve) => {
      this.queue.push({ text, resolve });
      if (!this.isProcessing) this.processQueue();
    });
  }

  private async processQueue() {
    this.isProcessing = true;
    while (this.queue.length > 0) {
      const { text, resolve } = this.queue.shift()!;
      const result = await this.callLLM(text);  // 并发数 = 1
      resolve(result);
    }
    this.isProcessing = false;
  }
}
```

#### 7.2.4 向量索引优化 (MTREE)

**策略：** 使用 SurrealDB 的 MTREE 索引而不是传统的 HNSW

**理由：**
- MTREE 在本地环境下的内存占用更小
- 对 M4 高带宽内存非常友好
- 保持高检索速度的同时，为 LLM 腾出更多运行空间

```sql
DEFINE INDEX idx_entity_vector ON TABLE entity FIELDS embedding MTREE DIMENSION 1024 DISTANCE COSINE;
```

### 7.3 索引优化

- entity 表：name、entity_type、normalized_name 建立索引
- memory_entity 表：in、out、复合索引（图遍历加速）
- **向量索引**: 使用 SurrealDB 的 **MTREE** 而非 HNSW
  ```sql
  DEFINE INDEX idx_entity_vector ON TABLE entity FIELDS embedding MTREE DIMENSION 1024 DISTANCE COSINE;
  ```
  - MTREE 是 SurrealDB 为本地高性能设计的向量索引算法
  - 比 HNSW 更省内存，适合本地部署

### 7.4 缓存策略

- 热点实体缓存到内存（最近访问的 100 个实体）
- 实体→记忆关联结果缓存 5 分钟

### 7.5 事务优化：织网模式

**批量导入文档时:**
- 使用 `BEGIN TRANSACTION` 包裹批量操作
- 每批处理 50 个切片再提交，避免频繁磁盘 I/O

**织网模式（针对 M4 优化）：**

```typescript
// 针对 M4 优化的实体织网逻辑
async function indexMemory(memoryId: string, text: string) {
  try {
    // 1. 调用本地 8B 模型 (利用 M4 ANE/GPU)
    const entities = await llm.extract(text);

    // 2. 使用事务一次性织网 (SurrealDB 原子操作)
    await db.query(`
      BEGIN TRANSACTION;
      FOR $ent IN $entities {
        -- 实体去重：存在则复用，不存在则创建
        LET $ent_id = (SELECT id FROM entity WHERE name = $ent.name)[0]
                      OR (CREATE entity SET name = $ent.name, type = $ent.type);

        -- RELATE 核心逻辑：建立带权重的边
        RELATE ${memoryId}->mentions->$ent_id SET weight = $ent.weight;
      };
      UPDATE ${memoryId} SET is_indexed = true;
      COMMIT TRANSACTION;
    `, { entities });

  } catch (e) {
    console.warn("织网失败，但不影响主流程：", e);
    // 失忆模式保障：图查询失败时降级为纯向量检索
  }
}
```

**关键点：**
1. **原子性**：要么全部建边成功，要么全部失败
2. **性能**：一次事务提交 vs 多次单独提交
3. **容错**：失败不影响主流程，记录日志即可

### 7.6 连接池管理

**配置建议:**
```typescript
const db = new SurrealDatabase({
  url: 'http://localhost:8000',
  namespace: 'openclaw',
  database: 'memory',
  username: 'root',
  password: 'root',
  max_connections: 5,  // M4 单核性能强，不需要太多并发连接
});
```
- 限制 `max_connections: 5`
- 防止内存因连接过多而碎片化
- 充分利用 M4 芯片的单核性能

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
  expect(entities).toContainEqual({ name: 'TypeScript' });
  expect(entities).toContainEqual({ name: 'SurrealDB' });
});

// 2. 通过实体精准召回记忆
test('should recall memories by entity', async () => {
  const entity = await upsertEntity('TypeScript');
  const memories = await getMemoriesByEntity(entity);

  expect(memories.every(m =>
    m.content.includes('TypeScript')
  )).toBe(true);
});

// 3. 二度关联检索（带权重过滤）
test('should retrieve associated memories with weight filter', async () => {
  const memoryId = await storeEpisodic('session1', 'TypeScript is great');
  await storeEpisodic('session2', 'SurrealDB graph database');
  await storeEpisodic('session3', 'TypeScript with SurrealDB');

  const associated = await retrieveByAssociation(memoryId, { minScore: 0.8 });

  // Should find memory:3 via shared entities (TypeScript, SurrealDB)
  // with relevance_score > 0.8
  expect(associated.length).toBeGreaterThan(0);
});

// 4. 失忆模式：图查询超时降级
test('should fall back to vector-only on graph timeout', async () => {
  const results = await retrieveWithGraphTimeout('TypeScript', 200);
  // Should return vector results even if graph query times out
  expect(results.length).toBeGreaterThan(0);
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

3. **扩展 memory 表** - 添加索引标记位（替代持久化队列）
   ```sql
   DEFINE FIELD is_indexed ON TABLE memory TYPE bool DEFAULT false;
   DEFINE INDEX idx_memory_is_indexed ON TABLE memory FIELDS is_indexed WHERE is_indexed = false;
   ```

4. **移除 EntityType 常量** - 单一 ENTITY 类型，无需定义多类型常量

**代码实现步骤:**

1. 实现 EntityExtractor（LLM 直接提取，无缓存层）
2. 实现 EntityIndexer（使用 `is_indexed` 标记位）
3. 实现 HybridRetriever（带 200ms 超时降级）
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
   - [ ] 二度关联检索时正确应用权重过滤（relevance_score > 0.8）
   - [ ] 图查询超时 200ms 时正确降级为纯向量检索

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
2. 不包括常见通用词汇（如"今天"、"很好"、"系统"、"功能"等）
3. 倾向于专业术语、项目名、技术名、概念名、人名、组织名

## 实体类型
不需要分类，所有实体统一标记为 "ENTITY"。

## 输出格式
严格返回 JSON 数组，每个实体包含：
- name: 实体名称（原文）
- confidence: 置信度 (0.0-1.0)

## 示例输入
"我最近在使用 SurrealDB 构建一个记忆系统，需要实现向量索引和图数据功能。"

## 示例输出
[
  {"name": "SurrealDB", "confidence": 0.95},
  {"name": "记忆系统", "confidence": 0.8},
  {"name": "向量索引", "confidence": 0.9},
  {"name": "图数据功能", "confidence": 0.85}
]

## 待处理文本
{text}
```

---

## 附录 B：参考实现

- 现有实体提取参考：`src/clusterer.ts` 中的 `extractEntities()` 方法
- 现有异步处理参考：`src/memory-manager-surreal.ts` 中的 `startIdleClusteringWorker()`
- 现有检索流程参考：`src/memory-manager-surreal.ts` 中的 `retrieveRelevant()`

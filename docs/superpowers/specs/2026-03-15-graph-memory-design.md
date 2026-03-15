# 图数据记忆网络设计文档

**日期:** 2026-03-15
**版本:** 1.0
**状态:** 待审核

---

## 1. 概述

### 1.1 目标

在现有向量检索基础上，构建**以实体索引为核心的记忆网络**，实现：

1. **精准召回** - 通过实体名称匹配，精准召回相关记忆块
2. **联想检索** - 通过图路径遍历，实现"通过一个话题带出相关背景知识"
3. **可扩展性** - Schema 支持未来升级为完整的知识图谱推理

### 1.2 核心原则

- 实体不宜过细，倾向于"能跨文档关联"的关键词
- 保证检索的确定性（实体匹配）和联想性（图路径遍历）
- 异步处理，不阻塞主存储流程

---

## 2. 实体类型定义

支持五类核心实体：

| 类型 | 标识 | 示例 |
|------|------|------|
| Tech/Tools | `TECH` | Python, M4 Chip, SurrealDB, LLM, TypeScript |
| Concepts | `CONCEPT` | GraphRAG, 向量索引，内存管理，HNSW |
| Projects/Tasks | `PROJECT` | openclaw-memory, 图数据功能实现 |
| People/Orgs | `PERSON` / `ORG` | Anthropic, OpenAI,  Elon Musk |
| General | `GENERAL` | 由 LLM 判断的其他关键名词 |

---

## 3. 架构设计

### 3.1 整体架构

```
┌─────────────────────────────────────────────────────────────────┐
│                        用户查询                                  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    检索入口 (retrieveRelevant)                   │
│  ┌─────────────────────────┐  ┌───────────────────────────────┐ │
│  │   向量检索分支          │  │      实体检索分支              │ │
│  │   query → embedding     │  │   query → 提取实体 → 匹配     │ │
│  │   → 向量相似性搜索      │  │   → memory_entity 关联查询    │ │
│  └───────────┬─────────────┘  └───────────────┬───────────────┘ │
│              │                                │                 │
│              └──────────────┬─────────────────┘                 │
│                             ▼                                   │
│              ┌──────────────────────────┐                       │
│              │      混合结果合并         │                       │
│              │  (Vector + Entity Merge)  │                       │
│              └────────────┬─────────────┘                       │
│                           ▼                                     │
│              ┌──────────────────────────┐                       │
│              │         Reranker         │                       │
│              │    (LLM 重排序 + 阈值)    │                       │
│              └────────────┬─────────────┘                       │
│                           ▼                                     │
│              ┌──────────────────────────┐                       │
│              │      返回最终结果         │                       │
│              └──────────────────────────┘                       │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                        数据层                                    │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────────────┐ │
│  │   memory     │   │    entity    │   │   memory_entity      │ │
│  │  (记忆表)    │   │   (实体表)   │   │   (记忆 - 实体关系)   │ │
│  │              │   │              │   │                      │ │
│  │ - id         │   │ - id         │   │ - memory_id (FK)     │ │
│  │ - content    │   │ - name       │   │ - entity_id (FK)     │ │
│  │ - embedding  │◄──┤ - type       │◄──┤ - relevance_score    │ │
│  │ - type       │   │ - ...        │   │ - created_at         │ │
│  └──────────────┘   └──────────────┘   └──────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 数据流

**存储流程:**
```
记忆存储请求
    │
    ▼
写入 memory 表 (向量 + 内容)
    │
    ▼
加入异步队列 (pending_entities)
    │
    ▼
[后台处理]
    ├─→ LLM 提取实体
    ├─→ 写入 entity 表 (去重)
    └─→ 写入 memory_entity 关系表
```

**检索流程:**
```
用户查询
    │
    ├─→ 向量检索分支：query → embedding → 向量搜索 → 候选集 A
    │
    └─→ 实体检索分支：query → 实体提取 → 匹配 entity →
                       memory_entity 关联 → 候选集 B
    │
    ▼
合并候选集 (A ∪ B)
    │
    ▼
Reranker 重排序
    │
    ▼
阈值过滤 → 最终结果
```

---

## 4. Schema 设计

### 4.1 实体表 (entity) - 扩展现有

**注意:** 现有代码中 `entity` 表 (`src/surrealdb-client.ts:132-136`) 只有基础字段。
本设计需要扩展该表，添加 `description`、`mention_count`、`last_mentioned_at` 字段。
迁移策略见第 10 节。

```sql
DEFINE TABLE entity SCHEMAFULL;

-- 基础字段（已存在）
DEFINE FIELD name ON TABLE entity TYPE string;
DEFINE FIELD normalized_name ON TABLE entity TYPE option<string>;  -- 归一化名称
DEFINE FIELD entity_type ON TABLE entity TYPE string;  -- TECH, CONCEPT, PROJECT, PERSON, ORG, GENERAL

-- 扩展字段（需要迁移添加）
DEFINE FIELD description ON TABLE entity TYPE option<string>;  -- 实体描述/定义
DEFINE FIELD mention_count ON TABLE entity TYPE int DEFAULT 0;  -- 被提及次数
DEFINE FIELD last_mentioned_at ON TABLE entity TYPE option<datetime>;  -- 最后提及时间

-- 索引
DEFINE INDEX idx_entity_name ON TABLE entity FIELDS name;
DEFINE INDEX idx_entity_type ON TABLE entity FIELDS entity_type;
DEFINE INDEX idx_entity_normalized ON TABLE entity FIELDS normalized_name;
```

### 4.3 实体类型常量

**文件:** `src/surrealdb-client.ts` (新增常量定义)

```typescript
export const EntityType = {
  TECH: 'TECH',           // 技术、工具、框架、库、硬件
  CONCEPT: 'CONCEPT',     // 抽象概念、方法论、算法
  PROJECT: 'PROJECT',     // 项目名、任务名
  PERSON: 'PERSON',       // 人名
  ORG: 'ORG',             // 组织、公司、团队
  GENERAL: 'GENERAL',     // 其他关键名词
} as const;
```

### 4.2 记忆 - 实体关系表 (memory_entity) - 新增

**注意:** 现有代码中 `relates` 表 (`src/surrealdb-client.ts:17`) 与新的 `memory_entity` 表设计不兼容。
本设计使用全新的 `memory_entity` 表，现有的 `relates` 表保留但暂不使用（留作第二阶段扩展）。

```sql
DEFINE TABLE memory_entity SCHEMAFULL;

-- 外键关联
DEFINE FIELD memory_id ON TABLE memory_entity TYPE int;
DEFINE FIELD entity_id ON TABLE memory_entity TYPE int;

-- 相关性评分
DEFINE FIELD relevance_score ON TABLE memory_entity TYPE float;  -- 0.0-1.0，实体与记忆的相关性

-- 审计字段
DEFINE FIELD created_at ON TABLE memory_entity TYPE datetime;

-- 索引
DEFINE INDEX idx_memory_entity_memory ON TABLE memory_entity FIELDS memory_id;
DEFINE INDEX idx_memory_entity_entity ON TABLE memory_entity FIELDS entity_id;
DEFINE INDEX idx_memory_entity_composite ON TABLE memory_entity FIELDS memory_id, entity_id;
DEFINE INDEX idx_memory_entity_score ON TABLE memory_entity FIELDS entity_id, relevance_score;  -- 支持按相关性排序查询
```

### 4.3 实体 - 实体关系表 (entity_relation) - 预留（第二阶段）

```sql
-- 第一阶段暂不实现，保留扩展性
-- 后续可通过分析 memory_entity 中共现频率自动创建

DEFINE TABLE entity_relation SCHEMAFULL;

DEFINE FIELD from_entity_id ON TABLE entity_relation TYPE int;
DEFINE FIELD to_entity_id ON TABLE entity_relation TYPE int;
DEFINE FIELD relation_type ON TABLE entity_relation TYPE string;  -- is-a, related-to, part-of, used-for
DEFINE FIELD evidence_memory_ids ON TABLE entity_relation TYPE array<int>;
DEFINE FIELD confidence ON TABLE entity_relation TYPE float;
DEFINE FIELD created_at ON TABLE entity_relation TYPE datetime;

DEFINE INDEX idx_entity_relation_from ON TABLE entity_relation FIELDS from_entity_id;
DEFINE INDEX idx_entity_relation_to ON TABLE entity_relation FIELDS to_entity_id;
```

---

## 5. 核心模块设计

### 5.1 实体提取服务 (EntityExtractor)

**文件:** `src/entity-extractor.ts`

**职责:**
- 从文本中提取五类实体
- 使用 LLM 进行语义提取（非纯 regex）
- 返回结构化的实体列表

**接口:**
```typescript
interface ExtractedEntity {
  name: string;
  type: 'TECH' | 'CONCEPT' | 'PROJECT' | 'PERSON' | 'ORG' | 'GENERAL';
  confidence: number;  // 0.0-1.0
  context?: string;  // 提取上下文
}

class EntityExtractor {
  constructor(llmEndpoint: string, limiter: LLMLimiter);

  /**
   * 从文本中提取实体
   */
  extract(text: string): Promise<ExtractedEntity[]>;

  /**
   * 批量提取（优化 LLM 调用）
   */
  extractBatch(texts: string[]): Promise<Map<number, ExtractedEntity[]>>;
}
```

**LLM Prompt 设计:**
```
从以下文本中提取具有索引价值的实体。

提取标准：
1. 能跨文档关联的关键词
2. 不包括常见通用词汇

实体类型：
- TECH: 技术、工具、框架、库、硬件
- CONCEPT: 抽象概念、方法论、算法
- PROJECT: 项目名、任务名、产品名
- PERSON: 人名
- ORG: 组织、公司、团队
- GENERAL: 其他具有索引价值的关键名词

文本：{text}

以 JSON 格式返回：
[
  {"name": "实体名", "type": "类型", "confidence": 0.9},
  ...
]
```

### 5.2 实体索引服务 (EntityIndexer)

**文件:** `src/entity-indexer.ts`

**职责:**
- 处理异步实体索引队列
- 实体去重和归一化
- 维护 memory_entity 关系

**接口:**
```typescript
class EntityIndexer {
  constructor(db: SurrealDatabase, extractor: EntityExtractor);

  /**
   * 将记忆加入索引队列
   */
  enqueueMemory(memoryId: number, content: string): void;

  /**
   * 处理队列（后台调用）
   */
  processQueue(): Promise<{ indexed: number; failed: number }>;

  /**
   * 获取与实体相关的所有记忆
   */
  getMemoriesByEntity(entityId: number, limit?: number): Promise<MemoryWithSimilarity[]>;

  /**
   * 获取记忆关联的所有实体
   */
  getEntitiesByMemory(memoryId: number): Promise<ExtractedEntity[]>;

  /**
   * 通过实体联想检索（一度/多度关联）
   */
  retrieveByAssociation(
    seedEntityId: number,
    degrees: number = 1,
    limit?: number
  ): Promise<MemoryWithSimilarity[]>;
}
```

### 5.3 混合检索增强 (HybridRetrieval)

**文件:** `src/hybrid-retrieval.ts` (新增)
或扩展现有 `memory-manager-surreal.ts`

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
interface HybridRetrievalOptions {
  vectorWeight?: number;  // 向量检索权重，默认 0.5
  entityWeight?: number;  // 实体检索权重，默认 0.5
  topK?: number;  // 返回数量，默认 5
  threshold?: number;  // 阈值，默认 0.6
  enableAssociation?: boolean;  // 是否启用联想检索，默认 false
  associationDegrees?: number;  // 联想度数，默认 1
}

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
    options?: HybridRetrievalOptions
  ): Promise<MemoryWithSimilarity[]>;
}
```

### 5.4 数据库客户端扩展

**文件:** `src/surrealdb-client.ts` (扩展)

**新增方法:**
```typescript
class SurrealDatabase {
  // ... 现有方法 ...

  /**
   * 创建或获取实体
   */
  upsertEntity(
    name: string,
    type: string,
    metadata?: { description?: string; normalized_name?: string }
  ): Promise<number>;

  /**
   * 创建记忆 - 实体关系
   */
  linkMemoryEntity(
    memoryId: number,
    entityId: number,
    relevanceScore: number
  ): Promise<void>;

  /**
   * 通过实体 ID 检索关联记忆
   */
  searchByEntity(
    entityId: number,
    limit?: number
  ): Promise<Array<{ id: number; payload: Record<string, any> }>>;

  /**
   * 获取记忆关联的实体
   */
  getEntitiesByMemory(memoryId: number): Promise<Array<{ id: number; name: string; type: string }>>;

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

## 6. 集成点

### 6.1 记忆存储流程集成

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

### 6.2 检索流程集成

**方案 A：修改现有 `retrieveRelevant` 方法**

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
      enableAssociation: false,  // 默认不启用联想检索
    });
  }

  // ... 现有向量检索逻辑（保持不变） ...
}
```

**方案 B：新增独立方法（推荐）**

保留现有 `retrieveRelevant` 逻辑不变，新增 `retrieveWithEntityIndex` 方法：

```typescript
async retrieveWithEntityIndex(
  query: string,
  sessionId: string | undefined,
  topK: number = 5,
  threshold: number = 0.6
): Promise<MemoryWithSimilarity[]> {
  // 使用混合检索
  return this.hybridRetriever.retrieve(query, sessionId, { topK, threshold });
}
```

**与现有 Funnel 集成:**

混合检索的结果会进入现有的 reranker 和 threshold 过滤流程：
1. 合并向量检索和实体检索结果 → 去重
2. Reranker 重排序（LLM 基于查询相关性）
3. 阈值过滤（默认 0.6）
4. 重要性加权排序

这样设计的好处：
- 保持现有 retrieval funnel 逻辑完整
- 实体检索作为"候选集扩展"手段
- Reranker 统一处理最终排序

### 6.3 后台维护集成

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

## 7. 错误处理

### 7.1 LLM 调用失败

- EntityExtractor 重试机制（最多 3 次）
- 失败后降级为 regex 提取（基础模式）
- 记录失败日志，不影响主存储流程

### 7.2 数据库操作失败

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
DEFINE INDEX idx_pending_retry ON TABLE pending_indexing FIELDS retry_count, created_at;
```

### 7.3 实体归一化冲突

- 使用 `normalized_name` 字段处理同义词
- 首次创建时确定 normalized_name
- 后续相同 normalized_name 的实体合并 mention_count

---

## 8. 性能考虑

### 8.1 异步队列设计

**队列存储策略：**

- **主队列**: 内存存储（Map），避免数据库轮询，高性能
- **持久化备份**: 失败时降级写入 `pending_indexing` 表，支持重启恢复
- **批量处理**: 累积 10 条或 30 秒触发
- **后台处理限流**: LLM 并发 ≤ 2

**重启恢复策略:**

```typescript
// MemoryManager.initialize() 中恢复未处理队列
async initialize(): Promise<MigrationResult> {
  const result = await this.db.initialize();

  // 恢复未处理的索引队列
  await this.entityIndexer?.restorePendingQueue();

  return result;
}
```

### 8.2 索引优化

- entity 表：name、type、normalized_name 建立索引
- memory_entity 表：memory_id、entity_id、复合索引
- 检索时先过滤 entity_type 再关联

### 8.3 缓存策略

- 热点实体缓存到内存（最近访问的 100 个实体）
- 实体→记忆关联结果缓存 5 分钟

---

## 9. 测试计划

### 9.1 单元测试

- EntityExtractor.extract() - 实体提取准确性
- EntityIndexer.enqueueMemory() - 队列操作
- 混合检索结果合并逻辑

### 9.2 集成测试

- 存储→提取→索引→检索完整流程
- 实体去重和归一化
- 联想检索（一度/多度关联）

### 9.3 性能测试

- 批量索引 1000 条记忆的耗时
- 混合检索 vs 纯向量检索的延迟对比
- 队列积压处理能力

---

## 10. 迁移计划

### 10.1 第一阶段（本次实现）

**Schema 迁移步骤:**

1. **扩展 entity 表** - 添加新字段
   ```sql
   DEFINE FIELD description ON TABLE entity TYPE option<string>;
   DEFINE FIELD mention_count ON TABLE entity TYPE int DEFAULT 0;
   DEFINE FIELD last_mentioned_at ON TABLE entity TYPE option<datetime>;
   ```

2. **创建 memory_entity 表** - 新建关系表
   ```sql
   DEFINE TABLE memory_entity SCHEMAFULL;
   DEFINE FIELD memory_id ON TABLE memory_entity TYPE int;
   DEFINE FIELD entity_id ON TABLE memory_entity TYPE int;
   DEFINE FIELD relevance_score ON TABLE memory_entity TYPE float;
   DEFINE FIELD created_at ON TABLE memory_entity TYPE datetime;
   DEFINE INDEX idx_memory_entity_memory ON TABLE memory_entity FIELDS memory_id;
   DEFINE INDEX idx_memory_entity_entity ON TABLE memory_entity FIELDS entity_id;
   DEFINE INDEX idx_memory_entity_composite ON TABLE memory_entity FIELDS memory_id, entity_id;
   DEFINE INDEX idx_memory_entity_score ON TABLE memory_entity FIELDS entity_id, relevance_score;
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

### 10.2 第二阶段（后续可选）

1. 创建 entity_relation 表
2. 实现基于共现频率的自动关系发现
3. 实现图遍历查询（最短路径、邻居扩展）
4. 支持显式关系查询接口

---

## 11. 验收标准

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

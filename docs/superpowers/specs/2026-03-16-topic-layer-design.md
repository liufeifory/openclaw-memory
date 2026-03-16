# Topic Layer (Stage 3) 设计文档

**日期:** 2026-03-16
**状态:** 设计阶段
**关联文档:** [2026-03-15-graph-memory-design.md](./2026-03-15-graph-memory-design.md)

---

## 1. 概述

### 1.1 目标

实现设计文档 Stage 3 的 Topic Layer，解决 Graph Explosion 问题：

| 问题 | 解决方案 | 预期效果 |
|------|----------|----------|
| Super Node (单实体连接 > 500) | Topic 抽象层 | edges 从 500 降至 10 |
| Graph Traversal 慢 (O(500)) | Entity → Topic → Memory | O(10) → O(50) |
| 缺乏语义组织 | LLM 自动分组 | 自动归类为 Web/ML/Data 等主题 |
| 同义词碎片化 | entity_alias 表 | Postgres/PostgreSQL/PG 合并 |

### 1.2 核心原则

- **按需创建**: Topic 只在 Super Node 接近阈值时触发
- **两阶段聚类**: Embedding 聚类 + LLM 命名（节省成本）
- **独立检索路径**: Topic Recall 与 Vector/Entity/Graph 并行
- **完整 Alias 支持**: 独立表管理，支持动态扩展

---

## 2. 架构设计

### 2.1 三层结构

```
┌─────────────────┐
│   Entity        │  ← 实体层 (TypeScript, Python, ...)
│   (实体)        │
└────────┬────────┘
         │ 1:N
         ▼
┌─────────────────┐
│   Topic         │  ← 主题层 (Web 开发，机器学习，数据分析，...)
│   (主题分组)    │
└────────┬────────┘
         │ 1:N
         ▼
┌─────────────────┐
│   Memory        │  ← 记忆层 (具体对话内容)
│   (记忆内容)    │
└─────────────────┘
```

### 2.2 检索流程（4 路并行）

```
                    Query
                      │
         ┌────────────┼────────────┐
         │            │            │
         ▼            ▼            ▼
   ┌──────────┐ ┌──────────┐ ┌──────────┐
   │  Vector  │ │  Entity  │ │  Graph   │
   │  Search  │ │  Search  │ │ Expansion│
   │ (语义)   │ │ (精准)   │ │ (2 度关联) │
   └────┬─────┘ └────┬─────┘ └────┬─────┘
        │            │            │
        └────────────┼────────────┘
                     │
              ┌──────▼──────┐
              │   Topic     │  ← 新增
              │   Search    │     (独立路径)
              └──────┬──────┘
                     │
         ┌───────────┴───────────┐
         │                       │
         ▼                       ▼
   ┌──────────┐           ┌──────────┐
   │   Merge  │──────────▶│ Reranker │
   │ (去重)   │           │ (重排序) │
   └────┬─────┘           └────┬─────┘
        │                      │
        ▼                      ▼
   ┌──────────┐           ┌──────────┐
   │ TopK +   │──────────▶│ Threshold│
   │ Filter   │           │ 过滤     │
   └──────────┘           └──────────┘
```

---

## 3. Schema 设计

### 3.1 topic 表

```sql
-- Topic 表
DEFINE TABLE topic SCHEMAFULL;

-- 基础字段
DEFINE FIELD name ON TABLE topic TYPE string;
DEFINE FIELD description ON TABLE topic TYPE option<string>;

-- 关联字段
DEFINE FIELD parent_entity_id ON TABLE topic TYPE option<record<entity>>;
DEFINE FIELD memory_count ON TABLE topic TYPE int DEFAULT 0;

-- 统计字段
DEFINE FIELD created_at ON TABLE topic TYPE datetime DEFAULT time::now();
DEFINE FIELD updated_at ON TABLE topic TYPE datetime;
DEFINE FIELD last_accessed_at ON TABLE topic TYPE datetime;

-- 索引
DEFINE INDEX idx_topic_name ON TABLE topic FIELDS name;
DEFINE INDEX idx_topic_entity ON TABLE topic FIELDS parent_entity_id;
DEFINE INDEX idx_topic_last_accessed ON TABLE topic FIELDS last_accessed_at;
```

### 3.2 topic_memory 边表

```sql
-- Topic-Memory 关联边
DEFINE TABLE topic_memory SCHEMAFULL;

-- 图边字段 (RELATE 自动创建 in/out)
-- in -> 指向 topic
-- out -> 指向 memory

-- 边属性
DEFINE FIELD relevance_score ON TABLE topic_memory TYPE float;
DEFINE FIELD weight ON TABLE topic_memory TYPE float;
DEFINE FIELD created_at ON TABLE topic_memory TYPE datetime DEFAULT time::now();

-- 索引
DEFINE INDEX idx_topic_memory_in ON TABLE topic_memory FIELDS in;
DEFINE INDEX idx_topic_memory_out ON TABLE topic_memory FIELDS out;
```

### 3.3 entity_topic 边表（可选）

```sql
-- Entity-Topic 关联边（如果 parent_entity_id 不够用）
DEFINE TABLE entity_topic SCHEMAFULL;

-- in -> 指向 entity
-- out -> 指向 topic

DEFINE FIELD relation_type ON TABLE entity_topic TYPE string DEFAULT 'has_topic';
DEFINE FIELD weight ON TABLE entity_topic TYPE float;

-- 索引
DEFINE INDEX idx_entity_topic_in ON TABLE entity_topic FIELDS in;
DEFINE INDEX idx_entity_topic_out ON TABLE entity_topic FIELDS out;
```

### 3.4 entity_alias 表

```sql
-- Entity Alias 同义词表
DEFINE TABLE entity_alias SCHEMAFULL;

-- 字段
DEFINE FIELD alias ON TABLE entity_alias TYPE string;
DEFINE FIELD entity_id ON TABLE entity_alias TYPE record<entity>;
DEFINE FIELD verified ON TABLE entity_alias TYPE bool DEFAULT false;
DEFINE FIELD source ON TABLE entity_alias TYPE string DEFAULT 'manual';  -- 'manual' | 'llm' | 'user'

-- 审计字段
DEFINE FIELD created_at ON TABLE entity_alias TYPE datetime DEFAULT time::now();
DEFINE FIELD created_by ON TABLE entity_alias TYPE string;

-- 索引
DEFINE INDEX idx_alias_name ON TABLE entity_alias FIELDS alias;
DEFINE INDEX idx_alias_entity ON TABLE entity_alias FIELDS entity_id;

-- 唯一约束：同一 alias 只能指向一个 entity
DEFINE INDEX idx_alias_unique ON TABLE entity_alias FIELDS alias UNIQUE;
```

### 3.5 entity 表扩展

```sql
-- 在现有 entity 表上添加字段
DEFINE FIELD canonical_id ON TABLE entity TYPE option<record<entity>>;
DEFINE FIELD aliases ON TABLE entity TYPE array<string> DEFAULT [];
DEFINE FIELD is_frozen ON TABLE entity TYPE bool DEFAULT false;
DEFINE FIELD freeze_reason ON TABLE entity TYPE option<string>;
DEFINE FIELD frozen_at ON TABLE entity TYPE datetime;
```

---

## 4. 核心功能实现

### 4.1 Topic 发现触发机制

```typescript
const TOPIC_THRESHOLD = {
  SOFT_LIMIT: 400,   // 80% 阈值，开始创建 Topic
  HARD_LIMIT: 500,   // 100% 阈值，强制冻结
};

// 在 linkMemoryEntity 时检查
async function checkSuperNode(entityId: string): Promise<void> {
  const stats = await db.getEntityStats(entityId);

  if (stats.memory_count >= TOPIC_THRESHOLD.SOFT_LIMIT) {
    // 触发 Topic 创建
    await topicIndexer.autoCreateTopicsForSuperNode(entityId);
  }

  if (stats.memory_count >= TOPIC_THRESHOLD.HARD_LIMIT) {
    // 强制冻结
    await db.freezeEntity(entityId);
  }
}
```

### 4.2 两阶段语义聚类

**Stage 1: Embedding 聚类（无监督）**

```typescript
async function clusterMemoriesByEmbedding(memoryIds: number[], maxClusters = 10): Promise<Cluster[]> {
  // 1. 获取所有记忆的 embedding
  const embeddings = await Promise.all(
    memoryIds.map(id => db.getMemoryEmbedding(id))
  );

  // 2. 计算相似度矩阵
  const similarityMatrix = computeCosineSimilarity(embeddings);

  // 3. 层次聚类或 K-Means
  const clusters = hierarchicalClustering(similarityMatrix, maxClusters);

  return clusters;  // { clusterId: number, memoryIds: number[] }[]
}
```

**Stage 2: LLM 命名**

```typescript
async function nameTopics(clusters: Cluster[]): Promise<TopicDefinition[]> {
  const topics = [];

  for (const cluster of clusters) {
    // 获取每个 cluster 的代表性记忆（Top 5）
    const sampleMemories = await getSampleMemories(cluster.memoryIds, 5);

    // 调用 LLM 命名
    const prompt = `
根据以下记忆内容，为该主题生成一个简短名称（2-5 个字）和一句话描述：

${sampleMemories.map(m => `- ${m.content}`).join('\n')}

输出格式:
{
  "name": "主题名称",
  "description": "一句话描述"
}
`;

    const result = await llm.call(prompt);
    topics.push({
      name: result.name,
      description: result.description,
      memoryIds: cluster.memoryIds,
    });
  }

  return topics;
}
```

### 4.3 TopicIndexer 后台任务

```typescript
class TopicIndexer {
  private queue: TopicTask[] = [];
  private processing = false;

  // 后台任务调度器
  startScheduler(): void {
    // 每 7 天扫描一次潜在的 Super Node
    setInterval(() => this.scanPotentialSuperNodes(), 7 * 24 * 60 * 60 * 1000);

    // 处理队列中的 Topic 创建任务
    this.processQueue();
  }

  // 扫描潜在的 Super Node
  async scanPotentialSuperNodes(): Promise<void> {
    const result = await db.query(`
      SELECT id, name, memory_count
      FROM entity
      WHERE memory_count >= ${TOPIC_THRESHOLD.SOFT_LIMIT}
      AND is_frozen = false
    `);

    for (const entity of result) {
      await this.enqueueTopicCreation(entity.id);
    }
  }

  // 入队 Topic 创建任务
  async enqueueTopicCreation(entityId: string): Promise<void> {
    this.queue.push({
      entityId,
      addedAt: Date.now(),
      retryCount: 0,
    });
  }

  // 处理队列
  async processQueue(): Promise<void> {
    if (this.processing || this.queue.length === 0) return;
    this.processing = true;

    while (this.queue.length > 0) {
      const task = this.queue.shift()!;
      try {
        await this.autoCreateTopicsForSuperNode(task.entityId);
      } catch (error) {
        console.error(`[TopicIndexer] Failed for entity ${task.entityId}:`, error);
        task.retryCount++;
        if (task.retryCount < 3) {
          this.queue.push(task);
        }
      }
    }

    this.processing = false;
  }

  // 自动创建 Topic
  async autoCreateTopicsForSuperNode(entityId: string): Promise<void> {
    // 1. 获取 Entity 下的所有记忆
    const memories = await db.getMemoriesByEntity(entityId, 200);

    // 2. Embedding 聚类
    const clusters = await this.clusterMemoriesByEmbedding(memories.map(m => m.id));

    // 3. LLM 命名
    const topics = await this.nameTopics(clusters);

    // 4. 创建 Topic 并链接记忆
    for (const topic of topics) {
      const topicId = await db.upsertTopic(topic.name, topic.description, entityId);

      for (const memoryId of topic.memoryIds) {
        await db.linkTopicMemory(topicId, memoryId);
      }
    }

    console.log(`[TopicIndexer] Created ${topics.length} topics for entity ${entityId}`);
  }
}
```

### 4.4 Topic Recall 检索

```typescript
class HybridRetriever {
  // Topic 检索
  async topicSearch(
    entityIds: string[],
    topK: number = 20
  ): Promise<MemoryResult[]> {
    const allMemories = new Map<number, MemoryResult>();

    for (const entityId of entityIds) {
      // 1. 获取 Entity 下的 Topics
      const topics = await this.db.getTopicsByEntity(entityId);

      // 2. 从每个 Topic 获取记忆
      for (const topic of topics) {
        const memories = await this.db.getMemoriesByTopic(topic.id, topK / topics.length);

        for (const mem of memories) {
          if (!allMemories.has(mem.id)) {
            allMemories.set(mem.id, {
              id: mem.id,
              content: mem.content,
              type: mem.type,
              weight: mem.weight,
              score: mem.weight,
              source: 'topic',
              topic_id: topic.id,
              topic_name: topic.name,
            });
          }
        }
      }
    }

    return Array.from(allMemories.values());
  }

  // 增强检索流程（4 路并行）
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

    // 提取查询中的实体
    const entities = await this.extractEntitiesFromQuery(query);
    const entityIds = await this.getEntityIds(entities);

    // 4 路并行检索
    const [vectorResults, entityResults, graphResults, topicResults] = await Promise.all([
      this.vectorSearch(query, sessionId, topK * 4),
      entityIds.length > 0 ? this.entitySearch(entityIds, topK * 2) : [],
      entityIds.length > 0 ? this.graphSearch(entityIds, topK * 2) : [],
      entityIds.length > 0 ? this.topicSearch(entityIds, topK * 2) : [],
    ]);

    stats.vectorCount = vectorResults.length;
    stats.entityCount = entityResults.length;
    stats.graphCount = graphResults.length;
    stats.topicCount = topicResults.length;

    // 合并去重
    const merged = this.mergeResults([
      ...vectorResults,
      ...entityResults,
      ...graphResults,
      ...topicResults,
    ]);
    stats.mergedCount = merged.length;

    // Rerank
    const reranked = await this.rerankResults(query, merged);

    // 阈值过滤
    const filtered = reranked.filter(r => (r.score ?? 0) >= threshold);
    stats.finalCount = filtered.length;

    // TopK
    const final = filtered.slice(0, topK);

    return {
      results: final,
      stats,
    };
  }
}
```

### 4.5 Alias 同义词管理

```typescript
class EntityIndexer {
  // 添加 Alias
  async addAlias(alias: string, entityId: string, verified = false): Promise<void> {
    await db.query(`
      INSERT INTO entity_alias (alias, entity_id, verified)
      VALUES ($alias, $entityId, $verified)
      ON DUPLICATE KEY UPDATE entity_id = $entityId
    `, { alias, entityId, verified });
  }

  // 批量添加 Alias（LLM 发现）
  async addAliasesFromLLM(entityName: string, aliases: string[]): Promise<void> {
    const canonicalEntity = await db.findEntityByName(entityName);
    if (!canonicalEntity) return;

    for (const alias of aliases) {
      await this.addAlias(alias, canonicalEntity.id, false);
    }
  }

  // 查询时解析 Alias 到规范实体
  async resolveAlias(alias: string): Promise<string | null> {
    const result = await db.query(`
      SELECT entity_id FROM entity_alias
      WHERE alias = $alias
      LIMIT 1
    `, { alias });

    return result[0]?.entity_id ?? null;
  }

  // 合并 Alias（转移边）
  async mergeAliases(aliasEntityId: string, canonicalEntityId: string): Promise<void> {
    // 1. 转移 memory_entity 边
    await db.query(`
      UPDATE memory_entity
      SET out = $canonicalEntityId
      WHERE out = $aliasEntityId
    `, { canonicalEntityId, aliasEntityId });

    // 2. 转移 entity_relation 边
    await db.query(`
      UPDATE entity_relation
      SET in = $canonicalEntityId
      WHERE in = $aliasEntityId
    `, { canonicalEntityId, aliasEntityId });

    await db.query(`
      UPDATE entity_relation
      SET out = $canonicalEntityId
      WHERE out = $aliasEntityId
    `, { canonicalEntityId, aliasEntityId });

    // 3. 标记原实体为 merged
    await db.updateEntity(aliasEntityId, {
      canonical_id: canonicalEntityId,
      is_merged: true,
      merged_at: new Date(),
    });

    console.log(`[EntityIndexer] Merged ${aliasEntityId} -> ${canonicalEntityId}`);
  }
}
```

---

## 5. SurrealDatabase 客户端扩展

### 5.1 新增方法

```typescript
class SurrealDatabase {
  // Topic CRUD
  async upsertTopic(name: string, description: string | null, parentEntityId: string | null): Promise<string>
  async getTopicById(topicId: string): Promise<Topic | null>
  async getTopicsByEntity(entityId: string): Promise<Topic[]>
  async deleteTopic(topicId: string): Promise<void>

  // Topic-Memory 链接
  async linkTopicMemory(topicId: string, memoryId: number, relevanceScore: number): Promise<void>
  async getMemoriesByTopic(topicId: string, limit: number): Promise<LinkedMemory[]>

  // Alias 管理
  async addAlias(alias: string, entityId: string, verified?: boolean): Promise<void>
  async resolveAlias(alias: string): Promise<string | null>
  async getAliasesByEntity(entityId: string): Promise<string[]>
  async mergeEntities(aliasEntityId: string, canonicalEntityId: string): Promise<void>

  // Super Node 管理
  async freezeEntity(entityId: string, reason?: string): Promise<void>
  async isEntityFrozen(entityId: string): Promise<boolean>
  async getEntityStats(entityId: string): Promise<{ memory_count: number; topic_count: number }>

  // 统计
  async getTopicStats(): Promise<{
    total_topics: number;
    by_entity: Record<string, number>;
    avg_memories_per_topic: number;
  }>
}
```

---

## 6. 验收标准

### 6.1 功能验收

- [ ] Topic 表、topic_memory 表、entity_alias 表创建成功
- [ ] 软阈值（400）触发 Topic 创建
- [ ] 硬阈值（500）强制冻结 Entity
- [ ] 两阶段聚类正常工作（Embedding + LLM）
- [ ] Topic Recall 检索返回结果
- [ ] 4 路检索合并去重正确
- [ ] Alias 解析到规范实体
- [ ] Alias 合并后边正确转移

### 6.2 性能验收

- [ ] Topic 创建不阻塞主存储流程
- [ ] Topic Recall 延迟 < 100ms
- [ ] Super Node 冻结后 traversal 延迟从 O(500) 降至 O(10)

### 6.3 质量验收

- [ ] 单元测试覆盖率 > 80%
- [ ] 集成测试通过
- [ ] Stage 3 综合测试通过

---

## 7. 实施任务分解

| 任务 | 描述 | 优先级 |
|------|------|--------|
| 1. Schema 迁移 | 创建 topic, topic_memory, entity_alias 表 | P0 |
| 2. SurrealDatabase 扩展 | 实现 Topic CRUD 和 Alias 管理方法 | P0 |
| 3. TopicIndexer | 实现 Topic 索引器和后台任务 | P0 |
| 4. HybridRetriever 扩展 | 实现 topicSearch 和 retrieveWithTopicRecall | P0 |
| 5. Super Node 管理 | 实现冻结逻辑和自动 Topic 创建 | P1 |
| 6. Alias 完整功能 | 实现 LLM 发现和合并功能 | P1 |
| 7. Stage 3 测试 | 编写综合测试 | P1 |

---

## 8. 风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| LLM 聚类不准确 | Topic 命名混乱 | 人工审核 + 可配置规则 |
| Topic 创建过多 | 存储开销增加 | 限制每 Entity 最多 10 Topics |
| Alias 冲突 | 数据不一致 | 唯一索引 + 事务处理 |
| 检索延迟增加 | 用户体验下降 | 4 路并行 + 超时降级 |

---

## 9. 后续优化

1. **动态阈值**: 根据系统负载自动调整 SOFT_LIMIT / HARD_LIMIT
2. **增量聚类**: 新记忆到来时增量更新 Topic，而非全量重算
3. **Alias 投票**: 用户反馈验证 Alias 准确性
4. **Topic 可视化**: 提供 Web UI 查看和管理 Topic 结构

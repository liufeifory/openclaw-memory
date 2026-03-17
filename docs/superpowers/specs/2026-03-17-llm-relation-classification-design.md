# LLM 关系分类功能设计

> **设计版本：** v1.0
> **日期：** 2026-03-17
> **状态：** 待实现
> **相关设计：** [Graph Memory Design](./2026-03-15-graph-memory-design.md) Section 9.2

## 目标

在现有 entity co-occurrence 基础上，使用 LLM 对 entity-entity 关系进行语义分类，将硬编码的 `'co_occurs'` 替换为更丰富的关系类型（`causes`、`used_for`、`member_of`、`located_in`、`created_by`、`related_to`）。

## 背景

当前 `buildEntityCooccurrence()` 方法将所有共现关系标记为 `'co_occurs'`，缺乏语义信息。设计文档 9.2 节原计划使用 LLM 进行关系分类，但 Stage 2 实现时暂未集成。

## 架构

### 整体流程

```
┌─────────────────────────────────────────────────────────────┐
│  buildEntityCooccurrence() - 每 7 天运行                      │
│  1. 统计 memory_entity 共现                                   │
│  2. 创建 entity_relation 边，relation_type = 'co_occurs'   │
│  3. UPSERT 逻辑：如果 is_manual_refined = true 则保留类型    │
└─────────────────────────────────────────────────────────────┘
                            ↓
                    （未分类关系累积）
                            ↓
┌─────────────────────────────────────────────────────────────┐
│  classifyEntityRelations() - 每 6 小时运行                     │
│  1. 查询 relation_type = 'co_occurs' 的关系                  │
│  2. 获取实体信息和共现 memory 内容（切片窗口）                 │
│  3. 调用 7B LLM 进行分类（允许 no_logical_relation）           │
│  4. 更新 relation_type + is_manual_refined = true            │
└─────────────────────────────────────────────────────────────┘
```

```
┌─────────────────────────────────────────────────────────────┐
│  buildEntityCooccurrence() - 每 7 天运行                      │
│  1. 统计 memory_entity 共现                                   │
│  2. 创建 entity_relation 边，relation_type = 'co_occurs'   │
└─────────────────────────────────────────────────────────────┘
                            ↓
                    （未分类关系累积）
                            ↓
┌─────────────────────────────────────────────────────────────┐
│  classifyEntityRelations() - 每 6 小时运行                     │
│  1. 查询 relation_type = 'co_occurs' 的关系                  │
│  2. 获取实体信息和共现 memory 内容                             │
│  3. 调用 7B LLM 进行分类                                       │
│  4. 更新 relation_type 字段                                  │
└─────────────────────────────────────────────────────────────┘
```

### 关系类型体系

采用通用知识图谱类型，包含兜底选项：

| 关系类型 | 描述 | 示例 |
|---------|------|------|
| `related_to` | 通用关联（默认/兜底） | React → JavaScript |
| `causes` | 因果关系（A 导致 B） | 内存泄漏 → 性能下降 |
| `used_for` | 用途关系（A 用于 B） | Python → 数据分析 |
| `member_of` | 成员关系（A 属于 B 的组成部分） | TypeScript → JavaScript 生态 |
| `located_in` | 位置关系（A 位于 B 的范围内） | Kubernetes → 云原生生态 |
| `created_by` | 创建关系（A 由 B 创建） | React → Facebook |
| `no_logical_relation` | 无逻辑关系（仅共现但无语义关联） | React → 咖啡机 |

**方向性说明：**
- 关系默认方向：`in → out`（A → B）
- LLM 可返回 `reverse_direction: true` 表示方向应反转（B → A）
- 反转时交换 `in` 和 `out`，并更新 `relation_type`

### 技术栈

- **LLM 模型**：复用现有 7B 模型 (`http://localhost:8083`)
- **数据库**：SurrealDB (`entity_relation` 表)
- **调度器**：`setInterval` 后台任务（6 小时间隔）
- **批处理**：每次最多处理 100 个关系
- **架构依赖**：
  - `EntityIndexer` 持有 `EntityExtractor` 实例
  - `EntityExtractor` 内置 `limiter7B` 限流器（构造函数注入端点）
  - 限流器配置：`maxConcurrent: 2, minInterval: 100ms`

**依赖注入链：**
```
EntityIndexer
  ↓ (持有)
EntityExtractor
  ↓ (内置)
limiter7B (endpoint: http://localhost:8083)
```

### Schema 扩展

**新增字段：**
```sql
-- entity_relation 表扩展
DEFINE FIELD is_manual_refined ON TABLE entity_relation TYPE bool DEFAULT false;
DEFINE FIELD confidence ON TABLE entity_relation TYPE float DEFAULT 0.0;
DEFINE FIELD reasoning ON TABLE entity_relation TYPE option<string>;
DEFINE FIELD last_occurrence_at ON TABLE entity_relation TYPE datetime;
DEFINE FIELD updated_at ON TABLE entity_relation TYPE datetime DEFAULT time::now();

-- 关系类型约束（可选，加强验证）
DEFINE FIELD relation_type ON TABLE entity_relation
  TYPE string
  VALUE $value INSIDE ['causes', 'used_for', 'member_of', 'located_in', 'created_by', 'related_to', 'no_logical_relation', 'co_occurs'];
```

## 组件设计

### 1. EntityIndexer.classifyEntityRelations()

**位置：** `src/entity-indexer.ts`

**职责：**
- 查询所有 `relation_type = 'co_occurs'` 或 `is_manual_refined = false` 的关系
- 对每个关系，获取实体 A/B 的信息和共现 memory 内容（切片窗口）
- 调用 7B LLM（通过 EntityExtractor）进行分类
- 更新 `relation_type`、`is_manual_refined`、`confidence`、`reasoning` 字段
- 处理方向反转（如 LLM 建议）

**方法签名：**
```typescript
async classifyEntityRelations(batchSize: number = 100): Promise<number>
```

**返回：** 成功分类的关系数量

**依赖注入：**
```typescript
export class EntityIndexer {
  private db: SurrealDatabase;
  private extractor: EntityExtractor;  // 用于调用 7B 模型

  constructor(db?: SurrealDatabase, extractor?: EntityExtractor) {
    this.db = db || null;
    this.extractor = extractor || new EntityExtractor();
  }
}
```

**LLM Prompt 模板（增强版）：**
```
你是一名知识图谱关系分类专家。根据以下实体信息和共现上下文，
选择最合适的关系类型。

## 实体 A（in）
- 名称：{entityA_name}
- 类型：{entityA_type}

## 实体 B（out）
- 名称：{entityB_name}
- 类型：{entityB_type}

## 共现信息
- 共现次数：{cooccurrence_count}

## 共现的 Memory 片段（前 3 条，每条约 200 字窗口）
1. "{memory_snippet_1}"
   （实体 A 和 B 出现位置前后各 100 字）
2. "{memory_snippet_2}"
3. "{memory_snippet_3}"

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
- 或者返回 source 字段指定关系的源实体（如"Facebook"表示 Facebook -> created_by -> React）

## 输出格式
严格返回 JSON 格式：
{
  "relation_type": "<选择的类型>",
  "confidence": <0.0-1.0>,
  "reasoning": "<简短解释，50 字以内>",
  "reverse_direction": <true/false>,  // 如果需要反转边的方向
  "source": "<实体名称，关系的源头>"  // 与 reverse_direction 互斥，优先使用
}
```

**错误处理：**
- LLM 调用失败：跳过该关系，记录日志，继续处理下一个
- 解析失败：使用默认值 `related_to`，`confidence = 0.5`
- 数据库错误：抛出异常，由上层调度器捕获
- 实体不存在：跳过该关系，记录警告日志
- 超时（>10 秒）：中止当前批次，记录已处理数量（使用 `Promise.race` 实现）

### 1.1 Memory 切片窗口机制

**问题：** 完整 memory 内容可能过长，浪费 token 且影响推理速度。

**解决方案：** 提取实体出现位置前后各 100 字的窗口。

```typescript
/**
 * 提取实体附近的内容窗口
 * @param content - 完整 memory 内容
 * @param entities - 实体名称列表
 * @param windowSize - 窗口大小（默认前后各 100 字）
 */
extractContextWindow(content: string, entities: string[], windowSize: number = 100): string {
  const snippets: string[] = [];

  for (const entity of entities) {
    const index = content.toLowerCase().indexOf(entity.toLowerCase());
    if (index !== -1) {
      const start = Math.max(0, index - windowSize);
      const end = Math.min(content.length, index + entity.length + windowSize);
      snippets.push(content.substring(start, end).trim());
    }
  }

  // 合并重叠的窗口，取前 3 个
  return snippets.slice(0, 3).join(' | ');
}
```

### 2. EntityIndexer.startRelationClassifierScheduler()

**位置：** `src/entity-indexer.ts`

**职责：** 启动后台调度器，每 6 小时调用 `classifyEntityRelations()`

**配置常量：**
```typescript
private readonly relationClassifierIntervalMs: number = 6 * 60 * 60 * 1000;  // 6 小时
private readonly relationClassifierBatchSize: number = 100;  // 每批次处理数
```

**调度逻辑：**
```typescript
private startRelationClassifierScheduler(): void {
  setInterval(async () => {
    await this.classifyEntityRelations().catch(console.error);
  }, this.relationClassifierIntervalMs);

  console.log(`[EntityIndexer] Relation classifier scheduled every 6 hours`);
}
```

### 3. classifyEntityRelations() 包装方法

**位置：** `src/entity-indexer.ts`

**职责：** 调用 SurrealDatabase 方法并更新统计

```typescript
async classifyEntityRelations(): Promise<number> {
  if (!this.db) {
    console.log('[EntityIndexer] Skip relation classification: no database');
    return 0;
  }

  try {
    const classified = await this.db.classifyEntityRelations(
      this.relationClassifierBatchSize
    );
    this.totalClassified += classified;
    console.log(`[EntityIndexer] Classified ${classified} relations`);
    return classified;
  } catch (error: any) {
    console.error('[EntityIndexer] Relation classification failed:', error.message);
    return 0;
  }
}
```

## 数据流

### classifyEntityRelations() 详细流程

```
1. 查询未分类关系
   SELECT * FROM entity_relation
   WHERE relation_type = 'co_occurs' OR is_manual_refined = false
   ORDER BY created_at ASC
   LIMIT 100

2. 对每个关系：
   2.1 获取实体 A 信息
       SELECT name, entity_type FROM entity:$in_id
   2.2 获取实体 B 信息
       SELECT name, entity_type FROM entity:$out_id
   2.3 获取共现 memory 内容（带窗口切片，按多样性采样）
       SELECT content, created_at, document_id FROM memory
       WHERE id IN (evidence_memory_ids)
       ORDER BY created_at ASC
       // 使用 diverseSample() 选择"头、中、尾"各一条，或按 document_id 去重
   2.4 构建 LLM Prompt
   2.5 调用 7B 模型（使用 limiter7B 限流）
       // 使用 Promise.race 实现 10 秒超时
       const result = await Promise.race([
         this.extractor.call7B(prompt),
         new Promise((_, reject) =>
           setTimeout(() => reject(new Error('Timeout')), 10000)
         )
       ]);
   2.6 解析响应，提取 relation_type、confidence、reverse_direction、source
   2.7 验证关系类型（白名单验证）
       const VALID_TYPES = ['causes', 'used_for', 'member_of',
                            'located_in', 'created_by', 'related_to',
                            'no_logical_relation'];
       if (!VALID_TYPES.includes(predictedType)) {
         relationType = 'related_to';  // 默认值
       }
   2.8 方向修正：如果 LLM 返回 source 字段，检查是否与当前边方向一致
       IF source AND source != relation.in {
         // 方向不一致，需要重建边
         DELETE entity_relation:$id;
         RELATE entity:$out_id->entity_relation->entity:$in_id
           SET relation_type = $new_type,
               source = $source,  // 记录关系源实体
               confidence = $confidence,
               reasoning = $reasoning,
               is_manual_refined = true,
               evidence_memory_ids = $evidence_memory_ids,
               weight = weight,
               updated_at = time::now();
       } ELSE {
         UPDATE entity_relation:$id SET
           relation_type = $new_type,
           confidence = $confidence,
           reasoning = $reasoning,
           is_manual_refined = true,
           updated_at = time::now()
       }
```

### 2.3 Memory 多样性采样策略

**问题：** 如果只取"前 3 条"Memory，可能这 3 条都来自同一个文档的同一个段落，导致 LLM 片面理解。

**解决方案：** 采用"头、中、尾"采样 + 文档去重。

```typescript
/**
 * 多样化采样 Memory 片段
 * @param memories - 按时间排序的 memory 列表
 * @param targetCount - 目标采样数量（默认 3）
 * @returns 采样后的 memory 列表
 */
diverseSample(memories: Memory[], targetCount: number = 3): Memory[] {
  if (memories.length <= targetCount) {
    return memories;
  }

  // 策略 1：按 document_id 去重，优先保留不同文档的 memory
  const byDocument = new Map<string, Memory>();
  for (const mem of memories) {
    if (!byDocument.has(mem.document_id)) {
      byDocument.set(mem.document_id, mem);
    }
  }

  if (byDocument.size >= targetCount) {
    // 有足够多的不同文档，直接返回
    return Array.from(byDocument.values()).slice(0, targetCount);
  }

  // 策略 2：如果文档数不足，采用"头、中、尾"采样
  const result: Memory[] = [];
  const step = Math.floor(memories.length / targetCount);

  for (let i = 0; i < targetCount; i++) {
    const index = Math.min(i * step, memories.length - 1);
    result.push(memories[index]);
  }

  return result;
}
```

**SQL 查询优化：**
```sql
-- 原查询：按 created_at 排序后直接 LIMIT
SELECT content FROM memory WHERE id IN ($ids) ORDER BY created_at ASC LIMIT 3

-- 新查询：获取完整列表供应用层采样
SELECT content, created_at, document_id FROM memory WHERE id IN ($ids) ORDER BY created_at ASC
```

## 错误处理

| 错误场景 | 处理策略 |
|---------|---------|
| LLM 服务不可用 | 记录错误，跳过本次分类，下次调度再试 |
| LLM 响应解析失败 | 使用默认值 `related_to`，`confidence = 0.5`，记录日志 |
| 数据库连接失败 | 抛出异常，由调度器捕获并记录 |
| 实体不存在 | 跳过该关系，记录警告日志（可能已被 TTL Pruning 删除） |
| 超时（>10 秒） | 中止当前批次，记录已处理数量（`Promise.race` 实现） |
| 关系类型未知 | 使用 `related_to` 作为默认值（白名单验证） |
| 边冲突（Edge Overwriting） | 设置 `is_manual_refined = true`，buildEntityCooccurrence 保留已分类类型 |
| 并发冲突 | 使用事务包裹更新，检测到冲突时重试（最多 3 次） |
| 边方向不一致 | 检测 LLM 返回的 source 与当前边 in 不一致时，DELETE 原边 + RELATE 新边 |
| Memory 采样单一 | 采用"头、中、尾"采样 + document_id 去重，确保多样性 |

## 性能考虑

**估算：**
- 每批次 100 个关系
- 每个 LLM 调用约 2-3 秒（含限流）
- Memory 切片窗口提取：每条约 50ms
- 数据库查询：每次约 100ms
- 总耗时：300-500 秒（5-8 分钟）
- 每 6 小时运行一次，日均处理 400 个关系

**优化措施：**
- 使用 `ORDER BY created_at ASC` 优先处理旧关系
- 限制 `LIMIT 100` 防止单次运行时间过长
- LLM 调用使用现有 limiter7B 限流（maxConcurrent: 2, minInterval: 100）
- Memory 内容切片窗口（前后各 100 字），减少 token 消耗
- 使用 `Promise.race` 实现 10 秒超时，防止单个调用卡死

**权重衰减机制（可选扩展）：**
```typescript
// 检索时根据 last_occurrence_at 计算衰减权重
const daysSinceLastOccurrence = (now - lastOccurrence) / (1000 * 60 * 60 * 24);
const decayFactor = Math.exp(-daysSinceLastOccurrence / 90);  // 90 天半衰期
const finalWeight = originalWeight * decayFactor;
```

## 测试计划

### 单元测试

```typescript
// 1. LLM Prompt 构建测试
test('should build correct prompt for relation classification');

// 2. LLM 响应解析测试
test('should parse LLM response and extract relation_type');

// 3. 默认值处理测试
test('should use related_to as default on parse failure');

// 4. 数据库更新测试
test('should update relation_type after classification');

// 5. 边界情况：空结果集
test('should handle empty result set gracefully');

// 6. 边界情况：实体已删除
test('should skip relation when entity is deleted by TTL pruning');

// 7. 边界情况：未知关系类型
test('should use related_to for unknown relation type');

// 8. 边界情况：并发冲突
test('should handle duplicate relation update conflicts');

// 9. Memory 切片窗口测试
test('should extract context window around entity mentions');

// 10. 方向反转测试
test('should reverse edge direction when LLM suggests');
```

### 集成测试

```typescript
// 1. 完整流程测试
test('should classify co_occurs relations end-to-end');

// 2. 调度器测试
test('should run classifier every 6 hours');

// 3. 错误恢复测试
test('should continue on LLM failure');

// 4. 边保护测试
test('should not overwrite is_manual_refined relations in buildEntityCooccurrence');

// 5. 权重衰减测试
test('should apply decay factor to old relations during retrieval');
```

## 验收标准

### 功能验收

- [ ] `classifyEntityRelations()` 方法存在并正常工作
- [ ] 关系类型从 `co_occurs` 更新为 7 种语义类型之一（包含 `no_logical_relation`）
- [ ] LLM Prompt 包含实体信息和 3 条 memory 片段（每条约 200 字窗口）
- [ ] 解析失败时使用 `related_to` 作为默认值
- [ ] 调度器每 6 小时自动运行
- [ ] `is_manual_refined` 标记正确设置，防止被 buildEntityCooccurrence 覆盖
- [ ] 方向反转功能正常（当 LLM 建议时交换 in/out）
- [ ] Memory 切片窗口正确提取（实体出现位置前后各 100 字）

### 性能验收

- [ ] 单批次处理时间 < 8 分钟（100 个关系）
- [ ] LLM 调用成功率 > 95%
- [ ] 不阻塞主流程（后台异步执行）
- [ ] Memory 切片窗口提取 < 50ms/条

### 质量验收

- [ ] 单元测试覆盖 Prompt 构建和解析逻辑
- [ ] 集成测试验证完整流程
- [ ] 错误日志完整记录
- [ ] 边界情况测试全部通过

## 迁移计划

### 实施步骤

1. **扩展 entity_relation Schema** - 添加 `is_manual_refined`、`confidence`、`reasoning`、`last_occurrence_at` 字段
2. **修改 buildEntityCooccurrence()** - 添加 UPSERT 逻辑保护已分类关系
3. **扩展 EntityIndexer** - 添加 `classifyEntityRelations()` 方法和调度器
4. **添加 Memory 切片工具** - `extractContextWindow()` 方法
5. **扩展 EntityExtractor** - 暴露 `call7B()` 方法供外部调用
6. **添加测试** - 单元测试 + 集成测试（包含边界情况）
7. **验证** - 手动运行并检查结果

### Schema 迁移 SQL

```sql
-- 1. 添加新字段
DEFINE FIELD is_manual_refined ON TABLE entity_relation TYPE bool DEFAULT false;
DEFINE FIELD confidence ON TABLE entity_relation TYPE float DEFAULT 0.0;
DEFINE FIELD reasoning ON TABLE entity_relation TYPE option<string>;
DEFINE FIELD last_occurrence_at ON TABLE entity_relation TYPE datetime;

-- 2. 添加关系类型约束（可选）
DEFINE FIELD relation_type ON TABLE entity_relation
  TYPE string
  VALUE $value INSIDE ['causes', 'used_for', 'member_of', 'located_in', 'created_by', 'related_to', 'no_logical_relation', 'co_occurs'];

-- 3. 修改 buildEntityCooccurrence 的 UPSERT 逻辑
-- 原逻辑：直接覆盖 relation_type
-- 新逻辑：如果 is_manual_refined = true，则保留原 relation_type
```

### 向后兼容

- 已有的 `co_occurs` 关系会被逐步分类
- 新的 co-occurrence 关系先标记为 `co_occurs`，等待下次分类
- 检索逻辑无需修改，`co_occurs` 作为有效关系类型继续工作
- `is_manual_refined = true` 的关系不会被 buildEntityCooccurrence 覆盖

## 后续扩展（可选）

1. **关系质量评分** - 基于 LLM confidence 字段
2. **低质量关系过滤** - 定期删除 confidence < 0.5 的关系
3. **关系可视化** - 展示不同类型关系的分布
4. **人工审核接口** - 对低置信度关系进行人工标注

---

## 附录：设计决策记录

| 决策 | 选项 | 选择 | 原因 |
|-----|------|------|------|
| 关系类型体系 | 简单技术/通用知识/自定义 | 通用知识 | 适用范围更广 |
| 集成点 | co-occurrence 中/独立流程/on-demand | 独立流程 | 不阻塞主流程 |
| LLM 模型 | 7B/13B+/专用小模型 | 7B | 复用现有资源 |
| Prompt 上下文 | 最小/中等/完整 | 中等 | 平衡准确性和成本 |
| 调度策略 | 定期/阈值/手动 | 定期 | 可预测，易监控 |
| 边保护机制 | 无/是_manual_refined 标记 | is_manual_refined | 防止被覆盖 |
| Memory 切片 | 完整内容/窗口切片 | 窗口切片 | 节省 token，提高速度 |
| 方向性 | 单向/可反转 | 可反转 | LLM 可建议反转边方向 |
| 兜底类型 | related_to only/添加 no_logical_relation | 添加 no_logical_relation | 允许 LLM 表示"无逻辑关系" |
| 超时处理 | 无/10 秒超时 | 10 秒超时 | 防止单个调用卡死批次 |
| 关系权重衰减 | 无/90 天半衰期 | 90 天半衰期（可选） | 防止过时关系干扰检索 |

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

采用通用知识图谱类型：

| 关系类型 | 描述 | 示例 |
|---------|------|------|
| `related_to` | 通用关联（默认/兜底） | React → JavaScript |
| `causes` | 因果关系 | 内存泄漏 → 性能下降 |
| `used_for` | 用途关系 | Python → 数据分析 |
| `member_of` | 成员关系 | TypeScript → JavaScript 生态 |
| `located_in` | 位置关系 | Kubernetes → 云原生生态 |
| `created_by` | 创建关系 | React → Facebook |

### 技术栈

- **LLM 模型**：复用现有 7B 模型 (`http://localhost:8083`)
- **数据库**：SurrealDB (`entity_relation` 表)
- **调度器**：`setInterval` 后台任务（6 小时间隔）
- **批处理**：每次最多处理 100 个关系

## 组件设计

### 1. SurrealDatabase.classifyEntityRelations()

**位置：** `src/surrealdb-client.ts`

**职责：**
- 查询所有 `relation_type = 'co_occurs'` 的未分类关系
- 对每个关系，获取实体 A/B 的信息和共现 memory 内容
- 调用 7B LLM 进行分类
- 更新 `relation_type` 字段

**方法签名：**
```typescript
async classifyEntityRelations(batchSize: number = 100): Promise<number>
```

**返回：** 成功分类的关系数量

**LLM Prompt 模板：**
```
你是一名知识图谱关系分类专家。根据以下实体信息和共现上下文，
选择最合适的关系类型。

## 实体 A
- 名称：{entityA_name}
- 类型：{entityA_type}

## 实体 B
- 名称：{entityB_name}
- 类型：{entityB_type}

## 共现信息
- 共现次数：{cooccurrence_count}

## 共现的 Memory 片段（前 3 条）
1. "{memory_snippet_1}"
2. "{memory_snippet_2}"
3. "{memory_snippet_3}"

## 可选关系类型
- causes: 因果关系（A 导致 B）
- used_for: 用途关系（A 用于 B）
- member_of: 成员关系（A 属于 B 的组成部分）
- located_in: 位置关系（A 位于 B 的范围内）
- created_by: 创建关系（A 由 B 创建）
- related_to: 通用关联（无法归类时使用）

## 输出格式
严格返回 JSON 格式：
{
  "relation_type": "<选择的类型>",
  "confidence": <0.0-1.0>,
  "reasoning": "<简短解释，50 字以内>"
}
```

**错误处理：**
- LLM 调用失败：跳过该关系，记录日志，继续处理下一个
- 解析失败：使用默认值 `related_to`
- 数据库错误：抛出异常，由上层调度器捕获

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
   WHERE relation_type = 'co_occurs'
   ORDER BY created_at ASC
   LIMIT 100

2. 对每个关系：
   2.1 获取实体 A 信息
       SELECT name, entity_type FROM entity:$in_id
   2.2 获取实体 B 信息
       SELECT name, entity_type FROM entity:$out_id
   2.3 获取共现 memory 内容
       SELECT content FROM memory
       WHERE id IN (evidence_memory_ids[0:3])
   2.4 构建 LLM Prompt
   2.5 调用 7B 模型
   2.6 解析响应，提取 relation_type
   2.7 更新 entity_relation
       UPDATE entity_relation:$id SET relation_type = $new_type
```

## 错误处理

| 错误场景 | 处理策略 |
|---------|---------|
| LLM 服务不可用 | 记录错误，跳过本次分类，下次调度再试 |
| LLM 响应解析失败 | 使用默认值 `related_to`，记录日志 |
| 数据库连接失败 | 抛出异常，由调度器捕获并记录 |
| 实体不存在 | 跳过该关系，记录警告日志 |
| 超时（>10 秒） | 中止当前批次，记录已处理数量 |

## 性能考虑

**估算：**
- 每批次 100 个关系
- 每个 LLM 调用约 2-3 秒
- 总耗时：200-300 秒（3-5 分钟）
- 每 6 小时运行一次，日均处理 400 个关系

**优化措施：**
- 使用 `ORDER BY created_at ASC` 优先处理旧关系
- 限制 `LIMIT 100` 防止单次运行时间过长
- LLM 调用使用现有 limiter7B 限流

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
```

### 集成测试

```typescript
// 1. 完整流程测试
test('should classify co_occurs relations end-to-end');

// 2. 调度器测试
test('should run classifier every 6 hours');

// 3. 错误恢复测试
test('should continue on LLM failure');
```

## 验收标准

### 功能验收

- [ ] `classifyEntityRelations()` 方法存在并正常工作
- [ ] 关系类型从 `co_occurs` 更新为 6 种语义类型之一
- [ ] LLM Prompt 包含实体信息和 3 条 memory 片段
- [ ] 解析失败时使用 `related_to` 作为默认值
- [ ] 调度器每 6 小时自动运行

### 性能验收

- [ ] 单批次处理时间 < 5 分钟（100 个关系）
- [ ] LLM 调用成功率 > 95%
- [ ] 不阻塞主流程（后台异步执行）

### 质量验收

- [ ] 单元测试覆盖 Prompt 构建和解析逻辑
- [ ] 集成测试验证完整流程
- [ ] 错误日志完整记录

## 迁移计划

### 实施步骤

1. **扩展 SurrealDatabase** - 添加 `classifyEntityRelations()` 方法
2. **扩展 EntityIndexer** - 添加调度器和包装方法
3. **扩展 entity-extractor** - 添加 LLM 调用辅助方法（如需要）
4. **添加测试** - 单元测试 + 集成测试
5. **验证** - 手动运行并检查结果

### 向后兼容

- 已有的 `co_occurs` 关系会被逐步分类
- 新的 co-occurrence 关系先标记为 `co_occurs`，等待下次分类
- 检索逻辑无需修改，`co_occurs` 作为有效关系类型继续工作

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

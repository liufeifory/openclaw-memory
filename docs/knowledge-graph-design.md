# 术语知识图谱设计文档 V2.0

## 1. 设计目标

将术语抽取系统的输出转化为结构化知识图谱：
- 术语作为实体节点
- 术语之间的关系作为边（使用 SurrealDB Graph 特性）
- 支持多领域、多版本的术语管理
- 高效的图遍历查询能力
- 关系可信度分层管理
- 术语生命周期与版本演进

---

## 2. 数据模型

### 2.1 实体层（术语）

```
┌─────────────────────────────────────────┐
│  term (术语实体)                          │
├─────────────────────────────────────────┤
│  id: string                              │
│  name: string           // 原始术语       │
│  normalized: string     // 标准化形式     │
│  namespace: string      // domain.normalized[version] │
│  domain: string         // 所属领域       │
│  type: string           // 类型           │
│  aliases: string[]      // 别名列表       │
│  description: string    // 术语描述       │
│  embedding: float[]     // 向量嵌入（name+description）│
│  frequency: int         // 出现频次       │
│  confidence: float      // 置信度         │
│  source_docs: string[]  // 来源文档列表   │
│  version_range: string  // 版本范围（如 "12-17"）│
│  is_primary: bool       // 是否为主实体   │
│  primary_id: string     // 主实体ID（别名指向）│
│  created_at: datetime   // 创建时间       │
│  updated_at: datetime   // 更新时间       │
└─────────────────────────────────────────┘
```

### 2.2 关系层（Graph Relation）

**改进：使用 SurrealDB 的 RELATE 语句和 Graph 特性**

```
┌─────────────────────────────────────────┐
│  term_relation (Graph Relation Table)    │
├─────────────────────────────────────────┤
│  id: string                              │
│  in: record<term>       // 源术语（自动） │
│  out: record<term>      // 目标术语（自动）│
│  relation_type: string  // 关系类型       │
│  weight: float          // 关系强度       │
│  method: string         // 发现方法       │
│  confidence: float      // 关系可信度     │
│  decay_factor: float    // 衰减因子       │
│  evidence: string       // 关系证据       │
│  source_doc: string     // 来源文档       │
│  created_at: datetime   // 创建时间       │
└─────────────────────────────────────────┘
```

**核心改进**：
- 使用 `TYPE RELATION FROM term TO term` 定义关系表
- `in` 和 `out` 字段由 SurrealDB 自动管理
- 新增 `method` 字段记录关系发现来源
- 新增 `confidence` 表示关系可信度
- 新增 `decay_factor` 用于共现关系的衰减

### 2.3 关系类型定义

| 关系类型 | 说明 | 示例 |
|---------|------|------|
| `is_a` | 分类关系 | pg_dump `is_a` tool |
| `part_of` | 组成关系 | checkpoint `part_of` WAL |
| `uses` | 使用关系 | pg_dump `uses` libpq |
| `related_to` | 相关关系 | GIN `related_to` index |
| `synonym` | 同义关系 | WAL `synonym` write-ahead-log |
| `derived_from` | 派生关系 | B-tree `derived_from` tree |
| `configures` | 配置关系 | shared_buffers `configures` PostgreSQL |
| `implements` | 实现关系 | libpq `implements` PostgreSQL protocol |
| `version_of` | 版本关系 | pg_dump_17 `version_of` pg_dump |

---

## 3. SurrealDB Schema V2.0

```sql
-- ============================================================
-- 术语实体表
-- ============================================================

DEFINE TABLE term SCHEMAFULL;

-- 基本信息
DEFINE FIELD name ON term TYPE string;
DEFINE FIELD normalized ON term TYPE string;
DEFINE FIELD namespace ON term TYPE string;
DEFINE FIELD domain ON term TYPE string;
DEFINE FIELD type ON term TYPE string;

-- 描述与别名
DEFINE FIELD aliases ON term TYPE array<string>;
DEFINE FIELD description ON term TYPE string;

-- 向量嵌入（name + description 组合）
DEFINE FIELD embedding ON term TYPE array<float>;

-- 统计信息
DEFINE FIELD frequency ON term TYPE int;
DEFINE FIELD confidence ON term TYPE float;
DEFINE FIELD source_docs ON term TYPE array<string>;

-- 版本管理（新增）
DEFINE FIELD version_range ON term TYPE string DEFAULT '';
DEFINE FIELD is_primary ON term TYPE bool DEFAULT true;
DEFINE FIELD primary_id ON term TYPE string DEFAULT '';

-- 时间戳
DEFINE FIELD created_at ON term TYPE datetime;
DEFINE FIELD updated_at ON term TYPE datetime;

-- ============================================================
-- 索引
-- ============================================================

DEFINE INDEX term_name_idx ON term COLUMNS name;
DEFINE INDEX term_normalized_idx ON term UNIQUE COLUMNS normalized;
DEFINE INDEX term_namespace_idx ON term UNIQUE COLUMNS namespace;
DEFINE INDEX term_domain_idx ON term COLUMNS domain;
DEFINE INDEX term_type_idx ON term COLUMNS type;
DEFINE INDEX term_version_idx ON term COLUMNS version_range;

-- 向量索引（MTREE）
DEFINE INDEX term_embedding_idx ON term TYPE MTREE COLUMNS embedding;

-- ============================================================
-- 关系表（使用 Graph Relation）
-- ============================================================

-- 定义为 RELATION TABLE（核心改进）
DEFINE TABLE term_relation SCHEMAFULL TYPE RELATION FROM term TO term;

-- 关系类型
DEFINE FIELD relation_type ON term_relation TYPE string;

-- 关系强度与可信度
DEFINE FIELD weight ON term_relation TYPE float DEFAULT 0.5;
DEFINE FIELD confidence ON term_relation TYPE float DEFAULT 0.5;

-- 发现方法（新增：rule/embedding/co_occurrence/llm）
DEFINE FIELD method ON term_relation TYPE string DEFAULT 'co_occurrence';

-- 衰减因子（新增：用于共现关系的时间衰减）
DEFINE FIELD decay_factor ON term_relation TYPE float DEFAULT 1.0;

-- 证据与来源
DEFINE FIELD evidence ON term_relation TYPE string;
DEFINE FIELD source_doc ON term_relation TYPE string;

-- 时间戳
DEFINE FIELD created_at ON term_relation TYPE datetime;

-- ============================================================
-- 关系表索引
-- ============================================================

DEFINE INDEX relation_type_idx ON term_relation COLUMNS relation_type;
DEFINE INDEX relation_method_idx ON term_relation COLUMNS method;
```

---

## 4. 关系发现方法（带可信度分层）

### 4.1 方法可信度定义

| 方法 | 可信度 | 成本 | 说明 |
|------|--------|------|------|
| `rule` | 0.95 | 低 | 命名模式规则（如 pg_* → tool） |
| `llm` | 0.90 | 高 | LLM 上下文分析 |
| `embedding` | 0.75 | 中 | 向量语义相似度 |
| `co_occurrence` | 0.50 | 低 | 统计共现（需衰减） |

### 4.2 共现关系（统计层）- 增加衰减机制

```
方法：基于文档中术语共现频率

基础公式：
weight = co_occurrence_count / min(freq_a, freq_b)

衰减公式（新增）：
decay_factor = e^(-λ × time_elapsed)
effective_weight = weight × decay_factor

参数：
- λ = 0.01（衰减率，每月衰减约 1%）
- time_elapsed = 当前时间 - relation.created_at（月）

示例：
2024-01 创建的关系：co_occurs(WAL, checkpoint), weight=0.62
2026-04 查询时：decay_factor = e^(-0.01 × 28) ≈ 0.75
effective_weight = 0.62 × 0.75 = 0.47
```

### 4.3 语义关系（向量层）- 描述增强嵌入

**改进：对 "术语名 + 描述" 做向量化**

```
方法：基于向量相似度

嵌入生成（改进）：
embedding_text = name + " " + description
例如："WAL Write-Ahead Logging ensures durability"

公式：
weight = cosine_similarity(embedding_a, embedding_b)

阈值：
- weight > 0.85 → synonym 关系
- weight > 0.70 → related_to 关系
- weight > 0.50 → candidate（待确认）

示例：
"WAL Write-Ahead Logging" vs "checkpoint periodic flush"
vs "WAL_Level configuration parameter"

收益：
- WAL 和 WAL_Level 的向量距离更远（语义区分）
- WAL 和 checkpoint 的向量更近（语义相关）
```

### 4.4 结构关系（规则层）

```
方法：基于术语命名模式

规则定义：
{
  pattern: /^pg_/,
  target: 'system_object',
  relation: 'is_a',
  method: 'rule',
  confidence: 0.95
}

示例：
pg_stat_activity → RELATE term:pg_stat_activity -> term_relation -> term:system_object
  SET relation_type = 'is_a', method = 'rule', confidence = 0.95;
```

### 4.5 上下文关系（LLM层）

```
方法：LLM 分析术语上下文

Prompt：
分析以下术语在上下文中的关系：
- WAL
- checkpoint

上下文：
"...WAL ensures durability. checkpoint periodically flushes WAL..."

输出格式：
source | target | relation_type | confidence | evidence
WAL | checkpoint | part_of | 0.95 | WAL系统包含checkpoint进程

存储：
RELATE term:wal -> term_relation -> term:checkpoint
  SET relation_type = 'part_of', method = 'llm', confidence = 0.95, evidence = '...';
```

---

## 5. 关系冲突处理

### 5.1 冲突检测

```
场景：
- LLM: WAL is_a mechanism（confidence: 0.90）
- Rule: WAL is_a concept（confidence: 0.95）
- Embedding: WAL related_to checkpoint（confidence: 0.75）

冲突规则：
1. 同一 source-target 对，不同 relation_type
2. 同一 relation_type，不同 confidence
```

### 5.2 冲突解决策略

```
策略：按可信度优先级合并

优先级：rule > llm > embedding > co_occurrence

逻辑：
IF exists relation with method='llm' AND relation_type='is_a':
  KEEP llm relation（精细化分类）
  DELETE or downgrade co_occurrence relation

示例处理：
WAL 和 checkpoint：
- LLM: part_of（confidence: 0.90）→ 保留
- Co-occurrence: related_to（confidence: 0.50）→ 降级或删除

合并结果：
最终关系 = part_of（method: llm, confidence: 0.90）
```

### 5.3 实现代码

```typescript
async resolveRelationConflicts(
  sourceId: string,
  targetId: string
): Promise<void> {
  // 查询所有关系
  const relations = await this.db.query(`
    SELECT * FROM term_relation 
    WHERE in = $source AND out = $target
  `, { source: sourceId, target: targetId });

  if (relations.length <= 1) return;

  // 按优先级排序
  const priority = { rule: 4, llm: 3, embedding: 2, co_occurrence: 1 };
  const sorted = relations.sort((a, b) => 
    priority[b.method] - priority[a.method] ||
    b.confidence - a.confidence
  );

  // 保留最高优先级，删除其他
  const keep = sorted[0];
  for (const r of sorted.slice(1)) {
    await this.db.query(`DELETE $id`, { id: r.id });
  }
}
```

---

## 6. 版本与生命周期管理

### 6.1 Namespace 扩展

```
原格式：domain.normalized
新格式：domain.normalized[version_range]

示例：
- database.wal                    // 通用版本
- database.wal[12-15]            // PostgreSQL 12-15
- database.wal[17]               // PostgreSQL 17
- database.shared_buffers[12]    // PostgreSQL 12 特定参数
- database.shared_buffers[17]    // PostgreSQL 17 新默认值
```

### 6.2 版本关系

```
RELATE term:pg_dump_12 -> term_relation -> term:pg_dump
  SET relation_type = 'version_of', method = 'rule', version = '12';

RELATE term:pg_dump_17 -> term_relation -> term:pg_dump
  SET relation_type = 'version_of', method = 'rule', version = '17';
```

### 6.3 主实体-别名合并

```
触发条件：
- synonym 关系存在
- embedding 相似度 > 0.99
- 同一 domain

处理逻辑：
1. 选择高频术语为主实体（is_primary = true）
2. 低频术语设为别名（is_primary = false, primary_id = 主实体ID）
3. 合并 aliases 数组
4. 删除冗余节点

示例：
Postgres（freq: 100）→ 主实体
PostgreSQL（freq: 80）→ 别名
合并后：
term:postgres {
  aliases: ['PostgreSQL', 'PG'],
  frequency: 180,
  is_primary: true
}
term:postgresql {
  is_primary: false,
  primary_id: 'term:postgres'
}
```

### 6.4 实现代码

```typescript
async mergeSynonyms(): Promise<void> {
  // 查找高相似度 synonym 关系
  const candidates = await this.db.query(`
    SELECT in, out, weight FROM term_relation
    WHERE relation_type = 'synonym' AND weight > 0.99
  `);

  for (const c of candidates) {
    const termA = await this.getTerm(c.in);
    const termB = await this.getTerm(c.out);

    // 选择高频为主实体
    const primary = termA.frequency >= termB.frequency ? termA : termB;
    const alias = termA.frequency < termB.frequency ? termA : termB;

    // 合并
    await this.db.query(`
      UPDATE $primary SET
        aliases = array::distinct(aliases + $alias_name),
        frequency = frequency + $alias_freq
    `, { primary: primary.id, alias_name: alias.name, alias_freq: alias.frequency });

    // 设置别名为非主实体
    await this.db.query(`
      UPDATE $alias SET
        is_primary = false,
        primary_id = $primary_id
    `, { alias: alias.id, primary_id: primary.id });
  }
}
```

---

## 7. 构建流程 V2.0

```
输入文档
   ↓
[1] 术语抽取（term-extraction 模块）
   ↓
[2] 术语存储（写入 term 表）
   │  - 生成 name+description 嵌入
   │  - 设置 version_range
   ↓
[3] 关系发现（并行执行）
   ├─ [3a] 规则层（rule，confidence: 0.95）
   ├─ [3b] 统计层（co_occurrence，confidence: 0.50）
   ├─ [3c] 语义层（embedding，confidence: 0.75）
   └─ [3d] LLM层（llm，confidence: 0.90，可选）
   ↓
[4] 冲突检测与解决
   │  - 按方法优先级合并
   │  - 删除低优先级关系
   ↓
[5] 同义词合并
   │  - 检测相似度 > 0.99
   │  - 合并主实体与别名
   ↓
[6] RELATE 存储（使用 Graph 特性）
   ↓
知识图谱（支持图遍历查询）
```

---

## 8. 查询示例（Graph 遍历）

### 8.1 使用 RELATE 创建关系

```sql
-- 创建关系（Graph 特性）
RELATE term:wal -> term_relation -> term:checkpoint
  SET 
    relation_type = 'part_of',
    method = 'llm',
    confidence = 0.90,
    evidence = 'WAL系统包含checkpoint进程';
```

### 8.2 图遍历查询

```sql
-- 查询 WAL 的所有出边关系（Graph 语法）
SELECT * FROM term:wal->term_relation;

-- 查询 WAL 的所有入边关系
SELECT * FROM term:wal<-term_relation;

-- 查询 WAL 的直接关联术语
SELECT out.name, relation_type, weight 
FROM term:wal->term_relation;

-- 查询 WAL 的所有关联术语（包括别名）
SELECT 
  out.name AS target,
  relation_type,
  weight,
  method
FROM term:wal->term_relation
WHERE relation_type != 'synonym'
ORDER BY weight DESC;

-- 深度遍历（2层）
SELECT out->term_relation->out.name AS level2
FROM term:wal->term_relation;
```

### 8.3 版本过滤查询

```sql
-- 查询特定版本的术语
SELECT * FROM term 
WHERE normalized = 'wal' 
AND version_range CONTAINS '17';

-- 查询版本演进
SELECT out.version_range, out.name
FROM term:pg_dump_12->term_relation
WHERE relation_type = 'version_of';
```

### 8.4 按方法过滤关系

```sql
-- 只查询 LLM 生成的高可信度关系
SELECT out.name, relation_type, confidence
FROM term:wal->term_relation
WHERE method = 'llm'
ORDER BY confidence DESC;

-- 查询规则关系
SELECT * FROM term_relation
WHERE method = 'rule' AND relation_type = 'is_a';
```

### 8.5 综合查询（带衰减）

```sql
-- 查询 WAL 的有效关系（考虑衰减）
SELECT 
  out.name AS target,
  relation_type,
  weight × decay_factor AS effective_weight,
  method
FROM term:wal->term_relation
ORDER BY effective_weight DESC
LIMIT 10;
```

---

## 9. 应用场景 V2.0

### 9.1 搜索增强（带可信度）

```
用户查询："什么是 WAL？"

流程：
1. 查询 term:wal（包括别名）
2. 图遍历获取所有关系
3. 按 confidence × weight 排序
4. 返回高可信度关联术语

输出：
"WAL (Write-Ahead Logging) 是 PostgreSQL 的核心机制。

高可信度关联（LLM确认）：
- checkpoint (part_of, 0.90)
- durability (ensures, 0.85)

统计关联（共现）：
- recovery (related_to, 0.47) ← 已衰减"
```

### 9.2 概念导航（版本感知）

```
用户浏览："PostgreSQL 17 的索引"

流程：
1. 查询 version_range CONTAINS '17' 的索引术语
2. 图遍历获取版本关系
3. 显示版本演进

输出：
"索引类型（PostgreSQL 17）：
- B-tree（默认，自 v12）
- GIN（全文搜索，自 v12）
- BRIN（大范围数据，v17 新增并行扫描）
"
```

### 9.3 推荐系统（方法权重）

```
用户阅读："shared_buffers"

推荐逻辑：
1. 图遍历获取关联术语
2. 按方法可信度加权：
   rule: ×1.5, llm: ×1.3, embedding: ×1.0, co_occurrence: ×0.5
3. 排序推荐

输出：
"推荐阅读（高可信度）：
- work_mem (configures, rule: 0.95)
- effective_cache_size (related, llm: 0.85)

统计推荐：
- maintenance_work_mem (co_occurrence: 0.32)"
```

---

## 10. 与 V1.0 的对比

| 维度 | V1.0 | V2.0 |
|------|------|------|
| 关系表 | 传统关联表 | RELATION TABLE（Graph） |
| 查询方式 | JOIN | 图遍历（->term_relation->） |
| 关系可信度 | 无 | method + confidence 字段 |
| 衰减机制 | 无 | decay_factor（共现衰减） |
| 嵌入内容 | 仅术语名 | name + description |
| 版本管理 | 无 | version_range + version_of |
| 同义词处理 | 简单 synonym | 主实体-别名合并 |
| 冲突处理 | 无 | 方法优先级合并 |

---

## 11. 实现清单

### 11.1 已完成 ✅
- [x] KnowledgeGraphBuilder 基础架构
- [x] term 表 Schema
- [x] 共现关系发现
- [x] 语义关系发现
- [x] 结构关系发现

### 11.2 V2.0 新增 ⚠️
- [ ] 改用 RELATE 语法
- [ ] 添加 method/confidence 字段
- [ ] 实现衰减机制
- [ ] name+description 嵌入
- [ ] 冲突检测与解决
- [ ] 同义词合并逻辑
- [ ] 版本管理

---

## 12. 变更记录

| 版本 | 日期 | 变更 |
|------|------|------|
| V1.0 | 2026-04-10 | 初版设计 |
| V2.0 | 2026-04-11 | 四大改进：Graph特性、可信度分层、描述增强嵌入、版本管理 |

---

**文档维护者**: OpenClaw Memory Team
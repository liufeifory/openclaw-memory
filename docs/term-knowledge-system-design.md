# OpenClaw Memory - 术语知识系统设计文档 V1.0

## 1. 概述

### 1.1 目标

构建一个**多领域术语抽取 + 知识图谱构建**系统，用于：
- 从技术文档中自动抽取专业术语
- 将术语转化为结构化知识图谱
- 支持知识检索、概念导航、推荐系统

### 1.2 与三元组的对比

| 维度 | 三元组方案 | 术语图谱方案 |
|------|-----------|-------------|
| **实体定义** | 抽象概念（subject-relation-object） | 具体术语（命名实体） |
| **提取方式** | LLM 提取（不稳定） | 分层架构（统计+规则+LLM） |
| **准确性** | 低（依赖 LLM 质量） | 高（多方法验证） |
| **存储结构** | 嵌入在 memory 表 | 独立 term + term_relation 表 |
| **查询能力** | 有限（数组内查询） | 强（表关联+向量检索） |
| **成本** | 高（每个块调用 LLM） | 低（缓存+批量判定） |
| **响应时间** | 24小时（PostgreSQL PDF） | <1小时（预期） |

### 1.3 系统架构

```
┌─────────────────────────────────────────────────────────────┐
│                    文档导入                                  │
│  PDF / Markdown / Word / HTML                               │
└─────────────────────┬───────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────────────────┐
│                 术语抽取 Pipeline                            │
│  [1] Domain Detection → [2] Statistical → [3] Filter        │
│  → [4] Cache → [5] LLM Judgment (可选)                      │
└─────────────────────┬───────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────────────────┐
│              知识图谱构建器                                   │
│  [1] 术语存储 → [2] 共现关系 → [3] 语义关系 → [4] 结构关系   │
└─────────────────────┬───────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────────────────┐
│                 SurrealDB 存储                               │
│  term 表 + term_relation 表                                  │
└─────────────────────┬───────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────────────────┐
│                   查询服务                                   │
│  向量检索 / 关系查询 / 概念导航 / 推荐系统                    │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. 术语抽取系统

### 2.1 模块结构

```
src/term-extraction/
├── types.ts              # 类型定义
├── domain-configs.ts     # 领域配置（7个领域）
├── domain-detector.ts    # 领域自动识别
├── statistical-layer.ts  # 统计层（TF-IDF + C-value）
├── candidate-filter.ts   # 候选层（规则过滤）
├── cache.ts              # 缓存层
├── pipeline.ts           # 主流程
├── index.ts              # 模块导出
```

### 2.2 分层架构

#### Layer 1: Domain Detection（领域识别）

```
算法：
1. 关键词匹配（各领域关键词集）
2. 核心术语加权（命中核心术语 = +2分）
3. 置信度计算 = (top1 - top2) / (top1 + 1)
4. 低置信度（<0.3）时返回 general

领域关键词示例：
- database: sql, postgres, wal, checkpoint, pg_dump...
- ai: transformer, bert, fine-tuning, pytorch...
- medical: mri, diagnosis, clinical, icd...
- legal: gdpr, contract, liability, jurisdiction...
- finance: roi, ebitda, derivative, gaap...
- devops: docker, kubernetes, cicd, prometheus...

块级领域覆盖（Block-level Override）：
当文档为混合领域内容时，支持在分块级别覆盖全局领域：
- SmartSplitter 分析每个块的语义特征
- 高置信度块（confidence > 0.7）使用块级领域
- 低置信度块继承文档级领域
- 实现流程：
  1. DocumentParser 解析全文
  2. SmartSplitter.analyzeBlock(block) → block_domain
  3. if (block_confidence > doc_confidence * 1.2):
       use block_domain  // 块级覆盖
  4. else:
       use doc_domain    // 继承文档级

示例：
PDF 文档《数据库AI集成》：
- 块1 "PostgreSQL WAL机制..." → database (confidence 0.92) → 块级覆盖
- 块2 "机器学习优化查询..." → ai (confidence 0.85) → 块级覆盖
- 块3 "系统架构概述..." → general (confidence 0.3) → 继承文档级
```

#### Layer 2: Statistical Layer（统计层）

```
流程：
1. 分词 → pg_前缀 / CamelCase / 连字符 / 缩写 / 普通词
2. N-gram 生成（1-gram + 2-gram + 3-gram）
3. 词频统计
4. TF-IDF 计算（词形作为 IDF 代理）
5. C-value 计算（Trie树优化，避免 O(N²)）

C-value 公式：
C-value(a) = log2(|a|) × (f(a) - Σf(b)/|Ta|)
```

#### Layer 3: Candidate Filter（候选层）

```
规则：
1. 黑名单过滤（泛词/通用词）
2. 白名单保留（领域核心术语）
3. pg_ 前缀必保留
4. CamelCase 检查（过滤重复噪声）
5. 连字符词根验证
6. 缩写白名单验证

输出：
ExtractedTerm {
  term: string
  normalized: string
  namespace: domain.normalized
  domain: DomainType
  type: TermType
  label: string
  confidence: number
  freq: number
  score: number
}
```

#### Layer 4: Cache（缓存层）

```
功能：
- 已判定术语缓存
- 按领域分区存储
- 命中率统计
- 冷启动种子加载

命中率目标：>80%

核心优化：Positive Feedback Loop（正反馈循环）
当术语满足以下条件时，自动晋升为 Seed_Term：
- confidence >= 0.95（极高置信度）
- frequency >= 50（极高频次）
- domain != 'general'（明确领域）

效果：
- 系统越跑越快
- LLM 调用率随时间单调递减
- 新文档处理效率持续提升
```

#### Layer 5: LLM Judgment（可选）

```
用途：
- 低置信度术语判定
- 批处理（50词/Prompt）

Prompt：
"你是{domain}领域专家。判断以下词是否为专业术语..."

输出：
term | label
```

### 2.3 领域配置

每个领域包含：

```typescript
interface DomainConfig {
  domain: DomainType;

  // 评分权重
  weights: {
    tfidf: number;    // 0.3
    cvalue: number;   // 0.4
    freq: number;     // 0.2
    length: number;   // 0.1
  };

  // 术语规则
  whitelist: string[];  // 必保留术语
  blacklist: string[];  // 必过滤术语
  roots: string[];      // 验证连字符词的词根
  patterns: Array<{     // 正则模式
    pattern: string;
    type: TermType;
  }>;
}
```

---

## 3. 知识图谱构建

### 3.1 模块结构

```
src/knowledge-graph/
├── builder.ts            # 知识图谱构建器
├── querier.ts            # 查询服务（待实现）
├── types.ts              # 类型定义
```

### 3.2 数据模型

#### Term 表（术语实体）

```sql
DEFINE TABLE term SCHEMAFULL;
DEFINE FIELD name ON term TYPE string;          -- 原始术语
DEFINE FIELD normalized ON term TYPE string;    -- 标准化形式
DEFINE FIELD namespace ON term TYPE string;     -- domain.normalized
DEFINE FIELD domain ON term TYPE string;        -- 所属领域
DEFINE FIELD type ON term TYPE string;          -- 类型
DEFINE FIELD aliases ON term TYPE array<string>;-- 别名列表
DEFINE FIELD description ON term TYPE string;   -- 术语描述
DEFINE FIELD embedding ON term TYPE array<float>;-- 向量嵌入
DEFINE FIELD frequency ON term TYPE int;        -- 出现频次
DEFINE FIELD confidence ON term TYPE float;     -- 置信度
DEFINE FIELD source_docs ON term TYPE array<string>;-- 来源文档
DEFINE FIELD created_at ON term TYPE datetime;
DEFINE FIELD updated_at ON term TYPE datetime;

-- 索引
DEFINE INDEX term_normalized_idx ON term UNIQUE COLUMNS normalized;
DEFINE INDEX term_namespace_idx ON term UNIQUE COLUMNS namespace;
DEFINE INDEX term_domain_idx ON term COLUMNS domain;
DEFINE INDEX term_type_idx ON term COLUMNS type;

-- 向量索引（MTREE）
-- SurrealDB MTREE 索引支持高效向量检索
-- 用于语义相似度计算和推荐系统
DEFINE INDEX term_embedding_idx ON term TYPE MTREE COLUMNS embedding;
```

#### Term_Relation 表（术语关系）

```sql
DEFINE TABLE term_relation SCHEMAFULL;
DEFINE FIELD source_id ON term_relation TYPE string;   -- 源术语ID
DEFINE FIELD target_id ON term_relation TYPE string;   -- 目标术语ID
DEFINE FIELD relation_type ON term_relation TYPE string;-- 关系类型
DEFINE FIELD weight ON term_relation TYPE float;       -- 关系强度
DEFINE FIELD evidence ON term_relation TYPE string;    -- 关系证据
DEFINE FIELD source_doc ON term_relation TYPE string;  -- 来源文档
DEFINE FIELD created_at ON term_relation TYPE datetime;

-- 索引
DEFINE INDEX relation_source_idx ON term_relation COLUMNS source_id;
DEFINE INDEX relation_target_idx ON term_relation COLUMNS target_id;
DEFINE INDEX relation_type_idx ON term_relation COLUMNS relation_type;
```

### 3.3 关系类型

| 关系类型 | 说明 | 示例 |
|---------|------|------|
| `is_a` | 分类关系 | pg_dump is_a tool |
| `part_of` | 组成关系 | checkpoint part_of WAL |
| `uses` | 使用关系 | pg_dump uses libpq |
| `related_to` | 相关关系 | GIN related_to index |
| `synonym` | 同义关系 | WAL synonym write-ahead-log |
| `derived_from` | 派生关系 | B-tree derived_from tree |
| `configures` | 配置关系 | shared_buffers configures PostgreSQL |
| `co_occurs` | 共现关系 | WAL co_occurs checkpoint |

### 3.4 关系发现方法

#### Method 1: 共现关系（统计层）

```
算法：
- 文档内术语共现计数
- 关系强度 = count / min(freq_a, freq_b)

阈值：
- min_count = 3（最小共现次数）
- min_weight = 0.1（最小关系强度）
```

#### Method 2: 语义关系（向量层）

```
算法：
- 向量余弦相似度
- 相似度 > 0.7 时建立 related_to 关系

公式：
cosine_similarity = (A·B) / (|A|×|B|)
```

#### Method 3: 结构关系（规则层）

```
命名模式规则：
- pg_* → is_a → system_object
- *_index → part_of → index
- *_buffer → part_of → memory
- shared_* / max_* / min_* → is_a → configuration
- *dump / *restore → is_a → tool
```

#### Method 4: LLM 关系（可选）

```
Prompt：
分析术语在上下文中的关系：
- WAL
- checkpoint

上下文：
"...WAL ensures durability. checkpoint periodically flushes WAL..."

输出：
WAL | checkpoint | part_of | WAL系统包含checkpoint进程
```

---

## 4. 完整流程

### 4.1 文档导入流程

```
输入文档 (PDF/Markdown)
    ↓
[DocumentParser] 解析文档
    ↓
[SmartSplitter] 智能分块
    ↓
    ├─ 文档级领域检测（全局）
    ├─ 块级领域分析（局部）
    └─ 块级领域覆盖决策（高置信度块优先）
    ↓
┌─────────────────────────────────────┐
│  每个 Block 执行：                   │
│  1. Domain Detection                │
│     - 高置信度 → 块级领域覆盖        │
│     - 低置信度 → 继承文档级领域      │
│  2. Term Extraction                 │
│  3. Term Storage                    │
│  4. Co-occurrence Recording         │
└─────────────────────────────────────┘
    ↓
文档完成后执行：
    ↓
[RelationDiscovery] 关系发现
    - Co-occurrence Relations
    - Semantic Relations
    - Structural Relations
    ↓
[RelationStorage] 关系存储
    ↓
知识图谱完成
```

### 4.2 代码示例

```typescript
import { TermExtractionPipeline } from './term-extraction/index.js';
import { KnowledgeGraphBuilder } from './knowledge-graph/builder.js';
import { DocumentParser } from './document-parser.js';

// 1. 初始化
const termPipeline = new TermExtractionPipeline({
  statistical: { minFreq: 2 },
  cache: { enabled: true },
});

const graphBuilder = new KnowledgeGraphBuilder(db, embeddingConfig);

// 2. 加载种子术语（冷启动）
termPipeline.loadSeedTerms([
  { term: 'WAL', type: 'concept', domain: 'database' },
  { term: 'checkpoint', type: 'component', domain: 'database' },
]);

// 3. 解析文档
const doc = await parser.parse('postgresql.pdf');

// 4. 逐块处理
for (const block of doc.blocks) {
  // 术语抽取
  const terms = termPipeline.extract(block.content);

  // 知识图谱构建
  await graphBuilder.buildFromDocument(terms, doc.path);
}

// 5. 全文档关系发现
const coRelations = await graphBuilder.extractCoOccurrenceRelations();
const semanticRelations = await graphBuilder.extractSemanticRelations();
const structuralRelations = await graphBuilder.extractStructuralRelations();

await graphBuilder.storeRelations([...coRelations, ...semanticRelations, ...structuralRelations]);
```

---

## 5. 查询服务

### 5.1 查询示例

#### 查询术语详情

```sql
SELECT * FROM term WHERE normalized = 'wal';
```

#### 查询术语关联术语

```sql
SELECT 
  t.name,
  r.relation_type,
  r.weight
FROM term_relation r
JOIN term t ON r.target_id = t.id
WHERE r.source_id = $wal_id
ORDER BY r.weight DESC;
```

#### 查询术语的同义词

```sql
SELECT t.name FROM term_relation r
JOIN term t ON r.target_id = t.id
WHERE r.source_id = $term_id 
AND r.relation_type = 'synonym';
```

#### 向量相似检索

```sql
SELECT name, cosine_similarity(embedding, $query_vector) AS score
FROM term
WHERE domain = 'database'
ORDER BY score DESC
LIMIT 10;
```

#### 查询特定类型术语

```sql
SELECT name, frequency FROM term
WHERE type = 'tool' AND domain = 'database'
ORDER BY frequency DESC;
```

### 5.2 应用场景

#### 搜索增强

```
用户查询："什么是 WAL？"

流程：
1. 向量检索相似术语
2. 查询 WAL 的关联术语
3. 返回：WAL + checkpoint + durability + recovery...

输出：
"WAL (Write-Ahead Logging) 是 PostgreSQL 的核心机制，
用于确保数据持久性。相关概念：checkpoint, recovery, durability..."
```

#### 概念导航

```
用户浏览："数据库索引"

流程：
1. 查询 index 相关术语
2. 返回术语图谱：B-tree, GIN, GiST, BRIN...
3. 展示：各索引类型的 is_a/part_of 关系

输出：
"索引类型图谱：
- B-tree (默认索引)
- GIN (全文搜索)
- GiST (地理数据)
- BRIN (大范围数据)"
```

#### 推荐系统

```
用户阅读："VACUUM"

流程：
1. 查询 VACUUM 的 related_to 术语
2. 按权重排序
3. 推荐相关概念

输出：
"推荐阅读：
- ANALYZE (weight: 0.85)
- autovacuum (weight: 0.75)
- REINDEX (weight: 0.65)"
```

---

## 6. 性能预估

### 6.1 PostgreSQL 15 文档（2958页）

| 操作 | 三元组方案 | 术语图谱方案 |
|------|-----------|-------------|
| 文档解析 | 2分钟 | 2分钟 |
| 术语抽取 | 24小时（LLM瓶颈） | 30分钟（统计+缓存） |
| 向量生成 | 已包含 | 30分钟 |
| 关系发现 | 无 | 10分钟 |
| **总计** | **24小时** | **~1小时** |

### 6.2 优化策略

1. **缓存命中率 >80%** - 避免重复 LLM 判定
2. **批量处理** - 50词/Prompt 减少 LLM 调用
3. **Trie树优化** - C-value O(N²) → O(N log N)
4. **并行向量生成** - embedding 批量请求

---

## 7. 扩展计划

### 7.1 Phase 1（已完成）
- [x] 术语抽取 Pipeline
- [x] 知识图谱构建器
- [x] SurrealDB Schema

### 7.2 Phase 2（待实现）
- [ ] 知识图谱查询服务
- [ ] 术语描述生成（LLM）
- [ ] 同义词发现
- [ ] 概念导航 UI

### 7.3 Phase 3（未来）
- [ ] 多语言术语支持
- [ ] 跨领域术语关联
- [ ] 术语生命周期管理
- [ ] 知识图谱可视化

---

## 8. 附录

### 8.1 术语类型定义

```typescript
type TermType =
  | 'component'    // 系统组件
  | 'parameter'    // 配置参数
  | 'algorithm'    // 算法方法
  | 'tool'         // 工具命令
  | 'concept'      // 技术概念
  | 'protocol'     // 协议规范
  | 'api'          // API/函数
  | 'metric'       // 指标度量
  | 'entity';      // 实体对象
```

### 8.2 领域类型定义

```typescript
type DomainType =
  | 'database'
  | 'ai'
  | 'medical'
  | 'legal'
  | 'finance'
  | 'devops'
  | 'general';
```

### 8.3 关系类型定义

```typescript
type RelationType =
  | 'is_a'        // 分类
  | 'part_of'     // 组成
  | 'uses'        // 使用
  | 'related_to'  // 相关
  | 'synonym'     // 同义
  | 'derived_from' // 派生
  | 'configures'  // 配置
  | 'implements'  // 实现
  | 'co_occurs';  // 共现
```

---

## 9. 变更记录

| 版本 | 日期 | 变更 |
|------|------|------|
| V1.0 | 2026-04-11 | 初版设计文档 |

---

**文档维护者**: OpenClaw Memory Team
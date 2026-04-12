# 术语知识系统集成指南

## 1. 已完成集成

术语知识系统已集成到 `openclaw-memory` 插件，通过以下方式：

### 1.1 新注册的工具

| 工具 | 说明 | 参数 |
|------|------|------|
| `term_extract` | 从文本提取术语 | `text`, `domain` (可选) |
| `term_import` | 导入文档构建知识图谱 | `path`, `doc_type` (可选), `version` (可选) |
| `term_search` | 搜索术语知识图谱 | `query`, `domain` (可选), `top_k` (可选) |

### 1.2 使用示例

#### term_extract

```json
{
  "text": "PostgreSQL uses WAL for durability. checkpoint periodically flushes WAL buffers.",
  "domain": "auto"
}
```

返回：
```json
{
  "success": true,
  "domain": "database",
  "terms": [
    { "term": "WAL", "type": "concept", "confidence": "0.95", "frequency": 2 },
    { "term": "checkpoint", "type": "component", "confidence": "0.85", "frequency": 1 }
  ],
  "total": 4
}
```

#### term_import

```json
{
  "path": "/path/to/postgresql.pdf",
  "doc_type": "database",
  "version": "15"
}
```

返回：
```json
{
  "success": true,
  "file": "postgresql.pdf",
  "doc_type": "database",
  "total_terms": 1250,
  "unique_terms": 450,
  "total_relations": 890,
  "timing_ms": 45000
}
```

#### term_search

```json
{
  "query": "WAL",
  "domain": "database",
  "top_k": 10
}
```

返回：
```json
{
  "success": true,
  "term": { "name": "WAL", "type": "concept", "frequency": 100 },
  "relations": [
    { "target": "checkpoint", "relation_type": "part_of", "weight": "0.85", "method": "llm" },
    { "target": "durability", "relation_type": "related_to", "weight": "0.75", "method": "embedding" }
  ]
}
```

---

## 2. 架构说明

### 2.1 模块关系

```
src/index.ts (插件入口)
    ├── term_extract → term-extraction/pipeline.ts
    ├── term_import → term-importer.ts
    │       ├── DocumentParser (解析文档)
    │       ├── TermExtractionPipeline (提取术语)
    │       └── KnowledgeGraphBuilder (构建图谱)
    └── term_search → knowledge-graph/builder.ts
            └── SurrealDB Graph (RELATE 语法)
```

### 2.2 复用现有服务

| 服务 | 来源 | 用途 |
|------|------|------|
| SurrealDB | `ServiceFactory.getDB()` | 存储术语和关系 |
| Embedding | `ServiceFactory.getEmbeddingConfig()` | 生成向量嵌入 |
| Config | `getConfig()` | 获取插件配置 |

---

## 3. 数据库 Schema

已在 `src/database/schema.surql` 定义：

```sql
-- 术语表
DEFINE TABLE term SCHEMAFULL;
DEFINE FIELD name ON term TYPE string;
DEFINE FIELD normalized ON term TYPE string;
DEFINE FIELD domain ON term TYPE string;
DEFINE FIELD type ON term TYPE string;
DEFINE FIELD embedding ON term TYPE array<float>;
DEFINE FIELD version_range ON term TYPE string;
...

-- 关系表（Graph Relation）
DEFINE TABLE term_relation SCHEMAFULL TYPE RELATION FROM term TO term;
DEFINE FIELD relation_type ON term_relation TYPE string;
DEFINE FIELD method ON term_relation TYPE string;
DEFINE FIELD confidence ON term_relation TYPE float;
DEFINE FIELD decay_factor ON term_relation TYPE float;
...
```

---

## 4. 与现有系统的区别

| 功能 | 现有 memory 系统 | 术语知识系统 |
|------|------------------|--------------|
| 存储对象 | 用户对话记忆 | 技术文档术语 |
| 数据结构 | memory 表 | term + term_relation 表 |
| 关系类型 | 无 | Graph Relation (RELATE) |
| 查询方式 | 向量相似度 | 图遍历 + 向量检索 |
| 版本管理 | 无 | version_range |

---

## 5. CLI 命令

新增 CLI 命令（在 `memory-cli.ts`）：

```bash
# 提取术语
node dist/memory-cli.js term-extract "PostgreSQL uses WAL" --domain=auto

# 导入文档
node dist/memory-cli.js doc-import ~/papers/postgresql.pdf --doc-type=database --version=15

# 查看统计
node dist/memory-cli.js term-stats
```

---

## 6. 后续扩展

### 6.1 知识图谱查询器 (Phase 2)

创建 `src/knowledge-graph/querier.ts`：
- 向量相似检索（MTREE）
- 概念导航（图遍历）
- 推荐系统（关系权重）

### 6.2 与 V3 系统整合

术语系统可作为 V3 三元组系统的替代：
- 更精确的实体识别（统计+规则）
- 更丰富的关系类型（Graph Relation）
- 更低的 LLM 成本（缓存 + 正反馈循环）

---

## 7. 变更记录

| 版本 | 日期 | 变更 |
|------|------|------|
| V1.0 | 2026-04-11 | 初始集成到 index.ts |
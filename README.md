# OpenClaw Memory Plugin

> 基于 SurrealDB 的企业级智能记忆系统，为 OpenClaw AI 助手提供长期记忆能力

[![Version](https://img.shields.io/badge/version-2.2.0-blue)](https://github.com/liufeifory/openclaw-memory)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![Node](https://img.shields.io/badge/Node.js-≥18-green)](https://nodejs.org)
[![SurrealDB](https://img.shields.io/badge/SurrealDB-≥2.0-orange)](https://surrealdb.com)

---

## 目录

- [简介](#简介)
- [核心特性](#核心特性)
- [系统架构](#系统架构)
- [快速开始](#快速开始)
- [详细配置](#详细配置)
- [记忆类型](#记忆类型)
- [检索机制](#检索机制)
- [知识图谱](#知识图谱)
- [文档导入](#文档导入)
- [CLI 工具](#cli-工具)
- [API 参考](#api-参考)
- [故障排查](#故障排查)
- [性能优化](#性能优化)
- [开发指南](#开发指南)

---

## 简介

OpenClaw Memory 是一个生产级的长期记忆系统，为 AI 助手提供类似人类大脑的记忆能力：

- **记忆存储**：自动分类、存储对话内容
- **语义检索**：基于向量相似度的智能搜索
- **知识图谱**：自动提取实体关系，支持多跳查询
- **自动维护**：记忆衰减、冲突检测、自动聚类

### 与其他方案对比

| 特性 | OpenClaw Memory | 简单向量库 | 传统数据库 |
|------|----------------|-----------|-----------|
| 语义检索 | ✅ | ✅ | ❌ |
| 知识图谱 | ✅ 原生支持 | ❌ | 需手动实现 |
| 自动分类 | ✅ LLM 驱动 | ❌ | ❌ |
| 冲突检测 | ✅ 自动 | ❌ | ❌ |
| 记忆衰减 | ✅ 时间衰减 | ❌ | ❌ |
| 文档导入 | ✅ 多格式 | 需手动 | 需手动 |

---

## 核心特性

### 1. 向量语义检索

使用 BGE-M3 模型生成 1024 维向量，支持跨语言的语义相似度搜索：

```
用户查询: "我喜欢什么编程语言？"
系统匹配: "用户是一名 TypeScript 开发者" (相似度 0.87)
```

### 2. 知识图谱

自动从对话中提取实体（人名、地名、组织、技术等）并构建关系网络：

```
对话: "我和张三在星巴克讨论了 React 项目"

图谱:
  [用户] --(讨论)--> [React]
  [用户] --(参与)--> [张三]
  [张三] --(地点)--> [星巴克]
```

### 3. 混合检索

结合三种检索路径，最大化召回率：

1. **向量检索**：语义相似度匹配
2. **实体检索**：精确实体匹配
3. **图遍历检索**：通过实体关联发现隐性知识

### 4. 文档导入

支持多种格式的文档自动解析和分块导入：

- PDF（使用 pdftotext）
- Word（.docx，使用 mammoth）
- Markdown（直接解析）
- HTML/URL（网页抓取）

### 5. 冲突检测

自动检测和更新过时信息：

```
旧记忆: "用户在阿里巴巴工作"
新记忆: "用户跳槽到了腾讯"
系统: 自动标记旧记忆为 superseded
```

### 6. 记忆衰减

基于时间的重要性衰减：

```typescript
importance = base_importance * exp(-λ * days)
// λ = ln(2) / 30 (半衰期 30 天)
```

---

## 系统架构

### 整体架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                        OpenClaw 主程序                            │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐   │
│  │ message_     │  │ before_      │  │ memory_search        │   │
│  │ received     │  │ prompt_build │  │ Tool                 │   │
│  │ Hook         │  │ Hook         │  │                      │   │
│  └──────┬───────┘  └──────┬───────┘  └──────────┬───────────┘   │
└─────────┼─────────────────┼─────────────────────┼───────────────┘
          │                 │                     │
          ▼                 ▼                     ▼
┌─────────────────────────────────────────────────────────────────┐
│                    OpenClaw Memory Plugin                        │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │                     MemoryManager                           │ │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐  │ │
│  │  │ Memory   │ │ Hybrid   │ │ Conflict │ │ Summarizer   │  │ │
│  │  │ Store    │ │ Retriever│ │ Detector │ │              │  │ │
│  │  └────┬─────┘ └────┬─────┘ └──────────┘ └──────────────┘  │ │
│  │       │            │                                       │ │
│  │  ┌────┴────────────┴────────────────────────────────────┐ │ │
│  │  │                   EntityIndexer                       │ │ │
│  │  │  实体提取 → 图构建 → 冻结保护 → TTL清理               │ │ │
│  │  └──────────────────────────────────────────────────────┘ │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────────────────┐ │
│  │ Document     │ │ Preference   │ │ Memory Filter            │ │
│  │ Watcher      │ │ Extractor    │ │ (消息分类)               │ │
│  └──────────────┘ └──────────────┘ └──────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
          │                     │
          ▼                     ▼
┌─────────────────┐  ┌─────────────────────────────────────────────┐
│   oMLX / LLM    │  │              SurrealDB                       │
│  ┌───────────┐  │  │  ┌─────────────────────────────────────────┐│
│  │ Embedding │  │  │  │ memory 表 (向量索引 + 图遍历)           ││
│  │ BGE-M3    │  │  │  ├─────────────────────────────────────────┤│
│  │ 1024维    │  │  │  │ entity 表 (实体节点)                    ││
│  └───────────┘  │  │  ├─────────────────────────────────────────┤│
│  ┌───────────┐  │  │  │ memory_entity 表 (记忆-实体关系)        ││
│  │ LLM       │  │  │  ├─────────────────────────────────────────┤│
│  │ Gemma-4   │  │  │  │ entity_relation 表 (实体-实体关系)      ││
│  │ 实体提取  │  │  │  └─────────────────────────────────────────┘│
│  └───────────┘  │  └─────────────────────────────────────────────┘
└─────────────────┘
```

### 数据流程

```
用户消息 → message_received Hook
    │
    ├─→ MemoryFilter.classify()     → 分类: FACT/PREFERENCE/EVENT/TRIVIAL
    │
    ├─→ MemoryStore.storeEpisodic() → 存储到 SurrealDB
    │       │
    │       └─→ EntityIndexer.enqueue() → 后台提取实体
    │
    └─→ 每10条消息触发:
            ├─→ PreferenceExtractor.extract() → 提取偏好
            └─→ Summarizer.summarize()        → 生成摘要
```

### 检索流程

```
用户查询 → before_prompt_build Hook
    │
    ├─→ HybridRetriever.retrieve()
    │       │
    │       ├─→ 向量检索 (BGE-M3 相似度)
    │       │
    │       ├─→ 实体检索 (精确匹配)
    │       │
    │       ├─→ 图遍历检索 (多跳关联)
    │       │
    │       └─→ Topic 检索 (主题召回)
    │
    ├─→ 结果合并 & 去重
    │
    ├─→ Reranker 重排序
    │
    └─→ 阈值过滤 → 注入上下文
```

---

## 快速开始

### 前置要求

| 组件 | 版本 | 安装方式 |
|------|------|----------|
| Node.js | ≥18 | `brew install node` |
| SurrealDB | ≥2.0 | `brew install surrealdb` |
| oMLX | 最新 | `brew install omlx` 或从源码编译 |

### 安装步骤

```bash
# 1. 克隆仓库
cd ~/.openclaw/plugins
git clone https://github.com/liufeifory/openclaw-memory.git
cd openclaw-memory

# 2. 安装依赖
npm install

# 3. 编译 TypeScript
npm run build

# 4. 启动 SurrealDB
surreal start --bind 0.0.0.0:8001 memory.db

# 5. 启动 oMLX (Embedding + LLM)
omlx serve --port 8000

# 6. 配置 OpenClaw (见下方)
```

### 验证安装

```bash
# 运行测试
npm test

# 查看统计
node dist/memory-cli.js stats
```

预期输出：
```
SurrealDB Memory Stats

============================================================
Episodic memories: 0
Semantic memories: 0
Reflection memories: 0
Total memories: 0
```

---

## 详细配置

### OpenClaw 主配置

编辑 `~/.openclaw/openclaw.json`：

```json
{
  "plugins": {
    "slots": {
      "memory": "openclaw-memory"
    },
    "entries": {
      "openclaw-memory": {
        "enabled": true,
        "config": {
          "backend": "surrealdb",
          "surrealdb": {
            "url": "ws://127.0.0.1:8001/rpc",
            "namespace": "openclaw",
            "database": "memory",
            "username": "root",
            "password": "root"
          },
          "embedding": {
            "endpoint": "http://localhost:8000/v1/embeddings",
            "model": "bge-m3-mlx-fp16",
            "apiKey": "your-api-key"
          },
          "llm": {
            "localEndpoint": "http://localhost:8000",
            "localApiKey": "your-api-key",
            "localModel": "gemma-4-e4b-it-8bit"
          },
          "documentImport": {
            "watchDir": "~/.openclaw/documents",
            "chunkSize": 500,
            "chunkOverlap": 50
          }
        }
      }
    }
  }
}
```

### 配置项详解

#### surrealdb 配置

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `url` | string | `ws://127.0.0.1:8001/rpc` | SurrealDB WebSocket 地址 |
| `namespace` | string | `openclaw` | 命名空间 |
| `database` | string | `memory` | 数据库名 |
| `username` | string | `root` | 用户名 |
| `password` | string | `root` | 密码 |

#### embedding 配置

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `endpoint` | string | `http://localhost:8000/v1/embeddings` | Embedding 服务地址 |
| `model` | string | `bge-m3-mlx-fp16` | 模型名称 |
| `apiKey` | string | - | API Key（可选） |

#### llm 配置

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `localEndpoint` | string | `http://localhost:8000` | 本地 LLM 地址 |
| `localApiKey` | string | - | API Key |
| `localModel` | string | `gemma-4-e4b-it-8bit` | 模型名称 |
| `cloudEnabled` | boolean | false | 是否启用云端 LLM |
| `cloudProvider` | string | - | 云服务商: `bailian`/`openai` |
| `cloudBaseUrl` | string | - | 云端 API 地址 |
| `cloudApiKey` | string | - | 云端 API Key |
| `cloudModel` | string | - | 云端模型名称 |

#### documentImport 配置

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `watchDir` | string | - | 文档监控目录 |
| `chunkSize` | number | 500 | 分块大小（字符） |
| `chunkOverlap` | number | 50 | 分块重叠（字符） |

### 环境变量

也可以通过环境变量配置：

```bash
export SURREALDB_URL=http://localhost:8001
export EMBEDDING_ENDPOINT=http://localhost:8000/v1/embeddings
export EMBEDDING_MODEL=bge-m3-mlx-fp16
export EMBEDDING_API_KEY=your-api-key
export LLM_ENDPOINT=http://localhost:8000
export LLM_API_KEY=your-api-key
export LLM_MODEL=gemma-4-e4b-it-8bit
```

---

## 记忆类型

### 三种记忆类型

| 类型 | 说明 | 重要性 | 衰减 | 示例 |
|------|------|--------|------|------|
| **Episodic** | 情景记忆：具体事件、对话 | 0.5-0.8 | 每日 ×0.98 | "今天去了星巴克" |
| **Semantic** | 语义记忆：事实、偏好 | 0.7-0.9 | 每日 ×0.98 | "用户喜欢 TypeScript" |
| **Reflection** | 反思记忆：总结、洞察 | 0.9 | 无 | "用户偏好简洁的代码风格" |

### 自动分类规则

系统使用 LLM 自动分类消息：

| 分类 | 示例 | 是否存储 | 记忆类型 |
|------|------|----------|----------|
| `FACT` | "我是程序员"、"我用 Mac" | ✅ | semantic |
| `PREFERENCE` | "我喜欢 Python"、"我讨厌早起" | ✅ | semantic |
| `EVENT` | "今天去了星巴克" | ✅ | episodic |
| `TRIVIAL` | "你好"、"谢谢"、"再见" | ❌ | - |
| `QUESTION` | "什么是向量数据库？" | ❌ | - |

### 重要性算法

```typescript
importance = 0.5 × base_importance
           + 0.3 × log(access_count + 1)
           + 0.2 × exp(-days_since_creation / 30)
```

影响因素：
- **基础重要性**：LLM 分类时评估
- **访问次数**：每次检索 +1
- **时间衰减**：半衰期 30 天

### 记忆提升

高频访问的 Episodic 记忆自动提升为 Semantic：

```typescript
if (access_count > 10 && type === 'episodic') {
  // 提升为 semantic
  memory.type = 'semantic';
  memory.importance = Math.min(0.9, memory.importance + 0.1);
}
```

---

## 检索机制

### 四路径并行检索

```
                    ┌─────────────────┐
                    │   用户查询       │
                    └────────┬────────┘
                             │
         ┌───────────────────┼───────────────────┐
         │                   │                   │
         ▼                   ▼                   ▼
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│   向量检索       │ │   实体检索      │ │   图遍历检索    │
│  (语义相似度)    │ │  (精确匹配)     │ │  (多跳关联)     │
└────────┬────────┘ └────────┬────────┘ └────────┬────────┘
         │                   │                   │
         └───────────────────┼───────────────────┘
                             │
                    ┌────────┴────────┐
                    │   结果合并去重   │
                    └────────┬────────┘
                             │
                    ┌────────┴────────┐
                    │   Reranker 重排  │
                    └────────┬────────┘
                             │
                    ┌────────┴────────┐
                    │   阈值过滤       │
                    │  (default: 0.6)  │
                    └────────┬────────┘
                             │
                    ┌────────┴────────┐
                    │   Top-K 结果     │
                    └─────────────────┘
```

### 向量检索

使用 BGE-M3 模型生成 1024 维向量：

```sql
-- SurrealDB 向量检索
SELECT *, vector::similarity::cosine(embedding, $query_embedding) AS similarity
FROM memory
WHERE is_active = true
ORDER BY similarity DESC
LIMIT $limit
```

### 实体检索

从查询中提取实体，精确匹配：

```typescript
// 1. 提取查询中的实体
const entities = await entityExtractor.extract(query);

// 2. 查找包含这些实体的记忆
for (const entity of entities) {
  const memories = await db.searchByEntity(entity.id);
  results.push(...memories);
}
```

### 图遍历检索

通过实体关系发现隐性知识：

```
查询: "React 项目"
实体提取: [React]

图遍历:
  [React] --(讨论)--> [张三]
  [张三] --(参与)--> [项目A]
  [张三] --(地点)--> [星巴克]

结果: 发现与 React 相关的记忆
```

### Reranker 重排序

使用 LLM 对结果进行相关性评分：

```typescript
const prompt = `
判断以下记忆与查询的相关性（0-10分）：

查询: ${query}
记忆: ${memory.content}

评分:`;

const score = await llm.complete(prompt);
```

---

## 知识图谱

### 图谱结构

```
┌─────────────────────────────────────────────────────────┐
│                      记忆层                              │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐                │
│  │ Memory 1│  │ Memory 2│  │ Memory 3│  ...           │
│  └────┬────┘  └────┬────┘  └────┬────┘                │
└───────┼────────────┼────────────┼──────────────────────┘
        │            │            │
        │ memory_entity 边        │
        │            │            │
┌───────┼────────────┼────────────┼──────────────────────┐
│       ▼            ▼            ▼                       │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐                │
│  │ Entity A│  │ Entity B│  │ Entity C│  实体层        │
│  │ "张三"  │  │ "React" │  │ "星巴克" │                │
│  └────┬────┘  └────┬────┘  └────┬────┘                │
│       │            │            │                       │
│       │ entity_relation 边     │                       │
│       │            │            │                       │
│       ▼            ▼            ▼                       │
│  ┌────────────────────────────────────┐               │
│  │        Entity-Entity 关系           │               │
│  │  (讨论, 参与, 地点, 使用...)        │               │
│  └────────────────────────────────────┘               │
└─────────────────────────────────────────────────────────┘
```

### 实体提取

使用 LLM + 正则表达式的双层提取：

```typescript
// Layer 1: 快速正则提取
const quickEntities = extractByRegex(content);

// Layer 2: LLM 精细提取
const llmEntities = await llm.extractEntities(content);

// 合并去重
const entities = mergeEntities(quickEntities, llmEntities);
```

### 图爆炸保护

防止高频实体（如"项目"、"公司"）导致图爆炸：

```typescript
const GRAPH_PROTECTION = {
  MIN_MENTION_COUNT: 3,     // 最少提及次数才创建实体
  MAX_MEMORY_LINKS: 500,    // 单实体最大关联数
  TTL_DAYS: 90,             // 未访问实体的 TTL
  PRUNE_INTERVAL_DAYS: 7,   // 清理间隔
};
```

### Super Node 冻结

高频实体自动冻结，停止新的关联：

```typescript
if (entity.memory_count >= MAX_MEMORY_LINKS) {
  entity.is_frozen = true;
  // 创建 Topic 节点替代
  await createTopicNode(entity);
}
```

---

## 文档导入

### 支持的格式

| 格式 | 扩展名 | 解析方式 |
|------|--------|----------|
| PDF | `.pdf` | pdftotext |
| Word | `.docx` | mammoth |
| Markdown | `.md`, `.markdown` | 直接读取 |
| HTML | URL | node-fetch + Cheerio |

### 智能语义分段

不按固定字符数分割，而是基于语义边界：

```typescript
// 检测段落边界
const paragraphs = content.split(/\n\n+/);

// 检测主题转变
for (const para of paragraphs) {
  const keywords = extractKeywords(para);
  const similarity = calculateKeywordOverlap(keywords, prevKeywords);
  
  if (similarity < 0.3) {
    // 主题转变，开始新分段
    startNewChunk();
  }
}
```

### 使用方式

#### 方式一：目录监控

```bash
# 创建文档目录
mkdir -p ~/.openclaw/documents

# 复制文件到目录
cp ~/Downloads/report.pdf ~/.openclaw/documents/

# 系统自动检测并导入
```

#### 方式二：CLI 导入

```bash
node dist/memory-cli.js import ~/Documents/report.pdf
```

#### 方式三：API 调用

```typescript
import { DocumentImporter } from './document-importer.js';

const importer = new DocumentImporter(memoryManager);
await importer.importFile('/path/to/document.pdf');
```

---

## CLI 工具

### 命令列表

```bash
# 查看帮助
node dist/memory-cli.js --help

# 查看统计
node dist/memory-cli.js stats

# 存储记忆
node dist/memory-cli.js store "内容" [选项]
  --type=<type>         记忆类型: episodic, semantic, reflection
  --importance=<num>    重要性: 0-1
  --session=<id>        会话 ID

# 搜索记忆
node dist/memory-cli.js search "查询" [选项]
  --top-k=<num>         返回数量
  --threshold=<num>     相似度阈值

# 列出记忆
node dist/memory-cli.js list [选项]
  --limit=<num>         最大数量
```

### 使用示例

```bash
# 存储语义记忆
node dist/memory-cli.js store "用户喜欢使用 TypeScript" \
  --type=semantic --importance=0.8

# 存储情景记忆
node dist/memory-cli.js store "今天完成了项目重构" \
  --type=episodic --session=project-alpha

# 搜索记忆
node dist/memory-cli.js search "编程语言偏好" --top-k=5

# 查看统计
node dist/memory-cli.js stats
```

---

## API 参考

### MemoryManager

核心记忆管理类：

```typescript
import { MemoryManager } from './memory-manager-surreal.js';

const mm = new MemoryManager(config);
await mm.initialize();

// 存储记忆
await mm.storeMemory(sessionId, content, importance);
await mm.storeSemantic(content, importance, sessionId);
await mm.storeReflection(summary, importance, sessionId);

// 检索记忆
const memories = await mm.retrieveRelevant(query, sessionId, topK, threshold);

// 获取统计
const stats = await mm.getStats();

// 清理
await mm.dispose();
```

### HybridRetriever

混合检索器：

```typescript
import { HybridRetriever } from './hybrid-retrieval.js';

const retriever = new HybridRetriever(db, embedding, entityIndexer, reranker);
const result = await retriever.retrieve(query, sessionId, topK, threshold);

console.log(result.results);  // 记忆列表
console.log(result.stats);    // 检索统计
```

### EntityIndexer

实体索引器：

```typescript
import { EntityIndexer } from './entity-indexer.js';

const indexer = new EntityIndexer(db);

// 加入索引队列
indexer.enqueue(memoryId, content);

// 获取统计
const stats = indexer.getStats();

// 运行 TTL 清理
await indexer.runTTLPruning();

// 清理
indexer.dispose();
```

### DocumentParser

文档解析器：

```typescript
import { DocumentParser } from './document-parser.js';

const parser = new DocumentParser();

// 解析本地文件
const doc = await parser.parse('/path/to/file.pdf');

// 解析 URL
const webPage = await parser.parseUrl('https://example.com');

console.log(doc.content);   // 文本内容
console.log(doc.metadata);  // 元数据
```

---

## 故障排查

### 常见问题

#### 1. SurrealDB 连接失败

```bash
# 检查服务状态
brew services list | grep surreal

# 重启服务
brew services restart surrealdb

# 手动连接测试
surreal sql --endpoint http://localhost:8001 --username root --password root
```

#### 2. Embedding 服务超时

```bash
# 检查服务状态
curl http://localhost:8000/v1/models

# 测试 Embedding
curl -X POST http://localhost:8000/v1/embeddings \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-api-key" \
  -d '{"input": "test", "model": "bge-m3-mlx-fp16"}'
```

#### 3. 记忆检索结果为空

可能原因：
- 数据库中没有记忆
- 阈值设置过高
- Embedding 服务未运行

解决方案：
```bash
# 降低阈值
node dist/memory-cli.js search "查询" --threshold=0.3

# 检查数据库
node dist/memory-cli.js stats
```

#### 4. 实体提取不工作

检查 LLM 服务：
```bash
curl http://localhost:8000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-api-key" \
  -d '{
    "model": "gemma-4-e4b-it-8bit",
    "messages": [{"role": "user", "content": "Hello"}]
  }'
```

### 日志查看

```bash
# OpenClaw 日志
tail -f ~/.openclaw/logs/gateway.log | grep memory

# SurrealDB 日志
tail -f /usr/local/var/log/surrealdb.log
```

---

## 性能优化

### 资源消耗

| 组件 | 内存 | CPU | 说明 |
|------|------|-----|------|
| 插件进程 | ~50MB | 低 | Node.js 进程 |
| BGE-M3 | ~500MB | 中 | Embedding 推理 |
| Gemma-4 | ~4GB | 中 | LLM 推理 |
| SurrealDB | ~150MB | 低 | 数据库 |

### 优化建议

#### 1. Embedding 缓存

系统内置 LRU 缓存，避免重复计算：

```typescript
// 缓存配置
const EMBEDDING_CACHE_SIZE = 1000;
const EMBEDDING_CACHE_TTL = 3600000; // 1 小时
```

#### 2. 批量处理

实体索引使用后台队列，避免阻塞主流程：

```typescript
// 动态调整索引间隔
const interval = calculateBackpressureInterval(queueSize, systemLoad);
```

#### 3. 图清理

定期运行 TTL 清理，保持图健康：

```typescript
// 每 7 天运行一次
await indexer.runTTLPruning();
```

---

## 开发指南

### 项目结构

```
openclaw-memory/
├── src/                           # TypeScript 源码
│   ├── index.ts                   # 插件入口
│   ├── config.ts                  # 统一配置
│   ├── service-factory.ts         # 服务工厂
│   ├── memory-manager-surreal.ts  # 记忆管理器
│   ├── surrealdb-client.ts        # SurrealDB 客户端
│   ├── embedding.ts               # Embedding 服务
│   ├── llm-client.ts              # LLM 客户端
│   ├── entity-extractor.ts        # 实体提取
│   ├── entity-indexer.ts          # 实体索引器
│   ├── hybrid-retrieval.ts        # 混合检索
│   ├── document-parser.ts         # 文档解析
│   ├── document-splitter.ts       # 文档分段
│   ├── document-watcher.ts        # 文件监控
│   ├── conflict-detector.ts       # 冲突检测
│   ├── reranker.ts                # 重排序
│   ├── clusterer.ts               # 聚类
│   ├── summarizer.ts              # 摘要
│   ├── preference-extractor.ts    # 偏好提取
│   ├── memory-filter.ts           # 消息分类
│   ├── memory-cli.ts              # CLI 工具
│   └── ...
├── dist/                          # 编译输出
├── package.json                   # 项目配置
├── tsconfig.json                  # TypeScript 配置
└── README.md                      # 本文档
```

### 开发命令

```bash
# 安装依赖
npm install

# 编译
npm run build

# 监听模式
npm run build -- --watch

# 运行测试
npm test

# 测试特定文件
npx vitest run src/index.test.ts
```

### 添加新功能

1. 在 `src/` 下创建新模块
2. 在 `src/index.ts` 中注册 Hook 或 Tool
3. 在 `src/memory-manager-surreal.ts` 中集成
4. 添加测试用例
5. 更新文档

### 代码规范

- 使用 TypeScript 严格模式
- 避免使用 `any` 类型
- 所有公开 API 添加 JSDoc 注释
- 使用 `logInfo`/`logWarn`/`logError` 记录日志
- 遵循单一职责原则

---

## 许可证

MIT License

---

## 贡献

欢迎提交 Issue 和 Pull Request！

1. Fork 本仓库
2. 创建特性分支 (`git checkout -b feature/amazing-feature`)
3. 提交更改 (`git commit -m 'Add amazing feature'`)
4. 推送到分支 (`git push origin feature/amazing-feature`)
5. 开启 Pull Request

---

## 致谢

- [OpenClaw](https://github.com/openclaw/openclaw) - AI 助手框架
- [SurrealDB](https://surrealdb.com/) - 原生图数据库
- [BGE-M3](https://huggingface.co/BAAI/bge-m3) - 多语言 Embedding 模型
- [oMLX](https://github.com/ml-explore/mlx) - Apple Silicon 机器学习框架
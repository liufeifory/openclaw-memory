# OpenClaw Memory Plugin - 架构文档

> 📐 深入理解记忆系统的设计与实现

---

## 🎯 设计目标

1. **全自动** - 用户无需手动操作，记忆自动存储和检索
2. **语义化** - 基于向量相似度，理解语义而非关键词匹配
3. **重要性驱动** - 动态评分，重要记忆优先保留
4. **SurrealDB 后端** - 原生图数据库，支持图遍历和混合检索
5. **三层实体提取** - Regex → 1B 模型 → 7B 模型漏斗式提取
6. **低延迟** - 上下文注入 <1 秒，不阻塞对话

---

## 🏗️ 系统架构

### 整体架构

```
┌─────────────────────────────────────────────────────────────────┐
│                        OpenClaw 主程序                           │
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │message_      │  │before_prompt │  │memory_search         │  │
│  │received Hook │  │_build Hook   │  │Tool                  │  │
│  └──────┬───────┘  └──────┬───────┘  └──────────┬───────────┘  │
│         │                 │                      │              │
└─────────┼─────────────────┼──────────────────────┼──────────────┘
          │                 │                      │
          ▼                 ▼                      ▼
┌─────────────────────────────────────────────────────────────────┐
│              Node.js 插件 (dist/index.js)                        │
│                                                                  │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐ │
│  │MemoryFilter │  │MemoryManager│  │LLMLimiter               │ │
│  │消息分类     │  │记忆管理     │  │LLM 调用限流              │ │
│  └─────────────┘  └──────┬──────┘  └─────────────────────────┘ │
│                          │                                      │
│  ┌─────────────┐  ┌──────┴──────┐  ┌─────────────────────────┐ │
│  │Preference   │  │SurrealDB    │  │EntityIndexer            │ │
│  │Extractor    │  │MemoryMgr    │  │(实体索引 + 图构建)        │ │
│  │偏好提取     │  │(原生图数据库) │  └─────────────────────────┘ │
│  └─────────────┘  └─────────────┘                               │
│                                                                  │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐ │
│  │Summarizer   │  │Reranker     │  │HybridRetriever          │ │
│  │对话摘要     │  │重排序       │  │(向量 + 图混合检索)         │ │
│  └─────────────┘  └─────────────┘  └─────────────────────────┘ │
│                                                                  │
│  ┌─────────────┐  ┌─────────────┐                               │
│  │Entity       │  │Conflict     │                               │
│  │Extractor    │  │Detector     │                               │
│  │(三层漏斗)    │  │(语义冲突检测) │                               │
│  └─────────────┘  └─────────────┘                               │
└─────────────────────────────────────────────────────────────────┘
          │                 │                      │
          │                 ▼                      │
          │    ┌────────────────────────┐          │
          │    │  llama.cpp (port 8081) │          │
          │    │  Llama-3.2-1B-Instruct │          │
          │    │  - 消息分类            │          │
          │    │  - 偏好提取            │          │
          │    │  - 对话摘要            │          │
          │    │  - 重排序              │          │
          │    └────────────────────────┘          │
          │                                       │
          ▼                                       ▼
┌─────────────────────┐              ┌─────────────────────────────┐
│  llama.cpp (8080)   │              │   SurrealDB 2.x             │
│  BGE-M3 Embedding   │              │   - 原生图数据库            │
│  1024 维向量生成     │              │   - 向量索引 + 图遍历        │
│                     │              │   - 自动 TTL 清理            │
└─────────────────────┘              └─────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│  llama.cpp (8082)                                                │
│  Qwen2.5-Coder-7B-Instruct                                      │
│  - 实体提取 (Layer 3 精炼)                                       │
│  - 三元组提取                                                    │
│  - 复杂 NLP 任务                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 数据流

#### 1. 消息存储流程（message_received Hook）

```
用户消息
   │
   ▼
┌─────────────────┐
│ MemoryFilter    │ → 分类：TRIVIAL/FACT/PREFERENCE/EVENT/QUESTION
│ (调用 LLM 8081)  │
└────────┬────────┘
         │
         ▼
    需要存储？
    ┌───┴───┐
   是       否
   │        │
   ▼        └→ 丢弃
┌─────────────────┐
│ MemoryManager   │ → 根据类型存储：
│                 │   - semantic: 带冲突检测
│                 │   - episodic: 直接存储
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ 本地 Markdown   │ → 同步写入 ~/.openclaw/workspace/memory/YYYY-MM-DD.md
│ (兼容性备份)     │
└─────────────────┘
```

#### 2. 上下文注入流程（before_prompt_build Hook）

```
用户发送新消息
   │
   ▼
┌─────────────────┐
│ 检索相关记忆     │ → 向量相似度搜索 (top_k=3, threshold=0.65)
│ (1000ms 超时)    │
└────────┬────────┘
         │
         ▼
    有结果？
    ┌───┴───┐
   是       否
   │        └→ 正常构建 prompt（无记忆注入）
   ▼
┌─────────────────┐
│ 构建上下文       │ → 格式：
│                 │   [TYPE] (sim: X.XXX, imp: X.XX) content
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ prependContext  │ → 插入到 prompt 开头
└─────────────────┘
```

#### 3. 偏好提取流程（每 10 条消息触发）

```
累积 10 条对话
   │
   ▼
┌─────────────────┐
│ Preference      │ → 调用 LLM 提取：
│ Extractor       │   - likes (喜欢的事物)
│ (调用 LLM 8081)  │   - dislikes (不喜欢的事物)
│                 │   - facts (用户事实)
│                 │   - habits (用户习惯)
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ MemoryManager   │ → 存储为 semantic 记忆
└─────────────────┘
```

#### 4. 对话摘要流程（每 10 条消息触发）

```
累积 10 条对话
   │
   ▼
┌─────────────────┐
│ Summarizer      │ → 调用 LLM 生成摘要
│ (调用 LLM 8081)  │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ MemoryManager   │ → 存储为 reflection 记忆 (importance=0.9)
└─────────────────┘
```

---

## 📊 记忆类型

| 类型 | 表名/Collection | 说明 | 重要性范围 | 衰减 | 存储条件 |
|------|----------------|------|-----------|------|----------|
| **Episodic** | `episodic_memory` | 具体事件、对话 | 0.5-0.8 | 每日 ×0.98 | EVENT 类消息 |
| **Semantic** | `semantic_memory` | 用户偏好、事实 | 0.7-0.9 | 每日 ×0.98 | FACT/PREFERENCE + 偏好提取 |
| **Reflection** | `reflection_memory` | 摘要、洞察 | 0.9 (固定) | 无 | 每 10 条自动生成 |

### 消息分类规则

| 分类 | 示例 | 是否存储 | 记忆类型 |
|------|------|----------|----------|
| TRIVIAL | "你好"、"谢谢"、"再见" | ❌ | - |
| FACT | "我是程序员"、"我用 Mac" | ✅ | semantic |
| PREFERENCE | "我喜欢 Python"、"我讨厌早起" | ✅ | semantic |
| EVENT | "今天去了星巴克"、"刚完成项目" | ✅ | episodic |
| QUESTION | "什么是向量数据库？" | ❌ | - |

---

## 🔬 核心算法

### 三层实体提取漏斗（Entity Extractor）

```
用户输入文本
     │
     ▼
┌─────────────────────────┐
│ Layer 1: Regex 匹配      │
│ - 预定义技术名词库       │
│ - 别名映射 (TS→TypeScript)│
│ - 覆盖率：60-80%         │
│ - 延迟：0ms (无 LLM)     │
└────────┬────────────────┘
         │ 未命中时
         ▼
┌─────────────────────────┐
│ Layer 2: 1B 模型过滤      │
│ - Llama-3.2-1B @ 8081   │
│ - 判断是否为有效实体     │
│ - 批量处理 (mini-batch) │
│ - 覆盖率：~90%          │
│ - 延迟：~200-400ms      │
└────────┬────────────────┘
         │ 未命中时
         ▼
┌─────────────────────────┐
│ Layer 3: 7B 模型精炼      │
│ - Qwen2.5-Coder-7B @8082│
│ - 深度提取复杂实体       │
│ - 三元组关系提取         │
│ - 覆盖率：~95%+         │
│ - 延迟：~800-1500ms     │
└─────────────────────────┘
```

**三层架构优势：**
- ✅ **性能优化** - 80% 请求在 Layer 1 解决，无需调用 LLM
- ✅ **成本降低** - Layer 2 使用 1B 小模型快速过滤
- ✅ **精度保证** - Layer 3 7B 模型处理疑难杂症
- ✅ **优雅降级** - LLM 不可用时，Layer 1 仍可工作

### 重要性计算

```typescript
importance = 0.5 × base_importance
           + 0.3 × log(access_count + 1)
           + 0.2 × exp(-days_since_creation / 30)
```

**参数说明：**
- `base_importance`: 初始重要性 (0.5-0.9)
- `access_count`: 被检索次数
- `days_since_creation`: 创建至今的天数

### 时间衰减

```typescript
// 每日维护任务执行
importance = importance * 0.98
```

### 记忆提升

```typescript
// Episodic → Semantic
if (memory.type === 'episodic' && memory.access_count > 10) {
  await storeSemantic(memory.content, memory.importance)
}
```

### 冲突检测（Semantic 记忆）

```typescript
// 存储前检查相似记忆
const similar = await searchSimilar(content, threshold=0.85)

if (similar.length > 0) {
  // 有新冲突，比较重要性
  if (newImportance > similar[0].importance) {
    // 新记忆更重要，标记旧记忆为 superseded
    await markSuperseded(similar[0].id)
    await storeNew()
  } else {
    // 旧记忆更重要，跳过存储
    return
  }
} else {
  await storeNew()
}
```

### 检索排序

```typescript
// 最终得分 = 相似度 × 重要性
score = similarity * importance

// 按 score 降序排列，返回 top_k
```

---

## 🔌 Hook 系统

### message_received

**触发时机：** 渠道消息到达时（Telegram/WhatsApp/Discord 等）

**行为：**
- 异步非阻塞
- 分类消息并存储
- 写入本地 Markdown 备份

**注意：** TUI 模式下不触发此 Hook

### before_prompt_build

**触发时机：** 每次构建 prompt 前（所有模式）

**行为：**
- 同步阻塞（1000ms 超时）
- 检索相关记忆
- 注入上下文到 prompt

**超时保护：**
```typescript
Promise.race([
  retrieveMemories(),
  setTimeout(() => reject('timeout'), 1000)
])
```

---

## 🗄️ 数据库 Schema

### PostgreSQL (pgvector)

```sql
-- 情景记忆
CREATE TABLE episodic_memory (
    id BIGSERIAL PRIMARY KEY,
    session_id TEXT,
    content TEXT,
    importance FLOAT,
    access_count INT DEFAULT 0,
    created_at TIMESTAMP,
    last_accessed TIMESTAMP
);

-- 语义记忆
CREATE TABLE semantic_memory (
    id BIGSERIAL PRIMARY KEY,
    content TEXT,
    importance FLOAT,
    access_count INT DEFAULT 0,
    created_at TIMESTAMP,
    superseded_by BIGINT  -- 冲突时被替代的旧记忆
);

-- 反思记忆
CREATE TABLE reflection_memory (
    id BIGSERIAL PRIMARY KEY,
    summary TEXT,
    importance FLOAT DEFAULT 0.9,
    created_at TIMESTAMP
);

-- 向量嵌入
CREATE TABLE memory_embeddings (
    memory_id BIGINT,
    memory_type TEXT,  -- 'episodic' | 'semantic' | 'reflection'
    embedding vector(1024),
    created_at TIMESTAMP
);

-- HNSW 索引
CREATE INDEX idx_memory_embedding
ON memory_embeddings
USING hnsw (embedding vector_cosine_ops);
```

### Qdrant

```typescript
// Collection: episodic_memories
// Collection: semantic_memories
// Collection: reflection_memories

// Payload 结构
{
  content: string,
  importance: number,
  access_count: number,
  session_id?: string,
  created_at: string,
  memory_type: 'episodic' | 'semantic' | 'reflection'
}

// 向量维度：1024 (BGE-M3)
```

---

## ⚙️ 配置详解

### PostgreSQL 配置

```json
{
  "plugins": {
    "slots": {
      "memory": "openclaw-memory"
    },
    "openclaw-memory": {
      "backend": "pgvector",
      "database": {
        "host": "localhost",
        "port": 5432,
        "database": "openclaw_memory",
        "user": "liufei",
        "password": ""
      },
      "embedding": {
        "endpoint": "http://localhost:8080"
      }
    }
  }
}
```

### Qdrant 配置

```json
{
  "plugins": {
    "slots": {
      "memory": "openclaw-memory"
    },
    "openclaw-memory": {
      "backend": "qdrant",
      "qdrant": {
        "url": "http://localhost:6333",
        "apiKey": ""  // 可选
      },
      "embedding": {
        "endpoint": "http://localhost:8080"
      }
    }
  }
}
```

### 配置参数说明

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `backend` | string | `pgvector` | 后端类型：`pgvector` 或 `qdrant` |
| `database.host` | string | `localhost` | PostgreSQL 主机 |
| `database.port` | number | `5432` | PostgreSQL 端口 |
| `database.database` | string | `openclaw_memory` | 数据库名 |
| `database.user` | string | - | 数据库用户 |
| `database.password` | string | `""` | 数据库密码 |
| `qdrant.url` | string | `http://localhost:6333` | Qdrant 地址 |
| `qdrant.apiKey` | string | `""` | Qdrant API 密钥 |
| `embedding.endpoint` | string | `http://localhost:8080` | Embedding 服务地址 |

---

## 📦 模块说明

### MemoryFilter

**职责：** 消息分类

**输入：** 用户消息文本

**输出：**
```typescript
{
  category: 'TRIVIAL' | 'FACT' | 'PREFERENCE' | 'EVENT' | 'QUESTION',
  shouldStore: boolean,
  memoryType?: 'episodic' | 'semantic',
  importance: number
}
```

**实现：** 调用 Llama-3.2-1B (8081) 进行零样本分类

### MemoryManager

**职责：** 记忆 CRUD 操作

**接口：**
```typescript
interface MemoryManager {
  storeMemory(sessionId: string, content: string, importance: number): Promise<void>
  storeSemantic(content: string, importance: number, sessionId?: string): Promise<void>
  storeReflection(summary: string, importance: number, sessionId?: string): Promise<void>
  retrieveRelevant(query: string, sessionId?: string, topK?: number, threshold?: number): Promise<Memory[]>
  runMaintenance(): Promise<MaintenanceResult>
  shutdown(): Promise<void>
}
```

### PreferenceExtractor

**职责：** 从对话中提取用户偏好

**输入：** 对话数组（10 条）

**输出：**
```typescript
{
  likes: string[],
  dislikes: string[],
  facts: string[],
  habits: string[]
}
```

### Summarizer

**职责：** 生成对话摘要

**输入：** 对话数组（10 条）

**输出：**
```typescript
{
  summary: string,
  keyPoints: string[]
}
```

### Reranker

**职责：** 对检索结果重排序

**实现：** 调用 LLM 进行交叉编码重排序

### Clusterer

**职责：** 聚类相似记忆

**触发：** 空闲时自动执行

### LLMLimiter

**职责：** LLM 调用限流

**配置：**
```typescript
{
  maxConcurrent: 2,    // 最大并发
  minInterval: 100,    // 最小间隔 (ms)
  queueLimit: 50       // 队列上限
}
```

---

## 🔍 性能指标

| 操作 | P50 | P95 | P99 |
|------|-----|-----|-----|
| 消息分类 | 200ms | 400ms | 600ms |
| 记忆检索 | 50ms | 150ms | 300ms |
| 偏好提取 | 800ms | 1200ms | 1500ms |
| 对话摘要 | 800ms | 1200ms | 1500ms |
| 重排序 | 300ms | 500ms | 800ms |

### 资源消耗

| 组件 | 内存 | CPU |
|------|------|-----|
| 插件进程 | ~50MB | 低 |
| BGE-M3 (8080) | ~500MB | 中（推理时） |
| Llama-3.2-1B (8081) | ~1GB | 中（推理时） |
| PostgreSQL | ~100MB | 低 |
| Qdrant | ~200MB | 低 |

---

## 🛡️ 容错机制

### 超时保护

```typescript
// before_prompt_build Hook: 1000ms 超时
const memories = await Promise.race([
  mm.retrieveRelevant(query),
  new Promise((_, reject) => 
    setTimeout(() => reject('timeout'), 1000)
  )
])
```

### 降级策略

| 故障场景 | 降级行为 |
|----------|----------|
| Embedding 服务不可用 | 记录错误，跳过存储 |
| 向量数据库不可用 | 记录错误，仅写入本地 Markdown |
| LLM 服务不可用 | 使用简单关键词分类 |
| Hook 超时 | 不注入记忆，正常响应 |

### 重试机制

```typescript
// 数据库操作：最多重试 3 次
async function withRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn()
    } catch (e) {
      if (i === maxRetries - 1) throw e
      await sleep(100 * (i + 1))  // 指数退避
    }
  }
}
```

---

## 📝 本地 Markdown 备份

**目的：** 兼容 self-improving-agent 等基于文件的记忆系统

**路径：** `~/.openclaw/workspace/memory/YYYY-MM-DD.md`

**格式：**
```markdown
# 2026-03-15

## 日志

- 2026-03-15T10:30:00Z: [FACT] 用户是程序员
- 2026-03-15T10:35:00Z: [PREFERENCE-LIKE] 用户喜欢 TypeScript
- 2026-03-15T10:40:00Z: [EVENT] 用户今天完成了项目
- 2026-03-15T10:45:00Z: [REFLECTION] 用户本周工作效率很高
```

**同步时机：** 每次存储记忆时同步写入

---

## 🧪 测试

### 单元测试

```bash
npm run test:features    # 功能测试
npm run test:recall      # 召回率测试
npm run test:conflict    # 冲突检测测试
npm run test:qdrant      # Qdrant 后端测试
```

### 手动测试

```bash
# CLI 工具
node dist/memory-cli.ts store "测试记忆" --type=semantic --importance=0.8
node dist/memory-cli.ts search "测试" --top-k=5
node dist/memory-cli.ts stats
```

---

## 🔮 未来规划

| 版本 | 特性 |
|------|------|
| v2.2 | 记忆可视化界面 |
| v2.3 | 多模态记忆（图片/音频） |
| v2.4 | 分布式记忆同步 |
| v3.0 | 记忆图谱（知识图谱） |

---

<div align="center">

**最后更新：** 2026-03-15  
**版本：** 2.1.0

</div>

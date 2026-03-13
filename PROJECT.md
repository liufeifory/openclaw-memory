# OpenClaw Memory Plugin - 项目文档

## 项目概述

一个生产级的长期记忆系统插件，为 OpenClaw 提供语义记忆检索功能。

**核心功能：**
- 语义记忆检索（向量相似度搜索）
- 动态重要性评分
- 自动记忆提升（episodic → semantic）
- 自动反思生成
- 记忆衰减机制

## 系统架构

```
┌─────────────────────────────────────────────────────────────────┐
│                        OpenClaw 主程序                           │
│  ┌─────────────────┐                                           │
│  │ memory_search   │──────────┐                                │
│  │ 工具调用         │          │                                │
│  └─────────────────┘          │                                │
└───────────────────────────────┼────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Node.js 插件层 (dist/index.js)                │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  HTTP Client (fetch) - 调用 Python 记忆服务               │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                                │
                                │ HTTP/JSON (port 8082)
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Python 记忆服务 (memory_server.py)             │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────────────────┐   │
│  │ MemoryMgr   │ │ Embedding   │ │ Maintenance             │   │
│  │ 记忆管理     │ │ llama.cpp   │ │ 衰减/提升/反思           │   │
│  └─────────────┘ └─────────────┘ └─────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                                │
                                │ psycopg2
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                  PostgreSQL + pgvector                          │
│  ┌────────────────┬────────────────┬────────────────────┐      │
│  │ episodic_memory│ semantic_memory│ reflection_memory  │      │
│  │ 情景记忆       │ 语义记忆        │ 反思记忆            │      │
│  └────────────────┴────────────────┴────────────────────┘      │
│  ┌────────────────────────────────────────────────────────┐    │
│  │ memory_embeddings (vector(1024))                       │    │
│  │ HNSW 索引                                               │    │
│  └────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

## 记忆类型

| 类型 | 表名 | 说明 | 重要性 | 提升条件 |
|------|------|------|--------|----------|
| **Episodic** | episodic_memory | 事件、对话、经历 | 动态 | access_count > 10 → Semantic |
| **Semantic** | semantic_memory | 稳定知识、事实 | 较高 | - |
| **Reflection** | reflection_memory | 总结的洞察 | 0.9 (固定) | 每 50 条 episodic 自动生成 |

## 核心算法

### 重要性计算公式

```
importance = 0.5 × base_importance
           + 0.3 × log(access_count + 1)
           + 0.2 × exp(-days_since_creation / 30)
```

### 记忆检索流程

1. 将查询文本转换为 embedding（1024 维向量）
2. 使用 pgvector 进行 HNSW 向量相似度搜索
3. 过滤低于阈值（0.6）的结果
4. 按 `similarity × importance` 排序
5. 返回 top 5 结果

### 记忆维护

- **每日衰减**：`importance *= 0.98`
- **自动提升**：access_count > 10 时复制到 semantic_memory
- **反思生成**：每 50 条 episodic memories 生成一条反思

## 数据库 Schema

```sql
-- 情景记忆（事件、对话）
CREATE TABLE episodic_memory (
    id BIGSERIAL PRIMARY KEY,
    session_id TEXT,
    content TEXT,
    importance FLOAT,
    access_count INT DEFAULT 0,
    created_at TIMESTAMP,
    last_accessed TIMESTAMP
);

-- 语义记忆（稳定知识）
CREATE TABLE semantic_memory (
    id BIGSERIAL PRIMARY KEY,
    content TEXT,
    importance FLOAT,
    access_count INT DEFAULT 0,
    created_at TIMESTAMP
);

-- 反思记忆（自动生成的洞察）
CREATE TABLE reflection_memory (
    id BIGSERIAL PRIMARY KEY,
    summary TEXT,
    importance FLOAT,
    created_at TIMESTAMP
);

-- 向量索引（使用 pgvector）
CREATE TABLE memory_embeddings (
    memory_id BIGINT,
    memory_type TEXT,
    embedding vector(1024),
    created_at TIMESTAMP
);

-- HNSW 索引用于快速近似最近邻搜索
CREATE INDEX idx_memory_embedding
ON memory_embeddings
USING hnsw (embedding vector_cosine_ops);
```

## API 参考

### HTTP 服务 (Python)

**端点：** `http://localhost:8082`

#### POST /memory/search
搜索记忆。

```json
// 请求
{
  "query": "用户编程经验",
  "top_k": 10,
  "threshold": 0.6
}

// 响应
{
  "query": "用户编程经验",
  "count": 3,
  "memories": [
    {
      "type": "episodic",
      "content": "用户今天学习了 Python 装饰器",
      "importance": 0.75,
      "similarity": 0.85
    }
  ]
}
```

#### POST /memory/store
存储记忆。

```json
// 请求
{
  "session_id": "session-123",
  "content": "用户想学习 Rust",
  "importance": 0.6
}
```

#### GET /memory/stats
获取统计信息。

#### POST /memory/maintenance
运行维护任务。

### OpenClaw 工具 (Node.js)

**工具名：** `memory_search`

```typescript
// 使用示例
const result = await memory_search({
  query: "用户之前说过什么关于 Python 的事？",
  top_k: 5
});
```

## 部署说明

### 环境要求

- PostgreSQL 14+ with pgvector
- Python 3.9+
- Node.js 18+
- llama.cpp (可选，用于本地 embedding)

### 安装步骤

1. **安装 PostgreSQL 扩展**
```bash
psql -d openclaw_memory -c "CREATE EXTENSION vector;"
psql -d openclaw_memory -f schema.sql
```

2. **启动 Embedding 服务**（使用 llama.cpp）
```bash
llama-server \
  --hf-repo lm-kit/bge-m3-gguf \
  --hf-file bge-m3-Q8_0.gguf \
  -c 8192 \
  --embedding \
  --port 8080
```

3. **启动 Python 记忆服务**
```bash
cd /path/to/openclaw-memory
MEMORY_DB_HOST=localhost \
MEMORY_DB_NAME=openclaw_memory \
MEMORY_DB_USER=liufei \
MEMORY_DB_PASS="" \
python3 memory_server.py --port 8082
```

4. **安装 OpenClaw 插件**
```bash
openclaw plugins install /path/to/openclaw-memory
```

5. **配置 openclaw.json**
```json
{
  "plugins": {
    "slots": {
      "memory": "openclaw-memory"
    }
  }
}
```

### 快速启动

```bash
# 使用启动脚本
./start.sh

# 或手动启动
# 1. 启动 llama.cpp embedding 服务
llama-server --hf-repo lm-kit/bge-m3-gguf --embedding --port 8080 &

# 2. 启动记忆服务
python3 memory_server.py --port 8082
```

### 测试

```bash
# 运行测试脚本
python3 test_memory.py

# 或使用 curl 手动测试
# 健康检查
curl http://localhost:8082/health

# 存储记忆
curl -X POST http://localhost:8082/memory/store \
  -H "Content-Type: application/json" \
  -d '{"session_id":"test","content":"用户想学习 Rust","importance":0.7}'

# 搜索记忆
curl -X POST http://localhost:8082/memory/search \
  -H "Content-Type: application/json" \
  -d '{"query":"用户想学什么语言","top_k":5,"threshold":0.5}'
```

### 配置文件

**memory_server.py 环境变量：**
```bash
MEMORY_DB_HOST=localhost
MEMORY_DB_PORT=5432
MEMORY_DB_NAME=openclaw_memory
MEMORY_DB_USER=liufei        # 改为你的 PostgreSQL 用户名
MEMORY_DB_PASS=""            # 如果没有密码
```

**快速配置方法：**
```bash
# 1. 查看当前 PostgreSQL 用户
psql -c "\\du"

# 2. 如果没有合适的用户，创建新用户
psql -c "CREATE USER openclaw WITH SUPERUSER;"

# 3. 创建数据库
psql -c "CREATE DATABASE openclaw_memory OWNER openclaw;"

# 4. 启动服务
cd /Users/liufei/.openclaw/plugins/openclaw-memory
python3 memory_server.py --port 8082
```

**embedding_model.py 配置：**
```python
# 使用本地 llama.cpp
endpoint = "http://127.0.0.1:8080/embedding"

# 或使用 DashScope API
api_key = "sk-xxx"
model = "text-embedding-v2"
```

## 商业化建议

### 产品定位

**目标用户：** AI 应用开发者、需要长期记忆的场景

**核心价值：**
- 语义检索（不是关键词匹配）
- 自动记忆管理（衰减、提升、反思）
- 可扩展架构（支持多种 embedding 服务）

### 可售卖版本

| 版本 | 功能 | 定价建议 |
|------|------|----------|
| **社区版** | 基础记忆检索、单用户 | 免费 |
| **专业版** | 多用户、多会话、统计 API | $99/月 |
| **企业版** | 集群部署、自定义模型、SLA | 联系销售 |

### Node.js 重写优先级

如果要商业化，建议用 TypeScript 重写以下模块：

1. **memory_server.py** → Node.js HTTP 服务
2. **embedding_model.py** → Node.js embedding 客户端
3. **memory_manager.py** → Node.js 记忆管理
4. **memory_maintenance.py** → Node.js 定时任务

### 重写技术栈建议

```json
{
  "dependencies": {
    "pg": "^8.11.0",
    "@xenova/transformers": "^2.14.0",
    "node-fetch": "^3.3.0",
    "express": "^4.18.0"
  }
}
```

**Embedding 选项：**
- 本地：`@xenova/transformers` (BGE-M3)
- API：DashScope / OpenAI

## 项目文件结构

```
openclaw-memory/
├── package.json              # NPM 包配置
├── openclaw.plugin.json      # OpenClaw 插件配置
├── dist/
│   └── index.js              # Node.js 插件入口
├── schema.sql                # 数据库 Schema
├── database.py               # 数据库连接
├── embedding_model.py        # Embedding 生成
├── vector_store.py           # 向量搜索
├── episodic_memory.py        # 情景记忆存储
├── semantic_memory.py        # 语义记忆存储
├── reflection_memory.py      # 反思记忆存储
├── importance_learning.py    # 重要性计算
├── context_builder.py        # 上下文构建
├── memory_maintenance.py     # 记忆维护
├── memory_manager.py         # 记忆管理器
├── memory_server.py          # HTTP 服务
├── retrieval_pipeline.py     # 检索流程
├── plugin.py                 # Python 插件入口
├── scripts/
│   └── search.py             # 命令行搜索工具
├── USAGE.md                  # 使用指南
├── INTEGRATION.md            # 集成文档
└── README.md                 # 项目说明
```

## 许可证建议

- **社区版：** MIT License（吸引用户）
- **商业版：** 商业许可证（限制企业使用）

## 联系方式

如需商业化合作，请联系项目作者。

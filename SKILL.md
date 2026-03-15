---
name: openclaw-memory
description: "Production-grade long-term memory system with semantic search, auto-storage, and auto-retrieval. Supports PostgreSQL (pgvector) and Qdrant backends."
metadata:
  {
    "openclaw": {
      "emoji": "🧠",
      "kind": "memory",
      "requires": {
        "config": ["database"]
      }
    },
  }
allowed-tools: ["bash"]
---

# OpenClaw Memory Plugin

基于向量数据库的长期记忆系统，**自动存储**和**自动检索**用户记忆。

## 自动功能

### 1. 自动记忆存储 (message_received Hook)

所有用户消息自动分类并存储：

```
用户消息 → MemoryFilter (LLM 分类) → MemoryManager → 向量数据库
```

**消息分类：**

| 分类 | 示例 | 是否存储 | 记忆类型 |
|------|------|----------|----------|
| TRIVIAL | "你好"、"谢谢" | ❌ | - |
| FACT | "我是程序员" | ✅ | semantic |
| PREFERENCE | "我喜欢 Python" | ✅ | semantic |
| EVENT | "今天去了星巴克" | ✅ | episodic |
| QUESTION | "什么是 AI？" | ❌ | - |

### 2. 自动上下文注入 (before_prompt_build Hook)

每次 Agent 响应前自动注入相关记忆：

```
用户消息 → 向量检索 (top_k=3, threshold=0.65) → 注入 prompt → Agent 响应
```

**注入格式：**

```
--- Relevant Memories ---
[SEMANTIC] (sim: 0.923, imp: 0.80) 用户经常使用 TypeScript
[EPISODIC] (sim: 0.856, imp: 0.65) 用户昨天安装了 PostgreSQL
--- End Memories ---
```

**超时保护：** 1000ms（避免阻塞 Agent 响应）

### 3. 偏好提取（每 10 条消息）

自动从对话中提取用户偏好：

- **likes** - 喜欢的事物
- **dislikes** - 不喜欢的事物
- **facts** - 用户事实
- **habits** - 用户习惯

提取结果存储为 **semantic 记忆**。

### 4. 对话摘要（每 10 条消息）

自动生成对话摘要，存储为 **reflection 记忆**（importance=0.9）。

## 配置

### PostgreSQL (pgvector) 配置

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
        "url": "http://localhost:6333"
      },
      "embedding": {
        "endpoint": "http://localhost:8080"
      }
    }
  }
}
```

## 手动检索

使用 `memory_search` 工具手动检索记忆：

```json
{
  "query": "用户之前说过什么关于 Python 的事",
  "top_k": 5,
  "threshold": 0.6
}
```

## 记忆类型

| 类型 | 说明 | 重要性 | 存储方式 |
|------|------|--------|----------|
| **Episodic** | 事件、对话 | 0.5-0.8 | 自动存储 |
| **Semantic** | 用户偏好、事实 | 0.7-0.9 | 自动存储 + 冲突检测 |
| **Reflection** | 摘要、洞察 | 0.9 | 每 10 条自动生成 |

## CLI 工具

使用 CLI 手动管理记忆：

```bash
# 存储记忆
node dist/memory-cli.ts store "用户喜欢 TypeScript" \
  --type=semantic --importance=0.8

# 搜索记忆
node dist/memory-cli.ts search "编程语言偏好" --top-k=3

# 列出所有记忆
node dist/memory-cli.ts list --limit=10

# 查看统计
node dist/memory-cli.ts stats

# 删除记忆
node dist/memory-cli.ts delete <id>

# 清空所有记忆
node dist/memory-cli.ts clear
```

## 输出格式

`memory_search` 工具返回：

```json
{
  "memories": [
    {
      "type": "semantic",
      "content": "用户经常使用 TypeScript",
      "importance": 0.8,
      "similarity": 0.92,
      "created_at": "2025-03-14T10:30:00Z"
    }
  ],
  "count": 1
}
```

## 记忆生命周期

```
1. 存储 → 2. 检索 → 3. 时间衰减 → 4. 冲突检测 → 5. 聚类
```

- **时间衰减**: 每日自动执行 `importance *= 0.98`
- **冲突检测**: semantic 记忆相似度 > 0.85 时触发
- **记忆提升**: access_count > 10 时 episodic → semantic

## Hook 说明

| Hook | 类型 | 返回值 | 说明 |
|------|------|--------|------|
| `message_received` | 异步非阻塞 | void | 后台存储消息（仅渠道模式） |
| `before_prompt_build` | 同步阻塞 | `{ prependContext }` | 注入记忆上下文（所有模式） |

### before_prompt_build 超时保护

```typescript
// 1000ms 超时，避免阻塞 Agent 响应
Promise.race([
  mm.retrieveRelevant(query, sessionId, 3, 0.65),
  setTimeout(() => reject(new Error('timeout')), 1000)
])
```

如果超时：
- 记录 warning 日志
- 不注入上下文
- Agent 正常响应

## 外部服务依赖

| 服务 | 端口 | 用途 |
|------|------|------|
| PostgreSQL / Qdrant | 5432 / 6333 | 向量数据库 |
| llama.cpp (Embedding) | 8080 | BGE-M3 向量生成 (1024 维) |
| llama.cpp (LLM) | 8081 | Llama-3.2-1B 分类/提取/摘要 |

## 故障排除

**没有自动注入记忆：**

1. 检查数据库是否运行：`curl http://localhost:6333` 或 `pg_isready`
2. 检查 embedding 服务：`curl http://localhost:8080/embedding -d '{"input":"test"}'`
3. 查看日志：`tail -f ~/.openclaw/logs/gateway.log | grep memory`

**检索结果不相关：**

1. 降低阈值：`threshold: 0.5`
2. 增加检索数量：`top_k: 10`

**Hook 超时警告：**

- 正常现象，说明检索超过 1000ms
- Agent 响应不受影响
- 如频繁出现，可增加 `timeout_ms` 配置

## 脚本

| 脚本 | 用途 |
|------|------|
| `dist/memory-cli.ts` | CLI 记忆管理 |
| `dist/test-qdrant.js` | Qdrant 功能测试 |
| `dist/test-features.js` | 特性测试 |
| `dist/profile.js` | 性能分析 |
| `dist/migrate.ts` | 数据库迁移 |

## 本地备份

系统同步写入本地 Markdown 文件：

**路径：** `~/.openclaw/workspace/memory/YYYY-MM-DD.md`

**格式：**

```markdown
# 2026-03-15

## 日志

- 2026-03-15T10:30:00Z: [FACT] 用户是程序员
- 2026-03-15T10:35:00Z: [PREFERENCE-LIKE] 用户喜欢 TypeScript
```

## 相关文档

- [README.md](README.md) - 快速开始
- [USAGE.md](USAGE.md) - 使用指南
- [ARCHITECTURE.md](ARCHITECTURE.md) - 架构说明
- [CONFIG.md](CONFIG.md) - 配置详解

# OpenClaw Memory Plugin - Agent 使用说明

## 概述

OpenClaw Memory 是一个**全自动**的长期记忆系统，基于 Qdrant 向量数据库。

**核心特性：**
- ✅ 自动存储用户消息
- ✅ 自动注入相关记忆到上下文
- ✅ 自动提取用户偏好
- ✅ 自动生成对话摘要

## 自动功能（无需 Agent 干预）

### 1. 自动记忆存储

每当用户发送消息时，系统自动：

```
用户消息 → MemoryFilter 分类 → 存储到 Qdrant
```

| 消息类型 | 分类 | 是否存储 | 记忆类型 |
|----------|------|----------|----------|
| "你好"、"谢谢" | TRIVIAL | ❌ | - |
| "我经常用 Python" | FACT | ✅ | semantic |
| "我喜欢红色" | PREFERENCE | ✅ | semantic |
| "今天去了星巴克" | EVENT | ✅ | episodic |
| "什么是向量数据库？" | QUESTION | ❌ | - |

### 2. 自动上下文注入

每次 Agent 响应前，系统自动：

```
before_prompt_build Hook
    ↓
检索与用户消息相关的记忆 (top 3, 相似度>0.65)
    ↓
注入到 prompt: "--- Relevant Memories ---\n..."
    ↓
Agent 看到记忆上下文后响应
```

**注入的上下文格式：**
```
--- Relevant Memories ---
[SEMANTIC] (sim: 0.923, imp: 0.80) 用户经常使用 TypeScript
[EPISODIC] (sim: 0.856, imp: 0.65) 用户昨天安装了 PostgreSQL
--- End Memories ---
```

### 3. 偏好提取（每 10 条消息）

自动从对话中提取：
- 用户喜欢的事物 (likes)
- 用户不喜欢的事物 (dislikes)
- 用户事实 (work, location, skills)
- 用户习惯 (habits)

提取的偏好自动存储为 semantic 记忆。

### 4. 对话摘要（每 10 条消息）

自动生成对话摘要，存储为 reflection 记忆（重要性 0.9）。

## 手动检索（可选）

如果需要主动检索记忆，使用 `memory_search` 工具：

### 工具参数

```json
{
  "name": "memory_search",
  "description": "Search long-term memory using semantic similarity",
  "parameters": {
    "type": "object",
    "properties": {
      "query": { "type": "string", "description": "Search query" },
      "top_k": { "type": "number", "default": 5, "description": "Number of results" },
      "threshold": { "type": "number", "default": 0.6, "description": "Similarity threshold" }
    },
    "required": ["query"]
  }
}
```

### 使用示例

**示例 1：检索用户编程经验**
```json
{
  "query": "用户的编程语言经验和偏好",
  "top_k": 5,
  "threshold": 0.6
}
```

**示例 2：检索过去的对话**
```json
{
  "query": "关于数据库设计的讨论",
  "top_k": 3,
  "threshold": 0.7
}
```

**示例 3：检索用户项目信息**
```json
{
  "query": "用户正在开发的项目",
  "top_k": 5,
  "threshold": 0.6
}
```

### 返回格式

```json
{
  "memories": [
    {
      "type": "semantic",
      "content": "用户经常使用 TypeScript 和 Node.js 开发",
      "importance": 0.8,
      "similarity": 0.92,
      "created_at": "2025-03-14T10:30:00Z"
    },
    {
      "type": "episodic",
      "content": "用户昨天部署了 PostgreSQL 数据库",
      "importance": 0.65,
      "similarity": 0.78,
      "created_at": "2025-03-13T15:20:00Z"
    }
  ],
  "count": 2
}
```

## CLI 工具（开发者使用）

```bash
# 存储记忆
node dist/memory-cli.ts store "用户喜欢 TypeScript" --type=semantic --importance=0.8

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

## Hook 行为说明

### message_received Hook

- **类型**: 异步非阻塞
- **返回值**: void
- **行为**: 消息立即显示给用户，记忆在后台存储
- **失败处理**: 记录错误日志，不影响对话

### before_prompt_build Hook

- **类型**: 同步阻塞（会等待）
- **返回值**: `{ prependContext?: string }`
- **超时**: 300ms
- **行为**:
  - 成功：注入记忆上下文到 prompt
  - 超时/失败：不注入，Agent 正常响应
- **日志**: 超时记录 warning，错误记录 error

## 性能特性

| 指标 | 值 | 说明 |
|------|-----|------|
| 记忆检索延迟 | ~50-150ms | 向量相似度搜索 |
| 超时阈值 | 300ms | 避免阻塞 Agent |
| 注入记忆数 | 最多 3 条 | 控制 token 消耗 |
| 相似度阈值 | 0.65 | 只注入高相关记忆 |

## 记忆类型详解

| 类型 | 重要性范围 | 衰减 | 说明 |
|------|-----------|------|------|
| Episodic | 0.5-0.8 | 每日 ×0.98 | 具体事件和对话 |
| Semantic | 0.7-0.9 | 每日 ×0.98 | 用户偏好和事实（带冲突检测） |
| Reflection | 0.9 | 无衰减 | 自动生成的摘要和洞察 |

## 冲突检测

semantic 记忆存储时会检查冲突：

1. 搜索相似记忆（相似度 > 0.85）
2. 如果有冲突：
   - 比较新旧记忆的重要性
   - 新记忆更重要 → 标记旧记忆为 superseded
   - 旧记忆更重要 → 跳过存储
3. 无冲突 → 直接存储

## 最佳实践

1. **信任自动注入**: Agent 响应前会自动看到相关记忆
2. **需要精确检索时使用工具**: memory_search 工具可以指定 query 和阈值
3. **注意记忆类型**:
   - episodic = 具体事件
   - semantic = 稳定知识
   - reflection = 摘要洞察

## 故障排除

| 问题 | 检查 | 解决 |
|------|------|------|
| 没有自动注入 | 检查 Qdrant 和 embedding 服务 | `./deploy.sh status` |
| 检索结果不相关 | 检查相似度阈值 | 降低 threshold 或增加 top_k |
| Hook 超时警告 | 检查日志 | 正常现象，不影响功能 |

## 服务依赖

| 服务 | 端口 | 检查命令 |
|------|------|----------|
| Qdrant | 6333 | `curl http://localhost:6333` |
| Embedding (BGE-M3) | 8080 | `curl http://localhost:8080/embedding -d '{"input":"test"}'` |
| LLM (Llama-3.2-1B) | 8081 | `curl http://localhost:8081/completion -d '{"prompt":"hi"}'` |

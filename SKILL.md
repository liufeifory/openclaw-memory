---
name: openclaw-memory
description: "Qdrant-based long-term memory with automatic storage and retrieval. Auto-stores user messages, auto-injects relevant memories into context. Use for: (1) automatic context injection, (2) semantic memory retrieval, (3) user preference extraction, (4) conversation summarization."
metadata:
  {
    "openclaw": {
      "emoji": "🧠",
      "kind": "memory",
      "requires": { "config": ["qdrant.url"] }
    },
  }
allowed-tools: ["bash"]
---

# Memory System (Auto Storage + Retrieval)

基于 Qdrant 向量数据库的长期记忆系统，**自动存储**和**自动检索**用户记忆。

## 自动功能

### 1. 自动记忆存储 (message_received Hook)

所有用户消息自动处理：

```
用户消息 → 分类 → 存储到 Qdrant
```

- **TRIVIAL** (问候、感谢): 不存储
- **FACT/PREFERENCE** (用户事实、偏好): 存储为 semantic 记忆
- **EVENT** (事件、经历): 存储为 episodic 记忆
- **QUESTION** (问题): 不存储

### 2. 自动上下文注入 (before_prompt_build Hook)

每次 Agent 响应前自动注入相关记忆：

```
用户消息 → 检索相关记忆 → 注入到 prompt → Agent 响应
```

- 检索 top 3 条相关记忆
- 相似度阈值 > 0.65
- 超时 300ms (避免阻塞)

### 3. 偏好提取 (每 10 条消息)

自动从对话中提取用户偏好：
- likes (喜欢的事物)
- dislikes (不喜欢的事物)
- facts (用户事实)
- habits (用户习惯)

### 4. 对话摘要 (每 10 条消息)

自动生成对话摘要，存储为 reflection 记忆。

## 配置

### Qdrant 配置 (推荐)

```yaml
plugins:
  slots:
    memory: "openclaw-memory"
  plugins:
    openclaw-memory:
      backend: "qdrant"
      qdrant:
        url: "http://localhost:6333"
      embedding:
        endpoint: "http://localhost:8080"
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

## 输出格式

memory_search 工具返回：
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
- **聚类**: 空闲时自动聚类相似记忆

## Hook 说明

| Hook | 类型 | 返回值 | 说明 |
|------|------|--------|------|
| `message_received` | 异步非阻塞 | void | 后台存储消息 |
| `before_prompt_build` | 同步阻塞 | `{ prependContext }` | 注入记忆上下文 |

### before_prompt_build 超时保护

```typescript
// 300ms 超时，避免阻塞 Agent 响应
Promise.race([
  mm.retrieveRelevant(query, sessionId, 3, 0.65),
  setTimeout(() => reject(new Error('timeout')), 300)
])
```

如果超时：
- 记录 warning 日志
- 不注入上下文
- Agent 正常响应

## 外部服务依赖

| 服务 | 端口 | 用途 |
|------|------|------|
| Qdrant | 6333 | 向量数据库 |
| llama.cpp (Embedding) | 8080 | BGE-M3 向量生成 |
| llama.cpp (LLM) | 8081 | Llama-3.2-1B 重排序/摘要 |

## 故障排除

**没有自动注入记忆：**
1. 检查 Qdrant 是否运行：`curl http://localhost:6333`
2. 检查 embedding 服务：`curl http://localhost:8080/embedding -d '{"input":"test"}'`
3. 查看日志：`./deploy.sh logs`

**检索结果不相关：**
1. 降低阈值：`threshold: 0.5`
2. 增加检索数量：`top_k: 10`

**Hook 超时警告：**
- 正常现象，说明检索超过 300ms
- 记忆检索会在后台继续，下次请求时可能已有结果
- Agent 响应不受影响

## 脚本

| 脚本 | 用途 |
|------|------|
| `dist/memory-cli.ts` | CLI 记忆管理 |
| `dist/test-qdrant.js` | Qdrant 功能测试 |
| `dist/test-features.js` | 特性测试 |
| `dist/profile.js` | 性能分析 |

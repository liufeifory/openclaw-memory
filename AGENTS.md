# OpenClaw Memory Plugin - Agent 使用说明

> 🤖 为 AI Agent 提供长期记忆能力

---

## 🎯 核心功能

OpenClaw Memory 是一个**全自动**的长期记忆系统：

- ✅ **自动存储** - 用户消息自动分类并存储
- ✅ **自动注入** - 相关记忆自动注入到对话上下文
- ✅ **偏好提取** - 自动提取用户偏好和习惯
- ✅ **对话摘要** - 自动生成对话总结
- ✅ **语义检索** - 基于向量相似度的智能搜索

---

## 🔄 自动功能（无需 Agent 干预）

### 1. 自动记忆存储

每当用户发送消息时，系统自动处理：

```
用户消息 → MemoryFilter 分类 → 存储到向量数据库
```

**消息分类规则：**

| 消息类型 | 示例 | 是否存储 | 记忆类型 |
|----------|------|----------|----------|
| TRIVIAL | "你好"、"谢谢"、"再见" | ❌ | - |
| FACT | "我是程序员"、"我用 Mac" | ✅ | semantic |
| PREFERENCE | "我喜欢 Python"、"我讨厌早起" | ✅ | semantic |
| EVENT | "今天去了星巴克"、"刚完成项目" | ✅ | episodic |
| QUESTION | "什么是向量数据库？" | ❌ | - |

### 2. 自动上下文注入

每次 Agent 响应前，系统自动注入相关记忆：

```
用户消息 → 检索相关记忆 → 注入到 prompt → Agent 响应
```

**注入的上下文格式：**

```
--- Relevant Memories ---
[SEMANTIC] (sim: 0.923, imp: 0.80) 用户经常使用 TypeScript
[EPISODIC] (sim: 0.856, imp: 0.65) 用户昨天安装了 PostgreSQL
--- End Memories ---
```

**默认参数：**
- `top_k`: 3（最多注入 3 条记忆）
- `threshold`: 0.65（相似度阈值）
- `timeout_ms`: 1000（超时保护）

### 3. 偏好提取（每 10 条消息）

自动从对话中提取用户偏好：

```typescript
{
  likes: ["TypeScript", "咖啡", "跑步"],
  dislikes: ["早起", "堵车"],
  facts: ["用户是程序员", "用户用 Mac"],
  habits: ["每天早上喝咖啡", "每周跑步 3 次"]
}
```

提取的偏好自动存储为 **semantic 记忆**。

### 4. 对话摘要（每 10 条消息）

自动生成对话摘要，存储为 **reflection 记忆**（重要性 0.9）：

```
摘要示例：
"用户本周主要讨论了 OpenClaw 插件开发，
完成了记忆系统的设计和实现，对 TypeScript 表现出浓厚兴趣。"
```

---

## 🛠️ 手动检索（可选）

如果需要主动检索记忆，使用 `memory_search` 工具：

### 工具定义

```json
{
  "name": "memory_search",
  "description": "Search long-term memory using semantic similarity",
  "parameters": {
    "type": "object",
    "properties": {
      "query": {
        "type": "string",
        "description": "Search query"
      },
      "top_k": {
        "type": "number",
        "default": 5,
        "description": "Number of results"
      },
      "threshold": {
        "type": "number",
        "default": 0.6,
        "description": "Similarity threshold"
      },
      "session_id": {
        "type": "string",
        "description": "Session ID to filter memories"
      }
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

---

## 📊 记忆类型详解

| 类型 | 重要性范围 | 衰减 | 说明 | 存储条件 |
|------|-----------|------|------|----------|
| **Episodic** | 0.5-0.8 | 每日 ×0.98 | 具体事件和对话 | EVENT 类消息 |
| **Semantic** | 0.7-0.9 | 每日 ×0.98 | 用户偏好和事实 | FACT/PREFERENCE + 偏好提取 |
| **Reflection** | 0.9 (固定) | 无 | 自动生成的摘要和洞察 | 每 10 条消息生成 |

### 记忆生命周期

```
存储 → 检索（access_count++） → 时间衰减 → 冲突检测 → 聚类
                ↓
         access_count > 10?
                ↓
          提升为 Semantic
```

---

## 🔌 Hook 行为说明

### message_received Hook

**触发时机：** 渠道消息到达时（Telegram/WhatsApp/Discord 等）

| 属性 | 说明 |
|------|------|
| 类型 | 异步非阻塞 |
| 返回值 | void |
| 行为 | 消息立即显示给用户，记忆在后台存储 |
| 失败处理 | 记录错误日志，不影响对话 |

**注意：** TUI 模式下不触发此 Hook

### before_prompt_build Hook

**触发时机：** 每次构建 prompt 前（所有模式）

| 属性 | 说明 |
|------|------|
| 类型 | 同步阻塞（会等待） |
| 返回值 | `{ prependContext?: string }` |
| 超时 | 1000ms |
| 行为 | 成功则注入记忆上下文，超时/失败则不注入 |
| 日志 | 超时记录 warning，错误记录 error |

**超时保护代码：**

```typescript
Promise.race([
  mm.retrieveRelevant(query, sessionId, 3, 0.65),
  setTimeout(() => reject(new Error('timeout')), 1000)
])
```

---

## ⚡ 性能特性

| 指标 | 值 | 说明 |
|------|-----|------|
| 记忆检索延迟 | ~50-150ms | 向量相似度搜索 |
| 消息分类延迟 | ~200-400ms | LLM 调用 |
| 偏好提取延迟 | ~800-1200ms | LLM 调用（后台） |
| 对话摘要延迟 | ~800-1200ms | LLM 调用（后台） |
| 超时阈值 | 1000ms | 避免阻塞 Agent 响应 |
| 注入记忆数 | 最多 3 条 | 控制 token 消耗 |
| 相似度阈值 | 0.65 | 只注入高相关记忆 |

---

## 🧩 CLI 工具（开发者使用）

```bash
# 存储记忆
node dist/memory-cli.ts store "用户喜欢 TypeScript" \
  --type=semantic \
  --importance=0.8

# 搜索记忆
node dist/memory-cli.ts search "编程语言偏好" \
  --top-k=3 \
  --threshold=0.7

# 列出所有记忆
node dist/memory-cli.ts list --limit=10

# 查看统计
node dist/memory-cli.ts stats

# 删除记忆
node dist/memory-cli.ts delete <id>

# 清空所有记忆（危险！）
node dist/memory-cli.ts clear

# 导出记忆
node dist/memory-cli.ts export > backup.json

# 导入记忆
node dist/memory-cli.ts import < backup.json
```

---

## 🛡️ 冲突检测

Semantic 记忆存储时会检查冲突：

```typescript
// 1. 搜索相似记忆（相似度 > 0.85）
const similar = await searchSimilar(content, 0.85)

// 2. 如果有冲突
if (similar.length > 0) {
  // 比较新旧记忆的重要性
  if (newImportance > similar[0].importance) {
    // 新记忆更重要 → 标记旧记忆为 superseded
    await markSuperseded(similar[0].id)
    await storeNew()
  } else {
    // 旧记忆更重要 → 跳过存储
    return
  }
} else {
  // 无冲突 → 直接存储
  await storeNew()
}
```

---

## 📁 本地 Markdown 备份

系统同步写入本地 Markdown 文件，兼容其他工具：

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

---

## 💡 最佳实践

### 1. 信任自动注入

Agent 响应前会自动看到相关记忆，无需手动调用工具。

### 2. 需要精确检索时使用工具

`memory_search` 工具可以指定 query 和阈值，适合精确查询。

### 3. 注意记忆类型

- **episodic** = 具体事件（"今天去了星巴克"）
- **semantic** = 稳定知识（"用户喜欢咖啡"）
- **reflection** = 摘要洞察（"用户本周工作效率高"）

### 4. 调整阈值

- 如果检索结果不相关 → 提高 `threshold` 至 0.7
- 如果检索结果太少 → 降低 `threshold` 至 0.5

---

## 🐛 故障排查

| 问题 | 检查 | 解决 |
|------|------|------|
| 没有自动注入 | 检查向量数据库和 embedding 服务 | `./services.sh status` |
| 检索结果不相关 | 检查相似度阈值 | 降低 `threshold` 或增加 `top_k` |
| Hook 超时警告 | 检查日志 | 正常现象，不影响功能 |
| 记忆存储失败 | 检查数据库连接 | `curl http://localhost:8082/health` |

---

## 🔗 服务依赖

| 服务 | 端口 | 检查命令 |
|------|------|----------|
| Qdrant / PostgreSQL | 6333 / 5432 | `curl http://localhost:6333` 或 `pg_isready` |
| Embedding (BGE-M3) | 8080 | `curl http://localhost:8080/embedding -d '{"input":"test"}'` |
| LLM (Llama-3.2-1B) | 8081 | `curl http://localhost:8081` |
| Memory Server | 8082 | `curl http://localhost:8082/health` |

---

## 📚 相关文档

- [README.md](README.md) - 快速开始
- [USAGE.md](USAGE.md) - 使用指南
- [ARCHITECTURE.md](ARCHITECTURE.md) - 架构说明
- [CONFIG.md](CONFIG.md) - 配置详解

---

<div align="center">

**最后更新：** 2026-03-15  
**版本：** 2.1.0

</div>

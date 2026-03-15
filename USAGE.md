# OpenClaw Memory Plugin - 使用指南

> 📖 从零开始使用记忆系统

---

## 🚀 快速开始

### 5 分钟部署

```bash
# 1. 克隆插件
cd ~/.openclaw/plugins
git clone https://github.com/liufeifory/openclaw-memory.git
cd openclaw-memory

# 2. 安装依赖
npm install && npm run build

# 3. 启动服务（使用 launchd）
./services.sh start

# 4. 验证服务
curl http://localhost:8082/health
```

看到 `{"status":"ok"}` 即表示成功 ✅

---

## 📋 配置

### 方式一：使用 PostgreSQL（推荐）

**1. 创建数据库**

```bash
# 创建数据库
psql -c "CREATE DATABASE openclaw_memory OWNER liufei;"

# 启用 pgvector 扩展
psql -d openclaw_memory -c "CREATE EXTENSION vector;"

# 导入 Schema
psql -d openclaw_memory -f schema.sql
```

**2. 编辑 OpenClaw 配置**

编辑 `~/.openclaw/config.json`：

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

**3. 重启 OpenClaw**

```bash
openclaw restart
```

### 方式二：使用 Qdrant

**1. 启动 Qdrant**

```bash
# 使用 Docker
docker run -d -p 6333:6333 qdrant/qdrant

# 或使用二进制（macOS）
brew install qdrant
qdrant &
```

**2. 编辑配置**

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

**3. 重启 OpenClaw**

```bash
openclaw restart
```

---

## ✅ 验证安装

### 1. 检查服务状态

```bash
# 查看服务状态
./services.sh status

# 预期输出：
# ✓ llama-server (embedding) - running
# ✓ memory-server - running
```

### 2. 测试健康检查

```bash
curl http://localhost:8082/health
# 预期：{"status":"ok"}
```

### 3. 测试记忆存储

```bash
curl -X POST http://localhost:8082/memory/store \
  -H "Content-Type: application/json" \
  -d '{
    "session_id": "test",
    "content": "用户喜欢 TypeScript",
    "importance": 0.8
  }'
# 预期：{"id": 1, "success": true}
```

### 4. 测试记忆检索

```bash
curl -X POST http://localhost:8082/memory/search \
  -H "Content-Type: application/json" \
  -d '{
    "query": "编程语言偏好",
    "top_k": 5,
    "threshold": 0.6
  }'
# 预期：{"count": 1, "memories": [...]}
```

### 5. 在 OpenClaw 中测试

启动对话，问一个问题：

```
用户：我之前说过喜欢什么编程语言？
AI: 您之前提到喜欢 TypeScript。
```

---

## 🔧 服务管理

### 使用 services.sh（推荐）

```bash
./services.sh start     # 启动所有服务
./services.sh stop      # 停止所有服务
./services.sh restart   # 重启所有服务
./services.sh status    # 查看服务状态
./services.sh logs      # 查看实时日志
```

### 手动启动

```bash
# 1. 启动 Embedding 服务（BGE-M3）
llama-server \
  --hf-repo lm-kit/bge-m3-gguf \
  --hf-file bge-m3-Q8_0.gguf \
  --embedding \
  --port 8080 \
  --ctx-size 8192 &

# 2. 启动 LLM 服务（Llama-3.2-1B）
llama-server \
  --hf-repo bartowski/Llama-3.2-1B-Instruct-GGUF \
  --hf-file Llama-3.2-1B-Instruct-Q8_0.gguf \
  --port 8081 \
  --ctx-size 1024 \
  --n-gpu-layers 99 &

# 3. 启动记忆服务
cd ~/.openclaw/plugins/openclaw-memory
python3 memory_server.py --port 8082 &
```

---

## 📖 日常使用

### 自动功能（无需操作）

记忆系统全自动运行，无需手动干预：

1. **自动存储** - 用户消息自动分类并存储
2. **自动检索** - 每次对话自动注入相关记忆
3. **偏好提取** - 每 10 条消息自动提取用户偏好
4. **对话摘要** - 每 10 条消息自动生成摘要

### 手动检索（可选）

在对话中主动调用 `memory_search` 工具：

```
用户：@memory_search 查询="用户的项目经验" top_k=5
```

或在代码中使用：

```typescript
const result = await memory_search({
  query: "用户之前说过什么关于 Python 的事？",
  top_k: 5,
  threshold: 0.6
})

console.log(result.memories)
```

### 使用 CLI 工具

```bash
# 存储记忆
node dist/memory-cli.ts store "用户是程序员" \
  --type=semantic \
  --importance=0.8

# 搜索记忆
node dist/memory-cli.ts search "编程语言" \
  --top-k=5 \
  --threshold=0.6

# 列出所有记忆
node dist/memory-cli.ts list --limit=10

# 查看统计
node dist/memory-cli.ts stats

# 删除记忆
node dist/memory-cli.ts delete <id>

# 清空所有记忆（危险！）
node dist/memory-cli.ts clear
```

---

## ⚙️ 高级配置

### 调整检索参数

在配置中修改：

```json
{
  "plugins": {
    "openclaw-memory": {
      "retrieval": {
        "top_k": 5,          // 返回结果数量
        "threshold": 0.65,   // 相似度阈值
        "timeout_ms": 1000   // 检索超时
      }
    }
  }
}
```

**参数说明：**

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `top_k` | 5 | 返回的记忆数量 |
| `threshold` | 0.65 | 相似度阈值（0-1，越高越精确） |
| `timeout_ms` | 1000 | 检索超时（毫秒） |

### 调整重要性参数

```json
{
  "plugins": {
    "openclaw-memory": {
      "importance": {
        "decay_rate": 0.98,      // 每日衰减率
        "promotion_threshold": 10, // 提升所需的访问次数
        "reflection_interval": 10  // 生成摘要的消息间隔
      }
    }
  }
}
```

### 禁用自动功能

```json
{
  "plugins": {
    "openclaw-memory": {
      "auto_store": false,       // 禁用自动存储
      "auto_inject": false,      // 禁用自动注入
      "preference_extraction": false,  // 禁用偏好提取
      "summarization": false     // 禁用对话摘要
    }
  }
}
```

---

## 🐛 故障排查

### 问题 1：服务无法启动

**检查 PostgreSQL**

```bash
# 检查是否运行
pg_isready

# 检查 pgvector 扩展
psql -d openclaw_memory -c "\\dx" | grep vector
```

**解决方案：**

```bash
# 安装 pgvector
brew install pgvector

# 启用扩展
psql -d openclaw_memory -c "CREATE EXTENSION vector;"
```

### 问题 2：记忆检索结果为空

**可能原因：**

1. 记忆库为空（正常，开始使用后会有数据）
2. 阈值设置过高
3. Embedding 服务不可用

**检查 Embedding 服务：**

```bash
curl -X POST http://localhost:8080/embedding \
  -H "Content-Type: application/json" \
  -d '{"input":"test"}'
```

**解决方案：**

```bash
# 降低阈值
# 在配置中设置 threshold: 0.5

# 重启 Embedding 服务
pkill llama-server
./services.sh restart
```

### 问题 3：OpenClaw 不加载插件

**检查插件状态：**

```bash
openclaw plugins list
```

**查看日志：**

```bash
tail -f ~/.openclaw/logs/gateway.log
```

**解决方案：**

```bash
# 检查配置语法
cat ~/.openclaw/config.json | python3 -m json.tool

# 重启 OpenClaw
openclaw restart
```

### 问题 4：Hook 超时警告

**日志示例：**

```
[openclaw-memory] before_prompt_build hook timeout (>1000 ms)
```

**原因：** 记忆检索超过 1000ms

**解决方案：**

1. 正常现象，不影响功能
2. 如频繁出现，可增加超时时间：

```json
{
  "plugins": {
    "openclaw-memory": {
      "retrieval": {
        "timeout_ms": 2000
      }
    }
  }
}
```

### 问题 5：LLM 服务不可用

**检查 LLM 服务：**

```bash
curl http://localhost:8081
```

**解决方案：**

```bash
# 重启 LLM 服务
pkill -f "llama-server.*8081"

llama-server \
  --hf-repo bartowski/Llama-3.2-1B-Instruct-GGUF \
  --port 8081 \
  --ctx-size 1024 &
```

---

## 📊 监控与维护

### 查看记忆统计

```bash
# CLI 工具
node dist/memory-cli.ts stats

# 输出示例：
# Episodic memories: 150
# Semantic memories: 45
# Reflection memories: 8
# Total: 203
```

### 运行维护任务

```bash
# 手动运行维护（衰减、提升、反思生成）
curl -X POST http://localhost:8082/memory/maintenance

# 输出示例：
# {
#   "decayed": 15,
#   "promoted": 3,
#   "reflections_generated": 1
# }
```

### 定期维护（推荐）

添加 cron 任务：

```bash
# 每天凌晨 3 点运行维护
crontab -e

# 添加：
0 3 * * * curl -X POST http://localhost:8082/memory/maintenance
```

---

## 💡 最佳实践

### 1. 信任自动功能

无需手动存储记忆，系统会自动处理。

### 2. 调整阈值

- 如果检索结果不相关 → 提高 `threshold` 至 0.7
- 如果检索结果太少 → 降低 `threshold` 至 0.5

### 3. 定期备份

```bash
# 导出所有记忆
node dist/memory-cli.ts export > backup-$(date +%Y%m%d).json

# 导入记忆
node dist/memory-cli.ts import < backup-20260315.json
```

### 4. 监控资源

```bash
# 查看内存使用
ps aux | grep llama-server

# 查看数据库大小
psql -d openclaw_memory -c "SELECT pg_size_pretty(pg_database_size('openclaw_memory'));"
```

### 5. 清理无用记忆

```bash
# 删除低重要性记忆（<0.5）
node dist/memory-cli.ts cleanup --min-importance=0.5
```

---

## 📚 相关文档

- [ARCHITECTURE.md](ARCHITECTURE.md) - 详细架构说明
- [README.md](README.md) - 快速开始
- [CONFIG.md](CONFIG.md) - 配置详解

---

<div align="center">

**最后更新：** 2026-03-15  
**版本：** 2.1.0

</div>

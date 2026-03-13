# OpenClaw Memory Plugin - 快速开始指南

## 概述

这是一个生产级的长期记忆系统插件，为 OpenClaw 提供语义记忆检索功能。

## 快速启动

### 方法一：使用 launchd 开机自启（推荐）

服务已配置为 macOS launchd 服务，开机自动启动：

```bash
# 查看服务状态
./services.sh status

# 启动服务
./services.sh start

# 停止服务
./services.sh stop

# 重启服务
./services.sh restart

# 查看日志
./services.sh logs
```

**已配置的服务：**
- `io.github.liufei.llama-server` - Embedding 服务（端口 8080）
- `io.github.liufei.memory-server` - 记忆服务（端口 8082）

### 方法二：手动启动

### 1. 启动 Embedding 服务

使用本地 llama.cpp：

```bash
llama-server \
  --hf-repo lm-kit/bge-m3-gguf \
  --hf-file bge-m3-Q8_0.gguf \
  -c 8192 \
  --embedding \
  --port 8080
```

### 2. 启动记忆服务

```bash
cd /Users/liufei/.openclaw/plugins/openclaw-memory
python3 memory_server.py --port 8082
```

或使用启动脚本：

```bash
./start.sh
```

### 3. 验证服务

```bash
# 健康检查
curl http://localhost:8082/health

# 查看统计
curl http://localhost:8082/memory/stats
```

## 使用示例

### 存储记忆

```bash
curl -X POST http://localhost:8082/memory/store \
  -H "Content-Type: application/json" \
  -d '{
    "session_id": "session-123",
    "content": "用户想学习 Rust 编程语言",
    "importance": 0.7
  }'
```

### 搜索记忆

```bash
curl -X POST http://localhost:8082/memory/search \
  -H "Content-Type: application/json" \
  -d '{
    "query": "用户想学什么编程语言？",
    "top_k": 5,
    "threshold": 0.5
  }'
```

### 在 OpenClaw 中使用

记忆系统已配置为 OpenClaw 的默认记忆后端。当 OpenClaw 需要检索历史记忆时，会自动调用 `memory_search` 工具：

```
请搜索用户之前关于 Python 的讨论
```

## 配置

### 数据库配置

编辑 `memory_server.py` 或通过环境变量设置：

```bash
export MEMORY_DB_HOST=localhost
export MEMORY_DB_PORT=5432
export MEMORY_DB_NAME=openclaw_memory
export MEMORY_DB_USER=liufei
export MEMORY_DB_PASS=""
```

### 阈值调整

- `threshold`: 相似度阈值（默认 0.6）
  - 降低阈值：更多结果，但可能不相关
  - 提高阈值：更精确的结果，但可能遗漏

## 测试

```bash
python3 test_memory.py
```

## 故障排查

### 数据库连接失败

```bash
# 检查 PostgreSQL 是否运行
pgrep -x postgres

# 检查用户是否存在
psql -c "\\du"

# 检查数据库是否存在
psql -c "\\l" | grep openclaw_memory
```

### Embedding 服务不可用

```bash
# 测试 embedding 服务
curl -X POST http://localhost:8080/embedding \
  -H "Content-Type: application/json" \
  -d '{"input":"test"}'
```

### 重启服务

```bash
# 使用方法一（推荐）
./services.sh restart

# 或手动重启
pkill -f memory_server.py
python3 memory_server.py --port 8082
```

## 架构

```
OpenClaw → Node.js 插件 → HTTP (8082) → Python 记忆服务 → PostgreSQL (pgvector)
                                       ↓
                                   llama.cpp (8080)
```

## 记忆类型

| 类型 | 说明 | 重要性 | 提升条件 |
|------|------|--------|----------|
| Episodic | 事件、对话 | 动态 | access_count > 10 → Semantic |
| Semantic | 稳定知识 | 较高 | - |
| Reflection | 自动洞察 | 0.9 (固定) | 每 50 条 episodic 生成 |

## 下一步

- 查看 `PROJECT.md` 获取完整项目文档
- 查看 `USAGE.md` 获取详细使用说明
- 查看 `INTEGRATION.md` 获取集成指南

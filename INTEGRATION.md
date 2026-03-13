# OpenClaw PostgreSQL 记忆系统集成指南

## 概述

OpenClaw 默认使用**基于文件的记忆系统** (`MEMORY.md` 和 `memory/YYYY-MM-DD.md`)。

本指南说明如何用 **PostgreSQL + pgvector 记忆系统** 替换默认文件记忆。

## 架构对比

### 默认文件记忆系统
```
OpenClaw → MEMORY.md (文件)
         └→ memory/YYYY-MM-DD.md (每日日志)
```

**限制：**
- 仅关键词匹配
- 无语义检索
- 记忆之间无关联

### PostgreSQL 记忆系统（本插件）
```
OpenClaw → Memory Plugin → PostgreSQL + pgvector
                    └→ 向量相似度搜索
                    └→ 重要性学习
                    └→ 自动反思生成
```

**优势：**
- 语义检索（理解意思，不只是关键词）
- 动态重要性评分
- 自动记忆提升和反思

---

## 安装步骤

### 1. 安装依赖

```bash
pip install flask flask-cors psycopg2-binary requests
```

### 2. 初始化数据库

```bash
# 连接到 PostgreSQL
psql -U postgres

# 创建数据库
CREATE DATABASE openclaw;

# 启用 pgvector 扩展
\c openclaw
CREATE EXTENSION IF NOT EXISTS vector;

# 执行 schema 创建表
\i /Users/liufei/.openclaw/plugins/openclaw-memory/schema.sql
```

### 3. 配置数据库连接

```bash
# 设置环境变量
export MEMORY_DB_HOST=localhost
export MEMORY_DB_PORT=5432
export MEMORY_DB_NAME=openclaw
export MEMORY_DB_USER=postgres
export MEMORY_DB_PASS=your_password
```

### 4. 启动记忆服务

```bash
# 方式 A：前台运行
python3 memory_server.py --port 8080

# 方式 B：后台运行
nohup python3 memory_server.py --port 8080 > memory.log 2>&1 &

# 方式 C：使用 systemd (推荐生产环境)
# 见 systemd/README.md
```

### 5. 在 OpenClaw 中配置

编辑 `~/.openclaw/openclaw.json`：

```json
{
  "plugins": {
    "enabled": true,
    "slots": {
      "memory": "openclaw-memory"
    },
    "entries": {
      "openclaw-memory": {
        "enabled": true,
        "config": {
          "postgresql": {
            "host": "localhost",
            "port": 5432,
            "database": "openclaw",
            "user": "postgres",
            "password": "your_password"
          }
        }
      }
    }
  }
}
```

**关键字段说明：**

| 字段 | 说明 |
|------|------|
| `plugins.enabled` | 启用插件系统 |
| `plugins.slots.memory` | 指定记忆插件（替换默认的 `memory-core`） |
| `plugins.entries.openclaw-memory` | 插件配置 |

### 6. 重启 OpenClaw

```bash
# 重启 OpenClaw 网关
openclaw restart
```

---

## 验证安装

### 测试记忆服务

```bash
# 健康检查
curl http://localhost:8080/health

# 预期输出：
# {"status":"healthy","service":"openclaw-memory"}
```

### 测试记忆搜索

```bash
# 使用脚本搜索
python3 scripts/search.py "用户编程经验"

# 或使用 API
curl -X POST http://localhost:8080/memory/search \
  -H "Content-Type: application/json" \
  -d '{"query": "用户编程经验", "top_k": 5}'
```

### 在 OpenClaw 中测试

启动 OpenClaw 对话，问一个问题（如"我之前说过什么关于 Python 的事？"），观察是否返回记忆相关内容。

---

## API 参考

### POST /memory/search

搜索记忆。

**请求：**
```json
{
  "query": "用户编程经验",
  "top_k": 10,
  "threshold": 0.6
}
```

**响应：**
```json
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

### POST /memory/store

存储记忆。

**请求：**
```json
{
  "session_id": "session-123",
  "content": "用户想学习 Rust",
  "importance": 0.6
}
```

### GET /memory/stats

获取统计信息。

### POST /memory/maintenance

运行维护任务（衰减、提升、反思生成）。

---

## 配置选项

### 记忆服务配置

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `--port` | 8080 | 监听端口 |
| `--host` | 0.0.0.0 | 监听地址 |
| `--debug` | false | 调试模式 |

### 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `MEMORY_DB_HOST` | localhost | PostgreSQL 主机 |
| `MEMORY_DB_PORT` | 5432 | PostgreSQL 端口 |
| `MEMORY_DB_NAME` | openclaw | 数据库名 |
| `MEMORY_DB_USER` | postgres | 数据库用户 |
| `MEMORY_DB_PASS` | (空) | 数据库密码 |

---

## 故障排查

### 1. 服务无法启动

**检查 PostgreSQL 是否运行：**
```bash
pg_isready
```

**检查 pgvector 是否安装：**
```sql
\c openclaw
\dx | grep vector
```

### 2. 搜索返回空结果

**可能原因：**
- 记忆库为空（正常，开始使用后会有数据）
- 阈值设置过高（默认 0.6）
- Embedding 服务未运行

**检查 embedding 服务：**
```bash
curl http://localhost:8080/embedding -X POST -d '{"input":"test"}'
```

### 3. OpenClaw 不加载插件

**检查配置：**
```bash
openclaw plugins list
```

**查看日志：**
```bash
tail -f ~/.openclaw/logs/gateway.log
```

---

## 回滚到文件记忆

如需恢复默认文件记忆系统：

```json
{
  "plugins": {
    "slots": {
      "memory": "memory-core"
    }
  }
}
```

然后重启 OpenClaw。

---

## 高级用法

### 直接导入 Python 模块

如果 OpenClaw 支持 Python 技能：

```python
import sys
sys.path.insert(0, "/Users/liufei/.openclaw/plugins/openclaw-memory")

from database import Database
from memory_manager import MemoryManager

db = Database(DB_CONFIG)
mm = MemoryManager(db)

# 搜索
memories = mm.retrieve_relevant("查询内容")

# 存储
mm.async_store("session-id", "记忆内容")
```

### 批量导入现有记忆

```python
# TODO: 实现批量导入脚本
# 读取 MEMORY.md 和 memory/*.md 文件
# 存入 PostgreSQL
```

---

## 总结

| 步骤 | 命令 |
|------|------|
| 1. 安装依赖 | `pip install flask flask-cors psycopg2-binary` |
| 2. 初始化数据库 | `psql -U postgres -f schema.sql` |
| 3. 配置环境变量 | `export MEMORY_DB_*` |
| 4. 启动服务 | `python3 memory_server.py` |
| 5. 配置 OpenClaw | 编辑 `openclaw.json` |
| 6. 重启 | `openclaw restart` |

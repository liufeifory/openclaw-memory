# OpenClaw Memory Plugin - 5 分钟快速开始

> 🚀 从零到运行，只需 5 分钟

---

## 📋 前置要求

| 组件 | 版本 | 安装命令 |
|------|------|----------|
| Node.js | ≥18 | `brew install node` |
| PostgreSQL | ≥14 + pgvector | `brew install postgresql pgvector` |
| llama.cpp | 最新 | `brew install llama.cpp` |

---

## 🏃 第一步：安装插件（1 分钟）

```bash
# 1. 进入插件目录
cd ~/.openclaw/plugins

# 2. 克隆或更新
git clone https://github.com/liufeifory/openclaw-memory.git
# 或（如已存在）
cd openclaw-memory && git pull

# 3. 安装依赖
npm install && npm run build
```

---

## 🗄️ 第二步：初始化数据库（1 分钟）

```bash
# 1. 创建数据库
psql -c "CREATE DATABASE openclaw_memory OWNER liufei;"

# 2. 启用 pgvector 扩展
psql -d openclaw_memory -c "CREATE EXTENSION vector;"

# 3. 导入表结构
cd ~/.openclaw/plugins/openclaw-memory
psql -d openclaw_memory -f schema.sql
```

---

## ⚙️ 第三步：启动服务（1 分钟）

```bash
# 使用 launchd 服务（推荐，开机自启）
cd ~/.openclaw/plugins/openclaw-memory
./services.sh start

# 验证服务
curl http://localhost:8082/health
# 预期输出：{"status":"ok"}
```

**服务说明：**

| 服务 | 端口 | 说明 |
|------|------|------|
| llama-server (Embedding) | 8080 | BGE-M3 向量生成 |
| llama-server (LLM) | 8081 | Llama-3.2-1B 分类/摘要 |
| memory-server | 8082 | 记忆服务 |

---

## 🔧 第四步：配置 OpenClaw（1 分钟）

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

**注意：** 将 `user` 改为你的 PostgreSQL 用户名

---

## 🔄 第五步：重启 OpenClaw（1 分钟）

```bash
# 重启 OpenClaw
openclaw restart

# 验证插件加载
openclaw plugins list

# 查看日志（可选）
tail -f ~/.openclaw/logs/gateway.log | grep memory
```

**预期日志：**

```
[openclaw-memory] Plugin initialized with PostgreSQL
[openclaw-memory] Plugin registered
```

---

## ✅ 验证安装

### 测试 1：健康检查

```bash
curl http://localhost:8082/health
# 预期：{"status":"ok"}
```

### 测试 2：存储记忆

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

### 测试 3：检索记忆

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

### 测试 4：在 OpenClaw 中测试

启动对话：

```
用户：我之前说过喜欢什么编程语言？
AI: 您之前提到喜欢 TypeScript。
```

---

## 🎉 完成！

现在记忆系统已就绪，自动功能：

- ✅ 自动存储用户消息
- ✅ 自动注入相关记忆
- ✅ 自动提取用户偏好
- ✅ 自动生成对话摘要

---

## 🆘 遇到问题？

### 问题 1：服务无法启动

```bash
# 检查 PostgreSQL
pg_isready

# 检查 pgvector
psql -d openclaw_memory -c "\\dx" | grep vector
```

### 问题 2：插件未加载

```bash
# 检查配置语法
cat ~/.openclaw/config.json | python3 -m json.tool

# 查看完整日志
tail -f ~/.openclaw/logs/gateway.log
```

### 问题 3：记忆检索为空

正常现象！开始使用后会自动积累记忆。

---

## 📚 下一步

- [README.md](README.md) - 完整文档
- [USAGE.md](USAGE.md) - 使用指南
- [CONFIG.md](CONFIG.md) - 配置详解
- [ARCHITECTURE.md](ARCHITECTURE.md) - 架构说明

---

<div align="center">

**最后更新：** 2026-03-15  
**版本：** 2.1.0

</div>

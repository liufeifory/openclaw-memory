# OpenClaw Memory Plugin - 5 分钟快速开始

> 🚀 从零到运行，只需 5 分钟

---

## 📋 前置要求

| 组件 | 版本 | 安装命令 |
|------|------|----------|
| Node.js | ≥18 | `brew install node` |
| SurrealDB | ≥2.0 | `brew install surrealdb` |
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

## 🗄️ 第二步：启动 SurrealDB（1 分钟）

```bash
# 1. 启动 SurrealDB（使用 Homebrew，开机自启）
brew services start surrealdb

# 2. 验证服务
curl http://localhost:8000/health
# 预期输出：{"status":"ok"}
```

**注意：** SurrealDB 会自动创建命名空间和数据库，无需手动初始化。

---

## ⚙️ 第三步：启动 llama.cpp 服务（2 分钟）

### 3.1 启动基础服务（Embedding + 1B LLM）

```bash
# 使用 launchd 服务（推荐，开机自启）
cd ~/.openclaw/plugins/openclaw-memory
./services.sh start

# 验证服务
curl http://localhost:8080/health
# 预期输出：{"status":"ok"}
```

### 3.2 启动 7B 模型服务（实体提取/三元组精炼）

**下载模型（首次运行）：**
```bash
# 模型约 4.4GB，下载一次即可
llama.cpp 会自动从 HuggingFace 下载
# 或手动下载：
# https://huggingface.co/Qwen/Qwen2.5-Coder-7B-Instruct-GGUF
```

**启动服务：**
```bash
# 方式 1：使用 launchd（推荐，开机自启）
cp ~/Library/LaunchAgents/io.github.liufei.llama-server-7b.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/io.github.liufei.llama-server-7b.plist

# 方式 2：手动启动（临时测试）
llama-server \
  --model ~/Library/Caches/llama.cpp/Qwen2.5-Coder-7B-Instruct-Q4_K_M.gguf \
  --port 8082 \
  --ctx-size 32768 \
  --n-gpu-layers 99 \
  --threads 8 \
  --mlock \
  --chat-template qwen25 &
```

**验证服务：**
```bash
curl http://localhost:8082/health
# 预期输出：{"status":"ok"}
```

**服务说明：**

| 服务 | 端口 | 说明 |
|------|------|------|
| llama-server (Embedding) | 8080 | BGE-M3 向量生成（1024 维） |
| llama-server (LLM 1B) | 8081 | Llama-3.2-1B 消息分类/偏好提取 |
| llama-server (LLM 7B) | 8082 | Qwen2.5-Coder-7B 实体提取/三元组精炼 |
| SurrealDB | 8000 | 原生图数据库 |

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
      "backend": "surrealdb",
      "surrealdb": {
        "url": "http://localhost:8000",
        "namespace": "openclaw",
        "database": "memory",
        "username": "root",
        "password": "root"
      },
      "embedding": {
        "endpoint": "http://localhost:8080"
      }
    }
  }
}
```

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
[openclaw-memory] Plugin initialized with SurrealDB
[openclaw-memory] Plugin registered
```

---

## ✅ 验证安装

### 测试 1：健康检查

```bash
# 检查 SurrealDB
curl http://localhost:8000/health
# 预期：{"status":"ok"}

# 检查 llama.cpp
curl http://localhost:8080/health
# 预期：{"status":"ok"}
```

### 测试 2：在 OpenClaw 中测试

启动对话：

```
用户：我是程序员，主要用 Python 和 TypeScript
AI: 好的，我记住了。

（后续对话）
用户：我之前说过用什么编程语言？
AI: 您之前提到主要使用 Python 和 TypeScript。
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

### 问题 1：SurrealDB 无法启动

```bash
# 检查服务状态
brew services list | grep surrealdb

# 重启服务
brew services restart surrealdb

# 验证连接
surreal sql --endpoint http://localhost:8000 --username root --password root
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

## 📋 服务端口总览

| 服务 | 端口 | 模型 | 用途 |
|------|------|------|------|
| BGE-M3 | 8080 | BGE-M3 | 向量嵌入（1024 维） |
| Llama-3.2-1B | 8081 | Llama-3.2-1B-Instruct | 消息分类、偏好提取、摘要 |
| Qwen2.5-Coder-7B | 8082 | Qwen2.5-Coder-7B-Instruct | 实体提取、三元组精炼 |
| SurrealDB | 8000 | - | 原生图数据库 |

---

<div align="center">

**最后更新：** 2026-03-16
**版本：** 2.2.0

</div>

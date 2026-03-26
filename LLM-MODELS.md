# 本地大模型部署说明

> 本项目使用的本地 LLM 模型和 Embedding 模型

**架构策略：** 本地尽量少用模型，能合并到云端 LLM 的任务都使用云端。

---

## 📋 模型清单

| 端口 | 模型名称 | 用途 | 显存占用 | 延迟 |
|------|----------|------|----------|------|
| 8080 | BGE-M3 | Embedding (1024 维向量) | ~500MB | ~50ms |
| 8082 | Qwen2.5-Coder-7B-Instruct | 实体提取、三元组精炼、冲突检测、聚类和并 | ~4GB | ~800-1500ms |

**已移除：**
- ~~Llama-3.2-1B-Instruct~~ (端口 8081) - 已迁移到云端 LLM 或合并到 7B 模型

---

## 🔧 启动命令

### Embedding 服务 (BGE-M3)

```bash
llama-server \
  --hf-repo lm-kit/bge-m3-gguf \
  --embedding \
  --port 8080 \
  --ctx-size 8192 \
  --n-gpu-layers 99
```

### 7B LLM 服务 (Qwen2.5-Coder-7B-Instruct)

```bash
llama-server \
  --hf-repo bartowski/Qwen2.5-Coder-7B-Instruct-GGUF \
  --hf-file Qwen2.5-Coder-7B-Instruct-Q4_K_M.gguf \
  --port 8082 \
  --ctx-size 32768 \
  --n-gpu-layers 99 \
  --threads 8 \
  --mlock \
  --chat-template qwen25
```

---

## 📦 服务管理

### 使用 services.sh

```bash
cd ~/.openclaw/plugins/openclaw-memory

# 查看状态
./services.sh status

# 启动所有服务
./services.sh start

# 停止所有服务
./services.sh stop

# 查看日志
./services.sh logs embedding   # Embedding 服务日志
./services.sh logs 7b          # 7B LLM 服务日志
./services.sh logs surrealdb   # SurrealDB 日志
```

### 使用 launchd (macOS)

```bash
# 启动服务
launchctl kickstart -k "gui/$(id -u)/io.github.liufei.llama-server-embedding"
launchctl kickstart -k "gui/$(id -u)/io.github.liufei.llama-server-7b"

# 停止服务
launchctl bootout "gui/$(id -u)/io.github.liufei.llama-server-embedding"
launchctl bootout "gui/$(id -u)/io.github.liufei.llama-server-7b"

# 查看状态
launchctl list | grep llama-server
```

---

## 🎯 模型用途详解

### BGE-M3 (端口 8080)

**用途:** 生成 1024 维向量嵌入，用于语义搜索

**调用场景:**
- 用户消息向量化存储
- 查询语句向量化检索
- 文档片段向量化

**性能:**
- 延迟：~50ms
- 显存：~500MB
- 吞吐量：~500 tokens/s

---

### Qwen2.5-Coder-7B-Instruct (端口 8082)

**用途:** 深度文本理解和结构化提取

**调用场景:**
1. **实体提取 (Layer 2)** - 从文本中提取人名、地名、组织等实体
2. **三元组精炼** - 将实体关系精炼为 `(主体，关系，客体)` 格式
3. **冲突检测** - 检测记忆之间的冲突
4. **消息分类** - 分类用户消息类型（FACT/PREFERENCE/EVENT 等）
5. **对话摘要** - 每 10 条对话生成摘要
6. **偏好提取** - 从对话中提取用户的 likes/dislikes
7. **聚类合并** - 聚类相似记忆并合并
8. **Reranker** - 检索结果重排序

**性能:**
- 延迟：~800-1500ms
- 显存：~4GB (Q4 量化)
- 吞吐量：~30-50 tokens/s

**注：** 原 1B 模型承担的任务已迁移到 7B 模型或云端 LLM（偏好提取、对话摘要）

---

## 🏗️ 三层实体提取架构

```
输入文本
   │
   ▼
┌─────────────────────────────┐
│ Layer 1: 正则匹配            │  ← 名词库匹配 (极速，~5ms)
│ - 预定义名词库              │     覆盖率 ~60%
└─────────────┬───────────────┘
              │ (未匹配)
              ▼
┌─────────────────────────────┐
│ Layer 2: 7B 模型精炼         │  ← 精确提取 (~1000ms)
│ - Qwen2.5-Coder-7B-Instruct │     覆盖率 ~95%+
└─────────────────────────────┘
```

---

## 📊 资源占用

| 组件 | 内存占用 | CPU/GPU 使用 |
|------|----------|-------------|
| BGE-M3 | ~500MB | GPU (推理时) |
| Qwen2.5-7B | ~4GB | GPU (推理时) |
| SurrealDB | ~150MB | CPU/内存 |
| 插件进程 | ~50MB | 低 |

**总计:** 约 5GB 内存 (模型全加载)

---

## 🔧 故障排查

### 查看日志

```bash
# Embedding 服务日志
tail -f ~/Library/Logs/llama-server-embedding.log

# 7B LLM 服务日志
tail -f ~/Library/Logs/llama-server-7b.log
```

### 测试服务

```bash
# 测试 Embedding 服务
curl -X POST http://localhost:8080/embedding \
  -H "Content-Type: application/json" \
  -d '{"input": "test"}'

# 测试 7B LLM 服务
curl -X POST http://localhost:8082/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model": "qwen2.5-7b", "messages": [{"role": "user", "content": "Hello"}]}'
```

---

## 📚 相关文档

- [README.md](README.md) - 项目概述
- [ARCHITECTURE.md](ARCHITECTURE.md) - 架构设计
- [CONFIG.md](CONFIG.md) - 配置详解
- [USAGE.md](USAGE.md) - 使用指南

---

<div align="center">

**最后更新:** 2026-03-26
**版本:** 2.2.0

</div>

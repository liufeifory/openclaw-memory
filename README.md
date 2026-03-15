# OpenClaw Memory Plugin

> 🧠 为 OpenClaw 赋予长期记忆能力 —— 语义检索、自动反思、记忆进化

[![Version](https://img.shields.io/badge/version-2.1.0-blue)](https://github.com/liufeifory/openclaw-memory/releases)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![OpenClaw](https://img.shields.io/badge/OpenClaw-≥2026.3.11-orange)](https://github.com/openclaw/openclaw)

---

## 📖 简介

OpenClaw Memory 是一个生产级的长期记忆系统 **Node.js 插件**，为 OpenClaw AI 助手提供语义记忆检索能力。

**核心特性：**

- 🔍 **语义检索** —— 基于向量相似度智能搜索历史记忆
- ⚡ **动态重要性** —— 根据访问频率和时间自动调整记忆权重
- 🔄 **自动进化** —— 高频情景记忆自动升级为稳定语义记忆
- 💡 **自动反思** —— 定期生成总结性洞察
- 📉 **记忆衰减** —— 长期未访问的记忆自动降低权重
- 🗄️ **双后端支持** —— PostgreSQL (pgvector) 或 Qdrant 任选
- 🎯 **全自动** —— 消息自动分类存储，上下文自动注入

---

## 🚀 5 分钟快速开始

### 前置要求

| 组件 | 版本 | 安装命令 |
|------|------|----------|
| Node.js | ≥18 | `brew install node` |
| PostgreSQL | ≥14 + pgvector | `brew install postgresql pgvector` |
| llama.cpp | 最新 | `brew install llama.cpp` |

### 一键安装

```bash
# 1. 克隆插件
cd ~/.openclaw/plugins
git clone https://github.com/liufeifory/openclaw-memory.git
cd openclaw-memory

# 2. 安装依赖 & 构建
npm install && npm run build

# 3. 初始化数据库
psql -d openclaw_memory -c "CREATE DATABASE openclaw_memory OWNER liufei;"
psql -d openclaw_memory -c "CREATE EXTENSION IF NOT EXISTS vector;"
psql -d openclaw_memory -f schema.sql

# 4. 启动 llama.cpp 服务
brew services start llama.cpp

# 5. 配置 OpenClaw (见下方配置章节)
```

### 验证安装

```bash
# 检查插件状态
openclaw plugins list

# 查看日志
tail -f ~/.openclaw/logs/gateway.log | grep memory
```

看到以下日志即表示成功 ✅：

```
[openclaw-memory] Plugin initialized with PostgreSQL
[openclaw-memory] Plugin registered
```

---

## 🏗️ 架构概览

```
┌─────────────────────────────────────────────────────────────┐
│                     OpenClaw 主程序                          │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────────┐  │
│  │message_     │    │before_prompt│    │memory_search    │  │
│  │received Hook│    │_build Hook  │    │Tool             │  │
│  └──────┬──────┘    └──────┬──────┘    └────────┬────────┘  │
└─────────┼──────────────────┼────────────────────┼───────────┘
          │                  │                    │
          ▼                  ▼                    ▼
┌─────────────────────────────────────────────────────────────┐
│           Node.js 插件 (dist/index.js)                       │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐   │
│  │MemoryFilter  │  │MemoryManager │  │Preference        │   │
│  │(LLM 8081)    │  │(pgvector/    │  │Extractor         │   │
│  │消息分类       │  │ Qdrant)      │  │(LLM 8081)        │   │
│  └──────────────┘  └──────────────┘  └──────────────────┘   │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐   │
│  │Summarizer    │  │Reranker      │  │Clusterer         │   │
│  │(LLM 8081)    │  │(LLM 8081)    │  │(空闲时执行)       │   │
│  └──────────────┘  └──────────────┘  └──────────────────┘   │
└─────────────────────────────────────────────────────────────┘
          │                  │
          ▼                  ▼
┌─────────────────┐  ┌─────────────────────────────────────────┐
│  llama.cpp      │  │  向量数据库                              │
│  - BGE-M3 (8080)│  │  ┌────────────┐  ┌─────────────────┐    │
│    Embedding    │  │  │PostgreSQL  │  │  Qdrant         │    │
│  - Llama-3.2-1B │  │  │+ pgvector  │  │                 │    │
│    (8081)       │  │  └────────────┘  └─────────────────┘    │
│                 │  └─────────────────────────────────────────┘
└─────────────────┘
```

**关键说明：**

- **纯 Node.js 实现** - 无 Python 依赖
- **Hooks 自动触发** - `message_received` 存储消息，`before_prompt_build` 注入上下文
- **LLM 调用** - 使用本地 llama.cpp (8081 端口) 进行消息分类、偏好提取、对话摘要
- **Embedding** - 使用 BGE-M3 (8080 端口) 生成 1024 维向量

---

## 📦 核心功能

### 记忆类型

| 类型 | 说明 | 重要性 | 衰减 | 提升条件 |
|------|------|--------|------|----------|
| **Episodic** | 事件、对话、经历 | 0.5-0.8 | 每日 ×0.98 | 访问 >10 次 → Semantic |
| **Semantic** | 用户偏好、事实 | 0.7-0.9 | 每日 ×0.98 | - |
| **Reflection** | 自动生成的洞察 | 0.9 (固定) | 无 | 每 50 条 episodic 生成 |

### 消息分类规则

| 分类 | 示例 | 是否存储 | 记忆类型 |
|------|------|----------|----------|
| TRIVIAL | "你好"、"谢谢"、"再见" | ❌ | - |
| FACT | "我是程序员"、"我用 Mac" | ✅ | semantic |
| PREFERENCE | "我喜欢 Python"、"我讨厌早起" | ✅ | semantic |
| EVENT | "今天去了星巴克"、"刚完成项目" | ✅ | episodic |
| QUESTION | "什么是向量数据库？" | ❌ | - |

### 重要性算法

```typescript
importance = 0.5 × base_importance
           + 0.3 × log(access_count + 1)
           + 0.2 × exp(-days_since_creation / 30)
```

### 检索流程

1. 查询文本 → BGE-M3 Embedding (1024 维向量)
2. pgvector/Qdrant HNSW 相似度搜索
3. 过滤阈值 <0.6 的结果
4. 按 `similarity × importance` 排序
5. 返回 Top 5

---

## ⚙️ 配置

### OpenClaw 配置

编辑 `~/.openclaw/config.json`：

#### PostgreSQL (pgvector) 配置（推荐）

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

#### Qdrant 配置

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

### 环境变量（可选）

```bash
export MEMORY_DB_HOST=localhost
export MEMORY_DB_PORT=5432
export MEMORY_DB_NAME=openclaw_memory
export MEMORY_DB_USER=liufei
export MEMORY_DB_PASS=""
export MEMORY_EMBEDDING_ENDPOINT=http://localhost:8080
```

---

## 📖 使用示例

### 自动功能（无需手动调用）

记忆系统全自动运行：

1. **自动存储** - 用户消息自动分类并存储
2. **自动检索** - 每次对话自动注入相关记忆
3. **偏好提取** - 每 10 条消息自动提取用户偏好
4. **对话摘要** - 每 10 条消息自动生成摘要

### 手动检索（可选）

在对话中调用 `memory_search` 工具：

```
用户：@memory_search 查询="用户的编程语言经验" top_k=5
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

### CLI 工具

```bash
# 存储记忆
node dist/memory-cli.ts store "用户喜欢 TypeScript" \
  --type=semantic --importance=0.8

# 搜索记忆
node dist/memory-cli.ts search "编程语言偏好" \
  --top-k=5 --threshold=0.6

# 查看统计
node dist/memory-cli.ts stats

# 列出所有记忆
node dist/memory-cli.ts list --limit=10
```

---

## 🔧 服务管理

### 启动 llama.cpp 服务

```bash
# 使用 Homebrew 管理（推荐）
brew services start llama.cpp

# 或手动启动
# Embedding 服务 (BGE-M3)
llama-server \
  --hf-repo lm-kit/bge-m3-gguf \
  --hf-file bge-m3-Q8_0.gguf \
  --embedding \
  --port 8080 \
  --ctx-size 8192 &

# LLM 服务 (Llama-3.2-1B-Instruct)
llama-server \
  --hf-repo bartowski/Llama-3.2-1B-Instruct-GGUF \
  --hf-file Llama-3.2-1B-Instruct-Q8_0.gguf \
  --port 8081 \
  --ctx-size 1024 \
  --n-gpu-layers 99 &
```

### 使用 services.sh（launchd 管理）

```bash
cd ~/.openclaw/plugins/openclaw-memory

./services.sh status    # 查看服务状态
./services.sh start     # 启动服务
./services.sh stop      # 停止服务
./services.sh restart   # 重启服务
./services.sh logs      # 查看日志
```

---

## 🐛 故障排查

### 插件未加载

```bash
# 检查配置语法
cat ~/.openclaw/config.json | python3 -m json.tool

# 查看完整日志
tail -f ~/.openclaw/logs/gateway.log
```

### 数据库连接失败

```bash
# 检查 PostgreSQL 是否运行
pg_isready

# 检查 pgvector 扩展
psql -d openclaw_memory -c "\\dx" | grep vector

# 创建数据库（如需要）
psql -c "CREATE DATABASE openclaw_memory OWNER liufei;"
psql -d openclaw_memory -c "CREATE EXTENSION vector;"
```

### Embedding 服务不可用

```bash
# 测试服务
curl -X POST http://localhost:8080/embedding \
  -H "Content-Type: application/json" \
  -d '{"input":"test"}'

# 查看日志
brew services logs llama-server
```

### 常见问题

| 问题 | 解决方案 |
|------|----------|
| `vector` 扩展不存在 | `psql -d openclaw_memory -c "CREATE EXTENSION vector;"` |
| 记忆检索结果为空 | 降低 `threshold` 至 0.5（正常，开始使用后会有数据） |
| Hook 超时警告 | 正常现象，不影响功能；可增加 `timeout_ms` 配置 |
| LLM 分类失败 | 检查 8081 端口：`curl http://localhost:8081` |

---

## 📁 项目结构

```
openclaw-memory/
├── src/                      # TypeScript 源码
│   ├── index.ts              # 插件入口（Hooks、Tool 注册）
│   ├── memory-manager.ts     # PostgreSQL 记忆管理
│   ├── memory-manager-qdrant.ts  # Qdrant 记忆管理
│   ├── memory-filter.ts      # 消息分类（LLM 调用）
│   ├── preference-extractor.ts # 偏好提取
│   ├── summarizer.ts         # 对话摘要
│   ├── reranker.ts           # 重排序
│   ├── clusterer.ts          # 聚类
│   └── ...
├── dist/                     # 编译输出
├── schema.sql                # PostgreSQL 表结构
├── package.json              # Node.js 配置
├── tsconfig.json             # TypeScript 配置
├── services.sh               # launchd 管理脚本
└── docs/                     # 文档
    ├── README.md
    ├── QUICKSTART.md
    ├── PROJECT.md
    ├── USAGE.md
    ├── CONFIG.md
    └── ARCHITECTURE.md
```

---

## 🧪 测试

```bash
# 运行完整测试
npm test

# 单独测试
npm run test:qdrant      # Qdrant 后端测试
npm run test:recall      # 召回率测试
npm run test:conflict    # 冲突检测测试
npm run test:features    # 功能测试
```

---

## 📊 性能指标

| 操作 | 延迟 (P50) | 延迟 (P99) |
|------|-----------|-----------|
| 消息分类 (LLM) | 200ms | 600ms |
| 记忆检索 | 50ms | 300ms |
| 偏好提取 (LLM) | 800ms | 1500ms |
| 对话摘要 (LLM) | 800ms | 1500ms |
| 上下文注入 | <100ms | <200ms |

### 资源消耗

| 组件 | 内存 | CPU |
|------|------|-----|
| 插件进程 | ~50MB | 低 |
| BGE-M3 (8080) | ~500MB | 中（推理时） |
| Llama-3.2-1B (8081) | ~1GB | 中（推理时） |
| PostgreSQL | ~100MB | 低 |

---

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

1. Fork 本仓库
2. 创建特性分支 (`git checkout -b feature/amazing-feature`)
3. 提交更改 (`git commit -m 'Add amazing feature'`)
4. 推送到分支 (`git push origin feature/amazing-feature`)
5. 开启 Pull Request

---

## 📝 更新日志

### v2.1.0 (2026-03)
- ✅ 新增 Qdrant 后端支持
- ✅ 新增冲突检测模块
- ✅ 优化重排序算法
- ✅ 修复 pgvector 索引问题

### v2.0.0 (2026-02)
- ✅ 重构为纯 TypeScript 实现（移除 Python 依赖）
- ✅ 新增自动反思生成
- ✅ 新增记忆提升机制
- ✅ 性能提升 40%

---

## 📄 许可证

MIT License

---

## 🙏 致谢

- [OpenClaw](https://github.com/openclaw/openclaw) - AI 助手框架
- [pgvector](https://github.com/pgvector/pgvector) - PostgreSQL 向量扩展
- [Qdrant](https://qdrant.tech/) - 向量数据库
- [llama.cpp](https://github.com/ggerganov/llama.cpp) - 本地 LLM 推理

---

<div align="center">

**Made with ❤️ for OpenClaw**

[报告问题](https://github.com/liufeifory/openclaw-memory/issues) · [请求特性](https://github.com/liufeifory/openclaw-memory/issues)

</div>

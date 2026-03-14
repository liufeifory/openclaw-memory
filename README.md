# OpenClaw Memory Plugin

> 🧠 为 OpenClaw 赋予长期记忆能力 —— 语义检索、自动反思、记忆进化

[![Version](https://img.shields.io/badge/version-2.1.0-blue)](https://github.com/liufeifory/openclaw-memory/releases)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![OpenClaw](https://img.shields.io/badge/OpenClaw-≥2026.3.11-orange)](https://github.com/openclaw/openclaw)

---

## 📖 简介

OpenClaw Memory 是一个生产级的长期记忆系统插件，让 AI 助手能够：

- 🔍 **语义检索** —— 基于向量相似度智能搜索历史记忆
- ⚡ **动态重要性** —— 根据访问频率和时间自动调整记忆权重
- 🔄 **自动进化** —— 高频情景记忆自动升级为稳定语义记忆
- 💡 **自动反思** —— 定期生成总结性洞察
- 📉 **记忆衰减** —— 长期未访问的记忆自动降低权重
- 🗄️ **双后端支持** —— PostgreSQL (pgvector) 或 Qdrant 任选

---

## 🚀 5 分钟快速开始

### 前置要求

| 组件 | 版本 | 说明 |
|------|------|------|
| Node.js | ≥18 | [下载](https://nodejs.org/) |
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
psql -d openclaw_memory -c "CREATE EXTENSION IF NOT EXISTS vector;"
psql -d openclaw_memory -f schema.sql

# 4. 启动服务
./start.sh
```

### 验证安装

```bash
# 健康检查
curl http://localhost:8082/health

# 查看统计
curl http://localhost:8082/memory/stats
```

看到 `{"status":"ok"}` 即表示成功 ✅

---

## 🏗️ 架构概览

```
┌─────────────────────────────────────────────────────────────┐
│                     OpenClaw 主程序                          │
│  ┌─────────────┐                                            │
│  │memory_search│ ───┐                                       │
│  └─────────────┘    │                                        │
└─────────────────────┼────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│              Node.js 插件层 (dist/index.js)                  │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  HTTP Client → 调用 Python 记忆服务 (port 8082)         │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                      │
                      │ HTTP/JSON
                      ▼
┌─────────────────────────────────────────────────────────────┐
│            Python 记忆服务 (memory_server.py)                │
│  ┌──────────┐ ┌──────────┐ ┌────────────────────────────┐  │
│  │MemoryMgr │ │Embedding │ │ Maintenance                │  │
│  │记忆管理   │ │llama.cpp │ │ 衰减/提升/反思              │  │
│  └──────────┘ └──────────┘ └────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                      │
                      │ psycopg2
                      ▼
┌─────────────────────────────────────────────────────────────┐
│               PostgreSQL + pgvector                          │
│  ┌──────────────┬──────────────┬──────────────────────┐    │
│  │episodic_memory│semantic_memory│reflection_memory    │    │
│  │情景记忆       │语义记忆        │反思记忆              │    │
│  └──────────────┴──────────────┴──────────────────────┘    │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ memory_embeddings (vector(1024)) + HNSW 索引          │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

---

## 📦 核心功能

### 记忆类型

| 类型 | 表名 | 说明 | 重要性 | 进化条件 |
|------|------|------|--------|----------|
| **Episodic** | `episodic_memory` | 事件、对话、经历 | 动态计算 | 访问 >10 次 → Semantic |
| **Semantic** | `semantic_memory` | 稳定知识、事实 | 较高 | - |
| **Reflection** | `reflection_memory` | 自动生成的洞察 | 0.9 (固定) | 每 50 条 episodic 生成 |

### 重要性算法

```
importance = 0.5 × base_importance
           + 0.3 × log(access_count + 1)
           + 0.2 × exp(-days_since_creation / 30)
```

### 检索流程

1. 查询文本 → Embedding (1024 维向量)
2. pgvector HNSW 相似度搜索
3. 过滤阈值 <0.6 的结果
4. 按 `similarity × importance` 排序
5. 返回 Top 5

---

## ⚙️ 配置

### 数据库配置

编辑 `memory_server.py` 或使用环境变量：

```bash
export MEMORY_DB_HOST=localhost
export MEMORY_DB_PORT=5432
export MEMORY_DB_NAME=openclaw_memory
export MEMORY_DB_USER=liufei
export MEMORY_DB_PASS=""
```

### OpenClaw 配置

在 `~/.openclaw/config.json` 中添加：

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

### Qdrant 后端（可选）

```json
{
  "plugins": {
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

---

## 📖 使用示例

### API 调用

```bash
# 存储记忆
curl -X POST http://localhost:8082/memory/store \
  -H "Content-Type: application/json" \
  -d '{
    "session_id": "session-123",
    "content": "用户想学习 Rust 编程语言",
    "importance": 0.7
  }'

# 搜索记忆
curl -X POST http://localhost:8082/memory/search \
  -H "Content-Type: application/json" \
  -d '{
    "query": "用户想学什么编程语言？",
    "top_k": 5,
    "threshold": 0.6
  }'

# 查看统计
curl http://localhost:8082/memory/stats

# 运行维护任务
curl -X POST http://localhost:8082/memory/maintenance
```

### OpenClaw 中使用

记忆系统自动集成到 OpenClaw，无需额外调用：

```
用户：我之前说过想学什么语言来着？
AI: [自动调用 memory_search] 您之前提到想学习 Rust 编程语言。
```

---

## 🔧 服务管理

### 使用启动脚本

```bash
./start.sh          # 启动所有服务
./start-qdrant.sh   # 仅启动 Qdrant
```

### 使用 services.sh（launchd 管理）

```bash
./services.sh status    # 查看服务状态
./services.sh start     # 启动服务
./services.sh stop      # 停止服务
./services.sh restart   # 重启服务
./services.sh logs      # 查看日志
```

### 手动启动

```bash
# 1. 启动 Embedding 服务 (BGE-M3)
llama-server \
  --hf-repo lm-kit/bge-m3-gguf \
  --hf-file bge-m3-Q8_0.gguf \
  --embedding \
  --port 8080 \
  --ctx-size 8192 &

# 2. 启动记忆服务
python3 memory_server.py --port 8082
```

---

## 🐛 故障排查

### 数据库连接失败

```bash
# 检查 PostgreSQL 是否运行
pgrep -x postgres

# 检查用户是否存在
psql -c "\\du"

# 检查数据库是否存在
psql -c "\\l" | grep openclaw_memory

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

# 查看 llama.cpp 日志
brew services logs llama-server
```

### 常见问题

| 问题 | 解决方案 |
|------|----------|
| `vector` 扩展不存在 | `psql -d openclaw_memory -c "CREATE EXTENSION vector;"` |
| 端口 8082 被占用 | `lsof -i :8082` 查找并终止进程 |
| 记忆检索结果为空 | 降低 `threshold` 参数至 0.5 |
| Embedding 超时 | 增加 llama.cpp `--ctx-size` 或升级硬件 |

---

## 📁 项目结构

```
openclaw-memory/
├── src/                      # TypeScript 源码
│   ├── index.ts              # 插件入口
│   ├── memory-manager.ts     # 记忆管理核心
│   ├── memory-store.ts       # 存储抽象层
│   ├── embedding.ts          # Embedding 接口
│   ├── reranker.ts           # 重排序模块
│   ├── clusterer.ts          # 聚类模块
│   ├── summarizer.ts         # 总结模块
│   └── ...
├── dist/                     # 编译输出
├── schema.sql                # 数据库 Schema
├── memory_server.py          # Python 记忆服务
├── start.sh                  # 启动脚本
├── services.sh               # launchd 管理脚本
├── deploy.sh                 # 一键部署脚本
├── package.json              # Node.js 配置
└── README.md                 # 本文档
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
| 存储记忆 | <50ms | <100ms |
| 检索记忆 (Top5) | <200ms | <500ms |
| 维护任务 | - | <5s/100 条 |

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
- ✅ 重构为双后端架构
- ✅ 新增自动反思生成
- ✅ 新增记忆提升机制
- ✅ 性能提升 40%

---

## 📄 许可证

MIT License - 详见 [LICENSE](LICENSE) 文件

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

# OpenClaw Memory Plugin

一个生产级的长期记忆系统插件，为 OpenClaw 提供语义记忆检索功能。

## 核心功能

- **语义记忆检索** - 基于向量相似度的智能搜索
- **动态重要性评分** - 根据访问频率和时间自动调整
- **自动记忆提升** - 高频 episodic 记忆自动转为 semantic
- **自动反思生成** - 定期生成总结性洞察
- **记忆衰减机制** - 长期未访问记忆自动降低权重

## 快速开始

### 使用 launchd 服务（推荐）

```bash
# 查看服务状态
./services.sh status

# 启动服务
./services.sh start

# 重启服务
./services.sh restart
```

### 手动启动

```bash
# 1. 启动 llama.cpp embedding 服务
llama-server --hf-repo lm-kit/bge-m3-gguf --embedding --port 8080

# 2. 启动记忆服务
python3 memory_server.py --port 8082
```

### 测试

```bash
python3 test_memory.py
```

## 系统要求

- PostgreSQL 14+ with pgvector
- Python 3.9+
- Node.js 18+
- llama.cpp (用于本地 embedding)

## 架构

```
OpenClaw → Node.js 插件 → HTTP (8082) → Python 记忆服务 → PostgreSQL (pgvector)
                                       ↓
                                   llama.cpp (8080)
```

## 文档

- [QUICKSTART.md](QUICKSTART.md) - 快速开始指南
- [PROJECT.md](PROJECT.md) - 完整项目文档
- [USAGE.md](USAGE.md) - 使用手册
- [INTEGRATION.md](INTEGRATION.md) - 集成指南

## 商业化

本项目可授权用于商业目的。如需企业级授权或定制开发，请联系作者。

## 许可证

MIT License

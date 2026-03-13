# OpenClaw Memory Plugin

一个生产级的长期记忆系统插件，为 OpenClaw 提供语义记忆检索功能。

**v2.0** - 完全使用 Node.js/TypeScript 重写，直接集成 OpenClaw，无需 Python 服务。

## 核心功能

- **语义记忆检索** - 基于向量相似度的智能搜索
- **动态重要性评分** - 根据访问频率和时间自动调整
- **自动记忆提升** - 高频 episodic 记忆自动转为 semantic
- **自动反思生成** - 定期生成总结性洞察
- **记忆衰减机制** - 长期未访问记忆自动降低权重
- **原生集成** - 无需 HTTP 服务，直接调用

## 快速开始

### 1. 安装依赖

```bash
cd ~/.openclaw/plugins/openclaw-memory
npm install
npm run build
```

### 2. 确保 llama.cpp 运行

```bash
llama-server --hf-repo lm-kit/bge-m3-gguf --embedding --port 8080
```

### 3. 测试

```bash
node dist/test.js
```

## 系统要求

- PostgreSQL 14+ with pgvector
- Node.js 18+
- llama.cpp (用于本地 embedding)

## 架构

**v1.0 (Python)**:
```
OpenClaw → HTTP (8082) → Python Flask → PostgreSQL
                          ↓
                       llama.cpp (8080)
```

**v2.0 (Node.js)**:
```
OpenClaw → Node.js 插件 → PostgreSQL
            ↓
         llama.cpp (8080)
```

## 性能对比

| 版本 | 延迟 | 说明 |
|------|------|------|
| v1.0 Python | ~60ms | 含 HTTP 开销 |
| v2.0 Node.js | ~40ms | 直接调用 |

## 记忆类型

| 类型 | 说明 | 重要性 | 提升条件 |
|------|------|--------|----------|
| Episodic | 事件、对话 | 动态 | access_count > 10 → Semantic |
| Semantic | 稳定知识 | 较高 | - |
| Reflection | 自动洞察 | 0.9 (固定) | 每 50 条 episodic 生成 |

## 开发

```bash
# 编译
npm run build

# 监听模式
npm run dev

# 测试
node dist/test.js
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

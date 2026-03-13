# OpenClaw Memory Plugin

一个生产级的长期记忆系统插件，为 OpenClaw 提供语义记忆检索功能。

**v2.1** - 支持 PostgreSQL (pgvector) 和 Qdrant 两种后端。

## 核心功能

- **语义记忆检索** - 基于向量相似度的智能搜索
- **动态重要性评分** - 根据访问频率和时间自动调整
- **自动记忆提升** - 高频 episodic 记忆自动转为 semantic
- **自动反思生成** - 定期生成总结性洞察
- **记忆衰减机制** - 长期未访问记忆自动降低权重
- **双后端支持** - PostgreSQL (pgvector) 或 Qdrant

## 快速开始

### 方案 A: Qdrant 后端 (推荐，便于分发)

**1. 启动 Qdrant**

```bash
cd ~/.openclaw/plugins/openclaw-memory
./start-qdrant.sh
```

**2. 启动 llama.cpp**

```bash
llama-server --hf-repo lm-kit/bge-m3-gguf --embedding --port 8080
```

**3. 安装依赖**

```bash
npm install
npm run build
```

**4. 测试**

```bash
node dist/test-qdrant.js
```

### 方案 B: PostgreSQL (pgvector) 后端

**1. 确保 PostgreSQL 运行**

```bash
# 检查 PostgreSQL 状态
pg_ctl -D /usr/local/var/postgres status
```

**2. 启动 llama.cpp**

```bash
llama-server --hf-repo lm-kit/bge-m3-gguf --embedding --port 8080
```

**3. 安装依赖**

```bash
cd ~/.openclaw/plugins/openclaw-memory
npm install
npm run build
```

**4. 测试**

```bash
node dist/test.js
```

## 配置

### Qdrant 配置

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

### PostgreSQL 配置

```json
{
  "plugins": {
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

## 系统要求

| 组件 | Qdrant 方案 | PostgreSQL 方案 |
|------|------------|----------------|
| 数据库 | Qdrant (二进制) | PostgreSQL 14+ with pgvector |
| Embedding | llama.cpp | llama.cpp |
| Node.js | 18+ | 18+ |

## 架构对比

**Qdrant 方案**:
```
OpenClaw → Node.js 插件 → Qdrant (本地二进制)
            ↓
         llama.cpp (8080)
```

**PostgreSQL 方案**:
```
OpenClaw → Node.js 插件 → PostgreSQL (pgvector)
            ↓
         llama.cpp (8080)
```

## 性能对比

| 版本 | 后端 | 延迟 (warm) | 适合规模 |
|------|------|------------|----------|
| v2.1 | Qdrant | ~12-20ms | 100 万 + |
| v2.0 | pgvector | ~15-25ms | 10 万 + |
| v1.0 | Python HTTP | ~60ms | 10 万 + |

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

# 测试 (pgvector)
node dist/test.js

# 测试 (Qdrant)
node dist/test-qdrant.js

# 性能基准
node dist/benchmark.js

# 迁移数据 (pgvector → Qdrant)
npm run migrate
```

## 从 pgvector 迁移到 Qdrant

1. 启动 Qdrant: `./start-qdrant.sh`
2. 运行迁移脚本：`npm run migrate`
3. 更新配置为 Qdrant 后端
4. 测试：`node dist/test-qdrant.js`

## 文档

- [QUICKSTART.md](QUICKSTART.md) - 快速开始指南
- [PROJECT.md](PROJECT.md) - 完整项目文档
- [USAGE.md](USAGE.md) - 使用手册
- [INTEGRATION.md](INTEGRATION.md) - 集成指南

## 商业化

本项目可授权用于商业目的。如需企业级授权或定制开发，请联系作者。

## 许可证

MIT License

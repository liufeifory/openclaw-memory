# OpenClaw Memory Plugin - 完整项目文档

> 📚 项目的全面技术文档

---

## 📖 项目概述

**OpenClaw Memory** 是一个生产级的长期记忆系统插件，为 OpenClaw AI 助手提供语义记忆检索能力。

**版本：** 2.1.0  
**语言：** TypeScript (Node.js)  
**后端：** PostgreSQL (pgvector) / Qdrant  
**许可证：** MIT

---

## 🎯 核心功能

| 功能 | 说明 | 状态 |
|------|------|------|
| 语义检索 | 基于向量相似度的智能搜索 | ✅ |
| 动态重要性 | 根据访问频率和时间自动调整权重 | ✅ |
| 自动记忆提升 | 高频 episodic 记忆自动转为 semantic | ✅ |
| 自动反思生成 | 定期生成总结性洞察 | ✅ |
| 记忆衰减 | 长期未访问记忆自动降低权重 | ✅ |
| 冲突检测 | semantic 记忆存储前检查冲突 | ✅ |
| 偏好提取 | 从对话中自动提取用户偏好 | ✅ |
| 对话摘要 | 每 10 条消息自动生成摘要 | ✅ |
| 双后端支持 | PostgreSQL (pgvector) 或 Qdrant | ✅ |
| 本地备份 | 同步写入 Markdown 文件 | ✅ |

---

## 🏗️ 系统架构

### 整体架构

```
┌─────────────────────────────────────────────────────────────────┐
│                        OpenClaw 主程序                           │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │message_      │  │before_prompt │  │memory_search         │  │
│  │received Hook │  │_build Hook   │  │Tool                  │  │
│  └──────┬───────┘  └──────┬───────┘  └──────────┬───────────┘  │
└─────────┼─────────────────┼──────────────────────┼──────────────┘
          │                 │                      │
          ▼                 ▼                      ▼
┌─────────────────────────────────────────────────────────────────┐
│              Node.js 插件 (dist/index.js)                        │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐ │
│  │MemoryFilter │  │MemoryManager│  │PreferenceExtractor      │ │
│  │消息分类     │  │记忆管理     │  │偏好提取                 │ │
│  └─────────────┘  └─────────────┘  └─────────────────────────┘ │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐ │
│  │Summarizer   │  │Reranker     │  │Clusterer                │ │
│  │对话摘要     │  │重排序       │  │记忆聚类                 │ │
│  └─────────────┘  └─────────────┘  └─────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
          │                 │
          ▼                 ▼
┌─────────────────┐  ┌─────────────────────────────────────────────┐
│  llama.cpp      │  │  向量数据库                                  │
│  - BGE-M3 (8080)│  │  ┌────────────┐  ┌───────────────────────┐  │
│  - Llama-3.2-1B │  │  │PostgreSQL  │  │  Qdrant               │  │
│    (8081)       │  │  │+ pgvector  │  │                       │  │
│                 │  │  └────────────┘  └───────────────────────┘  │
└─────────────────┘  └─────────────────────────────────────────────┘
```

### 数据流

#### 消息存储流程

```
用户消息
   │
   ▼
┌─────────────────┐
│ MemoryFilter    │ → 分类：TRIVIAL/FACT/PREFERENCE/EVENT/QUESTION
│ (LLM 8081)      │
└────────┬────────┘
         │
         ▼
    需要存储？
    ┌───┴───┐
   是       否
   │        └→ 丢弃
   ▼
┌─────────────────┐
│ MemoryManager   │ → 根据类型存储
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ 向量数据库       │ + 本地 Markdown 备份
└─────────────────┘
```

#### 上下文注入流程

```
用户消息
   │
   ▼
┌─────────────────┐
│ 检索相关记忆     │ → top_k=3, threshold=0.65, timeout=1000ms
└────────┬────────┘
         │
         ▼
    有结果？
    ┌───┴───┐
   是       否
   │        └→ 正常响应
   ▼
┌─────────────────┐
│ 注入到 prompt    │ → [TYPE] (sim: X.XX, imp: X.XX) content
└─────────────────┘
```

---

## 📊 记忆类型

| 类型 | 表名/Collection | 说明 | 重要性 | 衰减 | 提升条件 |
|------|----------------|------|--------|------|----------|
| **Episodic** | `episodic_memory` | 事件、对话 | 0.5-0.8 | 每日 ×0.98 | access_count > 10 → Semantic |
| **Semantic** | `semantic_memory` | 偏好、事实 | 0.7-0.9 | 每日 ×0.98 | - |
| **Reflection** | `reflection_memory` | 摘要、洞察 | 0.9 (固定) | 无 | 每 50 条 episodic 生成 |

### 消息分类规则

| 分类 | 示例 | 存储 | 类型 |
|------|------|------|------|
| TRIVIAL | "你好"、"谢谢" | ❌ | - |
| FACT | "我是程序员" | ✅ | semantic |
| PREFERENCE | "我喜欢 Python" | ✅ | semantic |
| EVENT | "今天去了星巴克" | ✅ | episodic |
| QUESTION | "什么是 AI？" | ❌ | - |

---

## 🔬 核心算法

### 重要性计算

```typescript
importance = 0.5 × base_importance
           + 0.3 × log(access_count + 1)
           + 0.2 × exp(-days_since_creation / 30)
```

### 时间衰减

```typescript
// 每日执行
importance = importance * 0.98
```

### 冲突检测

```typescript
// 存储 semantic 记忆前检查
const similar = await searchSimilar(content, 0.85)
if (similar.length > 0 && newImportance <= similar[0].importance) {
  return // 跳过存储
}
```

### 检索排序

```typescript
// 最终得分 = 相似度 × 重要性
score = similarity * importance
```

---

## 📦 技术栈

### 运行时

| 组件 | 版本 | 用途 |
|------|------|------|
| Node.js | ≥18 | 插件运行环境 |
| TypeScript | 5.3+ | 开发语言 |

### 向量数据库

| 选项 | 版本 | 说明 |
|------|------|------|
| PostgreSQL + pgvector | 14+ | 关系型 + 向量扩展 |
| Qdrant | 1.7+ | 专用向量数据库 |

### AI 模型

| 模型 | 用途 | 端口 |
|------|------|------|
| BGE-M3 | Embedding (1024 维) | 8080 |
| Llama-3.2-1B-Instruct | 分类/提取/摘要 | 8081 |

### 依赖库

```json
{
  "@qdrant/js-client-rest": "^1.7.0",
  "pg": "^8.11.3"
}
```

---

## 📁 项目结构

```
openclaw-memory/
├── src/                          # TypeScript 源码
│   ├── index.ts                  # 插件入口（Hooks、Tool 注册）
│   ├── memory-manager.ts         # PostgreSQL 记忆管理
│   ├── memory-manager-qdrant.ts  # Qdrant 记忆管理
│   ├── memory-store.ts           # 存储抽象层
│   ├── memory-store-qdrant.ts    # Qdrant 存储实现
│   ├── memory-filter.ts          # 消息分类（LLM 调用）
│   ├── preference-extractor.ts   # 偏好提取（LLM 调用）
│   ├── summarizer.ts             # 对话摘要（LLM 调用）
│   ├── reranker.ts               # 重排序（LLM 调用）
│   ├── clusterer.ts              # 记忆聚类
│   ├── embedding.ts              # Embedding 接口
│   ├── llm-limiter.ts            # LLM 调用限流
│   ├── memory-types.ts           # 类型定义
│   └── ...
├── dist/                         # 编译输出
├── schema.sql                    # PostgreSQL 表结构
├── package.json                  # Node.js 配置
├── tsconfig.json                 # TypeScript 配置
├── openclaw.plugin.json          # OpenClaw 插件元数据
├── services.sh                   # launchd 管理脚本
├── start.sh                      # 启动脚本
├── start-qdrant.sh               # Qdrant 启动脚本
├── deploy.sh                     # 一键部署脚本
└── docs/                         # 文档
    ├── README.md                 # 快速开始
    ├── QUICKSTART.md             # 5 分钟上手
    ├── PROJECT.md                # 本文档
    ├── USAGE.md                  # 使用指南
    ├── CONFIG.md                 # 配置详解
    ├── ARCHITECTURE.md           # 架构说明
    ├── AGENTS.md                 # Agent 使用
    └── SKILL.md                  # AgentSkill 定义
```

---

## 🔌 Hook 系统

### message_received

| 属性 | 说明 |
|------|------|
| 触发 | 渠道消息到达（Telegram/WhatsApp/Discord） |
| 类型 | 异步非阻塞 |
| 行为 | 分类并存储消息 |
| 注意 | TUI 模式不触发 |

### before_prompt_build

| 属性 | 说明 |
|------|------|
| 触发 | 每次构建 prompt 前（所有模式） |
| 类型 | 同步阻塞（1000ms 超时） |
| 行为 | 检索记忆并注入上下文 |
| 返回 | `{ prependContext?: string }` |

---

## 🛠️ 工具注册

### memory_search

```json
{
  "name": "memory_search",
  "description": "Search long-term memory using semantic similarity",
  "parameters": {
    "query": { "type": "string" },
    "top_k": { "type": "number", "default": 5 },
    "threshold": { "type": "number", "default": 0.6 },
    "session_id": { "type": "string" }
  }
}
```

---

## 📊 性能指标

| 操作 | P50 | P95 | P99 |
|------|-----|-----|-----|
| 消息分类 | 200ms | 400ms | 600ms |
| 记忆检索 | 50ms | 150ms | 300ms |
| 偏好提取 | 800ms | 1200ms | 1500ms |
| 对话摘要 | 800ms | 1200ms | 1500ms |

### 资源消耗

| 组件 | 内存 | CPU |
|------|------|-----|
| 插件进程 | ~50MB | 低 |
| BGE-M3 (8080) | ~500MB | 中 |
| Llama-3.2-1B (8081) | ~1GB | 中 |
| PostgreSQL | ~100MB | 低 |

---

## 🧪 测试

### 单元测试

```bash
npm run test:features    # 功能测试
npm run test:recall      # 召回率测试
npm run test:conflict    # 冲突检测测试
npm run test:qdrant      # Qdrant 后端测试
```

### CLI 工具

```bash
node dist/memory-cli.ts store "测试" --type=semantic
node dist/memory-cli.ts search "测试" --top-k=5
node dist/memory-cli.ts stats
```

---

## 🚀 部署

### 一键部署

```bash
./deploy.sh install
```

### 手动部署

1. 克隆仓库
2. `npm install && npm run build`
3. 初始化数据库
4. 启动服务
5. 配置 OpenClaw

详见 [QUICKSTART.md](QUICKSTART.md)

---

## 📈 版本历史

### v2.1.0 (2026-03)

- ✅ 新增 Qdrant 后端支持
- ✅ 新增冲突检测模块
- ✅ 优化重排序算法
- ✅ 修复 pgvector 索引问题

### v2.0.0 (2026-02)

- ✅ 重构为纯 TypeScript 实现
- ✅ 新增自动反思生成
- ✅ 新增记忆提升机制
- ✅ 性能提升 40%

### v1.0.0 (2026-01)

- ✅ 初始版本（Python 实现）

---

## 🔮 路线图

| 版本 | 特性 | 预计 |
|------|------|------|
| v2.2 | 记忆可视化界面 | 2026-04 |
| v2.3 | 多模态记忆（图片/音频） | 2026-05 |
| v2.4 | 分布式记忆同步 | 2026-06 |
| v3.0 | 记忆图谱（知识图谱） | 2026-Q3 |

---

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

1. Fork 本仓库
2. 创建特性分支
3. 提交更改
4. 推送到分支
5. 开启 Pull Request

---

## 📄 许可证

MIT License

---

## 🔗 相关链接

- [GitHub](https://github.com/liufeifory/openclaw-memory)
- [OpenClaw](https://github.com/openclaw/openclaw)
- [pgvector](https://github.com/pgvector/pgvector)
- [Qdrant](https://qdrant.tech/)
- [llama.cpp](https://github.com/ggerganov/llama.cpp)

---

<div align="center">

**最后更新：** 2026-03-15  
**版本：** 2.1.0

</div>

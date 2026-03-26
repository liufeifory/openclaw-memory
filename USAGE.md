# OpenClaw Memory Plugin - 使用指南

> 📖 详细的使用说明和最佳实践

---

## 📋 目录

1. [快速开始](#-快速开始)
2. [配置说明](#-配置说明)
3. [自动功能](#-自动功能)
4. [手动操作](#-手动操作)
5. [CLI 工具](#-cli-工具)
6. [API 参考](#-api-参考)
7. [最佳实践](#-最佳实践)
8. [故障排查](#-故障排查)

---

## 🚀 快速开始

### 前置检查

```bash
# 1. 检查 Node.js 版本
node --version  # 需要 >= 18

# 2. 检查 SurrealDB 服务
curl http://localhost:8000/rpc

# 3. 检查 Embedding 服务
curl http://localhost:8080/embedding -X POST -d '{"input":"test"}'

# 4. 检查 LLM 服务
curl http://localhost:8082/
```

### 安装

```bash
cd ~/.openclaw/plugins
git clone https://github.com/liufeifory/openclaw-memory.git
cd openclaw-memory
npm install && npm run build
```

### 初始化数据库

```bash
# 连接到 SurrealDB
surreal sql --endpoint ws://localhost:8000/rpc \
  --namespace openclaw --database memory \
  --username root --password root

# 执行 schema
source schema.sql
```

### 配置 OpenClaw

编辑 `~/.openclaw/config.json`:

```json
{
  "plugins": {
    "slots": {
      "memory": "openclaw-memory"
    },
    "openclaw-memory": {
      "backend": "surrealdb",
      "surrealdb": {
        "url": "ws://localhost:8000/rpc",
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

### 验证安装

```bash
# 查看插件状态
openclaw plugins list

# 查看日志
tail -f ~/.openclaw/logs/gateway.log | grep memory
```

---

## ⚙️ 配置说明

### 完整配置示例

```json
{
  "plugins": {
    "slots": {
      "memory": "openclaw-memory"
    },
    "openclaw-memory": {
      "backend": "surrealdb",
      "surrealdb": {
        "url": "ws://localhost:8000/rpc",
        "namespace": "openclaw",
        "database": "memory",
        "username": "root",
        "password": "root"
      },
      "embedding": {
        "endpoint": "http://localhost:8080"
      },
      "documentImport": {
        "watchDir": "~/.openclaw/documents",
        "chunkSize": 500,
        "chunkOverlap": 50
      }
    }
  }
}
```

### 配置选项

| 选项 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `backend` | string | `surrealdb` | 后端类型 |
| `surrealdb.url` | string | `ws://localhost:8000/rpc` | SurrealDB 地址 |
| `surrealdb.namespace` | string | `openclaw` | 命名空间 |
| `surrealdb.database` | string | `memory` | 数据库名 |
| `surrealdb.username` | string | `root` | 用户名 |
| `surrealdb.password` | string | `root` | 密码 |
| `embedding.endpoint` | string | `http://localhost:8080` | Embedding 服务 |
| `documentImport.watchDir` | string | `~/.openclaw/documents` | 文档监控目录 |
| `documentImport.chunkSize` | number | `500` | 分块大小 |
| `documentImport.chunkOverlap` | number | `50` | 分块重叠 |

---

## 🤖 自动功能

### 1. 自动存储消息

用户发送的每条消息都会自动：
- 分类（TRIVIAL/FACT/PREFERENCE/EVENT/QUESTION）
- 判断是否需要存储
- 存入对应的记忆表（episodic/semantic）

**无需手动操作**

### 2. 自动检索注入

每次构建 prompt 前自动：
- 检索相关记忆（向量相似度）
- 过滤低相关性内容（threshold=0.65）
- 注入到 prompt 开头

**无需手动操作**

### 3. 自动偏好提取

每 10 条对话自动：
- 提取用户 likes/dislikes
- 提取用户 facts/habits
- 存储为 semantic 记忆

**无需手动操作**

### 4. 自动对话摘要

每 10 条对话自动：
- 生成对话摘要
- 存储为 reflection 记忆（importance=0.9）

**无需手动操作**

### 5. 实体自动提取

所有存储的消息自动：
- Layer 1: 正则匹配名词库（~5ms，覆盖率 ~60%）
- Layer 2: 7B 模型精炼提取（~1000ms，覆盖率 ~95%+）

**无需手动操作**

### 6. 实体关系自动索引

后台自动：
- 实体入队
- 关系构建
- 图结构更新

**无需手动操作**

---

## 📝 手动操作

### 手动检索记忆

在对话中调用 `memory_search` 工具：

```
@memory_search query="用户的编程语言经验" top_k=5 threshold=0.6
```

或在代码中：

```typescript
const result = await memory_search({
  query: "用户之前说过什么关于 Python 的事？",
  top_k: 5,
  threshold: 0.6
});

console.log(result.memories);
```

### 手动导入文档

**方式 1：放入监控目录**

```bash
# 将文档放入监控目录
cp ~/Downloads/article.pdf ~/.openclaw/documents/

# 插件会自动导入
```

**方式 2：使用 URL 导入**

```
@document_import {"url": "https://example.com/article"}
```

**方式 3：批量导入脚本**

使用 `import-documents.js` 脚本批量导入 `~/.openclaw/documents` 目录中的所有文档：

```bash
cd ~/.openclaw/plugins/openclaw-memory
npm run import:docs
# 或
node scripts/import-documents.js
```

脚本会自动：
- 扫描 `~/.openclaw/documents` 目录
- 解析所有支持的文档格式（PDF、Word、Markdown）
- 使用智能语义分段
- 将每个片段存储到记忆系统
- 显示导入统计信息

### 手动查看统计

```bash
node dist/memory-cli.ts stats
```

### 手动清理记忆

```bash
node dist/memory-cli.ts cleanup --days=30
```

---

## 🛠️ CLI 工具

### memory-cli.ts

```bash
# 存储记忆
node dist/memory-cli.ts store "用户喜欢 TypeScript" \
  --type=semantic --importance=0.8

# 搜索记忆
node dist/memory-cli.ts search "编程语言" \
  --top-k=5 --threshold=0.6

# 查看统计
node dist/memory-cli.ts stats

# 列出记忆
node dist/memory-cli.ts list --limit=10

# 清理旧记忆
node dist/memory-cli.ts cleanup --days=30
```

### 批量导入脚本

```bash
# 导入 ~/.openclaw/documents 目录中的所有文档
cd ~/.openclaw/plugins/openclaw-memory
npm run import:docs
# 或
node scripts/import-documents.js
```

### services.sh (服务管理)

```bash
# 启动服务
./services.sh start

# 停止服务
./services.sh stop

# 重启服务
./services.sh restart

# 查看状态
./services.sh status

# 查看日志
./services.sh logs llama      # 只看 llama-server
./services.sh logs surrealdb  # 只看 SurrealDB
./services.sh logs all        # 看所有日志
```

---

## 📡 API 参考

### MemoryManager

```typescript
// 存储情景记忆
await mm.storeMemory(sessionId: string, content: string, importance: number): Promise<number>

// 存储语义记忆（带冲突检测）
await mm.storeSemantic(content: string, importance: number, sessionId?: string): Promise<number>

// 存储反思记忆
await mm.storeReflection(summary: string, importance: number, sessionId?: string): Promise<number>

// 检索相关记忆
await mm.retrieveRelevant(query: string, sessionId?: string, topK?: number, threshold?: number): Promise<Memory[]>

// 获取统计
await mm.getStats(): Promise<MemoryStats>

// 运行维护任务
await mm.runMaintenance(): Promise<void>

// 关闭连接
await mm.dispose(): Promise<void>
```

### memory_search Tool

```typescript
// 工具定义
{
  name: 'memory_search',
  description: 'Search memory by query',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query' },
      top_k: { type: 'number', default: 5 },
      threshold: { type: 'number', default: 0.6 }
    }
  },
  execute: async ({ query, top_k, threshold }) => {
    const results = await mm.retrieveRelevant(query, undefined, top_k, threshold);
    return { memories: results };
  }
}
```

---

## 💡 最佳实践

### 1. 性能优化

**Embedding 服务：**
```bash
# 使用 GPU 加速
llama-server \
  --hf-repo lm-kit/bge-m3-gguf \
  --embedding \
  --port 8080 \
  --n-gpu-layers 99
```

**SurrealDB：**
```bash
# 增加缓存大小
surreal start \
  --bind 0.0.0.0:8000 \
  --user root --pass root \
  memory --log debug
```

### 2. 内存管理

**定期清理：**
```bash
# 每周运行一次清理
0 3 * * 0 cd ~/.openclaw/plugins/openclaw-memory && node dist/memory-cli.ts cleanup --days=30
```

**监控内存使用：**
```bash
# 查看 SurrealDB 内存
ps aux | grep surreal
```

### 3. 备份策略

**数据库备份：**
```bash
# 导出 SurrealDB 数据
surreal export \
  --conn ws://localhost:8000 \
  --user root --pass root \
  --ns openclaw --db memory \
  backup.db
```

**本地 Markdown 备份：**
```bash
# 自动备份到 Git
cd ~/.openclaw/workspace/memory
git add *.md && git commit -m "Daily backup" && git push
```

### 4. 调优建议

**相似度阈值：**
- 默认：0.6-0.65（平衡召回和精度）
- 高精度场景：0.7-0.8
- 高召回场景：0.5-0.55

**分块大小：**
- 短文档：300-500 chars
- 长文档：500-1000 chars
- 技术文档：800-1200 chars

---

## 🐛 故障排查

### 常见问题

#### 1. 插件未加载

```bash
# 检查配置语法
cat ~/.openclaw/config.json | python3 -m json.tool

# 查看日志
tail -f ~/.openclaw/logs/gateway.log | grep memory
```

#### 2. 数据库连接失败

```bash
# 检查 SurrealDB 状态
curl http://localhost:8000/rpc

# 重启服务
./services.sh restart
```

#### 3. Embedding 服务不可用

```bash
# 测试服务
curl -X POST http://localhost:8080/embedding \
  -H "Content-Type: application/json" \
  -d '{"input":"test"}'

# 查看日志
tail -f ~/.openclaw/logs/llama-server.log
```

#### 4. 记忆检索结果为空

**原因：** 刚开始使用，数据库中还没有记忆

**解决：** 正常使用一段时间后再测试

#### 5. LLM 分类失败

```bash
# 检查 8082 端口
curl http://localhost:8082

# 查看模型状态
curl http://localhost:8082/health
```

### 日志位置

| 日志类型 | 位置 |
|----------|------|
| 网关日志 | `~/.openclaw/logs/gateway.log` |
| Llama-server | `~/.openclaw/logs/llama-server.log` |
| SurrealDB | `~/.openclaw/logs/surrealdb.log` |
| 维护日志 | `~/.openclaw/logs/memory-maintenance.log` |

### 调试模式

```bash
# 开启详细日志
export DEBUG=openclaw-memory:*

# 重启 OpenClaw
openclaw --debug
```

---

## 📚 相关文档

- [README.md](README.md) - 项目概述
- [ARCHITECTURE.md](ARCHITECTURE.md) - 架构设计
- [CONFIG.md](CONFIG.md) - 配置详解
- [DOCUMENT_IMPORT.md](docs/DOCUMENT_IMPORT.md) - 文档导入指南

---

<div align="center">

**最后更新：** 2026-03-20
**版本：** 2.1.79

</div>

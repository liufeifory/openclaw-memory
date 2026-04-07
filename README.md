# OpenClaw Memory Plugin

基于 SurrealDB 的智能记忆插件，为 OpenClaw AI 助手提供长期记忆能力。

## 特性

- **向量检索** - BGE-M3 语义搜索，1024 维向量
- **知识图谱** - 自动提取实体和关系，支持多跳查询
- **混合检索** - 向量相似度 + 图结构相关性
- **文档导入** - 支持 PDF/Word/Markdown 自动分块入库
- **冲突检测** - 自动识别和更新过时信息

## 安装

```bash
# 1. 安装依赖
npm install

# 2. 编译
npm run build

# 3. 启动 SurrealDB
surreal start --bind 0.0.0.0:8001 memory.db

# 4. 启动 oMLX (Embedding + LLM)
omlx serve --port 8000
```

## 配置

在 `~/.openclaw/openclaw.json` 中配置：

```json
{
  "plugins": {
    "entries": {
      "openclaw-memory": {
        "enabled": true,
        "config": {
          "surrealdb": {
            "url": "ws://127.0.0.1:8001/rpc",
            "namespace": "openclaw",
            "database": "memory",
            "username": "root",
            "password": "root"
          },
          "embedding": {
            "endpoint": "http://localhost:8000/v1/embeddings",
            "model": "bge-m3-mlx-fp16",
            "apiKey": "your-api-key"
          },
          "llm": {
            "localEndpoint": "http://localhost:8000",
            "localApiKey": "your-api-key",
            "localModel": "gemma-4-e4b-it-8bit"
          },
          "documentImport": {
            "watchDir": "~/.openclaw/documents",
            "chunkSize": 500,
            "chunkOverlap": 50
          }
        }
      }
    }
  }
}
```

## CLI 使用

```bash
# 查看统计
node dist/memory-cli.js stats

# 存储记忆
node dist/memory-cli.js store "用户喜欢 TypeScript" --type=semantic

# 搜索记忆
node dist/memory-cli.js search "编程语言偏好" --top-k=5
```

## 测试

```bash
npm test
```

## 架构

```
src/
├── index.ts              # 插件入口
├── config.ts             # 统一配置
├── service-factory.ts    # 服务工厂（单例）
├── memory-manager-surreal.ts  # 记忆管理器
├── surrealdb-client.ts   # SurrealDB 客户端
├── embedding.ts          # 向量嵌入服务
├── llm-client.ts         # LLM 客户端
├── entity-extractor.ts   # 实体提取
├── entity-indexer.ts     # 实体索引（图谱）
├── hybrid-retrieval.ts   # 混合检索
├── document-parser.ts    # 文档解析
├── document-watcher.ts   # 文件监听
└── memory-cli.ts         # 命令行工具
```

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| SURREALDB_URL | http://localhost:8001 | SurrealDB 地址 |
| EMBEDDING_ENDPOINT | http://localhost:8000/v1/embeddings | Embedding 服务 |
| EMBEDDING_MODEL | bge-m3-mlx-fp16 | 向量模型 |
| LLM_ENDPOINT | http://localhost:8000 | LLM 服务 |
| LLM_MODEL | gemma-4-e4b-it-8bit | LLM 模型 |

## License

MIT
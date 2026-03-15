# OpenClaw Memory Plugin - 集成指南

> 🔌 将记忆系统集成到 OpenClaw 和其他系统

---

## 📋 概述

本指南说明如何将 OpenClaw Memory 集成到：

1. **OpenClaw 主程序** - 作为记忆插件
2. **其他 AI 框架** - 作为独立服务
3. **自定义应用** - 通过 HTTP API 或 Node.js 模块

---

## 🧩 集成到 OpenClaw

### 方式一：插件槽位（推荐）

**步骤 1：安装插件**

```bash
cd ~/.openclaw/plugins
git clone https://github.com/liufeifory/openclaw-memory.git
cd openclaw-memory
npm install && npm run build
```

**步骤 2：配置插件槽位**

编辑 `~/.openclaw/config.json`：

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

**步骤 3：重启 OpenClaw**

```bash
openclaw restart
```

### 方式二：手动加载

如果 OpenClaw 支持手动加载插件：

```typescript
import memoryPlugin from './openclaw-memory/dist/index.js'

await openclaw.loadPlugin(memoryPlugin, {
  backend: 'pgvector',
  database: { /* ... */ }
})
```

---

## 🔌 集成到其他 AI 框架

### 作为 HTTP 服务

记忆服务提供独立的 HTTP API，可被任何框架调用。

**启动服务：**

```bash
cd ~/.openclaw/plugins/openclaw-memory
python3 memory_server.py --port 8082
```

**API 端点：**

| 端点 | 方法 | 说明 |
|------|------|------|
| `/health` | GET | 健康检查 |
| `/memory/store` | POST | 存储记忆 |
| `/memory/search` | POST | 搜索记忆 |
| `/memory/stats` | GET | 统计信息 |
| `/memory/maintenance` | POST | 运行维护 |

**示例（Python）：**

```python
import requests

# 存储记忆
requests.post('http://localhost:8082/memory/store', json={
    'session_id': 'session-123',
    'content': '用户喜欢 TypeScript',
    'importance': 0.8
})

# 搜索记忆
response = requests.post('http://localhost:8082/memory/search', json={
    'query': '编程语言偏好',
    'top_k': 5,
    'threshold': 0.6
})
memories = response.json()['memories']
```

**示例（JavaScript）：**

```javascript
// 存储记忆
await fetch('http://localhost:8082/memory/store', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    session_id: 'session-123',
    content: '用户喜欢 TypeScript',
    importance: 0.8
  })
})

// 搜索记忆
const response = await fetch('http://localhost:8082/memory/search', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    query: '编程语言偏好',
    top_k: 5,
    threshold: 0.6
  })
})
const { memories } = await response.json()
```

---

## 📦 作为 Node.js 模块使用

### 安装

```bash
npm install ~/.openclaw/plugins/openclaw-memory
```

### 基本用法

```typescript
import { MemoryManager } from './openclaw-memory/dist/memory-manager.js'

// 初始化
const mm = new MemoryManager({
  backend: 'pgvector',
  database: {
    host: 'localhost',
    port: 5432,
    database: 'openclaw_memory',
    user: 'liufei',
    password: ''
  },
  embedding: {
    endpoint: 'http://localhost:8080'
  }
})

// 存储记忆
await mm.storeMemory('session-123', '用户喜欢 TypeScript', 0.8)

// 搜索记忆
const memories = await mm.retrieveRelevant('编程语言偏好', 'session-123', 5, 0.6)
console.log(memories)

// 关闭
await mm.shutdown()
```

### 使用 Qdrant 后端

```typescript
import { MemoryManager as QdrantMM } from './openclaw-memory/dist/memory-manager-qdrant.js'

const mm = new QdrantMM({
  backend: 'qdrant',
  qdrant: {
    url: 'http://localhost:6333'
  },
  embedding: {
    endpoint: 'http://localhost:8080'
  }
})
```

---

## 🔗 集成到 LangChain

```python
from langchain.memory import ConversationBufferMemory
import requests

class MemoryPluginMemory(ConversationBufferMemory):
    """使用 OpenClaw Memory 插件的 LangChain 记忆类"""
    
    def __init__(self, memory_endpoint='http://localhost:8082'):
        super().__init__()
        self.endpoint = memory_endpoint
    
    def save_context(self, inputs, outputs):
        # 存储用户输入
        requests.post(f'{self.endpoint}/memory/store', json={
            'session_id': self.chat_id,
            'content': inputs.get('input', ''),
            'importance': 0.7
        })
    
    def load_memory_variables(self, inputs):
        # 检索相关记忆
        response = requests.post(f'{self.endpoint}/memory/search', json={
            'query': inputs.get('input', ''),
            'top_k': 3,
            'threshold': 0.6
        })
        memories = response.json().get('memories', [])
        
        # 构建上下文字符串
        context = '\n'.join([m['content'] for m in memories])
        return {'history': context}
```

**使用：**

```python
from langchain.chat_models import ChatOpenAI
from langchain.chains import ConversationChain

memory = MemoryPluginMemory()
llm = ChatOpenAI()
chain = ConversationChain(llm=llm, memory=memory)

chain.run('你好')
```

---

## 🔗 集成到 LlamaIndex

```python
from llama_index.core import VectorStoreIndex, StorageContext
from llama_index.core.memory import ChatMemoryBuffer
import requests

class MemoryPluginVectorStore:
    """使用 OpenClaw Memory 插件的 LlamaIndex 向量存储"""
    
    def __init__(self, endpoint='http://localhost:8082'):
        self.endpoint = endpoint
    
    def add(self, nodes):
        for node in nodes:
            requests.post(f'{self.endpoint}/memory/store', json={
                'session_id': 'llamaindex',
                'content': node.text,
                'importance': 0.8
            })
    
    def query(self, query_str, top_k=5):
        response = requests.post(f'{self.endpoint}/memory/search', json={
            'query': query_str,
            'top_k': top_k,
            'threshold': 0.5
        })
        return response.json().get('memories', [])
```

**使用：**

```python
from llama_index.core import Settings

Settings.memory = ChatMemoryBuffer.from_defaults()
# 自定义向量存储
```

---

## 🌐 集成到自定义 Web 应用

### 前端调用示例（React）

```typescript
import { useState } from 'react'

function useMemory() {
  const [memories, setMemories] = useState([])
  
  const search = async (query: string) => {
    const response = await fetch('http://localhost:8082/memory/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query,
        top_k: 5,
        threshold: 0.6
      })
    })
    const data = await response.json()
    setMemories(data.memories)
    return data.memories
  }
  
  const store = async (content: string, importance = 0.7) => {
    await fetch('http://localhost:8082/memory/store', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id: 'web-app',
        content,
        importance
      })
    })
  }
  
  return { memories, search, store }
}
```

### 后端中间件（Express）

```typescript
import express from 'express'
import fetch from 'node-fetch'

const app = express()
const MEMORY_ENDPOINT = 'http://localhost:8082'

// 中间件：自动注入记忆上下文
app.use(async (req, res, next) => {
  if (req.body.message) {
    try {
      const response = await fetch(`${MEMORY_ENDPOINT}/memory/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: req.body.message,
          top_k: 3,
          threshold: 0.6
        })
      })
      const { memories } = await response.json()
      req.memoryContext = memories
    } catch (e) {
      console.error('Memory search failed:', e)
    }
  }
  next()
})

// 路由：存储用户输入
app.post('/api/chat', async (req, res) => {
  // 存储记忆
  await fetch(`${MEMORY_ENDPOINT}/memory/store`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      session_id: req.session.id,
      content: req.body.message,
      importance: 0.7
    })
  })
  
  // 使用记忆上下文生成响应
  const context = req.memoryContext?.map(m => m.content).join('\n') || ''
  // ... 调用 LLM
})
```

---

## 🔐 安全集成

### API 密钥认证

如果 Qdrant 启用了 API 密钥：

```json
{
  "plugins": {
    "openclaw-memory": {
      "backend": "qdrant",
      "qdrant": {
        "url": "http://localhost:6333",
        "apiKey": "your-api-key"
      }
    }
  }
}
```

### 数据库认证

PostgreSQL 配置密码：

```json
{
  "database": {
    "host": "localhost",
    "port": 5432,
    "database": "openclaw_memory",
    "user": "openclaw",
    "password": "your_secure_password"
  }
}
```

### 环境变量（推荐用于生产）

```bash
export MEMORY_DB_HOST=localhost
export MEMORY_DB_PORT=5432
export MEMORY_DB_NAME=openclaw_memory
export MEMORY_DB_USER=openclaw
export MEMORY_DB_PASS=your_secure_password
export MEMORY_QDRANT_API_KEY=your-api-key
```

---

## 🧪 测试集成

### 健康检查

```bash
curl http://localhost:8082/health
# 预期：{"status":"ok"}
```

### 端到端测试

```bash
# 1. 存储记忆
curl -X POST http://localhost:8082/memory/store \
  -H "Content-Type: application/json" \
  -d '{"session_id":"test","content":"测试记忆","importance":0.8}'

# 2. 搜索记忆
curl -X POST http://localhost:8082/memory/search \
  -H "Content-Type: application/json" \
  -d '{"query":"测试","top_k":5,"threshold":0.6}'

# 3. 查看统计
curl http://localhost:8082/memory/stats
```

---

## 📚 相关文档

- [README.md](README.md) - 快速开始
- [QUICKSTART.md](QUICKSTART.md) - 5 分钟上手
- [CONFIG.md](CONFIG.md) - 配置详解
- [ARCHITECTURE.md](ARCHITECTURE.md) - 架构说明

---

<div align="center">

**最后更新：** 2026-03-15  
**版本：** 2.1.0

</div>

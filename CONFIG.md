# OpenClaw Memory Plugin - 配置详解

> ⚙️ 完整配置选项参考

---

## 📋 配置位置

OpenClaw 配置文件：`~/.openclaw/config.json`

---

## 🏗️ 基础配置结构

```json
{
  "plugins": {
    "slots": {
      "memory": "openclaw-memory"
    },
    "openclaw-memory": {
      // 插件配置
    }
  }
}
```

**必填字段：**

| 字段 | 说明 |
|------|------|
| `plugins.slots.memory` | 指定记忆插件为 `openclaw-memory` |
| `plugins.openclaw-memory` | 插件具体配置 |

---

## 🗄️ 后端配置

### SurrealDB 配置（推荐）

```json
{
  "plugins": {
    "slots": {
      "memory": "openclaw-memory"
    },
    "openclaw-memory": {
      "backend": "surrealdb",
      "surrealdb": {
        "url": "http://localhost:8000",
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

**参数说明：**

| 字段 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `backend` | string | 是 | `surrealdb` | 后端类型 |
| `surrealdb.url` | string | 是 | `http://localhost:8000` | SurrealDB 服务地址 |
| `surrealdb.namespace` | string | 是 | `openclaw` | 命名空间 |
| `surrealdb.database` | string | 是 | `memory` | 数据库名称 |
| `surrealdb.username` | string | 是 | `root` | 用户名 |
| `surrealdb.password` | string | 否 | `root` | 密码 |
| `embedding.endpoint` | string | 是 | `http://localhost:8080` | Embedding 服务地址 |

**特性：**
- ✅ 原生图数据库支持（RELATE 建边）
- ✅ 向量索引 + 图遍历混合检索
- ✅ 自动 TTL 清理
- ✅ 单二进制部署，无需额外依赖

### PostgreSQL (pgvector) 配置（已弃用）

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

**参数说明：**

| 字段 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `backend` | string | 是 | `pgvector` | 后端类型 |
| `database.host` | string | 是 | `localhost` | PostgreSQL 主机地址 |
| `database.port` | number | 是 | `5432` | PostgreSQL 端口 |
| `database.database` | string | 是 | `openclaw_memory` | 数据库名称 |
| `database.user` | string | 是 | - | 数据库用户名 |
| `database.password` | string | 否 | `""` | 数据库密码 |
| `embedding.endpoint` | string | 是 | `http://localhost:8080` | Embedding 服务地址 |

### Qdrant 配置

```json
{
  "plugins": {
    "slots": {
      "memory": "openclaw-memory"
    },
    "openclaw-memory": {
      "backend": "qdrant",
      "qdrant": {
        "url": "http://localhost:6333",
        "port": 6333,
        "apiKey": ""
      },
      "embedding": {
        "endpoint": "http://localhost:8080"
      }
    }
  }
}
```

**参数说明：**

| 字段 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `backend` | string | 是 | `qdrant` | 后端类型 |
| `qdrant.url` | string | 是 | `http://localhost:6333` | Qdrant 服务地址 |
| `qdrant.port` | number | 否 | `6333` | Qdrant 端口 |
| `qdrant.apiKey` | string | 否 | `""` | API 密钥（如有） |
| `embedding.endpoint` | string | 是 | `http://localhost:8080` | Embedding 服务地址 |

---

## 🔍 检索配置

```json
{
  "plugins": {
    "openclaw-memory": {
      "retrieval": {
        "top_k": 5,
        "threshold": 0.65,
        "timeout_ms": 1000,
        "max_context_length": 500
      }
    }
  }
}
```

**参数说明：**

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `top_k` | number | `5` | 检索返回的记忆数量 |
| `threshold` | number | `0.65` | 相似度阈值（0-1） |
| `timeout_ms` | number | `1000` | 检索超时时间（毫秒） |
| `max_context_length` | number | `500` | 注入上下文的最大字符数 |

**调优建议：**

| 场景 | 推荐配置 |
|------|----------|
| 结果不相关 | `threshold: 0.7` |
| 结果太少 | `threshold: 0.5`, `top_k: 10` |
| 响应慢 | `timeout_ms: 500`, `top_k: 3` |
| 需要更多上下文 | `max_context_length: 1000` |

---

## ⚡ 重要性配置

```json
{
  "plugins": {
    "openclaw-memory": {
      "importance": {
        "base_weights": {
          "episodic": 0.6,
          "semantic": 0.8,
          "reflection": 0.9
        },
        "decay_rate": 0.98,
        "decay_interval_hours": 24,
        "promotion_threshold": 10,
        "access_weight": 0.3,
        "recency_weight": 0.2
      }
    }
  }
}
```

**参数说明：**

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `base_weights.episodic` | number | `0.6` | 情景记忆基础重要性 |
| `base_weights.semantic` | number | `0.8` | 语义记忆基础重要性 |
| `base_weights.reflection` | number | `0.9` | 反思记忆基础重要性 |
| `decay_rate` | number | `0.98` | 每日衰减率（0-1） |
| `decay_interval_hours` | number | `24` | 衰减执行间隔（小时） |
| `promotion_threshold` | number | `10` | 访问次数达到此值提升为语义记忆 |
| `access_weight` | number | `0.3` | 访问次数在重要性计算中的权重 |
| `recency_weight` | number | `0.2` | 新鲜度在重要性计算中的权重 |

**重要性计算公式：**

```
importance = base_importance × 0.5
           + log(access_count + 1) × access_weight
           + exp(-days / 30) × recency_weight
```

---

## 🤖 自动功能配置

```json
{
  "plugins": {
    "openclaw-memory": {
      "auto": {
        "store_enabled": true,
        "inject_enabled": true,
        "preference_extraction": {
          "enabled": true,
          "interval_messages": 10
        },
        "summarization": {
          "enabled": true,
          "interval_messages": 10
        },
        "maintenance": {
          "enabled": true,
          "interval_hours": 24
        }
      }
    }
  }
}
```

**参数说明：**

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `store_enabled` | boolean | `true` | 启用自动存储消息 |
| `inject_enabled` | boolean | `true` | 启用自动注入记忆上下文 |
| `preference_extraction.enabled` | boolean | `true` | 启用偏好提取 |
| `preference_extraction.interval_messages` | number | `10` | 每多少条消息提取一次偏好 |
| `summarization.enabled` | boolean | `true` | 启用对话摘要 |
| `summarization.interval_messages` | number | `10` | 每多少条消息生成一次摘要 |
| `maintenance.enabled` | boolean | `true` | 启用自动维护（衰减/提升） |
| `maintenance.interval_hours` | number | `24` | 维护执行间隔（小时） |

---

## 🎯 消息分类配置

```json
{
  "plugins": {
    "openclaw-memory": {
      "filter": {
        "trivial_patterns": [
          "你好",
          "谢谢",
          "再见",
          "早上好",
          "晚安"
        ],
        "min_message_length": 3,
        "llm_endpoint": "http://localhost:8081",
        "llm_timeout_ms": 500
      }
    }
  }
}
```

**参数说明：**

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `trivial_patterns` | string[] | 见上 | 忽略的关键词列表 |
| `min_message_length` | number | `3` | 最小消息长度（短于此长度忽略） |
| `llm_endpoint` | string | `http://localhost:8081` | LLM 服务地址 |
| `llm_timeout_ms` | number | `500` | LLM 分类超时（毫秒） |

**LLM 端点说明：**

| 端口 | 模型 | 用途 |
|------|------|------|
| 8081 | Llama-3.2-1B | 消息分类、偏好提取、对话摘要、Reranker |
| 8082 | Qwen2.5-Coder-7B | 实体提取、三元组精炼（Layer 3） |

---

## 🔒 安全配置

```json
{
  "plugins": {
    "openclaw-memory": {
      "security": {
        "encrypt_at_rest": false,
        "pii_detection": {
          "enabled": true,
          "redact": true
        },
        "session_isolation": true
      }
    }
  }
}
```

**参数说明：**

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `encrypt_at_rest` | boolean | `false` | 启用静态加密（需要额外配置） |
| `pii_detection.enabled` | boolean | `true` | 启用 PII（个人敏感信息）检测 |
| `pii_detection.redact` | boolean | `true` | 自动脱敏 PII |
| `session_isolation` | boolean | `true` | 会话隔离（不同会话记忆不共享） |

---

## 📊 日志配置

```json
{
  "plugins": {
    "openclaw-memory": {
      "logging": {
        "level": "info",
        "file": "~/.openclaw/logs/memory.log",
        "max_size_mb": 10,
        "max_files": 5,
        "verbose_hooks": false
      }
    }
  }
}
```

**参数说明：**

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `level` | string | `info` | 日志级别：`debug`、`info`、`warn`、`error` |
| `file` | string | `~/.openclaw/logs/memory.log` | 日志文件路径 |
| `max_size_mb` | number | `10` | 单文件最大大小（MB） |
| `max_files` | number | `5` | 保留的最大文件数 |
| `verbose_hooks` | boolean | `false` | 详细 Hook 日志 |

---

## 🧪 开发/调试配置

```json
{
  "plugins": {
    "openclaw-memory": {
      "debug": {
        "enabled": false,
        "mock_embedding": false,
        "mock_llm": false,
        "skip_vector_search": false,
        "log_all_queries": true
      }
    }
  }
}
```

**参数说明：**

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `enabled` | boolean | `false` | 启用调试模式 |
| `mock_embedding` | boolean | `false` | 使用模拟 Embedding（随机向量） |
| `mock_llm` | boolean | `false` | 使用模拟 LLM |
| `skip_vector_search` | boolean | `false` | 跳过向量搜索（用于测试） |
| `log_all_queries` | boolean | `true` | 记录所有查询 |

---

## 📝 完整配置示例

### 生产环境（SurrealDB - 推荐）

```json
{
  "plugins": {
    "slots": {
      "memory": "openclaw-memory"
    },
    "openclaw-memory": {
      "backend": "surrealdb",
      "surrealdb": {
        "url": "http://localhost:8000",
        "namespace": "openclaw",
        "database": "memory",
        "username": "root",
        "password": "your_secure_password"
      },
      "embedding": {
        "endpoint": "http://localhost:8080"
      },
      "retrieval": {
        "top_k": 5,
        "threshold": 0.65,
        "timeout_ms": 1000
      },
      "importance": {
        "decay_rate": 0.98,
        "promotion_threshold": 10
      },
      "auto": {
        "store_enabled": true,
        "inject_enabled": true,
        "preference_extraction": {
          "enabled": true,
          "interval_messages": 10
        },
        "summarization": {
          "enabled": true,
          "interval_messages": 10
        }
      },
      "logging": {
        "level": "info",
        "file": "~/.openclaw/logs/memory.log"
      }
    }
  }
}
```

### 开发环境（SurrealDB + 调试）

```json
{
  "plugins": {
    "slots": {
      "memory": "openclaw-memory"
    },
    "openclaw-memory": {
      "backend": "surrealdb",
      "surrealdb": {
        "url": "http://localhost:8000",
        "namespace": "openclaw",
        "database": "memory",
        "username": "root",
        "password": "root"
      },
      "embedding": {
        "endpoint": "http://localhost:8080"
      },
      "retrieval": {
        "top_k": 10,
        "threshold": 0.5,
        "timeout_ms": 2000
      },
      "debug": {
        "enabled": true,
        "log_all_queries": true
      },
      "logging": {
        "level": "debug",
        "verbose_hooks": true
      }
    }
  }
}
```

### 最小配置（快速测试）

```json
{
  "plugins": {
    "slots": {
      "memory": "openclaw-memory"
    },
    "openclaw-memory": {
      "backend": "surrealdb",
      "surrealdb": {
        "url": "http://localhost:8000",
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

---

## 🔧 环境变量（可选）

也可以通过环境变量配置：

```bash
# SurrealDB 配置
export MEMORY_SURREALDB_URL=http://localhost:8000
export MEMORY_NAMESPACE=openclaw
export MEMORY_DATABASE=memory
export MEMORY_USERNAME=root
export MEMORY_PASSWORD=your_secure_password

# Embedding 配置
export MEMORY_EMBEDDING_ENDPOINT=http://localhost:8080

# LLM 配置
export MEMORY_LLM_ENDPOINT=http://localhost:8081        # 1B 模型
export MEMORY_ENTITY_LLM_ENDPOINT=http://localhost:8082 # 7B 模型（实体提取）

# 检索配置
export MEMORY_TOP_K=5
export MEMORY_THRESHOLD=0.65
export MEMORY_TIMEOUT_MS=1000
```

---

## ✅ 配置验证

### 检查配置语法

```bash
cat ~/.openclaw/config.json | python3 -m json.tool
```

### 测试配置

```bash
# 重启 OpenClaw
openclaw restart

# 查看插件状态
openclaw plugins list

# 查看日志
tail -f ~/.openclaw/logs/gateway.log | grep memory
```

### 预期日志输出

```
[openclaw-memory] Plugin initialized with SurrealDB
[openclaw-memory] Plugin registered
```

---

## 📚 相关文档

- [README.md](README.md) - 快速开始
- [USAGE.md](USAGE.md) - 使用指南
- [ARCHITECTURE.md](ARCHITECTURE.md) - 架构说明

---

<div align="center">

**最后更新：** 2026-03-16
**版本：** 2.2.0

</div>

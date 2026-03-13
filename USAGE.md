# OpenClaw Memory Plugin 使用指南

## 快速开始

### 1. 安装依赖

```bash
pip install psycopg2-binary requests
```

### 2. 初始化数据库

```sql
-- 执行 schema.sql 创建表结构
psql -U postgres -d openclaw -f schema.sql
```

### 3. 基本使用

```python
from plugin import OpenClawMemoryPlugin

# 配置数据库连接
config = {
    "host": "localhost",
    "port": 5432,
    "database": "openclaw",
    "user": "postgres",
    "password": "your_password"
}

# 初始化插件
plugin = OpenClawMemoryPlugin(config)

# 处理用户消息
context = plugin.on_user_message(
    session_id="user-123",
    message="我想学习 Python 编程",
    recent_conversation="User: 你好\nAssistant: 你好！有什么可以帮助你的？"
)

print(context)
# 输出:
# SYSTEM:
#
# Key insights:
# - 用户正在学习编程
#
# Relevant memories:
# - 用户对 Python 感兴趣
```

## API 参考

### OpenClawMemoryPlugin

#### `on_user_message(session_id, message, recent_conversation=None)`
处理用户消息，返回带记忆的上下文。

```python
context = plugin.on_user_message(
    session_id="session-001",
    message="今天天气不错",
    recent_conversation="User: 早上好\nAssistant: 早上好！"
)
```

#### `on_assistant_message(session_id, message, importance=0.3)`
存储助手回复（可选）。

```python
plugin.on_assistant_message(
    session_id="session-001",
    message="Python 是一门很好的编程语言"
)
```

#### `get_memory_stats()`
获取记忆系统统计信息。

```python
stats = plugin.get_memory_stats()
print(stats)
# {'episodic_count': 50, 'semantic_count': 10, 'reflection_count': 1}
```

#### `run_maintenance()`
运行维护操作（衰减、提升、生成反思）。

```python
results = plugin.run_maintenance()
print(results)
# {'decayed': 5, 'promoted': 2, 'reflections_generated': 0}
```

#### `shutdown()`
关闭插件并释放资源。

```python
plugin.shutdown()
```

## 高级用法

### 直接使用 MemoryManager

```python
from database import Database
from memory_manager import MemoryManager

db = Database(config)
manager = MemoryManager(db)

# 检索相关记忆
memories = manager.retrieve_relevant("Python 编程", top_k=10, threshold=0.6)

# 构建上下文
context = manager.build_context(
    session_id="session-001",
    memories=memories,
    recent_conversation="..."
)

# 异步存储记忆
manager.async_store("session-001", "用户想学习 Python")

# 手动存储语义记忆
memory_id = manager.store_semantic("用户是程序员", importance=0.8)

# 运行维护
results = manager.run_maintenance()
```

### 使用各个组件

```python
from episodic_memory import EpisodicMemory, EpisodicMemoryStore
from semantic_memory import SemanticMemoryStore
from reflection_memory import ReflectionMemoryStore
from importance_learning import ImportanceLearning
from context_builder import ContextBuilder

# 存储情景记忆
episodic = EpisodicMemory(
    session_id="session-001",
    content="今天安装了 PostgreSQL",
    importance=0.7
)
store = EpisodicMemoryStore(db)
memory_id = store.store(episodic)

# 计算动态重要性
learner = ImportanceLearning()
importance = learner.calculate(
    base_importance=0.7,
    access_count=5,
    created_at=episdic.created_at
)

# 构建上下文
builder = ContextBuilder()
context = builder.build_context(
    session_id="session-001",
    relevant_memories=memories,
    reflection_memories=reflections
)
```

## 集成到 OpenClaw

```python
# 在 OpenClaw 主程序中
from openclaw_memory import OpenClawMemoryPlugin

class OpenClawAgent:
    def __init__(self, config):
        self.memory = OpenClawMemoryPlugin(config)

    def chat(self, session_id, user_message, conversation_history):
        # 获取带记忆的上下文
        context = self.memory.on_user_message(
            session_id=session_id,
            message=user_message,
            recent_conversation=conversation_history
        )

        # 调用 LLM
        response = self.llm.generate(context + "\n" + user_message)

        # 存储助手回复
        self.memory.on_assistant_message(session_id, response)

        return response

    def cleanup(self):
        self.memory.shutdown()
```

## 配置 embedding endpoint

```python
from embedding_model import EmbeddingModel

# 使用自定义 endpoint
model = EmbeddingModel(endpoint="http://127.0.0.1:8080/embedding")

# 生成 embedding
embedding = model.embed_single("Hello world")
print(len(embedding))  # 1024
```

## 记忆类型说明

| 类型 | 用途 | 重要性 | 提升条件 |
|------|------|--------|----------|
| Episodic | 事件/经历 | 动态 | access_count > 10 提升为 Semantic |
| Semantic | 稳定知识 | 较高 | - |
| Reflection | 总结洞察 | 0.9 (固定) | 每 50 条 Episodic 自动生成 |

## 维护计划

建议每天运行一次维护：

```python
import schedule
import time

def daily_maintenance():
    results = plugin.run_maintenance()
    print(f"维护完成：{results}")

schedule.every().day.at("03:00").do(daily_maintenance)

while True:
    schedule.run_pending()
    time.sleep(60)
```

## 注意事项

1. **数据库连接**：确保 PostgreSQL 已安装 pgvector 扩展
2. **Embedding 服务**：确保本地 embedding 服务在运行
3. **资源清理**：使用 `shutdown()` 释放线程池资源
4. **错误处理**：插件内部有异常处理，不会中断对话

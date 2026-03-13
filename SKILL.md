---
name: openclaw-memory
description: "PostgreSQL-based long-term memory with semantic search using pgvector. Replaces file-based MEMORY.md system. Use for: (1) semantic memory retrieval, (2) vector similarity search, (3) long-term context storage, (4) importance-based memory ranking. Requires PostgreSQL with pgvector extension."
metadata:
  {
    "openclaw": {
      "emoji": "🧠",
      "kind": "memory",
      "requires": { "config": ["postgresql.host"] }
    },
  }
allowed-tools: ["bash"]
---

# Memory Search (Semantic Retrieval)

Search long-term memory using vector similarity search via PostgreSQL + pgvector.

## Configuration

Requires PostgreSQL with pgvector extension:

```yaml
# In OpenClaw config
memory:
  postgresql:
    host: localhost
    port: 5432
    database: openclaw
    user: postgres
    password: <password>
```

## Quick Start

```bash
# Search memory (Python skill)
python3 ~/.openclaw/plugins/openclaw-memory/scripts/search.py "user's programming experience"
```

## Memory Types

| Type | Description | Promotion |
|------|-------------|-----------|
| **Episodic** | Events, experiences, conversations | access_count > 10 → Semantic |
| **Semantic** | Stable knowledge, facts about user | - |
| **Reflection** | Summarized insights from episodes | Auto-generated every 50 episodes |

## Retrieval Parameters

- **top_k**: 10 (initial results)
- **threshold**: 0.6 (minimum similarity)
- **final_results**: 5 (returned to user)
- **scoring**: similarity × importance

## Importance Formula

```
importance = 0.5 × base + 0.3 × log(access + 1) + 0.2 × recency
```

Recency decay: `exp(-days_since_creation / 30)`

## Usage Examples

### Search for user context
```bash
python3 scripts/search.py "What does the user know about Python?"
```

### Find past conversations
```bash
python3 scripts/search.py "Discussion about database design"
```

### Get related experiences
```bash
python3 scripts/search.py "User's experience with cloud deployment"
```

## Output Format

Returns JSON array:
```json
[
  {
    "type": "episodic",
    "content": "User installed PostgreSQL",
    "importance": 0.75,
    "similarity": 0.85
  }
]
```

## Memory Lifecycle

1. **Store** - New memories stored asynchronously
2. **Retrieve** - Vector similarity search with importance scoring
3. **Decay** - Daily: importance ×= 0.98
4. **Promote** - Episodic → Semantic when access_count > 10
5. **Reflect** - Generate reflection every 50 episodic memories

## Maintenance

Run weekly:
```bash
python3 scripts/maintenance.py
```

Performs:
- Apply decay to old memories
- Promote frequently accessed memories
- Generate reflection summaries

## Scripts

| Script | Purpose |
|--------|---------|
| `search.py <query>` | Search memories by semantic similarity |
| `store.py <content>` | Store new memory |
| `maintenance.py` | Run maintenance tasks |
| `stats.py` | Show memory statistics |

## Troubleshooting

**Connection errors:** Check PostgreSQL is running and pgvector installed:
```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

**No results:** Lower threshold or check embedding service:
```bash
curl http://localhost:8080/embedding -d '{"input":"test"}'
```

## Embedding Service

Uses local HTTP endpoint: `http://localhost:8080/embedding`

Returns 1024-dimensional normalized BGE-M3 embeddings.

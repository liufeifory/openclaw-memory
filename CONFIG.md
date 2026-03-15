# OpenClaw Memory Plugin - Configuration Examples

## SurrealDB Backend (Recommended for Single Database Setup)

```json
{
  "plugins": {
    "openclaw-memory": {
      "enabled": true,
      "config": {
        "backend": "surrealdb",
        "surrealdb": {
          "url": "ws://localhost:8000",
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
}
```

### Starting SurrealDB

```bash
# Using Docker
docker run --rm -p 8000:8000 surrealdb/surrealdb:latest start --log debug --user root --pass root memory

# Using binary (Linux/macOS)
curl --proto '=https' --tlsv1.2 -sSf https://install.surrealdb.com | sh
./surreal start --user root --pass root memory
```

## Qdrant Backend

```json
{
  "plugins": {
    "openclaw-memory": {
      "enabled": true,
      "config": {
        "backend": "qdrant",
        "qdrant": {
          "url": "http://localhost:6333",
          "apiKey": ""
        },
        "embedding": {
          "endpoint": "http://localhost:8080"
        }
      }
    }
  }
}
```

### Starting Qdrant

```bash
# Using Docker
docker run -d -p 6333:6333 -p 6334:6334 qdrant/qdrant
```

## PostgreSQL (pgvector) Backend

```json
{
  "plugins": {
    "openclaw-memory": {
      "enabled": true,
      "config": {
        "backend": "pgvector",
        "database": {
          "host": "localhost",
          "port": 5432,
          "database": "openclaw",
          "user": "postgres",
          "password": "postgres"
        },
        "embedding": {
          "endpoint": "http://localhost:8080"
        }
      }
    }
  }
}
```

### Starting PostgreSQL with pgvector

```bash
# Using Docker
docker run -d -p 5432:5432 -e POSTGRES_PASSWORD=postgres pgvector/pgvector:pg16
```

## Features

### Message Queue + Background Worker

All backends now use a message queue + background worker architecture:

- **Non-blocking**: Hook returns immediately, message storage happens in background
- **Fault tolerant**: Memory system failures don't affect main conversation flow
- **Async processing**: Errors are logged but don't crash the plugin

### Local File Memory

Local Markdown file writing is preserved for all backends:

- Files written to: `~/.openclaw/workspace/memory/YYYY-MM-DD.md`
- Compatible with `self-improving-agent` skills
- Not affected by backend choice

### Session Isolation

All memory types support session-based filtering:

- Episodic memories: Scoped to session
- Semantic memories: Can be global or session-scoped
- Reflection memories: Can be global or session-scoped

## Testing

```bash
# Test SurrealDB backend
npm run build
node dist/test-surreal.js

# Test Qdrant backend
node dist/test-qdrant.js

# Test full features
node dist/test-full.js
```

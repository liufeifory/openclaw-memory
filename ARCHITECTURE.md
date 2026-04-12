# Architecture — OpenClaw Memory Plugin

This plugin provides long-term memory with semantic search for OpenClaw, using SurrealDB as backend.

**LLM: Cloud-only** (no local model required)

## Repository layout

| Path | Role |
|------|------|
| `src/index.ts` | Plugin entry point: tools registration, hooks, message queue |
| `src/service-factory.ts` | **Single source of truth** for all service instances |
| `src/config.ts` | Configuration types and defaults |
| `src/llm-client.ts` | Cloud LLM client (OpenAI-compatible API) |
| `src/memory-manager-surreal.ts` | Orchestrates all memory operations |
| `src/memory-store-surreal.ts` | CRUD operations for memories (episodic/semantic/reflection) |
| `src/hybrid-retrieval.ts` | Vector + Graph + Topic hybrid retrieval |
| `src/entity-indexer.ts` | Graph indexing with explosion protection |
| `src/knowledge-graph/` | Term knowledge system (term extraction + graph building) |
| `src/term-extraction/` | Multi-domain term extraction pipeline |
| `src/v3/` | Knowledge compilation system (standalone, not used by main system) |

## Configuration (Required)

```json
{
  "llm": {
    "cloudProvider": "bailian",  // or "openai", "deepseek", "custom"
    "cloudBaseUrl": "https://dashscope.aliyuncs.com/compatible-mode/v1",
    "cloudApiKey": "sk-xxx",
    "cloudModel": "qwen-plus"
  }
}
```

**No local model required** - All LLM tasks go to cloud API.

## Service Factory (Critical)

**All services must be obtained from ServiceFactory:**

```typescript
// CORRECT - Single entry point
const db = ServiceFactory.getDB();
const embedding = ServiceFactory.getEmbedding();
const llm = ServiceFactory.getLLM();  // Cloud-only

// WRONG - Direct instantiation
const llm = new LLMClient(config);  // ❌
```

## LLM Tasks (All Cloud)

| Task | Frequency | Model Task Type |
|------|-----------|-----------------|
| MemoryFilter.classify | High (every message) | `memory-filter` |
| Reranker.rerank | High (every retrieval) | `reranker` |
| EntityExtractor.extract | Medium (queue) | `entity-extractor` |
| ConflictDetector.detect | Medium | `conflict-detector` |
| PreferenceExtractor.extract | Low (every 10 msgs) | `preference` |
| Summarizer.summarize | Low (every 10 msgs) | `summarizer` |
| KnowledgeGraphBuilder.extractLLMRelations | Low (doc import) | `knowledge-graph` |
| TopicIndexer.nameTopics | Low | `topic-naming` |

## Data flow

```
OpenClaw Core
    ↓ registerHook('message_received')
src/index.ts
    ↓ enqueueMessage()
Background Queue Worker
    ↓ processQueue()
    ↓ MemoryFilter.classify() → Cloud LLM
    ↓ storeMemory()
    ↓ (every 10 messages) PreferenceExtractor → Cloud LLM
    ↓ (every 10 messages) Summarizer → Cloud LLM
```

## Key design principles

1. **Cloud-only LLM** - No local model dependency, saves memory
2. **Single entry point** - ServiceFactory instantiates all services
3. **Lazy initialization** - Services created on first access
4. **Config-driven** - All behavior controlled by `config.ts`
5. **Zero-cost intent** - Keyword matching before retrieval (no LLM)
6. **Graph protection** - EntityIndexer prevents explosion
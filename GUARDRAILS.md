# Guardrails — OpenClaw Memory Plugin

Rules for **human contributors** and **AI agents** working on this codebase.

## Non-negotiables

1. **Cloud LLM required** — `llm.cloudBaseUrl` and `llm.cloudApiKey` are mandatory. No local model fallback.

2. **Never instantiate services directly** — Use `ServiceFactory.getDB/getLLM/getEmbedding()`. Only ServiceFactory itself may instantiate services.

3. **Never pass services as constructor parameters** — Components must get services internally from ServiceFactory. Constructor params are for business config only.

4. **Never hardcode config values** — URLs, ports, timeouts, file paths must come from `config.ts` or environment variables.

5. **Never add `console.log` in production code** — Use `logInfo/logWarn/logError` from `maintenance-logger.ts`.

6. **Never modify interface without updating all usage sites** — Run `grep -rn "InterfaceName"` before modifying, verify all locations are updated.

## Signs (recurring failure patterns)

### Sign: Cloud LLM config missing

- **Trigger**: Error `[ServiceFactory] LLM cloudBaseUrl and cloudApiKey required`
- **Instruction**: Add to config: `"llm": { "cloudBaseUrl": "...", "cloudApiKey": "..." }`
- **Reason**: Plugin requires cloud LLM for all classification/summarization tasks.

### Sign: Service passed through multiple layers

- **Trigger**: Constructor chain like `new A(db, embedding, llm)` → `new B(db, embedding, llm)`
- **Instruction**: Remove service params. Each component calls `ServiceFactory.getX()` internally.
- **Reason**: Config changes require modifying many files instead of just `config.ts`.

### Sign: Config value hardcoded

- **Trigger**: URL like `http://localhost:8080` in code
- **Instruction**: Move to `src/config.ts` or pass as constructor config option.
- **Reason**: Hardcoded values prevent environment-specific configuration.

### Sign: Duplicate service instances

- **Trigger**: `grep -rn "new LLMClient"` returns results outside ServiceFactory
- **Instruction**: Remove direct instantiation, use ServiceFactory instead.
- **Reason**: Multiple instances cause inconsistent behavior.

## Pre-commit checklist

```bash
# Service factory check (should only show ServiceFactory.ts)
grep -rn "new LLMClient\|new SurrealDatabase\|new EmbeddingService" src/

# Cloud config check
grep -rn "cloudBaseUrl\|cloudApiKey" src/config.ts

# ESLint check
npm run lint
```

## Escalation

Stop and ask a **human maintainer** when:

- Cloud LLM provider needs adding (API compatibility)
- ServiceFactory needs a new service type (architectural decision)
- Database schema changes (migration required)
- Requirements conflict (e.g., cost vs. quality)

## Related docs

- [ARCHITECTURE.md](ARCHITECTURE.md) — components and data flow (cloud-only LLM)
- [docs/term-system-integration.md](docs/term-system-integration.md) — term knowledge system integration
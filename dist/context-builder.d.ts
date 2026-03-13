/**
 * Context builder for LLM integration.
 */
import type { MemoryWithSimilarity } from './memory-types.js';
import type { ReflectionMemory } from './memory-types.js';
export interface ContextOptions {
    maxMemories?: number;
    minMemories?: number;
}
export declare class ContextBuilder {
    private readonly maxMemories;
    private readonly minMemories;
    constructor(options?: ContextOptions);
    buildContext(sessionId: string, relevantMemories: MemoryWithSimilarity[], reflectionMemories?: ReflectionMemory[], recentConversation?: string): string;
}
//# sourceMappingURL=context-builder.d.ts.map
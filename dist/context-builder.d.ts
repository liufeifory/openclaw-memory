/**
 * Context builder for LLM integration.
 *
 * Configurable proportions for different context sections.
 */
import type { MemoryWithSimilarity } from './memory-types.js';
import type { ReflectionMemory } from './memory-types.js';
export interface ContextOptions {
    maxMemories?: number;
    minMemories?: number;
    reflectionRatio?: number;
    preferenceRatio?: number;
    memoryRatio?: number;
    conversationRatio?: number;
}
export declare class ContextBuilder {
    private readonly maxMemories;
    private readonly minMemories;
    private readonly reflectionRatio;
    private readonly preferenceRatio;
    private readonly memoryRatio;
    private readonly conversationRatio;
    constructor(options?: ContextOptions);
    buildContext(sessionId: string, relevantMemories: MemoryWithSimilarity[], reflectionMemories?: ReflectionMemory[], recentConversation?: string, preferences?: Array<{
        category: string;
        items: string[];
    }>): string;
}
//# sourceMappingURL=context-builder.d.ts.map
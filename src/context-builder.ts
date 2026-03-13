/**
 * Context builder for LLM integration.
 */

import type { MemoryWithSimilarity } from './memory-types.js';
import type { ReflectionMemory } from './memory-types.js';

export interface ContextOptions {
  maxMemories?: number;
  minMemories?: number;
}

export class ContextBuilder {
  private readonly maxMemories: number;
  private readonly minMemories: number;

  constructor(options: ContextOptions = {}) {
    this.maxMemories = options.maxMemories ?? 5;
    this.minMemories = options.minMemories ?? 3;
  }

  buildContext(
    sessionId: string,
    relevantMemories: MemoryWithSimilarity[],
    reflectionMemories: ReflectionMemory[] = [],
    recentConversation?: string
  ): string {
    const context: string[] = [];

    // Add reflection memories (highest priority)
    if (reflectionMemories.length > 0) {
      context.push('## Reflections');
      for (const ref of reflectionMemories.slice(0, 3)) {
        context.push(`- ${ref.summary}`);
      }
      context.push('');
    }

    // Add relevant episodic/semantic memories (exclude reflections to avoid duplication)
    const nonReflectionMemories = relevantMemories.filter(m => m.type !== 'reflection');
    if (nonReflectionMemories.length > 0) {
      context.push('## Relevant Memories');
      const displayMemories = nonReflectionMemories.slice(0, this.maxMemories);
      for (const mem of displayMemories) {
        context.push(`- [${mem.type}] ${mem.content}`);
      }
      context.push('');
    }

    // Add recent conversation if provided
    if (recentConversation) {
      context.push('## Recent Conversation');
      context.push(recentConversation);
      context.push('');
    }

    // Build final context
    const header = `# Memory Context for Session: ${sessionId}`;
    return [header, ...context].join('\n');
  }
}

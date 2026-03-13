/**
 * Context builder for LLM integration.
 */
export class ContextBuilder {
    maxMemories;
    minMemories;
    constructor(options = {}) {
        this.maxMemories = options.maxMemories ?? 5;
        this.minMemories = options.minMemories ?? 3;
    }
    buildContext(sessionId, relevantMemories, reflectionMemories = [], recentConversation) {
        const context = [];
        // Add reflection memories (highest priority)
        if (reflectionMemories.length > 0) {
            context.push('## Reflections');
            for (const ref of reflectionMemories.slice(0, 3)) {
                context.push(`- ${ref.summary}`);
            }
            context.push('');
        }
        // Add relevant episodic/semantic memories
        if (relevantMemories.length > 0) {
            context.push('## Relevant Memories');
            const displayMemories = relevantMemories.slice(0, this.maxMemories);
            for (const mem of displayMemories) {
                const score = (mem.similarity * mem.importance).toFixed(2);
                context.push(`- [${mem.type}] ${mem.content} (score: ${score})`);
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
//# sourceMappingURL=context-builder.js.map
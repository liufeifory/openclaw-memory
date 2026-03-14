/**
 * Context builder for LLM integration.
 *
 * Configurable proportions for different context sections.
 */
export class ContextBuilder {
    maxMemories;
    minMemories;
    reflectionRatio;
    preferenceRatio;
    memoryRatio;
    conversationRatio;
    constructor(options = {}) {
        this.maxMemories = options.maxMemories ?? 5;
        this.minMemories = options.minMemories ?? 3;
        this.reflectionRatio = options.reflectionRatio ?? 0.2;
        this.preferenceRatio = options.preferenceRatio ?? 0.1;
        this.memoryRatio = options.memoryRatio ?? 0.4;
        this.conversationRatio = options.conversationRatio ?? 0.3;
    }
    buildContext(sessionId, relevantMemories, reflectionMemories = [], recentConversation, preferences) {
        const context = [];
        // Calculate slot allocation based on approximate line counts
        // Assuming ~4000 tokens budget (~300 lines, ~13 tokens/line)
        // Reserve 500-800 tokens buffer for user input and model response
        const BUFFER_TOKENS = 600; // Hard buffer for safety
        const BUFFER_LINES = Math.ceil(BUFFER_TOKENS / 13); // ~46 lines
        const totalLines = 300 - BUFFER_LINES; // ~254 lines available
        const reflectionLines = Math.floor(totalLines * this.reflectionRatio);
        const preferenceLines = Math.floor(totalLines * this.preferenceRatio);
        const memoryLines = Math.floor(totalLines * this.memoryRatio);
        const conversationLines = Math.floor(totalLines * this.conversationRatio);
        // Add reflection memories (highest priority, fixed count)
        if (reflectionMemories.length > 0) {
            context.push('## Reflections');
            for (const ref of reflectionMemories.slice(0, Math.min(5, reflectionLines / 2))) {
                context.push(`- ${ref.summary}`);
            }
            context.push('');
        }
        // Add extracted preferences (if available)
        if (preferences && preferences.length > 0) {
            context.push('## User Preferences');
            let prefCount = 0;
            for (const pref of preferences) {
                for (const item of pref.items) {
                    if (prefCount >= preferenceLines)
                        break;
                    context.push(`- ${pref.category}: ${item}`);
                    prefCount++;
                }
                if (prefCount >= preferenceLines)
                    break;
            }
            context.push('');
        }
        // Add relevant episodic/semantic memories (exclude reflections)
        const nonReflectionMemories = relevantMemories.filter(m => m.type !== 'reflection');
        if (nonReflectionMemories.length > 0) {
            context.push('## Relevant Memories');
            const displayMemories = nonReflectionMemories.slice(0, Math.min(15, memoryLines / 2));
            for (const mem of displayMemories) {
                context.push(`- [${mem.type}] ${mem.content}`);
            }
            context.push('');
        }
        // Add recent conversation if provided (limit lines)
        if (recentConversation) {
            context.push('## Recent Conversation');
            const lines = recentConversation.split('\n');
            const truncated = lines.slice(0, conversationLines);
            context.push(truncated.join('\n'));
            if (lines.length > conversationLines) {
                context.push(`... (${lines.length - conversationLines} more lines)`);
            }
            context.push('');
        }
        // Build final context
        const header = `# Memory Context for Session: ${sessionId}`;
        return [header, ...context].join('\n');
    }
}
//# sourceMappingURL=context-builder.js.map
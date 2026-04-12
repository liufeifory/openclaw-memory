/* eslint-disable @typescript-eslint/no-explicit-any -- LLM API response types vary */
/**
 * Memory Filter using LLM
 *
 * Classifies user messages and determines storage importance.
 * Uses local 7B model by default (high-frequency task).
 */
const FILTER_PROMPT = `You are a memory filter for a personal AI assistant.
Classify the user message into ONE category and assign importance.

Categories:
- TRIVIAL: Greetings, thanks, acknowledgments, filler words
- FACT: Factual information about user (work, location, skills, etc.)
- PREFERENCE: User preferences, likes, dislikes, opinions
- EVENT: Specific events, activities, experiences
- QUESTION: User asking a question

Output JSON format:
{"category":"CATEGORY","importance":0.5,"reason":"brief reason"}

Examples:
"你好" -> {"category":"TRIVIAL","importance":0.1,"reason":"greeting"}
"谢谢" -> {"category":"TRIVIAL","importance":0.1,"reason":"acknowledgment"}
"我经常用 Python 编程" -> {"category":"FACT","importance":0.8,"reason":"user skill"}
"我喜欢红色" -> {"category":"PREFERENCE","importance":0.7,"reason":"user preference"}
"今天去了星巴克" -> {"category":"EVENT","importance":0.6,"reason":"daily activity"}
"什么是向量数据库" -> {"category":"QUESTION","importance":0.3,"reason":"question"}

Message: "{{message}}"

JSON:`;
import { logError } from './maintenance-logger.js';
import { LLMLimiter } from './llm-limiter.js';
export class MemoryFilter {
    client;
    limiter;
    constructor(client, limiter) {
        this.client = client;
        this.limiter = limiter ?? new LLMLimiter({ maxConcurrent: 2, minInterval: 100 });
    }
    /**
     * Classify message and determine if it should be stored.
     */
    async classify(message) {
        const prompt = FILTER_PROMPT.replace('{{message}}', message);
        try {
            const result = await this.limiter.execute(async () => {
                return await this.client.completeJson(prompt, 'memory-filter', { temperature: 0.1, maxTokens: 100 });
            });
            // Determine storage action - 全部入库，不再过滤
            const category = result.category.toUpperCase();
            const shouldStore = true; // 所有消息都存储
            const memoryType = 'episodic'; // 默认存储为 episodic
            return {
                category,
                importance: Math.max(0.1, Math.min(0.9, result.importance || 0.5)),
                reason: result.reason || 'auto-classified',
                shouldStore,
                memoryType,
            };
        }
        catch (error) {
            // Fallback: simple keyword-based classification
            logError(`[MemoryFilter] LLM failed, using fallback: ${error.message}`);
            return this.fallbackClassify(message);
        }
    }
    /**
     * Fallback classification using simple rules.
     */
    fallbackClassify(message) {
        const lower = message.toLowerCase();
        const trimLen = message.trim().length;
        // Trivial patterns
        if (/^(你好 | 您好 | hello|hi|hey|早上好 | 晚上好)/i.test(lower)) {
            return { category: 'TRIVIAL', importance: 0.1, reason: 'greeting', shouldStore: false };
        }
        if (/^(谢谢 | 感谢 | 好的 | 好的 | ok|okay|yes|no)/i.test(lower)) {
            return { category: 'TRIVIAL', importance: 0.1, reason: 'acknowledgment', shouldStore: false };
        }
        if (trimLen < 3) {
            return { category: 'TRIVIAL', importance: 0.1, reason: 'too short', shouldStore: false };
        }
        // Question patterns
        if (/[？?]|^(什么 | 怎么 | 为什么 | 谁 | 哪里 | 何时 | 多少|what|how|why|who|where|when)/i.test(lower)) {
            return { category: 'QUESTION', importance: 0.3, reason: 'question', shouldStore: false };
        }
        // Preference patterns
        if (/^(我喜欢 | 我爱 | 我讨厌 | 我讨厌|prefer|like|love|hate)/i.test(lower)) {
            return { category: 'PREFERENCE', importance: 0.7, reason: 'preference keyword', shouldStore: true, memoryType: 'semantic' };
        }
        // Fact patterns
        if (/^(我是 | 我在 | 我用 | 我做 | 我工作 | 我住|I am|I use|I work)/i.test(lower)) {
            return { category: 'FACT', importance: 0.7, reason: 'fact keyword', shouldStore: true, memoryType: 'semantic' };
        }
        // Event patterns (past tense indicators)
        if (/^(今天 | 昨天 | 前天 | 上周 | 刚才 | 刚|yesterday|today|just)/i.test(lower)) {
            return { category: 'EVENT', importance: 0.6, reason: 'event keyword', shouldStore: true, memoryType: 'episodic' };
        }
        // Default: store as episodic with medium importance
        return {
            category: 'EVENT',
            importance: 0.5,
            reason: 'default',
            shouldStore: true,
            memoryType: 'episodic',
        };
    }
}
//# sourceMappingURL=memory-filter.js.map
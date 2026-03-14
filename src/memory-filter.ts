/**
 * Memory Filter using Llama-3.2-1B-Instruct
 *
 * Classifies user messages and determines storage importance.
 *
 * Categories:
 * - TRIVIAL: Greetings, thanks, acknowledgments (don't store)
 * - FACT: Factual information about user (store as semantic, importance 0.7-0.9)
 * - PREFERENCE: User likes/dislikes (store as semantic, importance 0.7-0.9)
 * - EVENT: Something that happened (store as episodic, importance 0.5-0.8)
 * - QUESTION: User asking something (don't store, importance 0.3)
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

export interface FilterResult {
  category: 'TRIVIAL' | 'FACT' | 'PREFERENCE' | 'EVENT' | 'QUESTION';
  importance: number;
  reason: string;
  shouldStore: boolean;
  memoryType?: 'episodic' | 'semantic';
}

export class MemoryFilter {
  private endpoint: string;

  constructor(endpoint: string = 'http://localhost:8081') {
    this.endpoint = endpoint;
  }

  /**
   * Classify message and determine if it should be stored.
   */
  async classify(message: string): Promise<FilterResult> {
    const prompt = FILTER_PROMPT.replace('{{message}}', message);

    try {
      const response = await fetch(`${this.endpoint}/completion`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: prompt,
          n_predict: 100,
          temperature: 0.1,
          top_p: 0.9,
        }),
      });

      const result: any = await response.json();
      const output = (result.content || result.generated_text || '').trim();

      // Parse JSON response
      const parsed = this.parseJsonResponse(output);

      // Determine storage action
      const category = parsed.category as FilterResult['category'];
      const shouldStore = category !== 'TRIVIAL' && category !== 'QUESTION';
      const memoryType: 'episodic' | 'semantic' | undefined =
        category === 'EVENT' ? 'episodic' :
        category === 'FACT' || category === 'PREFERENCE' ? 'semantic' :
        undefined;

      return {
        category,
        importance: parsed.importance,
        reason: parsed.reason,
        shouldStore,
        memoryType,
      };
    } catch (error: any) {
      // Fallback: simple keyword-based classification
      console.error('[MemoryFilter] LLM failed, using fallback:', error.message);
      return this.fallbackClassify(message);
    }
  }

  /**
   * Parse JSON response from LLM.
   */
  private parseJsonResponse(output: string): { category: string; importance: number; reason: string } {
    // Extract JSON from output
    const jsonMatch = output.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          category: parsed.category?.toUpperCase() || 'TRIVIAL',
          importance: Math.max(0.1, Math.min(0.9, parsed.importance || 0.5)),
          reason: parsed.reason || 'auto-classified',
        };
      } catch {
        // Fall through to default
      }
    }

    // Default for failed parsing
    return {
      category: 'TRIVIAL',
      importance: 0.5,
      reason: 'parse failed',
    };
  }

  /**
   * Fallback classification using simple rules.
   */
  private fallbackClassify(message: string): FilterResult {
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

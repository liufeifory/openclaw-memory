/**
 * Entity Extractor - Three-Layer Funnel Strategy
 *
 * Architecture:
 * Layer 1: Static Cache / Regex (zero cost, ~60% coverage)
 *   ↓
 * Layer 1.5: Mini-Batch Buffer (batch processing, 90% scheduling overhead reduction)
 *   ↓
 * Layer 2: 1B Model Pre-Filter (very low cost, ~30% coverage)
 *   ↓
 * Layer 3: 8B Model Refine (high cost, ~10% coverage)
 *
 * Features:
 * - Alias normalization (Postgres → PostgreSQL, TS → TypeScript)
 * - Mini-batch buffer for LLM calls
 * - Known entity cache (loaded from database periodically)
 * - Layer stats tracking for optimization
 */

import { LLMLimiter, getGlobalLimiter } from './llm-limiter.js';

/**
 * Extracted entity structure
 */
export interface ExtractedEntity {
  name: string;
  confidence: number;
  source?: 'regex' | 'cache' | '1b' | '8b';
  originalText?: string;
}

/**
 * Layer statistics for tracking hit rates
 */
export interface LayerStats {
  layer1Hits: number;
  layer1Total: number;
  layer2Hits: number;
  layer2Total: number;
  layer3Hits: number;
  layer3Total: number;
  totalEntities: number;
}

/**
 * Buffer item for mini-batch processing
 */
interface BufferItem {
  text: string;
  confidence: number;
  addedAt: number;
}

/**
 * Alias normalization rules
 * Maps common aliases to canonical names
 */
export const ALIAS_RULES: Record<string, string> = {
  // Programming Languages
  'ts': 'TypeScript',
  'typescript': 'TypeScript',
  'js': 'JavaScript',
  'javascript': 'JavaScript',
  'py': 'Python',
  'python': 'Python',
  'rb': 'Ruby',
  'ruby': 'Ruby',
  'go': 'Go',
  'golang': 'Go',
  'rs': 'Rust',
  'rust': 'Rust',
  'java': 'Java',
  'kt': 'Kotlin',
  'kotlin': 'Kotlin',
  'swift': 'Swift',
  'cs': 'C#',
  'c#': 'C#',
  'cpp': 'C++',
  'c++': 'C++',
  'c': 'C',

  // Databases
  'postgres': 'PostgreSQL',
  'postgresql': 'PostgreSQL',
  'mongo': 'MongoDB',
  'mongodb': 'MongoDB',
  'redis': 'Redis',
  'mysql': 'MySQL',
  'mariadb': 'MariaDB',
  'sqlite': 'SQLite',
  'dynamo': 'DynamoDB',
  'dynamodb': 'DynamoDB',

  // Frameworks & Libraries
  'react': 'React',
  'reactjs': 'React',
  'react.js': 'React',
  'vue': 'Vue.js',
  'vuejs': 'Vue.js',
  'vue.js': 'Vue.js',
  'angular': 'Angular',
  'angularjs': 'AngularJS',
  'angular.js': 'AngularJS',
  'svelte': 'Svelte',
  'next': 'Next.js',
  'nextjs': 'Next.js',
  'next.js': 'Next.js',
  'nuxt': 'Nuxt.js',
  'nuxtjs': 'Nuxt.js',
  'nuxt.js': 'Nuxt.js',

  // Tools & Platforms
  'vscode': 'VSCode',
  'visual studio code': 'VSCode',
  'git': 'Git',
  'github': 'GitHub',
  'gitlab': 'GitLab',
  'docker': 'Docker',
  'k8s': 'Kubernetes',
  'kubernetes': 'Kubernetes',
  'aws': 'AWS',
  'amazon web services': 'AWS',
  'gcp': 'GCP',
  'google cloud platform': 'GCP',
  'azure': 'Azure',
  'vercel': 'Vercel',
  'netlify': 'Netlify',
  'heroku': 'Heroku',

  // Package Managers
  'npm': 'npm',
  'yarn': 'Yarn',
  'pnpm': 'pnpm',
  'bun': 'Bun',
  'cargo': 'Cargo',

  // Operating Systems
  'macos': 'macOS',
  'mac os': 'macOS',
  'osx': 'macOS',
  'linux': 'Linux',
  'ubuntu': 'Ubuntu',
  'debian': 'Debian',
  'arch': 'Arch Linux',
  'windows': 'Windows',
  'win': 'Windows',

  // AI/ML
  'ml': 'Machine Learning',
  'machine learning': 'Machine Learning',
  'dl': 'Deep Learning',
  'deep learning': 'Deep Learning',
  'llm': 'LLM',
  'large language model': 'LLM',
  'transformer': 'Transformer',
  'pytorch': 'PyTorch',
  'tensorflow': 'TensorFlow',
  'hugging face': 'Hugging Face',
  'huggingface': 'Hugging Face',

  // Common Tech Terms
  'api': 'API',
  'rest': 'REST',
  'graphql': 'GraphQL',
  'grpc': 'gRPC',
  'json': 'JSON',
  'yaml': 'YAML',
  'toml': 'TOML',
  'xml': 'XML',
  'html': 'HTML',
  'css': 'CSS',
  'scss': 'SCSS',
  'sass': 'Sass',
  'tailwind': 'Tailwind CSS',
  'tailwindcss': 'Tailwind CSS',
  'webpack': 'Webpack',
  'vite': 'Vite',
  'rollup': 'Rollup',
  'esbuild': 'esbuild',
  'babel': 'Babel',
  'eslint': 'ESLint',
  'prettier': 'Prettier',
  'jest': 'Jest',
  'vitest': 'Vitest',
  'cypress': 'Cypress',
  'playwright': 'Playwright',

  // Cloud & DevOps
  'ci': 'CI/CD',
  'cd': 'CI/CD',
  'cicd': 'CI/CD',
  'terraform': 'Terraform',
  'ansible': 'Ansible',
  'prometheus': 'Prometheus',
  'grafana': 'Grafana',
  'elk': 'ELK Stack',
  'elasticsearch': 'Elasticsearch',
  'logstash': 'Logstash',
  'kibana': 'Kibana',

  // Miscellaneous
  'llama': 'Llama',
  'llama2': 'Llama 2',
  'llama3': 'Llama 3',
  'claude': 'Claude',
  'gpt': 'GPT',
  'gpt4': 'GPT-4',
  'gpt-4': 'GPT-4',
  'gpt3': 'GPT-3',
  'gpt-3': 'GPT-3',
  'gpt3.5': 'GPT-3.5',
  'gpt-3.5': 'GPT-3.5',
};

/**
 * Regex patterns for common entity types
 */
const ENTITY_PATTERNS: Array<{ pattern: RegExp; name: string }> = [
  // Programming languages (case insensitive, word boundary)
  { pattern: /\b(typescript|ts|javascript|js|python|py|rust|rs|golang|go|ruby|rb|swift|kotlin|java|cpp|c\+\+|c#|cs)\b/gi, name: 'language' },

  // Databases
  { pattern: /\b(postgresql|postgres|mongodb|mongo|redis|mysql|mariadb|sqlite|dynamodb|dynamo)\b/gi, name: 'database' },

  // Frameworks
  { pattern: /\b(react|reactjs|vue|vuejs|angular|svelte|nextjs|next\.js|nuxt|nuxtjs)\b/gi, name: 'framework' },

  // Tools
  { pattern: /\b(vscode|visual studio code|git|github|gitlab|docker|kubernetes|k8s)\b/gi, name: 'tool' },

  // Cloud platforms
  { pattern: /\b(aws|gcp|azure|vercel|netlify|heroku)\b/gi, name: 'platform' },

  // Package managers
  { pattern: /\b(npm|yarn|pnpm|bun|cargo)\b/gi, name: 'package_manager' },

  // AI/ML
  { pattern: /\b(machine learning|ml|deep learning|dl|llm|pytorch|tensorflow|hugging ?face)\b/gi, name: 'ai_ml' },

  // Version control and CI/CD
  { pattern: /\b(git|github|gitlab|ci ?\/? cd|cicd|terraform|ansible)\b/gi, name: 'devops' },

  // Linting and formatting
  { pattern: /\b(eslint|prettier|stylelint)\b/gi, name: 'linter' },

  // Testing
  { pattern: /\b(jest|vitest|cypress|playwright|mocha|chai)\b/gi, name: 'testing' },

  // Build tools
  { pattern: /\b(webpack|vite|rollup|esbuild|babel|tsc)\b/gi, name: 'build' },
];

/**
 * Entity Extractor with three-layer funnel strategy
 */
export class EntityExtractor {
  private limiter1B: LLMLimiter;
  private limiter8B: LLMLimiter;
  private knownEntities: Map<string, number> = new Map();
  private buffer: BufferItem[] = [];
  private stats: LayerStats = {
    layer1Hits: 0,
    layer1Total: 0,
    layer2Hits: 0,
    layer2Total: 0,
    layer3Hits: 0,
    layer3Total: 0,
    totalEntities: 0,
  };

  // Buffer configuration
  private readonly bufferFlushInterval: number = 5000;  // 5 seconds
  private readonly minBatchSize: number = 3;  // Minimum batch for LLM call

  constructor(
    private endpoint1B: string = 'http://localhost:8081',
    private endpoint8B: string = 'http://localhost:8082'
  ) {
    this.limiter1B = getGlobalLimiter({ maxConcurrent: 3, minInterval: 50 });
    this.limiter8B = getGlobalLimiter({ maxConcurrent: 2, minInterval: 100 });

    // Start periodic buffer flush
    this.startPeriodicFlush();
  }

  /**
   * Start periodic buffer flush
   */
  private startPeriodicFlush(): void {
    setInterval(() => {
      if (this.buffer.length > 0) {
        this.flushBuffer().catch(console.error);
      }
    }, this.bufferFlushInterval);
  }

  /**
   * Add known entities to the cache (loaded from database periodically)
   */
  addKnownEntities(entities: Array<{ name: string; confidence: number }>): void {
    for (const entity of entities) {
      const normalizedName = this.normalizeText(entity.name);
      this.knownEntities.set(normalizedName.toLowerCase(), entity.confidence);
    }
    console.log(`[EntityExtractor] Added ${entities.length} known entities to cache`);
  }

  /**
   * Get known entity cache size
   */
  getKnownCacheSize(): number {
    return this.knownEntities.size;
  }

  /**
   * Get layer statistics
   */
  getLayerStats(): LayerStats {
    return { ...this.stats };
  }

  /**
   * Get buffer statistics
   */
  getBufferStats(): { size: number; oldest?: number } {
    return {
      size: this.buffer.length,
      oldest: this.buffer[0]?.addedAt,
    };
  }

  /**
   * Normalize text using alias rules
   */
  normalizeText(text: string): string {
    const trimmed = text.trim();
    const lower = trimmed.toLowerCase();

    // Check alias rules first
    if (ALIAS_RULES[lower]) {
      return ALIAS_RULES[lower];
    }

    // Title case for proper nouns (first letter uppercase, rest as-is)
    return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  }

  /**
   * Layer 1: Static regex matching against known patterns
   * Zero-cost, high-coverage extraction
   */
  layer1_RegexMatch(text: string): ExtractedEntity[] {
    const entities: ExtractedEntity[] = [];
    const found = new Set<string>();

    // Search with each pattern
    for (const { pattern, name } of ENTITY_PATTERNS) {
      // Reset regex lastIndex
      pattern.lastIndex = 0;

      let match: RegExpExecArray | null;
      while ((match = pattern.exec(text)) !== null) {
        const matchedText = match[0];
        const normalizedName = this.normalizeText(matchedText);
        const key = normalizedName.toLowerCase();

        if (!found.has(key)) {
          found.add(key);

          // Check if it's in known entities cache
          const knownConfidence = this.knownEntities.get(key);

          entities.push({
            name: normalizedName,
            confidence: knownConfidence ?? 0.8,  // High confidence for known entities
            source: knownConfidence ? 'cache' : 'regex',
            originalText: matchedText,
          });
        }
      }
    }

    // Update stats
    this.stats.layer1Total++;
    if (entities.length > 0) {
      this.stats.layer1Hits++;
    }

    return entities;
  }

  /**
   * Add item to mini-batch buffer for Layer 2 processing
   */
  addToBuffer(text: string, confidence: number): void {
    this.buffer.push({
      text,
      confidence,
      addedAt: Date.now(),
    });

    // Auto-flush if buffer is large enough
    if (this.buffer.length >= 10) {
      this.flushBuffer().catch(console.error);
    }
  }

  /**
   * Flush mini-batch buffer through Layer 2 (1B model)
   */
  async flushBuffer(): Promise<void> {
    if (this.buffer.length === 0) return;

    const texts = this.buffer.map(item => item.text);
    this.buffer = [];

    try {
      const results = await this.layer2_1BFilter(texts);

      // Log results for monitoring
      console.log(`[EntityExtractor] Flushed ${texts.length} items from buffer, ${results.filter(r => r).length} passed 1B filter`);
    } catch (error: any) {
      console.error('[EntityExtractor] Buffer flush failed:', error.message);
    }
  }

  /**
   * Layer 2: 1B Model Pre-Filter
   * Low-cost filtering to eliminate obvious non-entities
   * Returns boolean array indicating which texts should proceed to Layer 3
   */
  async layer2_1BFilter(texts: string[]): Promise<boolean[]> {
    if (texts.length === 0) return [];

    this.stats.layer2Total += texts.length;

    // Build batch prompt for efficiency
    const batchPrompt = this.buildBatchFilterPrompt(texts);

    try {
      const result = await this.limiter1B.execute(async () => {
        const response = await fetch(`${this.endpoint1B}/completion`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: batchPrompt,
            n_predict: texts.length * 2,  // Rough estimate for yes/no answers
            temperature: 0.1,  // Low temperature for deterministic output
            top_p: 0.9,
          }),
        });
        return await response.json();
      }) as any;

      const output = (result.content || result.generated_text || '').trim();
      const results = this.parseBatchFilterResponse(output, texts.length);

      // Update stats
      const passCount = results.filter(r => r).length;
      this.stats.layer2Hits += passCount;

      return results;
    } catch (error: any) {
      console.error('[EntityExtractor] Layer 2 1B filter failed:', error.message);
      // Return all true on error (fail open)
      return texts.map(() => true);
    }
  }

  /**
   * Build batch filter prompt for 1B model
   */
  private buildBatchFilterPrompt(texts: string[]): string {
    const items = texts.map((text, i) => `${i + 1}. "${text}"`).join('\n');

    return `For each item, answer YES if it mentions a technical entity (tool, language, framework, database, platform, etc.) or NO if it's general text.

Format: One answer per line (YES or NO)

${items}

Answers:`;
  }

  /**
   * Parse batch filter response
   */
  private parseBatchFilterResponse(output: string, expectedCount: number): boolean[] {
    const lines = output.trim().split('\n');
    const results: boolean[] = [];

    for (const line of lines) {
      const trimmed = line.trim().toUpperCase();
      if (trimmed.startsWith('YES')) {
        results.push(true);
      } else if (trimmed.startsWith('NO')) {
        results.push(false);
      }

      if (results.length >= expectedCount) break;
    }

    // Fill remaining with true if parsing failed
    while (results.length < expectedCount) {
      results.push(true);
    }

    return results;
  }

  /**
   * Layer 3: 8B Model Refine
   * High-quality entity extraction with proper noun detection
   */
  async layer3_8BRefine(text: string): Promise<ExtractedEntity[]> {
    this.stats.layer3Total++;

    const prompt = this.buildRefinePrompt(text);

    try {
      const result = await this.limiter8B.execute(async () => {
        const response = await fetch(`${this.endpoint8B}/completion`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: prompt,
            n_predict: 500,
            temperature: 0.3,
            top_p: 0.9,
          }),
        });
        return await response.json();
      }) as any;

      const output = (result.content || result.generated_text || '').trim();
      const entities = this.parseRefineResponse(output);

      // Update stats
      if (entities.length > 0) {
        this.stats.layer3Hits++;
      }

      return entities;
    } catch (error: any) {
      console.error('[EntityExtractor] Layer 3 8B refine failed:', error.message);
      return [];
    }
  }

  /**
   * Build refine prompt for 8B model
   */
  private buildRefinePrompt(text: string): string {
    return `Extract all technical entities (tools, programming languages, frameworks, databases, platforms, libraries, etc.) from the text.

Output JSON format:
{
  "entities": [
    {"name": "EntityName", "confidence": 0.9}
  ]
}

If no entities found, use empty array.

Text:
${text}

JSON:`;
  }

  /**
   * Parse refine response from 8B model
   */
  private parseRefineResponse(output: string): ExtractedEntity[] {
    const jsonMatch = output.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      // Fallback: try to extract entities from plain text
      return this.extractEntitiesFromPlain(output);
    }

    try {
      const parsed = JSON.parse(jsonMatch[0]);
      const entities: ExtractedEntity[] = [];

      if (Array.isArray(parsed.entities)) {
        for (const entity of parsed.entities) {
          if (entity.name && typeof entity.name === 'string') {
            entities.push({
              name: this.normalizeText(entity.name),
              confidence: typeof entity.confidence === 'number' ? entity.confidence : 0.7,
              source: '8b',
            });
          }
        }
      }

      return entities;
    } catch {
      // Fallback to plain text extraction
      return this.extractEntitiesFromPlain(output);
    }
  }

  /**
   * Fallback entity extraction from plain text response
   */
  private extractEntitiesFromPlain(text: string): ExtractedEntity[] {
    const entities: ExtractedEntity[] = [];
    const lines = text.split('\n');

    for (const line of lines) {
      // Try to match "EntityName: confidence" format
      const match = line.match(/"?([^"]+)"?\s*[:\-]?\s*(\d\.?\d*)?/);
      if (match && match[1]) {
        const name = match[1].trim();
        // Skip common non-entity words
        if (!this.isStopWord(name)) {
          entities.push({
            name: this.normalizeText(name),
            confidence: match[2] ? parseFloat(match[2]) : 0.7,
            source: '8b',
          });
        }
      }
    }

    return entities;
  }

  /**
   * Check if word is a stop word (should not be extracted as entity)
   */
  private isStopWord(word: string): boolean {
    const stopWords = new Set([
      'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been',
      'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
      'could', 'should', 'may', 'might', 'must', 'shall',
      'and', 'or', 'but', 'if', 'then', 'else', 'when', 'where',
      'who', 'which', 'what', 'whose', 'whom', 'how',
      'this', 'that', 'these', 'those', 'it', 'its',
      'for', 'to', 'from', 'by', 'with', 'in', 'on', 'at',
      'of', 'as', 'so', 'than', 'too', 'very',
      'i', 'you', 'he', 'she', 'we', 'they', 'them', 'his', 'her',
      'my', 'your', 'our', 'their', 'mine', 'yours', 'ours', 'theirs',
      'yes', 'no', 'ok', 'okay', 'json', 'format', 'array', 'object',
      'found', 'extracted', 'entities', 'entity', 'name', 'confidence',
    ]);
    return stopWords.has(word.toLowerCase().trim());
  }

  /**
   * Main extraction method - three-layer funnel
   * 1. First check Layer 1 (regex) - fast path
   * 2. Add remaining text to buffer for Layer 2 (1B model)
   * 3. For high-confidence items, use Layer 3 (8B model)
   */
  async extract(text: string): Promise<ExtractedEntity[]> {
    const allEntities = new Map<string, ExtractedEntity>();

    // Layer 1: Regex matching (zero cost)
    const layer1Entities = this.layer1_RegexMatch(text);
    for (const entity of layer1Entities) {
      allEntities.set(entity.name.toLowerCase(), entity);
    }

    // If Layer 1 found entities, return them
    // Otherwise, proceed to Layer 3 for deep extraction
    if (layer1Entities.length > 0) {
      this.stats.totalEntities += layer1Entities.length;
      return Array.from(allEntities.values());
    }

    // Layer 1 found nothing, use Layer 3 directly for this text
    // (In production, you might want to batch these through Layer 2 first)
    const layer3Entities = await this.layer3_8BRefine(text);
    for (const entity of layer3Entities) {
      const key = entity.name.toLowerCase();
      if (!allEntities.has(key)) {
        allEntities.set(key, entity);
      }
    }

    this.stats.totalEntities += allEntities.size;
    return Array.from(allEntities.values());
  }

  /**
   * Batch extract with mini-batch buffering
   */
  async batchExtract(texts: string[], useBuffer: boolean = true): Promise<ExtractedEntity[][]> {
    const results: ExtractedEntity[][] = [];

    if (useBuffer) {
      // Add all texts to buffer and process in batch
      for (const text of texts) {
        // First try Layer 1
        const layer1Entities = this.layer1_RegexMatch(text);
        if (layer1Entities.length > 0) {
          results.push(layer1Entities);
        } else {
          // Add to buffer for Layer 2 processing
          this.addToBuffer(text, 0.5);
          results.push([]);  // Will be populated after flush
        }
      }

      // Flush buffer if we have enough items
      if (this.buffer.length >= this.minBatchSize) {
        await this.flushBuffer();
      }
    } else {
      // Direct extraction without buffering
      for (const text of texts) {
        results.push(await this.extract(text));
      }
    }

    return results;
  }

  /**
   * Clear known entity cache
   */
  clearKnownCache(): void {
    this.knownEntities.clear();
  }

  /**
   * Get all statistics including buffer and cache info
   */
  getFullStats(): LayerStats & { knownCacheSize: number; bufferSize: number } {
    return {
      ...this.stats,
      knownCacheSize: this.knownEntities.size,
      bufferSize: this.buffer.length,
    };
  }
}

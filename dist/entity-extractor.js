/* eslint-disable @typescript-eslint/no-explicit-any -- LLM response types vary */
/**
 * Entity Extractor - Two-Layer Architecture
 *
 * Architecture:
 * Layer 1: Static Cache / Regex (zero cost, ~60% coverage)
 *   ↓
 * Layer 2: 7B Model Refine (high quality, ~40% coverage)
 *
 * Features:
 * - Alias normalization (Postgres → PostgreSQL, TS → TypeScript)
 * - Known entity cache (loaded from database periodically)
 * - Layer stats tracking for optimization
 */
import { logInfo, logError } from './maintenance-logger.js';
import { getGlobalLimiter } from './llm-limiter.js';
/**
 * Alias normalization rules
 * Maps common aliases to canonical names
 */
export const ALIAS_RULES = {
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
const ENTITY_PATTERNS = [
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
 * Entity Extractor with two-layer architecture
 */
export class EntityExtractor {
    client;
    limiter7B;
    knownEntities = new Map();
    stats = {
        layer1Hits: 0,
        layer1Total: 0,
        layer2Hits: 0,
        layer2Total: 0,
        totalEntities: 0,
    };
    constructor(client) {
        this.client = client;
        this.limiter7B = getGlobalLimiter({ maxConcurrent: 2, minInterval: 100 });
    }
    /**
     * Add known entities to the cache (loaded from database periodically)
     */
    addKnownEntities(entities) {
        for (const entity of entities) {
            const normalizedName = this.normalizeText(entity.name);
            this.knownEntities.set(normalizedName.toLowerCase(), entity.confidence);
        }
        logInfo(`[EntityExtractor] Added ${entities.length} known entities to cache`);
    }
    /**
     * Get known entity cache size
     */
    getKnownCacheSize() {
        return this.knownEntities.size;
    }
    /**
     * Get layer statistics
     */
    getLayerStats() {
        return { ...this.stats };
    }
    /**
     * Normalize text using alias rules
     */
    normalizeText(text) {
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
    layer1_RegexMatch(text) {
        const entities = [];
        const found = new Set();
        // Search with each pattern
        for (const { pattern, name } of ENTITY_PATTERNS) {
            // Reset regex lastIndex
            pattern.lastIndex = 0;
            let match;
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
                        entity_type: name, // Use pattern name as entity type
                        confidence: knownConfidence ?? 0.8, // High confidence for known entities
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
     * Layer 2: 7B Model Refine
     * High-quality entity extraction with proper noun detection
     */
    async layer2_7BRefine(text) {
        this.stats.layer2Total++;
        const prompt = this.buildRefinePrompt(text);
        try {
            const entities = await this.limiter7B.execute(async () => {
                return await this.client.completeJson(prompt, 'entity-extractor', { temperature: 0.3, maxTokens: 500 });
            });
            const result = [];
            if (Array.isArray(entities.entities)) {
                for (const entity of entities.entities) {
                    if (entity.name && typeof entity.name === 'string') {
                        result.push({
                            name: this.normalizeText(entity.name),
                            confidence: typeof entity.confidence === 'number' ? entity.confidence : 0.7,
                            source: '7b',
                        });
                    }
                }
            }
            // Update stats
            if (result.length > 0) {
                this.stats.layer2Hits++;
            }
            return result;
        }
        catch (error) {
            // Timeout or other errors should not block - return empty array
            // Layer 1 results (if any) will be used alone
            logError(`[EntityExtractor] Layer 2 7B refine failed: ${error.message}`);
            return [];
        }
    }
    /**
     * Build refine prompt for 7B model
     */
    buildRefinePrompt(text) {
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
     * Parse refine response from 7B model
     */
    parseRefineResponse(output) {
        const jsonMatch = output.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            // Fallback: try to extract entities from plain text
            return this.extractEntitiesFromPlain(output);
        }
        try {
            const parsed = JSON.parse(jsonMatch[0]);
            const entities = [];
            if (Array.isArray(parsed.entities)) {
                for (const entity of parsed.entities) {
                    if (entity.name && typeof entity.name === 'string') {
                        entities.push({
                            name: this.normalizeText(entity.name),
                            confidence: typeof entity.confidence === 'number' ? entity.confidence : 0.7,
                            source: '7b',
                        });
                    }
                }
            }
            return entities;
        }
        catch {
            // Fallback to plain text extraction
            return this.extractEntitiesFromPlain(output);
        }
    }
    /**
     * Fallback entity extraction from plain text response
     */
    extractEntitiesFromPlain(text) {
        const entities = [];
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
                        source: '7b',
                    });
                }
            }
        }
        return entities;
    }
    /**
     * Check if word is a stop word (should not be extracted as entity)
     */
    isStopWord(word) {
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
     * Main extraction method - two-layer architecture
     * 1. First check Layer 1 (regex) - fast path
     * 2. If not found, use Layer 2 (7B model) for deep extraction
     */
    async extract(text) {
        const allEntities = new Map();
        // Layer 1: Regex matching (zero cost)
        const layer1Entities = this.layer1_RegexMatch(text);
        for (const entity of layer1Entities) {
            allEntities.set(entity.name.toLowerCase(), entity);
        }
        // If Layer 1 found entities, return them
        // Otherwise, proceed to Layer 2 for deep extraction
        if (layer1Entities.length > 0) {
            this.stats.totalEntities += layer1Entities.length;
            return Array.from(allEntities.values());
        }
        // Layer 1 found nothing, use Layer 2 directly for this text
        const layer2Entities = await this.layer2_7BRefine(text);
        for (const entity of layer2Entities) {
            const key = entity.name.toLowerCase();
            if (!allEntities.has(key)) {
                allEntities.set(key, entity);
            }
        }
        this.stats.totalEntities += allEntities.size;
        return Array.from(allEntities.values());
    }
    /**
     * Batch extract - direct extraction without buffering
     */
    async batchExtract(texts, useBuffer = true) {
        const results = [];
        if (useBuffer) {
            // Direct extraction for each text
            for (const text of texts) {
                results.push(await this.extract(text));
            }
        }
        else {
            // Same as above, kept for API compatibility
            for (const text of texts) {
                results.push(await this.extract(text));
            }
        }
        return results;
    }
    /**
     * Clear known entity cache
     */
    clearKnownCache() {
        this.knownEntities.clear();
    }
    /**
     * Get all statistics including cache info
     */
    getFullStats() {
        return {
            ...this.stats,
            knownCacheSize: this.knownEntities.size,
        };
    }
    /**
     * Dispose - clear resources
     */
    dispose() {
        logInfo('[EntityExtractor] Disposed');
    }
    /**
     * Delegate completeJson to internal LLM client
     * Used by EntityIndexer for relation classification
     */
    async completeJson(prompt, taskType, options) {
        return await this.client.completeJson(prompt, taskType, options);
    }
}
//# sourceMappingURL=entity-extractor.js.map
/**
 * Semantic Clusterer for Memory Merging
 *
 * Clusters semantically similar memories (similarity > 0.9) and merges them
 * into permanent facts during idle time.
 *
 * Features:
 * - Async worker (non-blocking)
 * - source_ids tracking for traceability
 * - Fidelity preservation (no over-generalization)
 * - Conflict detection via conflict-detector.ts
 */

import { logInfo, logWarn, logError } from './maintenance-logger.js';
import { LLMLimiter } from './llm-limiter.js';
import { ConflictDetector } from './conflict-detector.js';
import { LLMClient } from './llm-client.js';

const CLUSTER_PROMPT = `Group these memories into clusters based on semantic similarity.
Output JSON format:
{
  "clusters": [
    {
      "theme": "brief theme description",
      "memory_indices": [0, 2, 5]
    }
  ]
}

Only cluster memories with similarity > 0.9 (very high similarity).
Do not cluster technical details or specific facts that should remain separate.

Memories:
{{memories}}

JSON:`;

const MERGE_PROMPT = `Merge these similar memories into ONE permanent fact.

IMPORTANT - ENTITY PRESERVATION:
Preserve all technical entities verbatim, including:
- File names (e.g., src/db/connection.ts)
- Class names (e.g., DatabaseService)
- Function names (e.g., getConnectionPool)
- Constants (e.g., MAX_POOL_SIZE=50)
- API endpoints (e.g., /api/v1/users)
- IDs, paths, configuration keys

These entities MUST appear exactly as-is in the summary.

Rules:
- Preserve all technical details and specific information
- Do not over-generalize or lose fidelity
- Keep specific numbers, names, and technical terms exact
- Only merge redundant/repetitive information

Output JSON format:
{
  "merged_content": "the merged permanent fact",
  "entities": ["list", "of", "preserved", "entities"],
  "confidence": 0.0-1.0,
  "reason": "brief explanation of merge decision"
}

If memories should NOT be merged (different technical details, conflicting info), output:
{
  "merged_content": null,
  "entities": [],
  "confidence": 0.0,
  "reason": "why they cannot be merged"
}

Memories to merge:
{{memories}}

JSON:`;

export interface ClusteredMemory {
  theme: string;
  memoryIndices: number[];
  memories: string[];
}

export interface MergeResult {
  mergedContent: string | null;
  entities: string[];  // Preserved technical entities
  confidence: number;
  reason: string;
}

export interface ClusterResult {
  clusters: ClusteredMemory[];
  totalMemories: number;
  clusteredCount: number;
}

export interface HierarchicalMemory {
  level: 1 | 2 | 3;  // 1=Episodic (events), 2=Semantic (facts), 3=Reflection (themes)
  id: number;
  content: string;
  importance: number;
  similarity?: number;
  children?: HierarchicalMemory[];  // For level 3 (reflections have semantic children)
}

export interface HierarchyConfig {
  episodicThreshold: number;  // Level 1 threshold (default: 0.7)
  semanticThreshold: number;  // Level 2 threshold (default: 0.8)
  reflectionThreshold: number;  // Level 3 threshold (default: 0.85)
}

export class SemanticClusterer {
  private client: LLMClient;
  private limiter: LLMLimiter;
  private conflictDetector: ConflictDetector;

  // Regex patterns for entity extraction
  private entityPatterns = [
    { name: 'constant', regex: /\b[A-Z_]{3,}\b/g },
    { name: 'filePath', regex: /\b[\w.-]+\.(ts|js|py|go|rs|java|tsx|jsx)\b/g },
    { name: 'className', regex: /\b[A-Z][a-zA-Z]*(Service|Controller|Repository|Manager|Factory|Builder|Config|Configurator)\b/g },
    { name: 'apiEndpoint', regex: /\/api\/[\w/-]+/g },
    { name: 'packageName', regex: /\b[a-z][a-z0-9.-]*::[a-z][a-z0-9-]*\b/g },
  ];

  constructor(client: LLMClient, limiter?: LLMLimiter) {
    this.client = client;
    this.limiter = limiter ?? new LLMLimiter({ maxConcurrent: 2, minInterval: 100 });
    this.conflictDetector = new ConflictDetector(client, limiter);
  }

  /**
   * Cluster memories by semantic similarity.
   * Only clusters memories with similarity > 0.9.
   */
  async cluster(memories: Array<{ id: number; content: string }>): Promise<ClusterResult> {
    if (memories.length < 2) {
      return { clusters: [], totalMemories: memories.length, clusteredCount: 0 };
    }

    const memoriesText = memories
      .map((m, i) => `[${i}] ${m.content.substring(0, 150)}`)
      .join('\n');

    const prompt = CLUSTER_PROMPT
      .replace('{{memories}}', memoriesText);

    try {
      const output = await this.limiter.execute(async () => {
        return await this.client.complete(
          prompt,
          'clusterer',
          { temperature: 0.2, maxTokens: 500 }
        );
      }) as string;
      const clusters = this.parseClusters(output, memories);

      const clusteredCount = clusters.reduce((sum, c) => sum + c.memoryIndices.length, 0);

      return {
        clusters,
        totalMemories: memories.length,
        clusteredCount,
      };
    } catch (error: any) {
      logError(`[SemanticClusterer] LLM failed: ${error.message}`);
      return { clusters: [], totalMemories: memories.length, clusteredCount: 0 };
    }
  }

  /**
   * Merge a cluster of similar memories into one permanent fact.
   * Extracts entities first to ensure preservation.
   */
  async mergeCluster(
    cluster: ClusteredMemory,
    existingMergedMemories: Array<{ id: number; content: string }> = []
  ): Promise<MergeResult> {
    if (cluster.memories.length < 2) {
      return {
        mergedContent: cluster.memories[0] || null,
        entities: this.extractEntities([cluster.memories[0] || '']),
        confidence: 1.0,
        reason: 'single memory',
      };
    }

    // Extract entities BEFORE merge to ensure preservation
    const extractedEntities = this.extractEntities(cluster.memories);

    // Limit to 20 memories per merge to avoid token overflow
    const MAX_MEM_COUNT = 20;
    const memoriesToMerge = cluster.memories.slice(0, MAX_MEM_COUNT);

    const memoriesText = memoriesToMerge
      .map((m, i) => `[${i}] ${m}`)
      .join('\n');

    // Add entity preservation instruction
    const entitiesContext = extractedEntities.length > 0
      ? `\nDetected entities that must be preserved verbatim:\n- ${extractedEntities.join('\n- ')}`
      : '';

    const prompt = MERGE_PROMPT
      .replace('{{memories}}', memoriesText) + entitiesContext;

    try {
      const output = await this.limiter.execute(async () => {
        return await this.client.complete(
          prompt,
          'clusterer',
          { temperature: 0.2, maxTokens: 500 }
        );
      }) as string;
      return this.parseMergeResult(output);
    } catch (error: any) {
      logError(`[SemanticClusterer] Merge failed: ${error.message}`);
      return {
        mergedContent: null,
        entities: [],
        confidence: 0.0,
        reason: `Merge error: ${error.message}`,
      };
    }
  }

  /**
   * Parse cluster JSON from LLM output.
   */
  private parseClusters(output: string, memories: Array<{ id: number; content: string }>): ClusteredMemory[] {
    const jsonMatch = output.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        if (Array.isArray(parsed.clusters)) {
          return parsed.clusters
            .filter((c: any) => Array.isArray(c.memory_indices) && c.memory_indices.length > 1)
            .map((c: any) => ({
              theme: c.theme || 'Unknown theme',
              memoryIndices: c.memory_indices as number[],
              memories: c.memory_indices.map((i: number) => memories[i]?.content || ''),
            }));
        }
      } catch {
        // Fall through to default
      }
    }

    return [];
  }

  /**
   * Extract technical entities from memories using regex patterns.
   * Used to preserve entities during summarization.
   */
  private extractEntities(memories: string[]): string[] {
    const entities = new Set<string>();

    for (const memory of memories) {
      for (const pattern of this.entityPatterns) {
        const matches = memory.match(pattern.regex);
        if (matches) {
          for (const match of matches) {
            entities.add(match);
          }
        }
      }
    }

    return Array.from(entities);
  }

  /**
   * Parse merge result JSON from LLM output.
   */
  private parseMergeResult(output: string): MergeResult {
    const jsonMatch = output.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          mergedContent: parsed.merged_content ?? null,
          entities: Array.isArray(parsed.entities) ? parsed.entities : [],
          confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.0,
          reason: parsed.reason || 'No reason provided',
        };
      } catch {
        // Fall through to default
      }
    }

    return {
      mergedContent: null,
      entities: [],
      confidence: 0.0,
      reason: 'Failed to parse JSON output',
    };
  }

  /**
   * Run clustering in background (async worker).
   * Non-blocking - processes memories during idle time.
   * Limits to top 100 memories to avoid O(N²) performance issues.
   */
  async runIdleClustering(
    getMemories: () => Promise<Array<{ id: number; content: string }>>,
    onClusterMerged: (result: { theme: string; mergedContent: string; sourceIds: number[] }) => Promise<void>,
    options?: { timeoutMs?: number; maxMemories?: number }
  ): Promise<{ completed: boolean; reason?: string }> {
    const timeoutMs = options?.timeoutMs ?? 120000;  // 2 minutes default
    const maxMemories = options?.maxMemories ?? 100;  // Limit to top 100

    try {
      const allMemories = await getMemories();

      // Limit to recent/top memories to avoid O(N²) performance issues
      const memories = allMemories.slice(0, maxMemories);

      if (memories.length < 5) {
        return { completed: true, reason: 'Not enough memories' };
      }

      if (allMemories.length > maxMemories) {
        logInfo(`[SemanticClusterer] Limited clustering to ${maxMemories}/${allMemories.length} memories`);
      }

      // Cluster memories
      const clusterResult = await this.cluster(memories);
      logInfo(`[SemanticClusterer] Found ${clusterResult.clusters.length} clusters from ${clusterResult.totalMemories} memories`);

      // Merge each cluster
      for (const cluster of clusterResult.clusters) {
        const mergeResult = await this.mergeCluster(cluster);

        if (mergeResult.mergedContent && mergeResult.confidence > 0.7) {
          // Store merged memory with source_ids tracking
          await onClusterMerged({
            theme: cluster.theme,
            mergedContent: mergeResult.mergedContent,
            sourceIds: cluster.memoryIndices.map(i => memories[i]?.id).filter(id => id !== undefined),
          });
          logInfo(`[SemanticClusterer] Merged cluster "${cluster.theme}" (${cluster.memoryIndices.length} memories)`);
        }
      }

      return { completed: true, reason: 'Success' };
    } catch (error: any) {
      logError(`[SemanticClusterer] Idle clustering failed: ${error.message}`);
      return { completed: false, reason: error.message };
    }
  }

  /**
   * Build hierarchical memory tree from retrieved memories.
   * Level 1: Episodic memories (specific events)
   * Level 2: Semantic memories (general facts)
   * Level 3: Reflection memories (themes/summaries)
   */
  buildHierarchy(
    memories: Array<{
      id: number;
      content: string;
      type: string;
      importance: number;
      similarity?: number;
    }>,
    config?: HierarchyConfig
  ): HierarchicalMemory[] {
    const cfg: Required<HierarchyConfig> = {
      episodicThreshold: config?.episodicThreshold ?? 0.7,
      semanticThreshold: config?.semanticThreshold ?? 0.8,
      reflectionThreshold: config?.reflectionThreshold ?? 0.85,
    };

    // Separate memories by type
    const episodic = memories.filter(m => m.type === 'episodic' && (m.similarity ?? 0) >= cfg.episodicThreshold);
    const semantic = memories.filter(m => m.type === 'semantic' && (m.similarity ?? 0) >= cfg.semanticThreshold);
    const reflection = memories.filter(m => m.type === 'reflection' && (m.similarity ?? 0) >= cfg.reflectionThreshold);

    const hierarchy: HierarchicalMemory[] = [];

    // Level 1: Episodic memories (leaf nodes)
    for (const mem of episodic) {
      hierarchy.push({
        level: 1,
        id: mem.id,
        content: mem.content,
        importance: mem.importance,
        similarity: mem.similarity,
      });
    }

    // Level 2: Semantic memories (can have episodic children if clustered)
    for (const mem of semantic) {
      hierarchy.push({
        level: 2,
        id: mem.id,
        content: mem.content,
        importance: mem.importance,
        similarity: mem.similarity,
      });
    }

    // Level 3: Reflection memories (themes, can have semantic children)
    for (const mem of reflection) {
      // Find semantically related semantic memories
      const relatedSemantic = semantic.filter(s =>
        s.content !== mem.content && this.textSimilarity(s.content, mem.content) > 0.5
      );

      hierarchy.push({
        level: 3,
        id: mem.id,
        content: mem.content,
        importance: mem.importance,
        similarity: mem.similarity,
        children: relatedSemantic.map(s => ({
          level: 2,
          id: s.id,
          content: s.content,
          importance: s.importance,
          similarity: s.similarity,
        })),
      });
    }

    return hierarchy;
  }

  /**
   * Simple text similarity for hierarchy building (Jaccard similarity).
   */
  private textSimilarity(a: string, b: string): number {
    const wordsA = new Set(a.toLowerCase().split(/\s+/).filter(w => w.length > 3));
    const wordsB = new Set(b.toLowerCase().split(/\s+/).filter(w => w.length > 3));

    const intersection = [...wordsA].filter(w => wordsB.has(w)).length;
    const union = new Set([...wordsA, ...wordsB]).size;

    if (union === 0) return 0;
    return intersection / union;
  }
}

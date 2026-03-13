/**
 * Memory types and interfaces.
 */

export interface Memory {
  id: number;
  content: string;
  importance: number;
  created_at: Date;
  access_count: number;
}

export interface EpisodicMemory extends Memory {
  session_id: string;
}

export interface SemanticMemory extends Memory {
  summary?: string;
}

export interface ReflectionMemory extends Memory {
  summary: string;
}

export interface MemoryWithSimilarity extends Memory {
  similarity: number;
  type: 'episodic' | 'semantic' | 'reflection';
}

#!/usr/bin/env node
/**
 * OpenClaw Memory Hook
 * Usage: Add to ~/.claude/hooks/user-hooks.js
 *
 * export OPENCLAW_MEMORY_URL=http://localhost:8090
 */

import { execSync } from 'child_process';

const MEMORY_URL = process.env.OPENCLAW_MEMORY_URL || 'http://localhost:8090';

export async function memorySearch(query, options = {}) {
  const { top_k = 5, threshold = 0.5 } = options;

  try {
    const response = await fetch(`${MEMORY_URL}/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, top_k, threshold }),
    });

    const result = await response.json();
    return result;
  } catch (error) {
    return { error: error.message, memories: [], count: 0 };
  }
}

// Export for hook usage
globalThis.memorySearch = memorySearch;

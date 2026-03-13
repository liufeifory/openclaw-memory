#!/usr/bin/env python3
"""
Search memory by semantic similarity.

Usage:
    python3 scripts/search.py "your search query"

Example:
    python3 scripts/search.py "What does the user know about Python?"
"""

import sys
import os
import json

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from database import Database
from memory_manager import MemoryManager

# Database configuration
DB_CONFIG = {
    "host": os.getenv("MEMORY_DB_HOST", "localhost"),
    "port": int(os.getenv("MEMORY_DB_PORT", 5432)),
    "database": os.getenv("MEMORY_DB_NAME", "openclaw"),
    "user": os.getenv("MEMORY_DB_USER", "postgres"),
    "password": os.getenv("MEMORY_DB_PASS", "")
}


def search_memory(query: str, top_k: int = 5, threshold: float = 0.6):
    """Search memory and print results."""
    try:
        db = Database(DB_CONFIG)
        mm = MemoryManager(db)

        memories = mm.retrieve_relevant(query, top_k=top_k, threshold=threshold)

        if not memories:
            print("No relevant memories found.")
            return

        print(f"Found {len(memories)} relevant memories:\n")
        for i, mem in enumerate(memories, 1):
            print(f"{i}. [{mem['type']}] {mem['content']}")
            print(f"   Importance: {mem['importance']:.2f}, Similarity: {mem['similarity']:.2f}")
            print()

        db.close()

    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python3 scripts/search.py <query>")
        print("Example: python3 scripts/search.py 'user programming experience'")
        sys.exit(1)

    query = " ".join(sys.argv[1:])
    search_memory(query)

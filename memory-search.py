"""
skill: memory-search
description: Search long-term memory with semantic similarity
"""

import requests
import json

def search_memory(query: str, top_k: int = 5):
    """
    Search memory using semantic similarity.

    Args:
        query: The search query
        top_k: Number of results to return

    Returns:
        List of relevant memories with similarity scores
    """
    # Call the memory plugin HTTP endpoint (if exposed)
    # This is a placeholder - actual implementation depends on how you expose the plugin
    response = requests.post(
        "http://localhost:8080/memory/search",
        json={"query": query, "top_k": top_k}
    )

    if response.status_code == 200:
        return response.json()
    return []

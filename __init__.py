"""OpenClaw Memory Plugin - Production-grade memory system.

Provides long-term memory with:
- Semantic retrieval
- Vector search
- Importance learning
- Reflection memory
- Asynchronous storage

Usage:
    from plugin import OpenClawMemoryPlugin

    config = {
        "host": "localhost",
        "port": 5432,
        "database": "openclaw",
        "user": "postgres",
        "password": "secret"
    }

    plugin = OpenClawMemoryPlugin(config)
    context = plugin.on_user_message("session-123", "Hello!")
"""

from plugin import OpenClawMemoryPlugin
from database import Database
from memory_manager import MemoryManager
from episodic_memory import EpisodicMemory, EpisodicMemoryStore
from semantic_memory import SemanticMemory, SemanticMemoryStore
from reflection_memory import ReflectionMemory, ReflectionMemoryStore
from retrieval_pipeline import RetrievalPipeline
from vector_store import VectorStore
from embedding_model import EmbeddingModel
from context_builder import ContextBuilder
from importance_learning import ImportanceLearning
from memory_maintenance import MemoryMaintenance

__all__ = [
    "OpenClawMemoryPlugin",
    "Database",
    "MemoryManager",
    "EpisodicMemory",
    "EpisodicMemoryStore",
    "SemanticMemory",
    "SemanticMemoryStore",
    "ReflectionMemory",
    "ReflectionMemoryStore",
    "RetrievalPipeline",
    "VectorStore",
    "EmbeddingModel",
    "ContextBuilder",
    "ImportanceLearning",
    "MemoryMaintenance",
]

__version__ = "1.0.0"

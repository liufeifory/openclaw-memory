"""Memory manager for orchestrating all memory operations."""

import logging
from concurrent.futures import ThreadPoolExecutor
from typing import Callable, Optional, List, Dict, Tuple, Any

from database import Database
from episodic_memory import EpisodicMemory, EpisodicMemoryStore
from semantic_memory import SemanticMemory, SemanticMemoryStore
from reflection_memory import ReflectionMemory, ReflectionMemoryStore
from retrieval_pipeline import RetrievalPipeline
from context_builder import ContextBuilder
from memory_maintenance import MemoryMaintenance
from vector_store import VectorStore

logger = logging.getLogger(__name__)


class MemoryManager:
    """Orchestrates all memory operations.

    Responsibilities:
    - Store and retrieve episodic, semantic, and reflection memories
    - Async storage with ThreadPoolExecutor
    - Build context with relevant memories
    - Trigger maintenance operations
    """

    # Thread pool for async operations
    MAX_WORKERS = 4

    def __init__(
        self,
        db: Database,
        llm_summarize_fn: Optional[Callable[[List[str]], str]] = None
    ) -> None:
        """Initialize memory manager.

        Args:
            db: Database instance.
            llm_summarize_fn: Optional function to generate summaries using LLM.
        """
        self.db = db

        # Memory stores
        self.episodic_store = EpisodicMemoryStore(db)
        self.semantic_store = SemanticMemoryStore(db)
        self.reflection_store = ReflectionMemoryStore(db)

        # Pipeline and utilities
        self.retrieval_pipeline = RetrievalPipeline(db)
        self.vector_store = VectorStore(db)
        self.context_builder = ContextBuilder()
        self.maintenance = MemoryMaintenance(db, llm_summarize_fn)

        # Thread pool for async operations
        self._executor = ThreadPoolExecutor(max_workers=self.MAX_WORKERS)

    def retrieve_relevant(
        self,
        query: str,
        top_k: int = 10,
        threshold: float = 0.6
    ) -> List[Dict]:
        """Retrieve memories relevant to a query.

        Args:
            query: Query text for semantic search.
            top_k: Initial number of results to retrieve.
            threshold: Minimum similarity threshold.

        Returns:
            List of relevant memory dicts with metadata.
        """
        logger.debug(f"Retrieving memories for query: {query[:50]}...")

        # Get episodic memories via vector search
        episodic_results = self.retrieval_pipeline.search(query, top_k)

        # Get semantic memories
        semantic_memories = self.semantic_store.get_all(limit=20)

        # Get reflection memories (highest priority)
        reflection_memories = self.reflection_store.get_all(limit=5)

        # Combine results with type markers
        results: List[Dict[str, Any]] = []

        # Add reflection memories (highest importance)
        for ref in reflection_memories:
            results.append({
                "type": "reflection",
                "content": ref.summary,
                "importance": ref.importance,
                "similarity": 1.0  # Reflections always relevant
            })

        # Add episodic results (already have content from search_with_content)
        for ep in episodic_results:
            results.append({
                "type": "episodic",
                "content": ep.get("content", str(ep)),
                "importance": float(ep.get("importance", 0.5)),
                "similarity": float(ep.get("similarity", 0.0))
            })

        # Add semantic memories
        for sem in semantic_memories:
            results.append({
                "type": "semantic",
                "content": sem.content,
                "importance": sem.importance,
                "similarity": 0.8  # Default similarity for semantic
            })

        # Sort by combined score
        results.sort(key=lambda x: x["similarity"] * x["importance"], reverse=True)

        # Filter by threshold and limit
        filtered = [r for r in results if r["similarity"] >= threshold]
        return filtered[:5]

    def build_context(
        self,
        session_id: str,
        memories: List[Dict],
        recent_conversation: Optional[str] = None
    ) -> str:
        """Build context string for LLM.

        Args:
            session_id: Session identifier.
            memories: List of relevant memory dicts.
            recent_conversation: Recent conversation history (optional).

        Returns:
            Formatted context string.
        """
        # Get reflection memories for context
        reflection_memories = self.reflection_store.get_all(limit=3)

        return self.context_builder.build_context(
            session_id=session_id,
            relevant_memories=memories,
            recent_conversation=recent_conversation,
            reflection_memories=reflection_memories
        )

    def async_store(
        self,
        session_id: str,
        content: str,
        importance: float = 0.5
    ) -> None:
        """Store memory asynchronously.

        Args:
            session_id: Session identifier.
            content: Memory content.
            importance: Base importance score.
        """
        logger.debug(f"Queueing async store for session {session_id}")

        # Submit to thread pool
        future = self._executor.submit(
            self._store_memory,
            session_id,
            content,
            importance
        )

        # Add callback for logging
        future.add_done_callback(self._log_store_result)

    def _store_memory(
        self,
        session_id: str,
        content: str,
        importance: float
    ) -> Tuple[int, str]:
        """Store memory synchronously (called by async_store).

        Args:
            session_id: Session identifier.
            content: Memory content.
            importance: Base importance score.

        Returns:
            Tuple of (memory_id, memory_type).
        """
        try:
            # Create episodic memory
            memory = EpisodicMemory(
                session_id=session_id,
                content=content,
                importance=importance
            )

            # Store in database
            memory_id = self.episodic_store.store(memory)

            # Store embedding
            from embedding_model import EmbeddingModel
            embedding_model = EmbeddingModel()
            embedding = embedding_model.embed(content)

            embedding_sql = """
                INSERT INTO memory_embeddings
                (memory_id, memory_type, embedding, created_at)
                VALUES (%s, %s, %s, %s)
            """
            from datetime import datetime
            self.db.execute(embedding_sql, (
                memory_id,
                "episodic",
                embedding,
                datetime.now()
            ))

            logger.info(f"Stored episodic memory {memory_id}")
            return (memory_id, "episodic")

        except Exception as e:
            logger.error(f"Failed to store memory: {e}")
            raise

    def _log_store_result(self, future: Any) -> None:
        """Log result of async store operation.

        Args:
            future: Future from ThreadPoolExecutor.
        """
        try:
            result = future.result()
            logger.info(f"Async store completed: id={result[0]}, type={result[1]}")
        except Exception as e:
            logger.error(f"Async store failed: {e}")

    def store_semantic(
        self,
        content: str,
        importance: float = 0.7
    ) -> int:
        """Store semantic memory synchronously.

        Args:
            content: Memory content.
            importance: Base importance score.

        Returns:
            ID of stored memory.
        """
        memory = SemanticMemory(content=content, importance=importance)
        memory_id = self.semantic_store.store(memory)

        # Store embedding
        from embedding_model import EmbeddingModel
        embedding_model = EmbeddingModel()
        embedding = embedding_model.embed(content)

        embedding_sql = """
            INSERT INTO memory_embeddings
            (memory_id, memory_type, embedding, created_at)
            VALUES (%s, %s, %s, %s)
        """
        from datetime import datetime
        self.db.execute(embedding_sql, (
            memory_id,
            "semantic",
            embedding,
            datetime.now()
        ))

        logger.info(f"Stored semantic memory {memory_id}")
        return memory_id

    def run_maintenance(self) -> Dict:
        """Run memory maintenance operations.

        Returns:
            Dict with maintenance results.
        """
        logger.info("Running memory maintenance")
        return self.maintenance.run_maintenance()

    def increment_access(self, memory_id: int, memory_type: str = "episodic") -> None:
        """Increment access count for a memory.

        Args:
            memory_id: Memory ID.
            memory_type: Type of memory (episodic/semantic).
        """
        if memory_type == "episodic":
            self.episodic_store.increment_access(memory_id)
        elif memory_type == "semantic":
            self.semantic_store.increment_access(memory_id)

    def shutdown(self) -> None:
        """Shutdown thread pool."""
        logger.info("Shutting down memory manager")
        self._executor.shutdown(wait=True)

    def __del__(self) -> None:
        """Cleanup on destruction."""
        try:
            self.shutdown()
        except Exception:
            pass

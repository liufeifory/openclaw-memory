"""Vector store for pgvector-based similarity search."""

import logging
from typing import Any, Optional, List, Dict

from database import Database

logger = logging.getLogger(__name__)


class VectorStore:
    """Handles vector similarity search using pgvector.

    Uses HNSW index for efficient approximate nearest neighbor search.
    Similarity is calculated using cosine distance.

    Attributes:
        db: Database instance.
    """

    def __init__(self, db: Database) -> None:
        """Initialize vector store.

        Args:
            db: Database instance.
        """
        self.db = db

    def search(
        self,
        embedding: List[float],
        top_k: int = 10,
        memory_type: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """Search for similar vectors.

        Args:
            embedding: Query embedding vector.
            top_k: Number of results to return.
            memory_type: Optional filter by memory type.

        Returns:
            List of dicts with memory_id, memory_type, and similarity.
        """
        try:
            # Convert Python list to pgvector-compatible format
            emb_str = ','.join(str(x) for x in embedding)

            if memory_type:
                query = """
                    SELECT memory_id, memory_type,
                           1 - (embedding <=> %s::vector) AS similarity
                    FROM memory_embeddings
                    WHERE memory_type = %s
                    ORDER BY embedding <=> %s::vector
                    LIMIT %s
                """
                return self.db.query(query, (f'[{emb_str}]', memory_type, f'[{emb_str}]', top_k))
            else:
                query = """
                    SELECT memory_id, memory_type,
                           1 - (embedding <=> %s::vector) AS similarity
                    FROM memory_embeddings
                    ORDER BY embedding <=> %s::vector
                    LIMIT %s
                """
                return self.db.query(query, (f'[{emb_str}]', f'[{emb_str}]', top_k))
        except Exception as e:
            logger.error(f"Vector search failed: {e}")
            raise

    def search_with_content(
        self,
        embedding: List[float],
        top_k: int = 10,
        memory_type: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """Search for similar vectors and join with episodic_memory content.

        Args:
            embedding: Query embedding vector.
            top_k: Number of results to return.
            memory_type: Optional filter by memory type.

        Returns:
            List of dicts with memory_id, memory_type, content, importance, and similarity.
        """
        try:
            # Convert Python list to pgvector-compatible format
            emb_str = ','.join(str(x) for x in embedding)

            if memory_type:
                query = """
                    SELECT m.id AS memory_id, e.memory_type, m.content, m.importance,
                           1 - (e.embedding <=> %s::vector) AS similarity
                    FROM memory_embeddings e
                    JOIN episodic_memory m ON e.memory_id = m.id
                    WHERE e.memory_type = %s
                    ORDER BY e.embedding <=> %s::vector
                    LIMIT %s
                """
                return self.db.query(query, (f'[{emb_str}]', memory_type, f'[{emb_str}]', top_k))
            else:
                query = """
                    SELECT m.id AS memory_id, e.memory_type, m.content, m.importance,
                           1 - (e.embedding <=> %s::vector) AS similarity
                    FROM memory_embeddings e
                    JOIN episodic_memory m ON e.memory_id = m.id
                    ORDER BY e.embedding <=> %s::vector
                    LIMIT %s
                """
                return self.db.query(query, (f'[{emb_str}]', f'[{emb_str}]', top_k))
        except Exception as e:
            logger.error(f"Vector search with content failed: {e}")
            raise

    def search_with_filter(
        self,
        embedding: List[float],
        top_k: int = 10,
        where_clause: str = "",
        params: tuple = ()
    ) -> List[Dict[str, Any]]:
        """Search with additional WHERE filter.

        Args:
            embedding: Query embedding vector.
            top_k: Number of results to return.
            where_clause: Additional WHERE clause.
            params: Additional query parameters.

        Returns:
            List of matching memories with similarity scores.
        """
        try:
            base_query = """
                SELECT memory_id, memory_type,
                       1 - (embedding <=> %s) AS similarity
                FROM memory_embeddings
            """

            if where_clause:
                full_query = f"{base_query} WHERE {where_clause} ORDER BY embedding <=> %s LIMIT %s"
                return self.db.query(full_query, (embedding, embedding, top_k) + params)
            else:
                return self.search(embedding, top_k)
        except Exception as e:
            logger.error(f"Filtered vector search failed: {e}")
            raise

    def store_embedding(
        self,
        memory_id: int,
        memory_type: str,
        embedding: List[float]
    ) -> None:
        """Store an embedding for a memory.

        Args:
            memory_id: Associated memory ID.
            memory_type: Type of memory (episodic/semantic/reflection).
            embedding: Embedding vector.
        """
        try:
            from datetime import datetime

            sql = """
                INSERT INTO memory_embeddings
                (memory_id, memory_type, embedding, created_at)
                VALUES (%s, %s, %s, %s)
            """
            self.db.execute(sql, (memory_id, memory_type, embedding, datetime.now()))
        except Exception as e:
            logger.error(f"Failed to store embedding: {e}")
            raise

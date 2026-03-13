"""Retrieval pipeline for memory search with embedding and filtering."""

import logging
from typing import Any, Optional, List, Dict

from embedding_model import EmbeddingModel
from vector_store import VectorStore
from database import Database

logger = logging.getLogger(__name__)


class RetrievalPipeline:
    """Handles the full retrieval pipeline.

    Steps:
    1. Embed query text
    2. Search vector index
    3. Filter by similarity threshold
    4. Return top results

    Parameters:
        THRESHOLD: Minimum similarity threshold (0.6)
        FINAL_RESULTS: Maximum number of results to return (5)

    Attributes:
        embedding: EmbeddingModel instance.
        vector_store: VectorStore instance.
    """

    THRESHOLD = 0.6
    FINAL_RESULTS = 5

    def __init__(self, db: Database) -> None:
        """Initialize retrieval pipeline.

        Args:
            db: Database instance.
        """
        self.embedding = EmbeddingModel()
        self.vector_store = VectorStore(db)
        logger.debug("RetrievalPipeline initialized")

    def search(
        self,
        query: str,
        top_k: int = 10,
        threshold: Optional[float] = None,
        memory_type: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """Search for memories similar to query.

        Args:
            query: Query text.
            top_k: Initial number of results to retrieve.
            threshold: Similarity threshold (default: THRESHOLD).
            memory_type: Optional filter by memory type.

        Returns:
            List of matching memories with similarity scores and content.
        """
        try:
            logger.debug(f"Searching for: {query[:50]}...")

            # Embed query
            emb = self.embedding.embed_single(query)

            # Vector search with content join
            results = self.vector_store.search_with_content(emb, top_k, memory_type)

            # Apply threshold
            effective_threshold = threshold if threshold is not None else self.THRESHOLD
            filtered = [
                r for r in results
                if r["similarity"] > effective_threshold
            ]

            logger.debug(f"Found {len(filtered)} memories above threshold")

            # Return top results
            return filtered[: self.FINAL_RESULTS]

        except Exception as e:
            logger.error(f"Retrieval pipeline search failed: {e}")
            raise

    def search_with_importance(
        self,
        query: str,
        top_k: int = 10,
        threshold: Optional[float] = None
    ) -> List[Dict[str, Any]]:
        """Search with combined similarity and importance scoring.

        Args:
            query: Query text.
            top_k: Number of results.
            threshold: Similarity threshold.

        Returns:
            List of memories with combined scores.
        """
        try:
            results = self.search(query, top_k, threshold)

            # Add combined score
            for result in results:
                importance = result.get("importance", 0.5)
                similarity = result.get("similarity", 0.0)
                result["combined_score"] = similarity * importance

            # Sort by combined score
            results.sort(key=lambda x: x["combined_score"], reverse=True)

            return results

        except Exception as e:
            logger.error(f"Search with importance failed: {e}")
            raise

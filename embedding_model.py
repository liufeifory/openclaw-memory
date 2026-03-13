"""Embedding model using local llama.cpp server."""

import logging
from typing import List
import requests

logger = logging.getLogger(__name__)


class EmbeddingModel:
    """Generates embeddings using local llama.cpp embedding server.

    BGE-M3 produces 1024-dimensional embeddings.
    Embeddings are normalized for cosine similarity.

    Attributes:
        endpoint: URL of the embedding service.
    """

    EMBEDDING_DIM = 1024

    def __init__(
        self,
        endpoint: str = "http://127.0.0.1:8080/embedding"
    ) -> None:
        """Initialize the embedding model.

        Args:
            endpoint: URL of the llama.cpp embedding endpoint.
        """
        self.endpoint = endpoint
        logger.info(f"Using local embedding endpoint: {self.endpoint}")

    def embed(self, text: str) -> List[float]:
        """Generate embedding for text.

        Args:
            text: String to embed.

        Returns:
            Embedding vector (list of floats).
        """
        try:
            response = requests.post(
                self.endpoint,
                json={"input": text},
                headers={"Content-Type": "application/json"}
            )
            response.raise_for_status()
            result = response.json()

            # llama.cpp returns array of results: [{index, embedding}]
            # embedding can be [[...]] or [...] depending on version
            if isinstance(result, list):
                emb = result[0]["embedding"]
                # Handle nested array [[...1024 values...]]
                if isinstance(emb, list) and len(emb) > 0 and isinstance(emb[0], list):
                    return emb[0]
                return emb
            elif "embedding" in result:
                return result["embedding"]
            elif "data" in result:
                return result["data"][0]["embedding"]
            else:
                raise ValueError(f"Unexpected response format: {result}")
        except Exception as e:
            logger.error(f"Failed to generate embedding: {e}")
            raise

    def embed_single(self, text: str) -> List[float]:
        """Generate embedding for a single text.

        Args:
            text: Text to embed.

        Returns:
            Embedding vector as list of floats.
        """
        return self.embed(text)

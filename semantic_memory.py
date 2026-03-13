"""Semantic memory storage for stable knowledge about the user."""

from dataclasses import dataclass
from datetime import datetime
from typing import Optional, List, Dict

from database import Database


@dataclass
class SemanticMemory:
    """Represents a semantic memory (stable knowledge).

    Attributes:
        id: Primary key (auto-generated).
        content: The knowledge content.
        importance: Base importance score (0.0-1.0).
        access_count: Number of times accessed.
        created_at: Creation timestamp.
    """

    content: str
    importance: float = 0.5
    access_count: int = 0
    created_at: Optional[datetime] = None
    id: Optional[int] = None

    def __post_init__(self) -> None:
        """Set default timestamp."""
        if self.created_at is None:
            self.created_at = datetime.now()


class SemanticMemoryStore:
    """Handles semantic memory CRUD operations."""

    def __init__(self, db: Database) -> None:
        """Initialize with database connection.

        Args:
            db: Database instance.
        """
        self.db = db

    def store(self, memory: SemanticMemory) -> int:
        """Store a new semantic memory.

        Args:
            memory: SemanticMemory instance to store.

        Returns:
            ID of the inserted memory.
        """
        sql = """
            INSERT INTO semantic_memory
            (content, importance, access_count, created_at)
            VALUES (%s, %s, %s, %s)
            RETURNING id
        """
        result = self.db.query(sql, (
            memory.content,
            memory.importance,
            memory.access_count,
            memory.created_at
        ))
        return result[0]["id"]

    def get_by_id(self, memory_id: int) -> Optional[SemanticMemory]:
        """Retrieve a memory by ID.

        Args:
            memory_id: Memory ID.

        Returns:
            SemanticMemory instance or None if not found.
        """
        sql = """
            SELECT id, content, importance, access_count, created_at
            FROM semantic_memory
            WHERE id = %s
        """
        results = self.db.query(sql, (memory_id,))
        if results:
            return self._row_to_memory(results[0])
        return None

    def get_all(self, limit: int = 100) -> List[SemanticMemory]:
        """Retrieve all semantic memories.

        Args:
            limit: Maximum number of memories to return.

        Returns:
            List of SemanticMemory instances.
        """
        sql = """
            SELECT id, content, importance, access_count, created_at
            FROM semantic_memory
            ORDER BY created_at DESC
            LIMIT %s
        """
        results = self.db.query(sql, (limit,))
        return [self._row_to_memory(r) for r in results]

    def increment_access(self, memory_id: int) -> None:
        """Increment access count.

        Args:
            memory_id: Memory ID.
        """
        sql = """
            UPDATE semantic_memory
            SET access_count = access_count + 1
            WHERE id = %s
        """
        self.db.execute(sql, (memory_id,))

    def promote_from_episodic(self, content: str, importance: float) -> int:
        """Promote an episodic memory to semantic memory.

        Args:
            content: Memory content.
            importance: Importance score.

        Returns:
            ID of the new semantic memory.
        """
        memory = SemanticMemory(content=content, importance=importance)
        return self.store(memory)

    def _row_to_memory(self, row: Dict[str, any]) -> SemanticMemory:
        """Convert database row to SemanticMemory.

        Args:
            row: Database row dict.

        Returns:
            SemanticMemory instance.
        """
        return SemanticMemory(
            id=row["id"],
            content=row["content"],
            importance=row["importance"],
            access_count=row["access_count"],
            created_at=row["created_at"]
        )

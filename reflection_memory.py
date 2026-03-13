"""Reflection memory storage for summarized insights."""

from dataclasses import dataclass
from datetime import datetime
from typing import Optional, List, Dict

from database import Database


@dataclass
class ReflectionMemory:
    """Represents a reflection memory (summarized insights).

    Attributes:
        id: Primary key (auto-generated).
        summary: The summarized insight.
        importance: Fixed importance score (typically 0.9).
        created_at: Creation timestamp.
    """

    summary: str
    importance: float = 0.9
    created_at: Optional[datetime] = None
    id: Optional[int] = None

    def __post_init__(self) -> None:
        """Set default timestamp."""
        if self.created_at is None:
            self.created_at = datetime.now()


class ReflectionMemoryStore:
    """Handles reflection memory CRUD operations."""

    def __init__(self, db: Database) -> None:
        """Initialize with database connection.

        Args:
            db: Database instance.
        """
        self.db = db

    def store(self, memory: ReflectionMemory) -> int:
        """Store a new reflection memory.

        Args:
            memory: ReflectionMemory instance to store.

        Returns:
            ID of the inserted memory.
        """
        sql = """
            INSERT INTO reflection_memory
            (summary, importance, created_at)
            VALUES (%s, %s, %s)
            RETURNING id
        """
        result = self.db.query(sql, (
            memory.summary,
            memory.importance,
            memory.created_at
        ))
        return result[0]["id"]

    def get_by_id(self, memory_id: int) -> Optional[ReflectionMemory]:
        """Retrieve a memory by ID.

        Args:
            memory_id: Memory ID.

        Returns:
            ReflectionMemory instance or None if not found.
        """
        sql = """
            SELECT id, summary, importance, created_at
            FROM reflection_memory
            WHERE id = %s
        """
        results = self.db.query(sql, (memory_id,))
        if results:
            return self._row_to_memory(results[0])
        return None

    def get_all(self, limit: int = 50) -> List[ReflectionMemory]:
        """Retrieve all reflection memories.

        Args:
            limit: Maximum number of memories to return.

        Returns:
            List of ReflectionMemory instances.
        """
        sql = """
            SELECT id, summary, importance, created_at
            FROM reflection_memory
            ORDER BY created_at DESC
            LIMIT %s
        """
        results = self.db.query(sql, (limit,))
        return [self._row_to_memory(r) for r in results]

    def get_latest(self) -> Optional[ReflectionMemory]:
        """Retrieve the most recent reflection.

        Returns:
            Latest ReflectionMemory or None.
        """
        sql = """
            SELECT id, summary, importance, created_at
            FROM reflection_memory
            ORDER BY created_at DESC
            LIMIT 1
        """
        results = self.db.query(sql)
        if results:
            return self._row_to_memory(results[0])
        return None

    def _row_to_memory(self, row: Dict[str, any]) -> ReflectionMemory:
        """Convert database row to ReflectionMemory.

        Args:
            row: Database row dict.

        Returns:
            ReflectionMemory instance.
        """
        return ReflectionMemory(
            id=row["id"],
            summary=row["summary"],
            importance=row["importance"],
            created_at=row["created_at"]
        )

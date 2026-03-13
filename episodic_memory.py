"""Episodic memory storage for events and experiences."""

from dataclasses import dataclass
from datetime import datetime
from typing import Optional, List, Dict

from database import Database


@dataclass
class EpisodicMemory:
    """Represents a single episodic memory.

    Attributes:
        id: Primary key (auto-generated).
        session_id: Session identifier.
        content: The memory content.
        importance: Base importance score (0.0-1.0).
        access_count: Number of times accessed.
        created_at: Creation timestamp.
        last_accessed: Last access timestamp.
    """

    session_id: str
    content: str
    importance: float = 0.5
    access_count: int = 0
    created_at: Optional[datetime] = None
    last_accessed: Optional[datetime] = None
    id: Optional[int] = None

    def __post_init__(self) -> None:
        """Set default timestamps."""
        if self.created_at is None:
            self.created_at = datetime.now()
        if self.last_accessed is None:
            self.last_accessed = self.created_at


class EpisodicMemoryStore:
    """Handles episodic memory CRUD operations."""

    def __init__(self, db: Database) -> None:
        """Initialize with database connection.

        Args:
            db: Database instance.
        """
        self.db = db

    def store(self, memory: EpisodicMemory) -> int:
        """Store a new episodic memory.

        Args:
            memory: EpisodicMemory instance to store.

        Returns:
            ID of the inserted memory.
        """
        sql = """
            INSERT INTO episodic_memory
            (session_id, content, importance, access_count, created_at, last_accessed)
            VALUES (%s, %s, %s, %s, %s, %s)
            RETURNING id
        """
        result = self.db.query(sql, (
            memory.session_id,
            memory.content,
            memory.importance,
            memory.access_count,
            memory.created_at,
            memory.last_accessed
        ))
        return result[0]["id"]

    def get_by_id(self, memory_id: int) -> Optional[EpisodicMemory]:
        """Retrieve a memory by ID.

        Args:
            memory_id: Memory ID.

        Returns:
            EpisodicMemory instance or None if not found.
        """
        sql = """
            SELECT id, session_id, content, importance, access_count,
                   created_at, last_accessed
            FROM episodic_memory
            WHERE id = %s
        """
        results = self.db.query(sql, (memory_id,))
        if results:
            return self._row_to_memory(results[0])
        return None

    def get_by_session(self, session_id: str, limit: int = 100) -> List[EpisodicMemory]:
        """Retrieve memories for a session.

        Args:
            session_id: Session identifier.
            limit: Maximum number of memories to return.

        Returns:
            List of EpisodicMemory instances.
        """
        sql = """
            SELECT id, session_id, content, importance, access_count,
                   created_at, last_accessed
            FROM episodic_memory
            WHERE session_id = %s
            ORDER BY created_at DESC
            LIMIT %s
        """
        results = self.db.query(sql, (session_id, limit))
        return [self._row_to_memory(r) for r in results]

    def increment_access(self, memory_id: int) -> None:
        """Increment access count and update last_accessed.

        Args:
            memory_id: Memory ID.
        """
        sql = """
            UPDATE episodic_memory
            SET access_count = access_count + 1,
                last_accessed = %s
            WHERE id = %s
        """
        self.db.execute(sql, (datetime.now(), memory_id))

    def get_count(self) -> int:
        """Get total number of episodic memories.

        Returns:
            Total count.
        """
        sql = "SELECT COUNT(*) as count FROM episodic_memory"
        result = self.db.query(sql)
        return result[0]["count"]

    def get_all_for_reflection(self, limit: int = 50) -> List[EpisodicMemory]:
        """Get recent memories for reflection generation.

        Args:
            limit: Maximum number of memories to return.

        Returns:
            List of EpisodicMemory instances.
        """
        sql = """
            SELECT id, session_id, content, importance, access_count,
                   created_at, last_accessed
            FROM episodic_memory
            ORDER BY created_at DESC
            LIMIT %s
        """
        results = self.db.query(sql, (limit,))
        return [self._row_to_memory(r) for r in results]

    def _row_to_memory(self, row: Dict[str, any]) -> EpisodicMemory:
        """Convert database row to EpisodicMemory.

        Args:
            row: Database row dict.

        Returns:
            EpisodicMemory instance.
        """
        return EpisodicMemory(
            id=row["id"],
            session_id=row["session_id"],
            content=row["content"],
            importance=row["importance"],
            access_count=row["access_count"],
            created_at=row["created_at"],
            last_accessed=row["last_accessed"]
        )

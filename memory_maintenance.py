"""Memory maintenance for decay, promotion, and reflection generation."""

import logging
from datetime import datetime, timedelta
from typing import Callable, Optional, List, Dict

from database import Database
from episodic_memory import EpisodicMemory, EpisodicMemoryStore
from semantic_memory import SemanticMemory, SemanticMemoryStore
from reflection_memory import ReflectionMemory, ReflectionMemoryStore
from importance_learning import ImportanceLearning

logger = logging.getLogger(__name__)


class MemoryMaintenance:
    """Handles memory maintenance operations.

    Operations:
    - Memory decay: importance *= 0.98 daily
    - Memory promotion: episodic -> semantic when access_count > 10
    - Reflection generation: every 50 episodic memories
    """

    # Decay factor (daily)
    DECAY_FACTOR = 0.98

    # Promotion threshold
    PROMOTION_THRESHOLD = 10

    # Reflection interval (number of episodic memories)
    REFLECTION_INTERVAL = 50

    def __init__(
        self,
        db: Database,
        llm_summarize_fn: Optional[Callable[[List[str]], str]] = None
    ) -> None:
        """Initialize memory maintenance.

        Args:
            db: Database instance.
            llm_summarize_fn: Optional function to generate summaries using LLM.
        """
        self.db = db
        self.episodic_store = EpisodicMemoryStore(db)
        self.semantic_store = SemanticMemoryStore(db)
        self.reflection_store = ReflectionMemoryStore(db)
        self.importance_learner = ImportanceLearning()
        self.llm_summarize_fn = llm_summarize_fn

    def run_decay(self, older_than_days: int = 1) -> int:
        """Apply decay to memories older than specified days.

        Args:
            older_than_days: Only decay memories older than this.

        Returns:
            Number of memories decayed.
        """
        cutoff = datetime.now() - timedelta(days=older_than_days)

        # Get old episodic memories
        sql = """
            SELECT id, importance, created_at
            FROM episodic_memory
            WHERE created_at < %s
        """
        results = self.db.query(sql, (cutoff,))

        count = 0
        for row in results:
            new_importance = self.importance_learner.apply_decay(
                row["importance"],
                self.DECAY_FACTOR
            )
            update_sql = """
                UPDATE episodic_memory
                SET importance = %s
                WHERE id = %s
            """
            self.db.execute(update_sql, (new_importance, row["id"]))
            count += 1

        # Get old semantic memories
        sql = """
            SELECT id, importance, created_at
            FROM semantic_memory
            WHERE created_at < %s
        """
        results = self.db.query(sql, (cutoff,))

        for row in results:
            new_importance = self.importance_learner.apply_decay(
                row["importance"],
                self.DECAY_FACTOR
            )
            update_sql = """
                UPDATE semantic_memory
                SET importance = %s
                WHERE id = %s
            """
            self.db.execute(update_sql, (new_importance, row["id"]))
            count += 1

        logger.info(f"Applied decay to {count} memories")
        return count

    def run_promotion(self) -> int:
        """Promote episodic memories to semantic based on access count.

        Returns:
            Number of memories promoted.
        """
        # Find episodic memories with high access count
        sql = """
            SELECT id, content, importance, access_count
            FROM episodic_memory
            WHERE access_count > %s
        """
        results = self.db.query(sql, (self.PROMOTION_THRESHOLD,))

        count = 0
        for row in results:
            # Check if already promoted (content exists in semantic)
            check_sql = """
                SELECT id FROM semantic_memory
                WHERE content = %s
            """
            existing = self.db.query(check_sql, (row["content"],))

            if not existing:
                # Promote to semantic memory
                self.semantic_store.promote_from_episodic(
                    content=row["content"],
                    importance=row["importance"]
                )
                count += 1
                logger.info(f"Promoted episodic memory {row['id']} to semantic")

        logger.info(f"Promoted {count} memories to semantic")
        return count

    def check_and_generate_reflection(self) -> Optional[int]:
        """Check if reflection should be generated and generate if needed.

        Returns:
            Reflection memory ID if generated, None otherwise.
        """
        total_count = self.episodic_store.get_count()

        # Check if we've hit reflection interval
        if total_count > 0 and total_count % self.REFLECTION_INTERVAL == 0:
            return self.generate_reflection()

        return None

    def generate_reflection(self) -> Optional[int]:
        """Generate a reflection memory from recent episodic memories.

        Returns:
            Reflection memory ID if successful, None otherwise.
        """
        # Get recent memories
        memories = self.episodic_store.get_all_for_reflection(
            limit=self.REFLECTION_INTERVAL
        )

        if not memories:
            return None

        # Extract content for summarization
        contents = [m.content for m in memories]

        # Generate summary using LLM if available
        if self.llm_summarize_fn:
            try:
                summary = self.llm_summarize_fn(contents)
            except Exception as e:
                logger.error(f"Failed to generate reflection summary: {e}")
                summary = self._fallback_summary(contents)
        else:
            summary = self._fallback_summary(contents)

        # Store reflection
        reflection = ReflectionMemory(summary=summary, importance=0.9)
        reflection_id = self.reflection_store.store(reflection)

        logger.info(f"Generated reflection memory {reflection_id}")
        return reflection_id

    def _fallback_summary(self, contents: List[str]) -> str:
        """Generate a simple fallback summary without LLM.

        Args:
            contents: List of memory contents.

        Returns:
            Simple summary string.
        """
        # Just list the topics covered
        unique_topics = list(set(contents))[:10]
        return f"Key experiences: {'; '.join(unique_topics)}"

    def run_maintenance(self) -> Dict:
        """Run all maintenance operations.

        Returns:
            Dict with counts of operations performed.
        """
        results = {
            "decayed": self.run_decay(),
            "promoted": self.run_promotion(),
            "reflections_generated": 0
        }

        reflection_id = self.check_and_generate_reflection()
        if reflection_id:
            results["reflections_generated"] = 1

        return results

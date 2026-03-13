"""OpenClaw Memory Plugin - main entry point.

Provides long-term memory with semantic retrieval, vector search,
importance learning, reflection memory, and asynchronous storage.
"""

import logging
from typing import Any, Optional, Dict

from database import Database
from memory_manager import MemoryManager

logger = logging.getLogger(__name__)


class OpenClawMemoryPlugin:
    """Main plugin class for OpenClaw memory system.

    Handles user messages by:
    1. Retrieving relevant memories for context
    2. Building context with memories
    3. Asynchronously storing new memories

    Attributes:
        db: Database connection.
        memory_manager: Memory operations orchestrator.
    """

    def __init__(self, config: Dict[str, Any]) -> None:
        """Initialize the memory plugin.

        Args:
            config: Database configuration dict with keys:
                - host: Database host
                - port: Database port
                - database: Database name
                - user: Database user
                - password: Database password
        """
        self.db = Database(config)
        self.memory_manager = MemoryManager(self.db)
        logger.info("OpenClaw Memory Plugin initialized")

    def on_user_message(
        self,
        session_id: str,
        message: str,
        recent_conversation: Optional[str] = None
    ) -> str:
        """Handle incoming user message.

        Retrieves relevant memories, builds context, and stores the message.

        Args:
            session_id: Unique session identifier.
            message: User message content.
            recent_conversation: Recent conversation history (optional).

        Returns:
            Context string with relevant memories for LLM.
        """
        try:
            logger.debug(f"Processing message for session {session_id}")

            # Retrieve relevant memories
            memories = self.memory_manager.retrieve_relevant(message)

            # Build context with memories
            context = self.memory_manager.build_context(
                session_id=session_id,
                memories=memories,
                recent_conversation=recent_conversation
            )

            # Store message asynchronously
            self.memory_manager.async_store(
                session_id=session_id,
                content=message
            )

            return context

        except Exception as e:
            logger.error(f"Error processing message: {e}")
            # Return empty context on error - don't break the conversation
            return "SYSTEM:\n\n[Memory system temporarily unavailable]"

    def on_assistant_message(
        self,
        session_id: str,
        message: str,
        importance: float = 0.3
    ) -> None:
        """Handle assistant response (optional storage).

        Args:
            session_id: Unique session identifier.
            message: Assistant message content.
            importance: Base importance score (default 0.3 for assistant messages).
        """
        try:
            # Store assistant messages with lower importance
            self.memory_manager.async_store(
                session_id=session_id,
                content=f"Assistant: {message}",
                importance=importance
            )
        except Exception as e:
            logger.error(f"Error storing assistant message: {e}")

    def get_memory_stats(self) -> Dict[str, Any]:
        """Get memory system statistics.

        Returns:
            Dict with memory counts by type.
        """
        try:
            from episodic_memory import EpisodicMemoryStore
            from semantic_memory import SemanticMemoryStore
            from reflection_memory import ReflectionMemoryStore

            episodic_store = EpisodicMemoryStore(self.db)
            semantic_store = SemanticMemoryStore(self.db)
            reflection_store = ReflectionMemoryStore(self.db)

            return {
                "episodic_count": episodic_store.get_count(),
                "semantic_count": len(semantic_store.get_all(limit=1000)),
                "reflection_count": len(reflection_store.get_all(limit=1000))
            }
        except Exception as e:
            logger.error(f"Error getting stats: {e}")
            return {"error": str(e)}

    def run_maintenance(self) -> Dict[str, Any]:
        """Run memory maintenance operations.

        Returns:
            Dict with maintenance results.
        """
        try:
            return self.memory_manager.run_maintenance()
        except Exception as e:
            logger.error(f"Error running maintenance: {e}")
            return {"error": str(e)}

    def shutdown(self) -> None:
        """Shutdown the plugin and cleanup resources."""
        try:
            self.memory_manager.shutdown()
            logger.info("OpenClaw Memory Plugin shut down")
        except Exception as e:
            logger.error(f"Error shutting down: {e}")

    def __del__(self) -> None:
        """Cleanup on destruction."""
        try:
            self.shutdown()
        except Exception:
            pass

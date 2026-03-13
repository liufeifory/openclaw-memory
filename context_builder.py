"""Context builder for constructing system prompts with memory injection."""

from typing import Optional, List, Dict, Union

from episodic_memory import EpisodicMemory
from semantic_memory import SemanticMemory
from reflection_memory import ReflectionMemory


class ContextBuilder:
    """Builds system context with relevant memories and conversation.

    Output format:
        SYSTEM:

        Relevant memories:
        - memory1
        - memory2

        Recent conversation:
        User: ...
        Assistant: ...

    Memory injection limit: 3-5 memories
    """

    # Memory injection limits
    MIN_MEMORIES = 3
    MAX_MEMORIES = 5

    def __init__(self) -> None:
        """Initialize context builder."""
        pass

    def build_context(
        self,
        session_id: str,
        relevant_memories: List[Dict],
        recent_conversation: Optional[str] = None,
        reflection_memories: Optional[List[ReflectionMemory]] = None
    ) -> str:
        """Build system context with memories.

        Args:
            session_id: Session identifier.
            relevant_memories: List of relevant memory dicts with 'content' key.
            recent_conversation: Recent conversation history (optional).
            reflection_memories: Reflection memories to include (optional).

        Returns:
            Formatted context string.
        """
        context_parts = ["SYSTEM:"]

        # Add reflection memories first (highest priority insights)
        if reflection_memories:
            context_parts.append("\nKey insights:")
            for memory in reflection_memories[:self.MAX_MEMORIES]:
                context_parts.append(f"- {memory.summary}")

        # Add relevant memories
        if relevant_memories:
            context_parts.append("\nRelevant memories:")
            for memory in relevant_memories[:self.MAX_MEMORIES]:
                content = memory.get("content", str(memory))
                context_parts.append(f"- {content}")

        # Add recent conversation if available
        if recent_conversation:
            context_parts.append("\nRecent conversation:")
            context_parts.append(recent_conversation.strip())

        return "\n".join(context_parts)

    def format_memory_for_display(
        self,
        memory: Union[EpisodicMemory, SemanticMemory],
        include_metadata: bool = False
    ) -> str:
        """Format a memory for display in context.

        Args:
            memory: Memory instance to format.
            include_metadata: Whether to include importance/access info.

        Returns:
            Formatted memory string.
        """
        content = memory.content

        if include_metadata:
            return f"[importance={memory.importance:.2f}] {content}"

        return content

    def truncate_context(
        self,
        context: str,
        max_tokens: Optional[int] = None
    ) -> str:
        """Truncate context to fit within token limits.

        Args:
            context: Context string to truncate.
            max_tokens: Maximum tokens (approximate, 4 chars = 1 token).

        Returns:
            Truncated context string.
        """
        if max_tokens is None:
            return context

        max_chars = max_tokens * 4

        if len(context) <= max_chars:
            return context

        # Truncate and add indicator
        truncated = context[:max_chars - 50]
        return truncated + "\n... [truncated]"

    def select_top_memories(
        self,
        memories: List[Dict],
        count: Optional[int] = None
    ) -> List[Dict]:
        """Select top memories based on scored results.

        Args:
            memories: List of memory dicts with 'similarity' and 'importance' keys.
            count: Number of memories to select (default: MAX_MEMORIES).

        Returns:
            List of top memories.
        """
        if not memories:
            return []

        if count is None:
            count = self.MAX_MEMORIES

        # Sort by combined score (similarity * importance)
        scored_memories = []
        for memory in memories:
            similarity = memory.get("similarity", 0.0)
            importance = memory.get("importance", 0.5)
            score = similarity * importance
            scored_memories.append((score, memory))

        # Sort by score descending
        scored_memories.sort(key=lambda x: x[0], reverse=True)

        # Return top memories
        return [m[1] for m in scored_memories[:count]]

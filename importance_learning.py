"""Importance learning for dynamic importance calculation."""

import math
from datetime import datetime
from typing import Optional


class ImportanceLearning:
    """Calculates dynamic importance scores for memories.

    Importance formula:
        importance = 0.5 * base_importance +
                     0.3 * log(access_count + 1) +
                     0.2 * recency_score

    Where recency_score = exp(-days_since_creation / 30)
    """

    # Weights for importance calculation
    BASE_WEIGHT = 0.5
    ACCESS_WEIGHT = 0.3
    RECENCY_WEIGHT = 0.2

    # Recency decay constant (days)
    RECENCY_DECAY_DAYS = 30

    def __init__(self) -> None:
        """Initialize importance calculator."""
        pass

    def calculate(
        self,
        base_importance: float,
        access_count: int,
        created_at: datetime,
        reference_time: Optional[datetime] = None
    ) -> float:
        """Calculate dynamic importance score.

        Args:
            base_importance: Base importance score (0.0-1.0).
            access_count: Number of times the memory was accessed.
            created_at: Memory creation timestamp.
            reference_time: Time to calculate recency from (default: now).

        Returns:
            Calculated importance score (0.0-1.0).
        """
        if reference_time is None:
            reference_time = datetime.now()

        # Calculate recency score
        days_since_creation = (reference_time - created_at).days
        recency_score = math.exp(-days_since_creation / self.RECENCY_DECAY_DAYS)

        # Calculate access score (normalized)
        access_score = math.log(access_count + 1)

        # Combine scores with weights
        importance = (
            self.BASE_WEIGHT * base_importance +
            self.ACCESS_WEIGHT * access_score +
            self.RECENCY_WEIGHT * recency_score
        )

        # Normalize to 0.0-1.0 range
        # Max theoretical value: 0.5*1 + 0.3*log(high) + 0.2*1
        # We clamp to keep it in valid range
        return max(0.0, min(1.0, importance))

    def calculate_recency_score(
        self,
        created_at: datetime,
        reference_time: Optional[datetime] = None
    ) -> float:
        """Calculate recency score alone.

        Args:
            created_at: Memory creation timestamp.
            reference_time: Time to calculate recency from (default: now).

        Returns:
            Recency score (0.0-1.0).
        """
        if reference_time is None:
            reference_time = datetime.now()

        days_since_creation = (reference_time - created_at).days
        return math.exp(-days_since_creation / self.RECENCY_DECAY_DAYS)

    def apply_decay(self, importance: float, decay_factor: float = 0.98) -> float:
        """Apply decay to importance score.

        Args:
            importance: Current importance score.
            decay_factor: Decay multiplier (default: 0.98 for daily decay).

        Returns:
            Decayed importance score.
        """
        return max(0.0, importance * decay_factor)

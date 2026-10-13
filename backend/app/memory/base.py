"""MemoryProvider interface — the replaceable conversational-memory seam.

An implementation retrieves the most recent turns for a (user, agent) pair and
appends new turns. The voice session uses this to ground the system prompt with
past conversation context (retrieve-then-inject) and to persist the current
conversation on close. A future summarizing implementation reuses this exact
interface.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import List


@dataclass(frozen=True)
class Turn:
    role: str  # "USER" | "ASSISTANT"
    text: str


class MemoryProvider(ABC):
    @abstractmethod
    async def retrieve(
        self, user_sub: str, agent_id: str, max_turns: int = 12
    ) -> List[Turn]:
        """Return up to `max_turns` most recent turns, oldest-first."""
        raise NotImplementedError

    @abstractmethod
    async def append(
        self, user_sub: str, agent_id: str, session_id: str, turns: List[Turn]
    ) -> None:
        """Persist the turns of a finished (or in-progress) session."""
        raise NotImplementedError

    async def save_stats(
        self,
        user_sub: str,
        agent_id: str,
        session_id: str,
        input_tokens: int,
        output_tokens: int,
    ) -> None:
        """Persist token usage stats for a finished session. Default no-op."""
        return None


class NullMemoryProvider(MemoryProvider):
    """No-op provider when memory is disabled (backward compatible)."""

    async def retrieve(
        self, user_sub: str, agent_id: str, max_turns: int = 12
    ) -> List[Turn]:
        return []

    async def append(
        self, user_sub: str, agent_id: str, session_id: str, turns: List[Turn]
    ) -> None:
        return None

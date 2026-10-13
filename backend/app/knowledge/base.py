"""KnowledgeProvider interface — the replaceable RAG seam.

An implementation returns the most relevant text chunks for a query against one
or more knowledge bases. The voice session uses this to ground the agent's
system prompt (retrieve-then-inject). A future tool-use path (C4) can reuse the
exact same interface behind a `search_kb` tool.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import List


@dataclass(frozen=True)
class RetrievedChunk:
    text: str
    source: str = ""
    score: float = 0.0


class KnowledgeProvider(ABC):
    @abstractmethod
    async def retrieve(
        self, knowledge_base_id: str, query: str, max_results: int = 4
    ) -> List[RetrievedChunk]:
        """Return up to `max_results` relevant chunks for `query`."""
        raise NotImplementedError


class NullKnowledgeProvider(KnowledgeProvider):
    """No-op provider used when no KB is configured (backward compatible)."""

    async def retrieve(
        self, knowledge_base_id: str, query: str, max_results: int = 4
    ) -> List[RetrievedChunk]:
        return []

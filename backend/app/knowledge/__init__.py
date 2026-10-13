"""Knowledge (RAG) seam for the voice proxy.

Exposes a `KnowledgeProvider` interface (retrieve chunks for a query) and a
`BedrockKbProvider` implementation backed by Amazon Bedrock Knowledge Bases.

Keeping retrieval behind this interface means we can swap the current
"retrieve-then-inject" strategy for tool-use (the model calls a `search_kb`
tool mid-turn) in C4 without touching the voice/session loop.
"""
from .base import KnowledgeProvider, NullKnowledgeProvider
from .bedrock_kb import BedrockKbProvider

__all__ = ["KnowledgeProvider", "NullKnowledgeProvider", "BedrockKbProvider"]

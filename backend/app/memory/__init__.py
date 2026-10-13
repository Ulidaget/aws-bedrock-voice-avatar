"""Conversational memory (cross-session) seam for the voice proxy.

Exposes a `MemoryProvider` interface (retrieve recent turns / append new turns)
and a `DynamoMemoryProvider` backed by a DynamoDB table.

Same shape as the C3 knowledge seam: retrieve-then-inject at session start,
persist on session close. Kept behind an interface so a future
`SummarizingMemoryProvider` (rolling summaries instead of raw turns) can drop in
without touching the voice/session loop.
"""
from .base import MemoryProvider, NullMemoryProvider, Turn
from .dynamo import DynamoMemoryProvider

__all__ = ["MemoryProvider", "NullMemoryProvider", "Turn", "DynamoMemoryProvider"]

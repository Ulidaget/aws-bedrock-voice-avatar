"""ToolRegistry — the seam for tools/actions (C5 tool use).

Decoupled from any single tool implementation: built-in Python handlers today,
Lambda / MCP / Bedrock AgentCore tomorrow. The session builds a per-agent
registry from the agent's tool_names and passes the specs to the VoiceProvider,
which advertises them to the model.

Handlers may be sync or async; `ToolRegistry.execute` awaits them uniformly.
"""
from __future__ import annotations

import asyncio
import inspect
from dataclasses import dataclass
from typing import Awaitable, Callable, Dict, List, Union

# A handler takes the parsed tool arguments and returns a JSON-serializable dict
# (or an awaitable of one).
ToolHandler = Callable[[dict], Union[dict, Awaitable[dict]]]


@dataclass
class ToolSpec:
    name: str
    description: str
    input_schema: dict
    handler: ToolHandler


class ToolRegistry:
    def __init__(self) -> None:
        self._tools: Dict[str, ToolSpec] = {}

    def register(self, spec: ToolSpec) -> None:
        self._tools[spec.name] = spec

    def get(self, name: str) -> ToolSpec | None:
        return self._tools.get(name)

    def specs(self) -> List[ToolSpec]:
        return list(self._tools.values())

    def is_empty(self) -> bool:
        return not self._tools

    async def execute(self, name: str, args: dict) -> dict:
        """Run a tool by name. Raises KeyError if unknown; the caller is
        responsible for always sending a toolResult (even on error)."""
        spec = self._tools.get(name)
        if spec is None:
            raise KeyError(name)
        result = spec.handler(args or {})
        if inspect.isawaitable(result):
            result = await result
        return result if isinstance(result, dict) else {"result": result}


# Backward-compatible empty default (no tools).
default_registry = ToolRegistry()

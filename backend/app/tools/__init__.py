"""Built-in tools for C5 tool use.

`build_registry` assembles a per-session ToolRegistry from an agent's tool_names,
wiring dependencies (e.g. the KnowledgeProvider + resolved KB id) into the
handlers via closures.
"""
from .builtins import AVAILABLE_TOOL_NAMES, build_registry

__all__ = ["AVAILABLE_TOOL_NAMES", "build_registry"]

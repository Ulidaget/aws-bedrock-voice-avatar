"""AgentRepository — loads AgentConfig records from DynamoDB by agentId.

This is the C1 (multi-agent) seam: Phase 0 returned a single hard-coded agent;
now agents are data. The repository:
  - reads an item from the `Agents` table by `agentId`,
  - maps it to the existing AgentConfig dataclass (unchanged shape),
  - caches results in-memory with a short TTL (agents rarely change, and we
    don't want a DynamoDB read per WebSocket session),
  - falls back to the static default agent when the table/env is not configured
    or the requested id is `default` and missing — preserving Phase 0 behavior.

boto3 is synchronous; calls run in a thread executor so the asyncio event loop
is never blocked. Credentials come from the task role (no keys in code).
"""
from __future__ import annotations

import asyncio
import logging
import time
from typing import Dict, Optional, Tuple

from .agent_config import AgentConfig, get_default_agent

logger = logging.getLogger("agent_repository")

DEFAULT_AGENT_ID = "default"


class AgentNotFound(Exception):
    pass


class AgentDisabled(Exception):
    pass


def _item_to_config(item: dict) -> AgentConfig:
    """Map a DynamoDB item (plain dict from the resource API) to AgentConfig."""
    return AgentConfig(
        agent_id=item["agentId"],
        name=item.get("name", item["agentId"]),
        description=item.get("description", ""),
        system_prompt=item["systemPrompt"],
        model_id=item.get("modelId", "amazon.nova-2-sonic-v1:0"),
        voice_id=item.get("voiceId", "matthew"),
        knowledge_base_ids=list(item.get("knowledgeBaseIds", []) or []),
        tool_names=list(item.get("toolNames", []) or []),
        remember_conversations=bool(item.get("rememberConversations", False)),
        allowed_groups=list(item.get("allowedGroups", []) or []),
    )


class AgentRepository:
    def __init__(self, table_name: str, region: str, default_model_id: str,
                 cache_ttl_seconds: float = 60.0) -> None:
        self._table_name = table_name
        self._region = region
        self._default_model_id = default_model_id
        self._cache_ttl = cache_ttl_seconds
        self._cache: Dict[str, Tuple[float, AgentConfig]] = {}
        self._table = None  # lazily created boto3 Table

    def _get_table(self):
        if self._table is None:
            import boto3  # imported lazily so the module loads without boto3 present

            self._table = boto3.resource("dynamodb", region_name=self._region).Table(
                self._table_name
            )
        return self._table

    async def load(self, agent_id: Optional[str]) -> AgentConfig:
        """Load an agent by id. Raises AgentNotFound / AgentDisabled on problems.

        Falls back to the static default agent when the table is not configured
        (AGENTS_TABLE unset) or when `default` is requested but absent.
        """
        agent_id = (agent_id or DEFAULT_AGENT_ID).strip()

        # No table configured -> Phase 0 behavior (static default).
        if not self._table_name:
            if agent_id != DEFAULT_AGENT_ID:
                logger.warning(
                    "AGENTS_TABLE not configured; ignoring agentId=%s, using default",
                    agent_id,
                )
            return get_default_agent(self._default_model_id)

        # Cache hit?
        cached = self._cache.get(agent_id)
        if cached and (time.monotonic() - cached[0]) < self._cache_ttl:
            return cached[1]

        item = await self._get_item(agent_id)

        if item is None:
            if agent_id == DEFAULT_AGENT_ID:
                # Graceful fallback so a fresh/empty table still works.
                logger.warning("default agent missing in table; using static default")
                cfg = get_default_agent(self._default_model_id)
                self._cache[agent_id] = (time.monotonic(), cfg)
                return cfg
            raise AgentNotFound(f"unknown agentId: {agent_id}")

        if not item.get("enabled", True):
            raise AgentDisabled(f"agent is disabled: {agent_id}")

        cfg = _item_to_config(item)
        self._cache[agent_id] = (time.monotonic(), cfg)
        return cfg

    async def _get_item(self, agent_id: str) -> Optional[dict]:
        loop = asyncio.get_running_loop()

        def _get() -> Optional[dict]:
            try:
                resp = self._get_table().get_item(Key={"agentId": agent_id})
                return resp.get("Item")
            except Exception as exc:  # network / permissions / table missing
                logger.exception("DynamoDB get_item failed for agentId=%s", agent_id)
                raise exc

        return await loop.run_in_executor(None, _get)

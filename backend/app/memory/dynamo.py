"""DynamoMemoryProvider — stores/reads conversation turns in DynamoDB.

Table schema (see infra DataStack `ConversationsTable`):
  - PK  userSub  (Cognito subject; strict per-user namespacing)
  - SK  sk       = "{agentId}#{createdAtIso}#{turnSeq}"  (chronological order)
  - role, text, sessionId, createdAt, ttl (epoch seconds for auto-expiry)

Retrieval: query by userSub with begins_with(sk, "{agentId}#"), newest-first,
limited to max_turns; then reverse so callers get oldest-first for prompt
injection.

boto3 is synchronous; calls run in a thread executor so the asyncio event loop
is never blocked. Credentials come from the task role. The client/table are
created lazily so the module imports without boto3 present.
"""
from __future__ import annotations

import asyncio
import logging
import time
from datetime import datetime, timezone
from typing import List

from boto3.dynamodb.conditions import Key

from .base import MemoryProvider, Turn

logger = logging.getLogger("dynamo_memory")


class DynamoMemoryProvider(MemoryProvider):
    def __init__(self, table_name: str, region: str, ttl_days: int = 30) -> None:
        self._table_name = table_name
        self._region = region
        self._ttl_days = ttl_days
        self._table = None  # lazily created boto3 Table

    def _get_table(self):
        if self._table is None:
            import boto3  # imported lazily so the module loads without boto3

            self._table = boto3.resource(
                "dynamodb", region_name=self._region
            ).Table(self._table_name)
        return self._table

    async def retrieve(
        self, user_sub: str, agent_id: str, max_turns: int = 12
    ) -> List[Turn]:
        if not self._table_name or not user_sub or not agent_id:
            return []

        loop = asyncio.get_running_loop()

        def _query() -> List[Turn]:
            try:
                resp = self._get_table().query(
                    KeyConditionExpression=Key("userSub").eq(user_sub)
                    & Key("sk").begins_with(f"{agent_id}#"),
                    ScanIndexForward=False,  # newest first
                    Limit=max_turns,
                )
            except Exception:
                logger.exception(
                    "memory retrieve failed user=%s agent=%s", user_sub, agent_id
                )
                return []
            items = resp.get("Items", [])
            # Newest-first from the query; reverse to oldest-first for the prompt.
            items.reverse()
            turns: List[Turn] = []
            for it in items:
                text = it.get("text", "")
                role = it.get("role", "")
                if text and role:
                    turns.append(Turn(role=role, text=text))
            return turns

        return await loop.run_in_executor(None, _query)

    async def append(
        self, user_sub: str, agent_id: str, session_id: str, turns: List[Turn]
    ) -> None:
        if not self._table_name or not user_sub or not agent_id or not turns:
            return None

        loop = asyncio.get_running_loop()

        def _write() -> None:
            now = datetime.now(timezone.utc)
            created_iso = now.isoformat()
            ttl = int(time.time()) + self._ttl_days * 86400
            try:
                table = self._get_table()
                with table.batch_writer() as batch:
                    for seq, turn in enumerate(turns):
                        batch.put_item(
                            Item={
                                "userSub": user_sub,
                                # Zero-pad seq so lexical order == chronological
                                # order within the same session timestamp.
                                "sk": f"{agent_id}#{created_iso}#{seq:04d}",
                                "role": turn.role,
                                "text": turn.text,
                                "sessionId": session_id,
                                "createdAt": created_iso,
                                "ttl": ttl,
                            }
                        )
            except Exception:
                logger.exception(
                    "memory append failed user=%s agent=%s", user_sub, agent_id
                )

        await loop.run_in_executor(None, _write)

    async def save_stats(
        self,
        user_sub: str,
        agent_id: str,
        session_id: str,
        input_tokens: int,
        output_tokens: int,
    ) -> None:
        """Write a single session-summary item with token usage counts."""
        if not self._table_name or not user_sub or not agent_id:
            return

        loop = asyncio.get_running_loop()

        def _write_stats() -> None:
            from decimal import Decimal

            now = datetime.now(timezone.utc)
            ttl = int(time.time()) + self._ttl_days * 86400
            try:
                self._get_table().put_item(
                    Item={
                        "userSub": user_sub,
                        # #stats# prefix distinguishes summary items from turn items.
                        "sk": f"{agent_id}#stats#{session_id}",
                        "sessionId": session_id,
                        "inputTokens": Decimal(input_tokens),
                        "outputTokens": Decimal(output_tokens),
                        "createdAt": now.isoformat(),
                        "ttl": ttl,
                    }
                )
            except Exception:
                logger.exception(
                    "save_stats failed user=%s agent=%s session=%s",
                    user_sub, agent_id, session_id,
                )

        await loop.run_in_executor(None, _write_stats)

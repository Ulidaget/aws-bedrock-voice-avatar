"""Built-in tool definitions and the per-session registry builder."""
from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timezone
from typing import Optional

from ..agent.tool_registry import ToolRegistry, ToolSpec
from ..knowledge.base import KnowledgeProvider

logger = logging.getLogger("tools")

# Tool names the platform knows about (surfaced in the admin UI).
AVAILABLE_TOOL_NAMES = ["get_current_time", "search_knowledge", "get_order_status"]


# --- get_current_time -----------------------------------------------------
def _get_current_time(args: dict) -> dict:
    now = datetime.now(timezone.utc).astimezone()
    return {
        "iso": now.isoformat(),
        "date": now.strftime("%Y-%m-%d"),
        "time": now.strftime("%H:%M:%S"),
        "timezone": str(now.tzinfo),
    }


_GET_CURRENT_TIME = ToolSpec(
    name="get_current_time",
    description="Get the current date and time. Use when the user asks what "
    "time or date it is.",
    input_schema={"type": "object", "properties": {}, "required": []},
    handler=_get_current_time,
)


# --- search_knowledge (RAG per turn) --------------------------------------
def _make_search_knowledge(
    knowledge: KnowledgeProvider, kb_id: str
) -> ToolSpec:
    async def _handler(args: dict) -> dict:
        query = (args.get("query") or "").strip()
        if not query:
            return {"results": [], "note": "empty query"}
        try:
            chunks = await knowledge.retrieve(kb_id, query, max_results=4)
        except Exception:
            logger.exception("search_knowledge failed")
            return {"results": [], "error": "knowledge search failed"}
        return {
            "results": [
                {"text": c.text, "source": c.source} for c in chunks
            ]
        }

    return ToolSpec(
        name="search_knowledge",
        description="Search the knowledge base for information from the "
        "organization's documents. Use when the user asks something that may be "
        "answered by internal documentation, policies, products, or FAQs.",
        input_schema={
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "What to look up, in natural language.",
                }
            },
            "required": ["query"],
        },
        handler=_handler,
    )


# --- get_order_status (C9: business Lambda) -------------------------------
def _make_get_order_status(function_name: str, region: str) -> ToolSpec:
    _client = {"c": None}

    def _get_client():
        if _client["c"] is None:
            import boto3

            _client["c"] = boto3.client("lambda", region_name=region)
        return _client["c"]

    async def _handler(args: dict) -> dict:
        order_id = str(args.get("orderId", "")).strip()
        if not order_id:
            return {"error": "missing orderId"}

        loop = asyncio.get_running_loop()

        def _invoke() -> dict:
            try:
                resp = _get_client().invoke(
                    FunctionName=function_name,
                    InvocationType="RequestResponse",
                    Payload=json.dumps({"orderId": order_id}).encode("utf-8"),
                )
                raw = resp["Payload"].read()
                return json.loads(raw.decode("utf-8")) if raw else {}
            except Exception:
                logger.exception("order-service invoke failed")
                return {"error": "order service unavailable"}

        return await loop.run_in_executor(None, _invoke)

    return ToolSpec(
        name="get_order_status",
        description="Look up the status of a customer order by its order id. "
        "Use when the user asks about the state, delivery, or contents of an "
        "order and gives an order number.",
        input_schema={
            "type": "object",
            "properties": {
                "orderId": {
                    "type": "string",
                    "description": "The order identifier the user provided.",
                }
            },
            "required": ["orderId"],
        },
        handler=_handler,
    )


def build_registry(
    tool_names: list[str],
    knowledge: Optional[KnowledgeProvider] = None,
    kb_id: str = "",
    order_service_function: str = "",
    region: str = "us-east-1",
) -> ToolRegistry:
    """Assemble a ToolRegistry from the agent's opted-in tool_names.

    Tools with unmet dependencies are skipped (e.g. search_knowledge without a
    resolvable KB id), so the model is never offered a tool it can't fulfil.
    """
    registry = ToolRegistry()
    wanted = {t.strip() for t in (tool_names or []) if t and t.strip()}

    if "get_current_time" in wanted:
        registry.register(_GET_CURRENT_TIME)

    if "search_knowledge" in wanted:
        if knowledge is not None and kb_id:
            registry.register(_make_search_knowledge(knowledge, kb_id))
        else:
            logger.info(
                "search_knowledge requested but no KB configured; skipping tool"
            )

    if "get_order_status" in wanted:
        if order_service_function:
            registry.register(
                _make_get_order_status(order_service_function, region)
            )
        else:
            logger.info(
                "get_order_status requested but ORDER_SERVICE_FUNCTION unset; "
                "skipping tool"
            )

    return registry

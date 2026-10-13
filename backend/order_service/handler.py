"""OrderService business Lambda (C9).

A standalone microservice that owns "order" logic. Invoked directly (not via API
Gateway) with a JSON payload:  {"orderId": "1234"}

Returns:
  {"found": true, "order": {orderId, status, estimatedDelivery, items, total}}
  or {"found": false}

The voice-proxy tool `get_order_status` calls this; the agent never touches
DynamoDB directly. Stdlib + boto3 (runtime-provided).

Security note (POC): looks up any orderId with no ownership check. In production
this should verify the order belongs to the authenticated user (pass userSub).
"""
from __future__ import annotations

import decimal
import os

import boto3

ORDERS_TABLE = os.environ["ORDERS_TABLE"]
_table = boto3.resource("dynamodb").Table(ORDERS_TABLE)


def _to_plain(value):
    """DynamoDB returns Decimals; make the payload JSON-friendly for Lambda."""
    if isinstance(value, decimal.Decimal):
        # int if whole, else float
        return int(value) if value % 1 == 0 else float(value)
    if isinstance(value, list):
        return [_to_plain(v) for v in value]
    if isinstance(value, dict):
        return {k: _to_plain(v) for k, v in value.items()}
    return value


def handler(event, context):
    order_id = ""
    if isinstance(event, dict):
        order_id = str(event.get("orderId", "")).strip()

    if not order_id:
        return {"found": False, "error": "missing orderId"}

    try:
        item = _table.get_item(Key={"orderId": order_id}).get("Item")
    except Exception as exc:  # pragma: no cover
        return {"found": False, "error": f"lookup failed: {exc}"}

    if not item:
        return {"found": False, "orderId": order_id}

    order = _to_plain(item)
    return {
        "found": True,
        "order": {
            "orderId": order.get("orderId"),
            "status": order.get("status"),
            "estimatedDelivery": order.get("estimatedDelivery"),
            "items": order.get("items", []),
            "total": order.get("total"),
        },
    }

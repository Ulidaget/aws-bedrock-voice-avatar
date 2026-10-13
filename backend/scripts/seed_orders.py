"""Seed the DynamoDB Orders table (C9 business tool demo).

Writes a few demo orders so the `get_order_status` tool has something to look
up in a demo.

Usage (from the backend/ directory, with AWS creds + the table name):

    $env:ORDERS_TABLE="<table-name>"         (PowerShell)
    python -m scripts.seed_orders

Or pass the table name explicitly:

    python scripts/seed_orders.py --table <table-name> --region us-east-1

The table name is printed by the CDK deploy as
`Phase0-dev-Business.OrdersTableName`.
"""
from __future__ import annotations

import argparse
import os

import boto3

ORDERS = [
    {
        "orderId": "1234",
        "status": "enviado",
        "estimatedDelivery": "2026-09-26",
        "items": ["Audífonos inalámbricos", "Cable USB-C"],
        "total": "1299.00",
    },
    {
        "orderId": "5678",
        "status": "en preparación",
        "estimatedDelivery": "2026-09-29",
        "items": ["Teclado mecánico"],
        "total": "899.00",
    },
    {
        "orderId": "9999",
        "status": "entregado",
        "estimatedDelivery": "2026-09-20",
        "items": ["Mouse ergonómico", "Mousepad", "Base para laptop"],
        "total": "1549.50",
    },
]


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed the Orders DynamoDB table.")
    parser.add_argument("--table", default=os.environ.get("ORDERS_TABLE", ""))
    parser.add_argument("--region", default=os.environ.get("AWS_REGION", "us-east-1"))
    args = parser.parse_args()

    if not args.table:
        raise SystemExit(
            "No table name. Set ORDERS_TABLE or pass --table <name> "
            "(see CDK output Phase0-dev-Business.OrdersTableName)."
        )

    table = boto3.resource("dynamodb", region_name=args.region).Table(args.table)

    for order in ORDERS:
        table.put_item(Item=order)
        print(f"seeded order: {order['orderId']} ({order['status']})")

    print(f"\nDone. Seeded {len(ORDERS)} orders into '{args.table}'.")


if __name__ == "__main__":
    main()

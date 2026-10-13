"""Seed the DynamoDB Agents table (C1 multi-agent config store).

Writes a `default` agent (mirroring the Phase 0 static agent) plus a couple of
example agents so there's something to switch between in a demo.

Usage (from the backend/ directory, with AWS creds + the table name):

    set AGENTS_TABLE=<table-name>            (Windows cmd)
    $env:AGENTS_TABLE="<table-name>"         (PowerShell)
    python -m scripts.seed_agents

Or pass the table name explicitly:

    python scripts/seed_agents.py --table <table-name> --region us-east-1

The table name is printed by the CDK deploy as `Phase0-dev-Data.AgentsTableName`.
"""
from __future__ import annotations

import argparse
import os
from datetime import datetime, timezone

import boto3

# Language directive prepended so agents speak Spanish from the first turn.
_ES = "Responde SIEMPRE en español latino, con un tono natural y cercano. "

AGENTS = [
    {
        "agentId": "default",
        "name": "General Assistant",
        "description": "Asistente de voz general y amigable.",
        "systemPrompt": (
            _ES
            + "Eres un asistente de voz amable y servicial. Tú y el usuario "
            "mantienen una conversación hablada en tiempo real. Da respuestas "
            "cortas y naturales, normalmente de dos o tres frases. Si te "
            "interrumpen, detente y escucha."
        ),
        "modelId": "amazon.nova-2-sonic-v1:0",
        "voiceId": "lupe",
        "enabled": True,
    },
    {
        "agentId": "sales",
        "name": "Sales Assistant",
        "description": "Asistente de ventas entusiasta que ayuda a elegir producto.",
        "systemPrompt": (
            _ES
            + "Eres un asistente de ventas entusiasta y conciso. Ayuda al usuario "
            "a encontrar el producto adecuado, haz una sola pregunta aclaratoria "
            "a la vez, y mantén las respuestas cortas y conversacionales. Nunca "
            "seas insistente ni agresivo."
        ),
        "modelId": "amazon.nova-2-sonic-v1:0",
        "voiceId": "lupe",
        "enabled": True,
    },
    {
        "agentId": "support",
        "name": "Support Assistant",
        "description": "Asistente de soporte técnico calmado.",
        "systemPrompt": (
            _ES
            + "Eres un asistente de soporte técnico calmado y paciente. Guía al "
            "usuario paso a paso, confirma que entendió, y mantén las respuestas "
            "cortas y claras. Si no sabes algo, dilo y sugiere un siguiente paso."
        ),
        "modelId": "amazon.nova-2-sonic-v1:0",
        "voiceId": "lupe",
        "enabled": True,
    },
]


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed the Agents DynamoDB table.")
    parser.add_argument("--table", default=os.environ.get("AGENTS_TABLE", ""))
    parser.add_argument("--region", default=os.environ.get("AWS_REGION", "us-east-1"))
    args = parser.parse_args()

    if not args.table:
        raise SystemExit(
            "No table name. Set AGENTS_TABLE or pass --table <name> "
            "(see CDK output Phase0-dev-Data.AgentsTableName)."
        )

    table = boto3.resource("dynamodb", region_name=args.region).Table(args.table)
    now = datetime.now(timezone.utc).isoformat()

    for agent in AGENTS:
        item = {
            **agent,
            "knowledgeBaseIds": [],  # seams for C3
            "toolNames": [],         # seams for C4
            "createdAt": now,
            "updatedAt": now,
        }
        table.put_item(Item=item)
        print(f"seeded agent: {agent['agentId']} ({agent['name']})")

    print(f"\nDone. Seeded {len(AGENTS)} agents into '{args.table}'.")


if __name__ == "__main__":
    main()

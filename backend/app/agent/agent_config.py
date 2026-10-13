"""AgentConfig — the replaceable seam for the future multi-agent platform.

In Phase 0 there is exactly ONE static agent. Later this becomes a record
loaded per-agent from DynamoDB (name, prompt, model, voice, KB ids, tools,
permissions). Keeping it behind this dataclass means the voice/session code
never hard-codes agent details.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import List


@dataclass(frozen=True)
class AgentConfig:
    agent_id: str
    name: str
    description: str
    system_prompt: str
    model_id: str
    voice_id: str
    # Future seams — unused in Phase 0, present so callers can rely on the shape.
    knowledge_base_ids: List[str] = field(default_factory=list)
    tool_names: List[str] = field(default_factory=list)
    # C4: opt-in cross-session conversational memory. Off by default.
    remember_conversations: bool = False
    # C8: Cognito groups allowed to use this agent. Empty = everyone.
    allowed_groups: List[str] = field(default_factory=list)


# --- Phase 0 static agent -------------------------------------------------
DEFAULT_SYSTEM_PROMPT = (
    "You are a friendly, helpful voice assistant. You and the user are having a "
    "spoken, real-time conversation. Keep replies short and natural, usually two "
    "or three sentences. If interrupted, stop and listen."
)


def get_default_agent(model_id: str) -> AgentConfig:
    return AgentConfig(
        agent_id="phase0-default",
        name="Phase 0 Assistant",
        description="Single static voice agent used to validate the Phase 0 POC.",
        system_prompt=DEFAULT_SYSTEM_PROMPT,
        model_id=model_id,
        voice_id="matthew",
    )

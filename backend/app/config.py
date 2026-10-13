"""Environment-driven settings for the voice proxy backend."""
from __future__ import annotations

import os
from dataclasses import dataclass, field


def _bool(name: str, default: bool) -> bool:
    val = os.environ.get(name)
    if val is None:
        return default
    return val.strip().lower() in ("1", "true", "yes", "on")


@dataclass
class Settings:
    # Server
    host: str = field(default_factory=lambda: os.environ.get("HOST", "0.0.0.0"))
    port: int = field(default_factory=lambda: int(os.environ.get("PORT", "8080")))

    # AWS / Bedrock
    aws_region: str = field(default_factory=lambda: os.environ.get("AWS_REGION", "us-east-1"))
    bedrock_model_id: str = field(
        default_factory=lambda: os.environ.get("BEDROCK_MODEL_ID", "amazon.nova-2-sonic-v1:0")
    )

    # DynamoDB agents table (C1 multi-agent). Empty -> fall back to the static
    # Phase 0 default agent, preserving backward compatibility.
    agents_table: str = field(default_factory=lambda: os.environ.get("AGENTS_TABLE", ""))

    # C3: Bedrock Knowledge Base id for RAG. Empty -> no retrieval (agents behave
    # exactly as before). An agent opts into RAG via its knowledgeBaseIds; when a
    # value is "default"/"platform" we substitute this platform-wide KB id.
    knowledge_base_id: str = field(
        default_factory=lambda: os.environ.get("KNOWLEDGE_BASE_ID", "")
    )

    # C4: conversational memory. Empty CONVERSATIONS_TABLE -> memory disabled
    # (agents behave exactly as before). Agents opt in via rememberConversations.
    conversations_table: str = field(
        default_factory=lambda: os.environ.get("CONVERSATIONS_TABLE", "")
    )
    memory_max_turns: int = field(
        default_factory=lambda: int(os.environ.get("MEMORY_MAX_TURNS", "12"))
    )
    memory_ttl_days: int = field(
        default_factory=lambda: int(os.environ.get("MEMORY_TTL_DAYS", "30"))
    )

    # C9: business order-service Lambda for the get_order_status tool. Empty ->
    # the tool is not offered (backward compatible).
    order_service_function: str = field(
        default_factory=lambda: os.environ.get("ORDER_SERVICE_FUNCTION", "")
    )

    # Audio (Nova Sonic fixed formats)
    input_sample_rate: int = 16000
    output_sample_rate: int = 24000

    # Cognito JWT validation
    cognito_user_pool_id: str = field(
        default_factory=lambda: os.environ.get("COGNITO_USER_POOL_ID", "")
    )
    cognito_app_client_id: str = field(
        default_factory=lambda: os.environ.get("COGNITO_APP_CLIENT_ID", "")
    )

    # When True, skip JWT validation (LOCAL DEV ONLY). Never enable in AWS.
    auth_disabled: bool = field(default_factory=lambda: _bool("AUTH_DISABLED", False))

    # CORS / allowed origin for the SPA
    allowed_origin: str = field(
        default_factory=lambda: os.environ.get("ALLOWED_ORIGIN", "http://localhost:5173")
    )

    # Session limits
    max_session_seconds: int = field(
        default_factory=lambda: int(os.environ.get("MAX_SESSION_SECONDS", "450"))  # ~7.5 min (< 8 min cap)
    )

    @property
    def cognito_issuer(self) -> str:
        return f"https://cognito-idp.{self.aws_region}.amazonaws.com/{self.cognito_user_pool_id}"

    @property
    def cognito_jwks_url(self) -> str:
        return f"{self.cognito_issuer}/.well-known/jwks.json"


settings = Settings()

"""WebSocket voice-proxy server entrypoint (Fargate).

Flow per connection:
  1. Client connects to /session?token=<JWT> (or Authorization header).
  2. We validate the Cognito JWT BEFORE opening any Bedrock stream.
  3. On {"type":"start"} we open a Nova 2 Sonic session and relay audio/events.
  4. Binary frames = user PCM up; binary frames back = assistant PCM down.

Also exposes GET /health for ALB target-group health checks.
"""
from __future__ import annotations

import asyncio
import dataclasses
import json
import logging
import uuid
from urllib.parse import parse_qs, urlparse

import websockets
from websockets.asyncio.server import ServerConnection, serve

from .agent.agent_repository import AgentDisabled, AgentNotFound, AgentRepository
from .auth import AuthError, validate_token
from .config import settings
from .knowledge import BedrockKbProvider, KnowledgeProvider, NullKnowledgeProvider
from .memory import DynamoMemoryProvider, MemoryProvider, NullMemoryProvider
from .observability import configure_logging
from .session import Session

logger = logging.getLogger("server")

# C10-B: voices the end user may pick (Nova Sonic voice ids; language-specific).
# An override is validated against this set before it's applied.
KNOWN_VOICES = {
    "lupe", "carlos", "matthew", "tiffany", "amy", "ambre", "florian",
    "beatrice", "lorenzo", "greta", "lennart",
}

# Shared across connections; caches agent records in-memory (TTL).
agent_repository = AgentRepository(
    table_name=settings.agents_table,
    region=settings.aws_region,
    default_model_id=settings.bedrock_model_id,
)

# C3: shared RAG provider. Real Bedrock retrieval when a KB is configured;
# otherwise a no-op so nothing changes for non-RAG deployments.
knowledge_provider: KnowledgeProvider = (
    BedrockKbProvider(settings.aws_region)
    if settings.knowledge_base_id
    else NullKnowledgeProvider()
)

# C4: shared conversational-memory provider. Real DynamoDB store when a table is
# configured; otherwise a no-op so nothing changes for deployments without it.
memory_provider: MemoryProvider = (
    DynamoMemoryProvider(
        settings.conversations_table,
        settings.aws_region,
        ttl_days=settings.memory_ttl_days,
    )
    if settings.conversations_table
    else NullMemoryProvider()
)


def _extract_token(path: str, headers) -> str:
    # Prefer query string (?token=), fall back to Authorization header.
    query = parse_qs(urlparse(path).query)
    if "token" in query:
        return query["token"][0]
    auth = headers.get("Authorization") or headers.get("authorization") or ""
    if auth.lower().startswith("bearer "):
        return auth[7:]
    return ""


async def handle_connection(ws: ServerConnection) -> None:
    # websockets >= 14: the handler receives only the connection; the request
    # path and headers live on ws.request.
    path = ws.request.path if ws.request else "/"

    # Health check path (some setups route HTTP GETs here); ALB uses /health via HTTP.
    if path.startswith("/health"):
        await ws.close()
        return

    session_id = str(uuid.uuid4())
    headers = ws.request.headers if ws.request else {}
    token = _extract_token(path, headers)

    try:
        user = await validate_token(token)
    except AuthError as exc:
        logger.warning("auth rejected session=%s reason=%s", session_id, exc)
        await ws.close(code=4401, reason="unauthorized")
        return

    async def send_text(msg: str) -> None:
        await ws.send(msg)

    async def send_bytes(data: bytes) -> None:
        await ws.send(data)

    # The Session is created on `start`, once we know which agent to run.
    session: Session | None = None

    # Enforce max session length (Nova Sonic ~8-min stream cap).
    async def kill_after_timeout() -> None:
        await asyncio.sleep(settings.max_session_seconds)
        logger.info("session timeout session=%s", session_id)
        await send_text(json.dumps({"type": "state", "state": "IDLE"}))
        if session:
            await session.close()
        await ws.close(code=1000, reason="session time limit")

    timeout_task: asyncio.Task | None = None
    started = False

    try:
        async for message in ws:
            if isinstance(message, bytes):
                if session:
                    await session.handle_audio(message)
                continue
            # text/JSON control message
            try:
                msg = json.loads(message)
            except ValueError:
                continue
            mtype = msg.get("type")
            if mtype == "start" and not started:
                # C1: resolve the requested agent (by agentId) before opening the
                # session. Unknown/disabled agents are reported and the socket is
                # closed. Omitting agentId falls back to the "default" agent.
                agent_id = msg.get("agentId")
                try:
                    agent = await agent_repository.load(agent_id)
                except (AgentNotFound, AgentDisabled) as exc:
                    logger.warning("agent load rejected session=%s reason=%s", session_id, exc)
                    await send_text(json.dumps({"type": "error", "message": str(exc)}))
                    await ws.close(code=4404, reason="agent unavailable")
                    return
                except Exception as exc:
                    logger.exception("agent load failed session=%s", session_id)
                    await send_text(json.dumps({"type": "error", "message": "agent load failed"}))
                    await ws.close(code=1011, reason="agent load error")
                    return

                # C8: per-agent access control. If the agent restricts groups,
                # the user must belong to at least one of them.
                allowed = getattr(agent, "allowed_groups", []) or []
                if allowed and not (set(allowed) & set(user.groups)):
                    logger.warning(
                        "access denied session=%s user=%s agent=%s (groups=%s allowed=%s)",
                        session_id, user.sub, agent.agent_id, user.groups, allowed,
                    )
                    await send_text(
                        json.dumps(
                            {"type": "error", "message": "no access to this agent"}
                        )
                    )
                    await ws.close(code=4403, reason="forbidden")
                    return

                # C10-B: per-user voice/language override. If the client sends a
                # known voiceId, use it for this session only (not persisted).
                requested_voice = (msg.get("voiceId") or "").strip().lower()
                if requested_voice and requested_voice in KNOWN_VOICES:
                    agent = dataclasses.replace(agent, voice_id=requested_voice)
                    logger.info(
                        "session=%s voice override=%s", session_id, requested_voice
                    )

                started = True
                session = Session(
                    session_id,
                    user.sub,
                    send_text,
                    send_bytes,
                    agent=agent,
                    knowledge=knowledge_provider,
                    memory=memory_provider,
                )
                logger.info(
                    "session start session=%s user=%s agent=%s",
                    session_id, user.sub, agent.agent_id,
                )
                await session.start()
                timeout_task = asyncio.create_task(kill_after_timeout())
            elif mtype in ("interrupt", "stop"):
                if session:
                    await session.handle_control(msg)
                if mtype == "stop":
                    break
    except websockets.ConnectionClosed:
        logger.info("connection closed session=%s", session_id)
    finally:
        if timeout_task:
            timeout_task.cancel()
        if session:
            await session.close()


def _start_health_server() -> None:
    """Dedicated, standard HTTP health endpoint on PORT+1 (8081).

    We use a plain http.server here (not the websockets process_request hook)
    because the ALB sends ordinary HTTP GETs and a standard HTTP server gives an
    unambiguous, ALB-accepted 200 response. The websockets library's handling of
    non-upgrade requests proved unreliable behind the ALB (Target.Timeout).

    Runs in a daemon thread so it doesn't block the asyncio event loop.
    """
    from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
    import threading

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):  # noqa: N802
            body = b"ok\n"
            self.send_response(200)
            self.send_header("Content-Type", "text/plain")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *args):  # silence access logs
            pass

    health_port = settings.port + 1
    server = ThreadingHTTPServer((settings.host, health_port), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    logger.info("health server listening on %s:%s/health", settings.host, health_port)


async def main() -> None:
    configure_logging()
    _start_health_server()
    logger.info(
        "starting voice proxy host=%s port=%s region=%s model=%s auth_disabled=%s",
        settings.host, settings.port, settings.aws_region,
        settings.bedrock_model_id, settings.auth_disabled,
    )
    async with serve(
        handle_connection,
        settings.host,
        settings.port,
        max_size=None,
    ):
        await asyncio.Future()  # run forever


if __name__ == "__main__":
    asyncio.run(main())

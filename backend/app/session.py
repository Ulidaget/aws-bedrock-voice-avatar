"""Per-connection session: bridges the browser WebSocket and the VoiceProvider.

Browser -> backend protocol (WebSocket):
  - Binary frames:  raw PCM16 mono 16 kHz audio chunks (user speech).
  - Text frames (JSON):
      {"type": "start"}                 begin the voice session
      {"type": "text", "content": "..."}  (reserved for text mode; Phase 0 audio-first)
      {"type": "interrupt"}             user barge-in
      {"type": "stop"}                  end the session

Backend -> browser protocol (WebSocket):
  - Binary frames:  raw PCM16 mono 24 kHz audio chunks (assistant speech).
  - Text frames (JSON):
      {"type": "state", "state": "IDLE|LISTENING|PROCESSING|SPEAKING|INTERRUPTED|ERROR"}
      {"type": "transcript", "role": "USER|ASSISTANT", "text": "..."}
      {"type": "error", "message": "..."}
"""
from __future__ import annotations

import asyncio
import dataclasses
import json
import logging

from .agent.agent_config import AgentConfig, get_default_agent
from .config import settings
from .knowledge.base import KnowledgeProvider, NullKnowledgeProvider
from .memory.base import MemoryProvider, NullMemoryProvider, Turn
from .tools import build_registry
from .observability import SessionMetrics
from .voice.base import VoiceEvent, VoiceEventType
from .voice.nova_sonic import NovaSonicProvider

logger = logging.getLogger("session")

# Aliases an agent may use to refer to the single platform-wide KB. When an
# agent lists one of these as a knowledge base id, we substitute the concrete
# KB id from settings (KNOWLEDGE_BASE_ID).
_PLATFORM_KB_ALIASES = {"default", "platform", "shared"}


class VoiceState:
    IDLE = "IDLE"
    LISTENING = "LISTENING"
    PROCESSING = "PROCESSING"
    SPEAKING = "SPEAKING"
    INTERRUPTED = "INTERRUPTED"
    ERROR = "ERROR"


class Session:
    """Owns one VoiceProvider and pumps events to the connected client.

    `send_text` and `send_bytes` are injected so this class is transport-agnostic
    (works with websockets, FastAPI, tests).
    """

    def __init__(
        self,
        session_id: str,
        user_sub: str,
        send_text,
        send_bytes,
        agent: AgentConfig | None = None,
        knowledge: KnowledgeProvider | None = None,
        memory: MemoryProvider | None = None,
    ) -> None:
        self.session_id = session_id
        self.user_sub = user_sub
        self._send_text = send_text
        self._send_bytes = send_bytes
        # C1: the agent is resolved by the caller (from DynamoDB by agentId) and
        # injected. Falls back to the static default for backward compatibility.
        self._agent = agent or get_default_agent(settings.bedrock_model_id)
        # C3: RAG provider. Defaults to a no-op so non-RAG sessions are unchanged.
        self._knowledge = knowledge or NullKnowledgeProvider()
        # C4: conversational memory. Defaults to no-op (backward compatible).
        self._memory = memory or NullMemoryProvider()
        # Turns spoken during THIS session, flushed to memory on close.
        self._session_turns: list[Turn] = []
        # C5: per-session tool registry (built in start() from agent.tool_names).
        self._registry = None
        self._tool_tasks: set[asyncio.Task] = set()
        # The provider is created in start(), after the (possibly KB-augmented)
        # system prompt is resolved.
        self._provider: NovaSonicProvider | None = None
        self._metrics = SessionMetrics(session_id, user_sub, self._agent.agent_id)
        self._pump_task: asyncio.Task | None = None
        self._state = VoiceState.IDLE
        self._active = False

    def _resolve_kb_id(self) -> str:
        """Return the concrete KB id this agent should use, or "" if none."""
        for kb in self._agent.knowledge_base_ids:
            kb = (kb or "").strip()
            if not kb:
                continue
            if kb.lower() in _PLATFORM_KB_ALIASES:
                if settings.knowledge_base_id:
                    return settings.knowledge_base_id
                continue
            return kb
        return ""

    async def _augment_agent_with_kb(self) -> AgentConfig:
        """Retrieve-then-inject: ground the system prompt with KB context.

        Best-effort. On any failure or empty result the original agent is used
        unchanged, so retrieval never breaks a voice session.
        """
        kb_id = self._resolve_kb_id()
        if not kb_id:
            return self._agent

        # No user query yet at session start, so seed retrieval with the agent's
        # own identity/description. This surfaces the most relevant background
        # for this agent's domain. True per-turn RAG is a C4 (tool-use) follow-up.
        seed = f"{self._agent.name}. {self._agent.description}".strip()
        try:
            chunks = await self._knowledge.retrieve(kb_id, seed, max_results=4)
        except Exception:
            logger.exception("KB augmentation failed; continuing without RAG")
            return self._agent

        if not chunks:
            return self._agent

        context = "\n\n".join(f"- {c.text}" for c in chunks)
        grounded_prompt = (
            f"{self._agent.system_prompt}\n\n"
            "You have access to a knowledge base. Use the following reference "
            "information to answer questions accurately. If the answer is not in "
            "this material, say you don't have that information rather than "
            "guessing.\n\n"
            f"Reference information:\n{context}"
        )
        logger.info(
            "session=%s grounded with %d KB chunks (kb=%s)",
            self.session_id,
            len(chunks),
            kb_id,
        )
        return dataclasses.replace(self._agent, system_prompt=grounded_prompt)

    async def _augment_agent_with_memory(self, agent: AgentConfig) -> AgentConfig:
        """Retrieve-then-inject past conversation turns (cross-session memory).

        Best-effort. On any failure or when the agent hasn't opted in, the agent
        is returned unchanged so memory never breaks a voice session.
        """
        if not self._agent.remember_conversations:
            return agent
        try:
            turns = await self._memory.retrieve(
                self.user_sub, self._agent.agent_id, settings.memory_max_turns
            )
        except Exception:
            logger.exception("memory retrieve failed; continuing without memory")
            return agent
        if not turns:
            return agent

        history = "\n".join(
            f"{'User' if t.role == 'USER' else 'Assistant'}: {t.text}" for t in turns
        )
        prompt = (
            f"{agent.system_prompt}\n\n"
            "The following is a summary of your previous conversation(s) with "
            "this same user. Use it to maintain continuity and remember context, "
            "but do not read it back verbatim.\n\n"
            f"Previous conversation:\n{history}"
        )
        logger.info(
            "session=%s grounded with %d memory turns (agent=%s)",
            self.session_id,
            len(turns),
            self._agent.agent_id,
        )
        return dataclasses.replace(agent, system_prompt=prompt)

    async def start(self) -> None:
        agent = await self._augment_agent_with_kb()
        agent = await self._augment_agent_with_memory(agent)
        # C5: build the per-session tool registry from the agent's opted-in
        # tools, wiring search_knowledge to this session's KB.
        self._registry = build_registry(
            self._agent.tool_names,
            knowledge=self._knowledge,
            kb_id=self._resolve_kb_id(),
            order_service_function=settings.order_service_function,
            region=settings.aws_region,
        )
        tool_specs = self._registry.specs()
        self._provider = NovaSonicProvider(
            agent, settings.aws_region, tools=tool_specs
        )
        if tool_specs:
            logger.info(
                "session=%s tools enabled: %s",
                self.session_id,
                [t.name for t in tool_specs],
            )
        await self._provider.start()
        self._active = True
        await self._set_state(VoiceState.LISTENING)
        self._pump_task = asyncio.create_task(self._pump_events())
        logger.info("session started session=%s user=%s", self.session_id, self.user_sub)

    async def handle_audio(self, pcm_bytes: bytes) -> None:
        if not self._active:
            return
        # The mic streams audio continuously (including silence), so we must NOT
        # infer barge-in from the mere arrival of bytes — that would cut the
        # assistant off constantly. Nova Sonic does its own endpointing and
        # emits an interruption event when the user actually speaks over it;
        # that event drives the INTERRUPTED state + client audio flush.
        # We just forward the audio and reflect first-user-turn as LISTENING.
        if self._state in (VoiceState.IDLE, VoiceState.PROCESSING):
            await self._set_state(VoiceState.LISTENING)
            self._metrics.turn_started()
        await self._provider.send_audio(pcm_bytes)

    async def handle_control(self, msg: dict) -> None:
        mtype = msg.get("type")
        if mtype == "interrupt":
            if self._provider is not None:
                await self._provider.interrupt()
        elif mtype == "stop":
            await self.close()

    async def close(self) -> None:
        if not self._active:
            return
        self._active = False
        try:
            if self._provider is not None:
                await self._provider.close()
        finally:
            if self._pump_task:
                self._pump_task.cancel()
            # C5: cancel any in-flight tool tasks.
            for task in list(self._tool_tasks):
                task.cancel()
            # C4: persist this session's turns for cross-session memory.
            await self._flush_memory()
            self._metrics.closed()
            logger.info("session closed session=%s", self.session_id)

    async def _handle_tool_use(self, ev: VoiceEvent) -> None:
        """C5: execute a requested tool and ALWAYS reply with a tool result.

        Nova Sonic enters a stuck/waiting state if a toolUse is not answered, so
        every path here ends in send_tool_result — success or error.
        """
        name = ev.tool_name or ""
        tool_use_id = ev.tool_use_id or ""
        if self._provider is None or not tool_use_id:
            return
        logger.info("session=%s tool_use name=%s", self.session_id, name)
        self._metrics.tool_invoked(name)
        try:
            if self._registry is None:
                raise KeyError(name)
            result = await self._registry.execute(name, ev.tool_input or {})
            await self._provider.send_tool_result(tool_use_id, result)
        except KeyError:
            logger.warning("session=%s unknown tool %s", self.session_id, name)
            await self._provider.send_tool_result(
                tool_use_id, {"error": f"unknown tool: {name}"}, is_error=True
            )
        except Exception as exc:
            logger.exception("session=%s tool %s failed", self.session_id, name)
            await self._provider.send_tool_result(
                tool_use_id, {"error": str(exc)}, is_error=True
            )

    async def _flush_memory(self) -> None:
        if not (self._agent.remember_conversations and self._session_turns):
            return
        try:
            await self._memory.append(
                self.user_sub,
                self._agent.agent_id,
                self.session_id,
                self._session_turns,
            )
            logger.info(
                "session=%s flushed %d turns to memory",
                self.session_id,
                len(self._session_turns),
            )
        except Exception:
            logger.exception("memory flush failed session=%s", self.session_id)

    # -- internals ---------------------------------------------------------
    async def _pump_events(self) -> None:
        try:
            async for ev in self._provider.events():
                await self._route_event(ev)
        except asyncio.CancelledError:  # pragma: no cover
            pass
        except Exception as exc:
            logger.exception("event pump error")
            self._metrics.error("pump")
            await self._emit_error(str(exc))

    async def _route_event(self, ev: VoiceEvent) -> None:
        if ev.type == VoiceEventType.USER_SPEAKING:
            await self._set_state(VoiceState.LISTENING)
        elif ev.type == VoiceEventType.SPEECH_STARTED:
            await self._set_state(VoiceState.SPEAKING)
        elif ev.type == VoiceEventType.AUDIO_OUTPUT and ev.audio:
            self._metrics.first_audio()
            await self._send_bytes(ev.audio)
        elif ev.type == VoiceEventType.TEXT_OUTPUT and ev.text:
            await self._send_text(
                json.dumps({"type": "transcript", "role": ev.role, "text": ev.text})
            )
            # C4: accumulate turns for cross-session memory (flushed on close).
            if self._agent.remember_conversations and ev.role in ("USER", "ASSISTANT"):
                self._session_turns.append(Turn(role=ev.role, text=ev.text))
        elif ev.type == VoiceEventType.SPEECH_STOPPED:
            self._metrics.turn_ended()
            await self._set_state(VoiceState.LISTENING)
        elif ev.type == VoiceEventType.INTERRUPTED:
            await self._set_state(VoiceState.INTERRUPTED)
            await self._set_state(VoiceState.LISTENING)
        elif ev.type == VoiceEventType.TOOL_USE:
            # C5: run the tool without blocking the event pump. Nova Sonic runs
            # tools asynchronously and keeps conversing; we must ALWAYS reply.
            task = asyncio.create_task(self._handle_tool_use(ev))
            self._tool_tasks.add(task)
            task.add_done_callback(self._tool_tasks.discard)
        elif ev.type == VoiceEventType.ERROR:
            self._metrics.error("provider")
            await self._emit_error(ev.message or "voice provider error")

    async def _set_state(self, state: str) -> None:
        self._state = state
        await self._send_text(json.dumps({"type": "state", "state": state}))

    async def _emit_error(self, message: str) -> None:
        self._state = VoiceState.ERROR
        await self._send_text(json.dumps({"type": "error", "message": message}))
        await self._send_text(json.dumps({"type": "state", "state": VoiceState.ERROR}))

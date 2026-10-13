"""Amazon Nova 2 Sonic implementation of VoiceProvider.

Uses the Bedrock bidirectional streaming API (InvokeModelWithBidirectionalStream)
via the experimental `aws_sdk_bedrock_runtime` client, following the AWS
Nova 2 Sonic getting-started example:
https://docs.aws.amazon.com/nova/latest/nova2-userguide/sonic-getting-started.html

Event protocol (JSON frames on the input stream, in order):
  sessionStart -> promptStart -> contentStart(TEXT/SYSTEM) -> textInput(system)
  -> contentEnd -> contentStart(AUDIO/USER) -> audioInput* -> contentEnd
  -> promptEnd -> sessionEnd

Audio: input 16 kHz / output 24 kHz, mono, PCM16 (LPCM), base64-encoded.
"""
from __future__ import annotations

import asyncio
import base64
import json
import logging
import uuid
from typing import AsyncIterator, Optional

from ..agent.agent_config import AgentConfig
from ..agent.tool_registry import ToolSpec
from .base import VoiceEvent, VoiceEventType, VoiceProvider

logger = logging.getLogger(__name__)

# Imported lazily so the module can be imported (e.g. for typing/tests) even
# when the experimental SDK is not installed in a given environment.
#
# aws-sdk-bedrock-runtime >= 0.11 uses an async client resolved from config:
#   AsyncBedrockRuntimeConfig.resolve(...) -> AsyncBedrockRuntimeClient
#   client.invoke_model_with_bidirectional_stream(input=...) -> DuplexEventStream
# Credentials are resolved from the environment / ~/.aws automatically.
try:
    from aws_sdk_bedrock_runtime.client import AsyncBedrockRuntimeClient
    from aws_sdk_bedrock_runtime.config import AsyncBedrockRuntimeConfig
    from aws_sdk_bedrock_runtime.models import (
        BidirectionalInputPayloadPart,
        InvokeModelWithBidirectionalStreamInputChunk,
        InvokeModelWithBidirectionalStreamOperationInput,
    )

    # Bidirectional (duplex) streaming requires the CRT transport; the default
    # aiohttp transport does not support duplex event streams.
    from smithy_http.aio.crt import AWSCRTHTTPClient

    _SDK_AVAILABLE = True
except Exception as exc:  # pragma: no cover - depends on environment
    _SDK_AVAILABLE = False
    _IMPORT_ERROR = exc


class NovaSonicProvider(VoiceProvider):
    def __init__(
        self, agent: AgentConfig, region: str, tools: Optional[list[ToolSpec]] = None
    ) -> None:
        self._agent = agent
        self._region = region
        self._tools = tools or []
        self._client = None
        self._stream = None
        self._is_active = False

        self._prompt_name = str(uuid.uuid4())
        self._system_content_name = str(uuid.uuid4())
        self._audio_content_name = str(uuid.uuid4())

        self._event_queue: asyncio.Queue[VoiceEvent] = asyncio.Queue()
        self._reader_task: Optional[asyncio.Task] = None
        self._current_role: Optional[str] = None
        self._current_stage: str = "FINAL"

    # -- lifecycle ---------------------------------------------------------
    async def start(self) -> None:
        if not _SDK_AVAILABLE:
            raise RuntimeError(
                "aws_sdk_bedrock_runtime is not installed. "
                f"Original import error: {_IMPORT_ERROR}"
            )
        await self._init_client()
        self._stream = await self._client.invoke_model_with_bidirectional_stream(
            input=InvokeModelWithBidirectionalStreamOperationInput(
                model_id=self._agent.model_id
            )
        )
        self._is_active = True

        await self._send(self._session_start_event())
        await self._send(self._prompt_start_event())
        await self._send(self._content_start_text_event())
        await self._send(self._text_input_event(self._agent.system_prompt))
        await self._send(self._content_end_event(self._system_content_name))
        await self._send(self._audio_content_start_event())

        self._reader_task = asyncio.create_task(self._read_loop())
        logger.info("Nova Sonic session started (prompt=%s)", self._prompt_name)

    async def send_audio(self, pcm_bytes: bytes) -> None:
        if not self._is_active:
            return
        blob = base64.b64encode(pcm_bytes).decode("utf-8")
        await self._send(
            json.dumps(
                {
                    "event": {
                        "audioInput": {
                            "promptName": self._prompt_name,
                            "contentName": self._audio_content_name,
                            "content": blob,
                        }
                    }
                }
            )
        )

    def events(self) -> AsyncIterator[VoiceEvent]:
        return self._event_iterator()

    async def _event_iterator(self) -> AsyncIterator[VoiceEvent]:
        while self._is_active or not self._event_queue.empty():
            try:
                event = await asyncio.wait_for(self._event_queue.get(), timeout=0.5)
            except asyncio.TimeoutError:
                continue
            yield event

    async def interrupt(self) -> None:
        # Nova Sonic handles barge-in natively when new user audio arrives while
        # it is speaking; we just surface the state to the client.
        await self._event_queue.put(VoiceEvent(type=VoiceEventType.INTERRUPTED))

    async def send_tool_result(
        self, tool_use_id: str, result: dict, is_error: bool = False
    ) -> None:
        # C5: reply to a toolUse with the three-event TOOL sequence:
        # contentStart(type=TOOL) -> toolResult -> contentEnd. A fresh
        # contentName ties the three together.
        if not self._is_active or not tool_use_id:
            return
        content_name = str(uuid.uuid4())
        payload = json.dumps(result if isinstance(result, dict) else {"result": result})
        await self._send(
            json.dumps(
                {
                    "event": {
                        "contentStart": {
                            "promptName": self._prompt_name,
                            "contentName": content_name,
                            "interactive": False,
                            "type": "TOOL",
                            "role": "TOOL",
                            "toolResultInputConfiguration": {
                                "toolUseId": tool_use_id,
                                "type": "TEXT",
                                "textInputConfiguration": {"mediaType": "text/plain"},
                            },
                        }
                    }
                }
            )
        )
        await self._send(
            json.dumps(
                {
                    "event": {
                        "toolResult": {
                            "promptName": self._prompt_name,
                            "contentName": content_name,
                            "content": payload,
                        }
                    }
                }
            )
        )
        await self._send(self._content_end_event(content_name))

    async def close(self) -> None:
        if not self._is_active:
            return
        self._is_active = False
        # Stop the reader FIRST and await its cancellation, so there is no
        # pending awscrt read future when we close the stream. Otherwise awscrt
        # logs a benign but noisy "InvalidStateError: CANCELLED" traceback.
        if self._reader_task is not None:
            self._reader_task.cancel()
            try:
                await self._reader_task
            except (asyncio.CancelledError, Exception):
                pass
        try:
            await self._send(self._content_end_event(self._audio_content_name))
            await self._send(self._prompt_end_event())
            await self._send(json.dumps({"event": {"sessionEnd": {}}}))
            if self._stream is not None:
                await self._stream.input_stream.close()
        except Exception as exc:  # pragma: no cover
            logger.debug("Error closing Nova Sonic stream (expected on teardown): %s", exc)

    # -- internals ---------------------------------------------------------
    async def _init_client(self) -> None:
        # Credentials + region are resolved from the environment / ~/.aws.
        # The CRT transport is required for bidirectional (duplex) streaming.
        config = await AsyncBedrockRuntimeConfig.resolve(
            region=self._region,
            transport=AWSCRTHTTPClient(),
        )
        self._client = AsyncBedrockRuntimeClient(config=config)

    async def _send(self, event_json: str) -> None:
        chunk = InvokeModelWithBidirectionalStreamInputChunk(
            value=BidirectionalInputPayloadPart(bytes_=event_json.encode("utf-8"))
        )
        await self._stream.input_stream.send(chunk)

    async def _read_loop(self) -> None:
        try:
            # await_output returns (initial_response, output_stream); then we
            # async-iterate the output stream for model events.
            _, output_stream = await self._stream.await_output()
            async for event in output_stream:
                if not self._is_active:
                    break
                payload = getattr(event, "value", None)
                raw = getattr(payload, "bytes_", None) if payload is not None else None
                if not raw:
                    continue
                data = json.loads(raw.decode("utf-8"))
                await self._handle_model_event(data.get("event", {}))
        except asyncio.CancelledError:  # pragma: no cover
            pass
        except Exception as exc:
            logger.exception("Nova Sonic read loop error")
            await self._event_queue.put(
                VoiceEvent(type=VoiceEventType.ERROR, message=str(exc))
            )

    async def _handle_model_event(self, event: dict) -> None:
        if "contentStart" in event:
            cs = event["contentStart"]
            self._current_role = cs.get("role")
            content_type = cs.get("type")
            # Nova Sonic emits ASSISTANT content twice: a SPECULATIVE (early
            # guess) stage and a FINAL stage. Track the stage so we surface the
            # transcript / audio only once (we keep FINAL). Default to FINAL when
            # the field is absent (e.g. USER transcripts).
            self._current_stage = "FINAL"
            extra = cs.get("additionalModelFields")
            if extra:
                try:
                    stage = json.loads(extra).get("generationStage")
                    if stage:
                        self._current_stage = stage
                except (ValueError, TypeError):
                    pass
            _ = content_type  # (reserved; stage tracked above)
            if self._current_role == "ASSISTANT":
                await self._event_queue.put(VoiceEvent(type=VoiceEventType.SPEECH_STARTED))
            elif self._current_role == "USER":
                await self._event_queue.put(VoiceEvent(type=VoiceEventType.USER_SPEAKING))

        elif "textOutput" in event:
            text = event["textOutput"].get("content", "")
            # Nova Sonic emits a special interruption marker in assistant text.
            if '"interrupted"' in text.lower() or text.strip() == "{ }":
                await self._event_queue.put(VoiceEvent(type=VoiceEventType.INTERRUPTED))
                return
            # De-duplicate assistant transcript: skip the SPECULATIVE copy and
            # keep only the FINAL one. USER transcripts always pass through.
            if self._current_role == "ASSISTANT" and self._current_stage == "SPECULATIVE":
                return
            await self._event_queue.put(
                VoiceEvent(
                    type=VoiceEventType.TEXT_OUTPUT,
                    text=text,
                    role=self._current_role,
                )
            )

        elif "audioOutput" in event:
            # Like text, Nova Sonic can emit audio for a SPECULATIVE stage and a
            # FINAL stage. Playing both produces two overlapping voices. Only
            # play the FINAL audio so the user hears a single, clean voice.
            if self._current_stage == "SPECULATIVE":
                return
            audio = base64.b64decode(event["audioOutput"]["content"])
            await self._event_queue.put(
                VoiceEvent(type=VoiceEventType.AUDIO_OUTPUT, audio=audio)
            )

        elif "toolUse" in event:
            # C5: the model wants to call a tool. Parse the args (a JSON string)
            # and surface a TOOL_USE event; the session executes it and replies
            # via send_tool_result.
            tu = event["toolUse"]
            raw_args = tu.get("content", "{}")
            try:
                args = json.loads(raw_args) if isinstance(raw_args, str) else (raw_args or {})
            except (ValueError, TypeError):
                args = {}
            await self._event_queue.put(
                VoiceEvent(
                    type=VoiceEventType.TOOL_USE,
                    tool_use_id=tu.get("toolUseId"),
                    tool_name=tu.get("toolName"),
                    tool_input=args,
                )
            )

        elif "contentEnd" in event:
            ce = event["contentEnd"]
            # Robust barge-in detection: Nova Sonic ends an assistant audio
            # block with stopReason == INTERRUPTED when the user talks over it.
            stop_reason = (ce.get("stopReason") or "").upper()
            if stop_reason == "INTERRUPTED":
                await self._event_queue.put(VoiceEvent(type=VoiceEventType.INTERRUPTED))
                return
            if ce.get("type") == "AUDIO" or self._current_role == "ASSISTANT":
                await self._event_queue.put(VoiceEvent(type=VoiceEventType.SPEECH_STOPPED))

    # -- event builders ----------------------------------------------------
    def _session_start_event(self) -> str:
        return json.dumps(
            {
                "event": {
                    "sessionStart": {
                        "inferenceConfiguration": {
                            "maxTokens": 1024,
                            "topP": 0.9,
                            "temperature": 0.7,
                        },
                        "turnDetectionConfiguration": {"endpointingSensitivity": "HIGH"},
                    }
                }
            }
        )

    def _prompt_start_event(self) -> str:
        prompt_start: dict = {
            "promptName": self._prompt_name,
            "textOutputConfiguration": {"mediaType": "text/plain"},
            "audioOutputConfiguration": {
                "mediaType": "audio/lpcm",
                "sampleRateHertz": 24000,
                "sampleSizeBits": 16,
                "channelCount": 1,
                "voiceId": self._agent.voice_id,
                "encoding": "base64",
                "audioType": "SPEECH",
            },
        }
        # C5: advertise tools only when the agent has any (backward compatible).
        if self._tools:
            prompt_start["toolUseOutputConfiguration"] = {
                "mediaType": "application/json"
            }
            prompt_start["toolConfiguration"] = {
                "tools": [
                    {
                        "toolSpec": {
                            "name": t.name,
                            "description": t.description,
                            # inputSchema.json must be a STRINGIFIED JSON schema.
                            "inputSchema": {"json": json.dumps(t.input_schema)},
                        }
                    }
                    for t in self._tools
                ],
                "toolChoice": {"auto": {}},
            }
        return json.dumps({"event": {"promptStart": prompt_start}})

    def _content_start_text_event(self) -> str:
        return json.dumps(
            {
                "event": {
                    "contentStart": {
                        "promptName": self._prompt_name,
                        "contentName": self._system_content_name,
                        "type": "TEXT",
                        "interactive": True,
                        "role": "SYSTEM",
                        "textInputConfiguration": {"mediaType": "text/plain"},
                    }
                }
            }
        )

    def _text_input_event(self, text: str) -> str:
        return json.dumps(
            {
                "event": {
                    "textInput": {
                        "promptName": self._prompt_name,
                        "contentName": self._system_content_name,
                        "content": text,
                    }
                }
            }
        )

    def _content_end_event(self, content_name: str) -> str:
        return json.dumps(
            {
                "event": {
                    "contentEnd": {
                        "promptName": self._prompt_name,
                        "contentName": content_name,
                    }
                }
            }
        )

    def _audio_content_start_event(self) -> str:
        return json.dumps(
            {
                "event": {
                    "contentStart": {
                        "promptName": self._prompt_name,
                        "contentName": self._audio_content_name,
                        "type": "AUDIO",
                        "interactive": True,
                        "role": "USER",
                        "audioInputConfiguration": {
                            "mediaType": "audio/lpcm",
                            "sampleRateHertz": 16000,
                            "sampleSizeBits": 16,
                            "channelCount": 1,
                            "audioType": "SPEECH",
                            "encoding": "base64",
                        },
                    }
                }
            }
        )

    def _prompt_end_event(self) -> str:
        return json.dumps({"event": {"promptEnd": {"promptName": self._prompt_name}}})

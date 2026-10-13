"""VoiceProvider — the replaceable seam for the voice engine.

Phase 0 implements this with Amazon Nova 2 Sonic (speech-to-speech). A future
STT+LLM+TTS pipeline or another vendor can implement the same interface without
touching the WebSocket server, the session logic, or the frontend.

Contract:
  - start(): open the underlying stream / session.
  - send_audio(pcm_bytes): push a chunk of 16 kHz mono PCM16 user audio.
  - events(): async-iterate provider-normalized VoiceEvent objects
              (audio out, transcript, state hints, errors).
  - interrupt(): signal a barge-in (stop current model speech).
  - close(): tear down.
"""
from __future__ import annotations

import abc
from dataclasses import dataclass
from enum import Enum
from typing import AsyncIterator, Optional


class VoiceEventType(str, Enum):
    AUDIO_OUTPUT = "audio_output"       # bytes of PCM16 model speech
    TEXT_OUTPUT = "text_output"         # transcript text (user or assistant)
    SPEECH_STARTED = "speech_started"   # model began speaking -> SPEAKING
    SPEECH_STOPPED = "speech_stopped"   # model finished a turn
    USER_SPEAKING = "user_speaking"     # endpointing detected user speech -> LISTENING
    INTERRUPTED = "interrupted"         # barge-in acknowledged
    TOOL_USE = "tool_use"               # C5: model requested a tool/function call
    ERROR = "error"


@dataclass
class VoiceEvent:
    type: VoiceEventType
    audio: Optional[bytes] = None
    text: Optional[str] = None
    role: Optional[str] = None          # "USER" | "ASSISTANT"
    message: Optional[str] = None       # for errors
    # C5 tool use
    tool_use_id: Optional[str] = None   # unique id to correlate the tool result
    tool_name: Optional[str] = None     # which tool the model wants to call
    tool_input: Optional[dict] = None   # parsed arguments (from the JSON string)


class VoiceProvider(abc.ABC):
    @abc.abstractmethod
    async def start(self) -> None: ...

    @abc.abstractmethod
    async def send_audio(self, pcm_bytes: bytes) -> None: ...

    @abc.abstractmethod
    def events(self) -> AsyncIterator[VoiceEvent]: ...

    @abc.abstractmethod
    async def interrupt(self) -> None: ...

    @abc.abstractmethod
    async def close(self) -> None: ...

    async def send_tool_result(
        self, tool_use_id: str, result: dict, is_error: bool = False
    ) -> None:
        """C5: return a tool's result to the model.

        Default no-op so providers that don't support tools stay valid. Nova
        Sonic overrides this. `is_error` lets callers signal a failed execution
        while still satisfying the "always answer a toolUse" requirement.
        """
        return None

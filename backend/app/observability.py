"""Structured logging + latency metrics.

Logs carry metadata ONLY (timings, event types, error codes, session id,
user sub). Never raw audio or transcripts. Metrics are emitted as EMF-style
JSON lines so CloudWatch can pick them up from stdout without extra agents.
"""
from __future__ import annotations

import json
import logging
import sys
import time
from typing import Optional


def configure_logging(level: str = "INFO") -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s"))
    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(getattr(logging, level.upper(), logging.INFO))


_logger = logging.getLogger("metrics")

_NAMESPACE = "Phase0VoicePOC"


def emit_metric(name: str, value: float, unit: str = "Milliseconds", **dimensions: str) -> None:
    """Emit a CloudWatch EMF metric line to stdout."""
    payload = {
        "_aws": {
            "Timestamp": int(time.time() * 1000),
            "CloudWatchMetrics": [
                {
                    "Namespace": _NAMESPACE,
                    "Dimensions": [list(dimensions.keys())] if dimensions else [[]],
                    "Metrics": [{"Name": name, "Unit": unit}],
                }
            ],
        },
        name: value,
        **dimensions,
    }
    _logger.info(json.dumps(payload))


class SessionMetrics:
    """Tracks per-session latency and counters.

    C7: an optional `agent_id` is stamped as a dimension on every metric so
    latency/usage can be sliced per agent. Note: CloudWatch treats each unique
    set of dimensions as a distinct metric stream, so we pick ONE dimension set
    per metric (agentId) to keep the dashboard queries simple; the session id is
    still logged for correlation.
    """

    def __init__(self, session_id: str, user_sub: str, agent_id: str = "") -> None:
        self.session_id = session_id
        self.user_sub = user_sub
        self.agent_id = agent_id or "unknown"
        self._session_start = time.monotonic()
        self._turn_start: Optional[float] = None
        self._first_audio_emitted = False
        self.turns = 0
        self.interruptions = 0

    def _emit(self, name: str, value: float, unit: str = "Milliseconds") -> None:
        emit_metric(name, value, unit=unit, agentId=self.agent_id)

    def turn_started(self) -> None:
        self._turn_start = time.monotonic()
        self._first_audio_emitted = False
        self.turns += 1

    def first_audio(self) -> None:
        if self._first_audio_emitted or self._turn_start is None:
            return
        self._first_audio_emitted = True
        ms = (time.monotonic() - self._turn_start) * 1000
        self._emit("TimeToFirstAudio", ms)

    def turn_ended(self) -> None:
        if self._turn_start is None:
            return
        ms = (time.monotonic() - self._turn_start) * 1000
        self._emit("EndToEndTurnLatency", ms)
        self._turn_start = None

    def interruption(self) -> None:
        self.interruptions += 1
        self._emit("Interruptions", 1, unit="Count")

    def tool_invoked(self, tool_name: str) -> None:
        """C7: record a tool call with tool + agent dimensions."""
        emit_metric(
            "ToolInvocations", 1, unit="Count", tool=tool_name, agentId=self.agent_id
        )

    def error(self, code: str) -> None:
        self._emit("ConnectionErrors", 1, unit="Count")
        logging.getLogger("session").warning(
            "session_error session=%s code=%s", self.session_id, code
        )

    def closed(self) -> None:
        dur = (time.monotonic() - self._session_start) * 1000
        self._emit("SessionDuration", dur)
        self._emit("TurnsPerSession", self.turns, unit="Count")

"""BedrockKbProvider — retrieves chunks from an Amazon Bedrock Knowledge Base.

Uses `bedrock-agent-runtime.retrieve`, which runs the query embedding + vector
search against the KB's store (S3 Vectors, in this project) and returns the
matching source chunks.

boto3 is synchronous; the call runs in a thread executor so the asyncio event
loop is never blocked. Credentials come from the task role (no keys in code).
The client is created lazily so the module imports without boto3 present.
"""
from __future__ import annotations

import asyncio
import logging
from typing import List

from .base import KnowledgeProvider, RetrievedChunk

logger = logging.getLogger("bedrock_kb")


class BedrockKbProvider(KnowledgeProvider):
    def __init__(self, region: str) -> None:
        self._region = region
        self._client = None  # lazily created boto3 bedrock-agent-runtime client

    def _get_client(self):
        if self._client is None:
            import boto3  # imported lazily so the module loads without boto3

            self._client = boto3.client(
                "bedrock-agent-runtime", region_name=self._region
            )
        return self._client

    async def retrieve(
        self, knowledge_base_id: str, query: str, max_results: int = 4
    ) -> List[RetrievedChunk]:
        if not knowledge_base_id or not query.strip():
            return []

        loop = asyncio.get_running_loop()

        def _call() -> List[RetrievedChunk]:
            try:
                resp = self._get_client().retrieve(
                    knowledgeBaseId=knowledge_base_id,
                    retrievalQuery={"text": query},
                    retrievalConfiguration={
                        "vectorSearchConfiguration": {"numberOfResults": max_results}
                    },
                )
            except Exception:
                # RAG is best-effort: never break a voice session because
                # retrieval failed (KB not ready, throttling, permissions, ...).
                logger.exception("KB retrieve failed for kb=%s", knowledge_base_id)
                return []

            chunks: List[RetrievedChunk] = []
            for result in resp.get("retrievalResults", []):
                text = (result.get("content", {}) or {}).get("text", "")
                if not text:
                    continue
                location = result.get("location", {}) or {}
                source = ""
                s3loc = location.get("s3Location") or {}
                if s3loc.get("uri"):
                    source = s3loc["uri"]
                chunks.append(
                    RetrievedChunk(
                        text=text,
                        source=source,
                        score=float(result.get("score", 0.0) or 0.0),
                    )
                )
            return chunks

        return await loop.run_in_executor(None, _call)

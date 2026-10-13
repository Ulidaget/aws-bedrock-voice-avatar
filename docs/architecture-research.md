# Phase 0 — Architecture Research

> Status: Research proposal. No application code is written in this phase.
> Goal validated by Phase 0: *A user opens a web app, sees an avatar, speaks naturally, the agent understands and replies with low perceived latency, speaks back naturally, and the avatar reacts while speaking.*

All external facts in this document were checked against current (2026) AWS documentation, AWS blogs, AWS solution samples, and vendor pages. Sources are linked inline. Content was rephrased for compliance with licensing restrictions.

---

## 1. Voice / conversational AI research

There are two fundamentally different ways to build the voice loop.

### Option 1 — Unified speech-to-speech model: Amazon Nova Sonic / Nova 2 Sonic

Amazon Nova Sonic is a speech-to-speech foundation model on Amazon Bedrock. It takes streaming audio in and produces streaming audio out over a single persistent connection, unifying speech understanding and speech generation in one model instead of chaining separate STT, LLM, and TTS services ([AWS Nova Sonic docs](https://docs.aws.amazon.com/nova/latest/userguide/speech.html), [analysis](https://hidekazu-konishi.com/entry/realtime_voice_ai_agent_architecture_amazon_nova_sonic.html)).

Key technical facts:

- **API**: `InvokeModelWithBidirectionalStream`. It maintains an open channel for continuous audio in both directions rather than a request/response cycle. The stream stays open up to ~8 minutes and can carry multiple prompts/responses in one session ([API reference](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_InvokeModelWithBidirectionalStream.html), [bidirectional guide](https://docs.aws.amazon.com/nova/latest/userguide/speech-bidirection.html)).
- **Barge-in / interruption**: handled natively by the model. It supports natural turn-taking and graceful interruption ([telephony guide](https://aws.amazon.com/blogs/machine-learning/building-ai-powered-voice-applications-amazon-nova-sonic-telephony-integration-guide/)).
- **Prosody adaptation**: the generated speech adapts to the prosody/tone of the input speech ([Nova speech page](https://aws.amazon.com/ai/generative-ai/nova/speech/)).
- **Nova 2 Sonic** (announced December 2025) is the next generation. It adds polyglot voices, support for seven languages (including Portuguese and Hindi), asynchronous tool calling, cross-modal switching between voice and text, and a 1M-token context window ([AWS What's New](https://aws.amazon.com/about-aws/whats-new/2025/12/amazon-nova-2-sonic-real-time-conversational-ai/), [summary](https://rywalker.com/research/aws-nova-2-sonic)).
- **Tool use**: both generations support function/tool calling, which is exactly the seam we need for the future platform (Knowledge Bases, MCP, Lambda actions). Nova 2 Sonic makes tool calls asynchronous, so the model can keep talking while a tool runs.

Why this matters for Phase 0: the single-model design removes the STT→LLM→TTS "glue latency" and the need to build our own barge-in/turn-taking logic. Those are the two hardest parts of a natural voice UX, and Nova Sonic gives them to us for free.

### Option 2 — Separate STT → LLM → TTS pipeline

Compose the loop from discrete AWS services:

- **STT**: Amazon Transcribe streaming (WebSocket, partial transcripts).
- **LLM**: Amazon Bedrock (e.g., Claude, Nova Pro) via streaming `Converse`/`InvokeModelWithResponseStream`.
- **TTS**: Amazon Polly (neural/generative voices, streaming audio).

This is the classic architecture. It is well documented and every component is independently replaceable. But you own the orchestration: endpointing (deciding when the user stopped talking), barge-in (stopping Polly when the user speaks over it), and the compounding latency of three network hops. AWS itself frames the challenge of the separate-service approach as managing multiple systems each with its own latency and failure modes ([Stream Vision Agents + Nova 2 Sonic post](https://aws.amazon.com/blogs/machine-learning/real-time-voice-agents-with-stream-vision-agents-and-amazon-nova-2-sonic/)).

### Can the browser talk to the voice service directly?

Two supported patterns exist, both shown in official AWS samples:

1. **Direct SigV4-signed WebSocket from the browser to Bedrock.** The browser uses the AWS SDK v3 bidirectional streaming client with temporary credentials, eliminating a backend relay ([AWS drive-thru sample](https://github.com/aws-solutions-library-samples/sample-voice-ai-powered-drive-thru-with-amazon-nova-sonic)). Simplest topology, but it puts model invocation and temporary AWS credentials in the browser and makes it harder to insert server-side logic (tools, guardrails, logging, KB retrieval) later.
2. **Backend WebSocket proxy.** The browser connects to our backend over a WebSocket; the backend validates a Cognito JWT, then opens the bidirectional stream to Bedrock and relays audio frames ([AWS Nova Sonic CDK sample](https://github.com/aws-samples/sample-sonic-cdk-agent)). Slightly more latency and infrastructure, but the browser never holds AWS credentials, and the backend becomes the natural home for tools, Knowledge Bases, observability, and multi-agent routing.

**For a platform that must grow into agents + KB + tools + observability, the backend-proxy pattern is the right long-term seam.** The direct pattern is attractive only for a throwaway demo.

---

## 2. Avatar technology research

The prompt asks us to distinguish **real-time interactive avatars** from **pre-rendered AI video avatars**, and to prioritize real-time.

### Category A — Managed real-time video-avatar APIs (photoreal)

You stream audio (or text) to a provider and receive a talking, listening photoreal human video stream over WebRTC.

- **HeyGen LiveAvatar** — photoreal, streaming; note LiveAvatar is a separate product/credits from HeyGen's video API ([cost breakdown](https://gofranz.com/blog/real-time-ai-avatars-what-they-actually-cost/)).
- **D-ID** — API-first, interactive "agents," lower entry pricing ([D-ID vs HeyGen](https://www.ngram.com/blog/d-id-vs-heygen)).
- **Simli** — very low latency, reported under ~300 ms ([comparison](https://meetcody.ai/blog/real-time-ai-avatar-models-compared/)).

Trade-offs: highest realism, fastest to a "wow" demo, but per-minute cost ($0.10–$0.37/min for managed APIs per [Forasoft](https://www.forasoft.com/blog/article/interactive-ai-avatar-development)), external vendor dependency, audio/video leaving AWS (privacy), and a second real-time transport (their WebRTC) layered on top of the voice transport.

### Category B — Open browser WebGL / Three.js 3D avatars (stylized)

Render a 3D character in the browser and drive its mouth from the audio.

- **met4citizen/TalkingHead** — a JavaScript class for real-time lip-sync on full-body GLB 3D avatars, all in-browser, demonstrated with real-time speech-to-speech over WebRTC ([GitHub](https://github.com/met4citizen/talkinghead), [README](https://github.com/met4citizen/talkinghead/blob/main/README.md)).
- **Ready Player Me + Three.js + Oculus/ARKit viseme blendshapes** — a common stack: a free customizable GLB avatar, animated via viseme blendshapes timed to the audio ([example](https://devpost.com/software/eduverse-gx02e3)).
- **MascotBot lipsync SDK** — client-side viseme inference to lip-sync an animated avatar to a realtime voice stream ([template](https://github.com/mascotbot-templates/openai-realtime-api-avatar)).

Trade-offs: no per-minute avatar fee, runs entirely client-side (audio stays in our stack), fully replaceable, but stylized rather than photoreal and we own the animation states.

### Category C — Pre-rendered AI video

Generate a video file from a script. Not real-time. **Explicitly out of scope** for the interactive experience Phase 0 wants; noted only for completeness.

### How lip-sync gets driven

- **Viseme/blendshape driven** — map phonemes/visemes to mouth blendshapes on a 3D model. Works with any audio source if we can derive visemes (from text, from Polly's viseme stream, or from client-side audio analysis).
- **Audio-amplitude driven** — open the mouth proportionally to audio energy. Crude but trivial, transport-agnostic, and good enough for a persistent "is-speaking" avatar.
- **Provider-driven** — the managed API renders the mouth for you; we just play their video.

For Nova Sonic, the model returns **audio**, not phoneme timings. That means the cleanest browser-native lip-sync for our recommended stack is **audio-amplitude / client-side viseme estimation on the Nova Sonic output audio**, which keeps the avatar decoupled from the voice provider.

---

## 3. Architecture options

Three candidate architectures follow. All assume: React frontend on CloudFront/S3, Cognito auth, CDK IaC, CloudWatch observability. They differ in the voice engine, the backend, and the avatar.

### Architecture A — AWS-native speech-to-speech + lightweight WebGL avatar (recommended baseline)

- **Voice**: Amazon Nova 2 Sonic (speech-to-speech) via Bedrock bidirectional stream.
- **Backend**: a WebSocket proxy on **AWS Fargate (ECS)** (long-lived bidirectional streams are a poor fit for Lambda). Validates Cognito JWT, relays audio to/from Bedrock.
- **Avatar**: browser WebGL (Three.js + Ready Player Me GLB or TalkingHead), lip-synced from the Nova Sonic output audio client-side.
- **Auth**: Cognito User Pool + Identity Pool.
- **Data flow**: mic → PCM frames → WSS → Fargate → Bedrock bidi stream → audio out → WSS → browser playback + avatar lip-sync.
- **Latency**: one extra proxy hop vs. direct, but unified model removes glue latency; expected low perceived latency with time-to-first-audio dominated by Nova Sonic.
- **Pros**: fully AWS-native voice, native barge-in/turn-taking, no per-minute avatar vendor, audio stays in our AWS account, backend is the seam for future tools/KB/observability, cleanly replaceable avatar.
- **Cons**: we build the WebSocket relay and the avatar animation states; stylized (not photoreal) avatar.
- **Complexity**: Moderate. **Cost**: Low–Moderate. **Extensibility**: Strong.

### Architecture B — AWS conversational voice + external real-time avatar provider

- **Voice**: Nova 2 Sonic as in A.
- **Avatar**: managed real-time provider (HeyGen LiveAvatar / D-ID / Simli) over their WebRTC.
- **Backend**: Fargate proxy for voice **plus** orchestration to feed the agent's speech/text to the avatar provider and synchronize.
- **Pros**: photoreal avatar, fastest visual "wow."
- **Cons**: two real-time transports to synchronize (hard), per-minute avatar cost, vendor lock-in on the most visible component, audio/text leaves AWS to a third party (privacy/compliance), harder to keep avatar in lip-sync with independently streamed Nova audio.
- **Complexity**: High. **Cost**: High. **Extensibility**: Moderate (voice yes, avatar locked-in).

### Architecture C — Separate STT + LLM + TTS + custom WebGL avatar

- **Voice**: Amazon Transcribe (streaming) → Bedrock LLM (streaming) → Amazon Polly (neural/generative + viseme stream).
- **Avatar**: WebGL, lip-synced from **Polly's viseme metadata** (clean, accurate visemes).
- **Backend**: Fargate/Lambda orchestrating three services, plus custom endpointing and barge-in.
- **Pros**: every component independently swappable, accurate Polly-driven visemes, mature/well-documented services, per-component cost visibility.
- **Cons**: we own endpointing, turn-taking, and barge-in (the hard parts); compounding latency of three hops; more moving parts.
- **Complexity**: High. **Cost**: Moderate. **Extensibility**: Strong but with more custom code to maintain.

### Why not "most AWS services wins"

Architecture C uses more AWS services than A but delivers a worse conversational feel for more engineering effort, because it forces us to rebuild barge-in and turn-taking that Nova Sonic already solves. We optimize for **UX + low latency + maintainability + extensibility**, which points to A.

---

## 4. Future-platform compatibility (why A generalizes)

The recommended Architecture A keeps three replaceable seams, each behind an interface:

- **Voice provider interface** — today Nova 2 Sonic; tomorrow a STT+LLM+TTS pipeline or another vendor, without touching the frontend.
- **Agent/session interface** — today a single hard-coded agent config (name, system prompt, model, voice); tomorrow an `Agent` record from DynamoDB with KB IDs, tool definitions, permissions. The backend already sits between browser and model, so adding retrieval and tools is additive.
- **Avatar interface** — today WebGL amplitude/viseme lip-sync; tomorrow a managed provider or a different 3D model, driven by the same voice-state events (IDLE/LISTENING/PROCESSING/SPEAKING/INTERRUPTED/ERROR).

Knowledge Bases (S3 → embeddings → vector store → Bedrock KB → retrieval → agent), MCP/AgentCore tools, multi-agent routing, and the admin portal all attach to the backend and the agent-config store **without rewriting the frontend/voice/avatar layers**. None are implemented in Phase 0.

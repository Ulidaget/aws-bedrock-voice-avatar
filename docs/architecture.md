# Phase 0 — Recommended Architecture

> Recommended architecture for the Voice + Avatar POC. This is **Architecture A** from `architecture-research.md`: AWS-native speech-to-speech + lightweight WebGL avatar.

Diagrams live in `../diagrams/` (`architecture.md`, `voice-sequence.md`, `component-diagram.md`).

> **Status: BUILT and deployed to AWS.** Sections 1–9 below describe the original
> design. Where the deployed system differs from that design, section 0 (As-Built)
> is authoritative. See `deployment-notes.md` for the obstacles resolved during
> deployment and `decisions.md` (ADR-009…ADR-014) for the decisions behind the
> as-built deltas.

---

## 0. As-Built (what was actually deployed)

The deployed architecture matches Architecture A, with these concrete refinements
discovered during implementation and deployment:

- **WSS via CloudFront, not directly to the ALB.** A single CloudFront
  distribution serves the SPA (default behavior → private S3 + OAC) AND
  reverse-proxies the WebSocket to the ALB under `/session*`, `/ws*`, `/health*`.
  The browser talks `wss://<cloudfront-domain>/session` on the same HTTPS origin
  as the SPA, so there is no mixed-content blocking and no custom domain / ACM
  certificate is required. (ADR-009)
- **Runtime `config.json`, not build-time env injection.** The deploy writes a
  `/config.json` to S3 with the real WSS endpoint and Cognito IDs; the SPA fetches
  it at startup. The same built SPA works in any environment without rebuilding.
  Local dev falls back to Vite env vars. (ADR-010)
- **Dedicated HTTP health server on port 8081.** The container runs a plain
  `http.server` answering `GET /health` on 8081, separate from the WebSocket on
  8080. The ALB target group health-checks 8081, and the task security group is
  explicitly opened for 8081 from the ALB. (The earlier attempt to serve health
  via the `websockets` `process_request` hook on 8080 caused `Target.Timeout`.)
  A `healthCheckGracePeriod` of 120s covers cold starts. (ADR-011)
- **CRT transport is mandatory for Nova Sonic bidirectional streaming.** The
  `aws-sdk-bedrock-runtime` client is configured with `AWSCRTHTTPClient`
  (`awscrt`); the default aiohttp transport does not support duplex event
  streams. (ADR-012)
- **`aws-credentials-http` is required on Fargate.** The smithy credential chain
  needs this package to read the ECS task-role credentials from the container
  credential endpoint. Without it, Bedrock calls fail silently. (ADR-013)
- **Cognito app client lives in the FrontendStack, not the AuthStack.** Its OAuth
  callback/logout URLs must point at the CloudFront domain, which only exists in
  the FrontendStack. The client is created there as a standalone
  `UserPoolClient` (not `userPool.addClient`) to avoid a stack dependency cycle.
  The backend validates the JWT against the pool (issuer + signature +
  `verify_at_hash: false`) and does not require the client id. (ADR-014)
- **Deployed SDK/library specifics**: `websockets>=14` (asyncio.server API,
  single-arg handler), `aws-sdk-bedrock-runtime>=0.11` (async
  `AsyncBedrockRuntimeClient` resolved via `AsyncBedrockRuntimeConfig.resolve`),
  model id `amazon.nova-2-sonic-v1:0`, input 16 kHz / output 24 kHz PCM16.

### As-built network flow

```
Browser (HTTPS)
  GET / , /assets , /config.json  -> CloudFront -> S3 (private, OAC)   [SPA]
  wss://.../session               -> CloudFront -> ALB -> Fargate WS proxy
                                                            -> Bedrock Nova 2 Sonic (bidi, CRT)
Cognito Hosted UI  <- login redirect -  SPA   (id_token in URL fragment)
```

---

## 1. The ten required elements

| # | Element | Phase 0 choice |
|---|---|---|
| 1 | Frontend | Vite + React static SPA (S3 + CloudFront) |
| 2 | Voice technology | Amazon Nova 2 Sonic (speech-to-speech) on Amazon Bedrock |
| 3 | AI model | Nova 2 Sonic (unified understanding + generation) |
| 4 | Backend | AWS Fargate (ECS) WebSocket proxy service |
| 5 | Streaming mechanism | Browser ⇄ backend over **WSS (WebSocket)**; backend ⇄ Bedrock over `InvokeModelWithBidirectionalStream` |
| 6 | Avatar technology | WebGL 3D (Three.js + Ready Player Me GLB / TalkingHead), audio-driven lip-sync |
| 7 | Authentication | Amazon Cognito (User Pool for identity, Identity Pool only if browser needs scoped temp creds) |
| 8 | AWS services | Bedrock, Cognito, ECS Fargate, ALB, S3, CloudFront, CloudWatch, ECR, IAM, VPC |
| 9 | Infrastructure as Code | AWS CDK (TypeScript), one app, per-environment stacks |
| 10 | Monitoring | Amazon CloudWatch (custom latency metrics, structured logs, dashboard) |

---

## 2. Components

**Frontend (browser)**
- React SPA served via CloudFront from a private S3 bucket (OAC).
- Mic capture via `getUserMedia` + WebAudio; downsample to the PCM format Nova Sonic expects.
- WebSocket client to the backend; plays returned audio; drives avatar state machine.
- Three.js scene rendering the avatar; lip-sync from output audio (amplitude/viseme estimation).
- Cognito Hosted UI / Amplify Auth for login; sends JWT when opening the WebSocket.

**Backend (AWS Fargate service)**
- WebSocket server (Python or Node). On connect, validates the Cognito JWT.
- Opens a Bedrock bidirectional stream per session; relays user audio up and model audio/events down.
- Emits voice-state events (LISTENING/PROCESSING/SPEAKING/INTERRUPTED) to the client.
- Holds the (single, hard-coded) agent config for Phase 0: name, system prompt, model id, voice id.
- Behind an Application Load Balancer (TLS, sticky per-connection). Task role has least-privilege Bedrock invoke permission.

**AWS platform**
- Bedrock (Nova 2 Sonic), Cognito, ECS/Fargate + ALB in a VPC, ECR for the container image, S3 + CloudFront for the SPA, CloudWatch for logs/metrics/dashboard, IAM roles.

---

## 3. Data / audio / network flow

```
Mic → WebAudio (PCM frames) → WSS → ALB → Fargate WS proxy
   → Bedrock InvokeModelWithBidirectionalStream (Nova 2 Sonic)
Nova 2 Sonic → audio + events → Fargate → WSS → browser
   → audio playback + avatar lip-sync + state transitions
```

- **Audio up**: small PCM chunks streamed continuously while the mic is open (no press-to-record).
- **Audio down**: streamed audio chunks played as they arrive (time-to-first-audio is the key metric).
- **Barge-in**: user speech during SPEAKING is forwarded; Nova Sonic interrupts itself; backend signals INTERRUPTED so the client stops playback and the avatar stops "talking."
- **Network**: all traffic is TLS. Browser↔backend is WSS through CloudFront/ALB; backend↔Bedrock is AWS SigV4 over the SDK stream, inside AWS.

## 4. Authentication flow

1. User signs in via Cognito Hosted UI → receives JWT (ID/access token).
2. Browser opens `wss://.../session` including the token.
3. Backend validates the JWT against the Cognito User Pool JWKS before starting the Bedrock stream.
4. The browser never receives long-lived AWS credentials; the Fargate task role calls Bedrock.

## 5. Voice interaction state machine

| State | Trigger | UI | Avatar |
|---|---|---|---|
| IDLE | connected, mic idle | "Tap to talk" / listening ready | neutral idle |
| LISTENING | mic streaming to backend | live mic indicator, waveform | listening animation |
| PROCESSING | user turn ended, awaiting audio | subtle spinner | thinking animation |
| SPEAKING | model audio streaming | playback + captions (optional) | talking + lip-sync |
| INTERRUPTED | user barge-in during SPEAKING | stop playback, back to LISTENING | stop talking immediately |
| ERROR | stream/connection/auth failure | error banner + retry | error/neutral state |

These states are emitted by the backend and consumed by both the UI and the avatar via one shared event channel, so the avatar provider can be swapped without changing voice logic.

## 6. Replaceable interfaces (future-proofing)

- **`VoiceProvider`** — `startSession`, `sendAudio`, `onAudio`, `onEvent`, `interrupt`, `endSession`. Nova 2 Sonic today; a STT+LLM+TTS pipeline or other vendor later.
- **`AgentConfig`** — `{ name, description, systemPrompt, modelId, voiceId, knowledgeBaseIds[], tools[], permissions }`. Phase 0 uses one static config; later loaded per-agent from DynamoDB.
- **`AvatarController`** — consumes voice-state events + audio; renders. WebGL today; managed provider later.
- **`ToolRegistry`** — empty in Phase 0; the seam where Lambda/MCP/AgentCore tools plug in.

## 7. Expected latency characteristics

Dominant term is Nova 2 Sonic time-to-first-audio. Added terms: one WSS proxy hop (browser↔Fargate, single-digit ms within region + client RTT) and client-side audio decode/playback. No STT/LLM/TTS glue latency because the model is unified. Target: low perceived latency with barge-in that feels immediate. Actual numbers must be measured in the target region (see `../docs/cost-analysis.md` assumptions and observability metrics below).

## 8. Observability

CloudWatch custom metrics emitted by the backend per turn/session:
- `TimeToFirstAudio`, `EndToEndTurnLatency`, `SessionDuration`, `TurnsPerSession`, `Interruptions`, `ConnectionErrors`, `AudioErrors`.
- Structured JSON logs (no raw audio, no PII) to CloudWatch Logs.
- A CloudWatch dashboard + alarms on error rate and p95 time-to-first-audio.

## 9. Diagrams

- Architecture diagram: `../diagrams/architecture.md`
- Voice sequence diagram: `../diagrams/voice-sequence.md`
- Component diagram: `../diagrams/component-diagram.md`

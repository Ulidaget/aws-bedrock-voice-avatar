# Phase 0 — Scope and Task Breakdown

> Strict scope for the Voice + Avatar POC. Everything outside "Included" is deferred.

---

## 1. Included

- Web page (Vite + React SPA).
- Microphone access + streaming capture.
- Voice conversation with the AI agent (Nova 2 Sonic).
- AI response (audio + optional text captions).
- Streaming where possible (bidirectional audio).
- Persistent WebGL avatar.
- Avatar listening / thinking / speaking / interrupted / error states with audio-driven lip-sync.
- Basic session handling (start, reconnect on the ~8-min stream limit, end).
- Authentication (Cognito) — required by the chosen backend-proxy architecture.
- AWS infrastructure via CDK.
- Basic logging + core latency metrics (CloudWatch).

## 2. Excluded (deferred to later phases)

Knowledge Bases, RAG, S3 Vectors implementation, document ingestion, multiple agents, agent administration portal, MCP, tools/actions, business actions, analytics dashboard, billing, multi-tenancy.

## 3. Kept abstract (so the platform can evolve)

`VoiceProvider`, `AgentConfig`, `AvatarController`, `ToolRegistry` interfaces (see `architecture.md` §6). Phase 0 ships one static agent config and an empty tool registry.

## 4. Success criteria (definition of done)

- A signed-in user can open the app, grant mic access, and hold a spoken conversation without press-to-record.
- The agent responds with streamed natural speech at low perceived latency.
- The avatar visibly reacts across IDLE/LISTENING/PROCESSING/SPEAKING/INTERRUPTED/ERROR and lip-syncs while speaking.
- Barge-in works: speaking over the agent interrupts it.
- The whole stack deploys from CDK into a clean AWS account and can be destroyed cleanly.
- Core latency/error metrics appear in CloudWatch.
- No AWS credentials in the browser; no secrets in the repo.

## 5. Exact task breakdown

### Epic A — Repo, IaC bootstrap, CI
- A1. Create monorepo layout: `frontend/`, `backend/`, `infra/` (CDK), `docs/`, `diagrams/`.
- A2. CDK app skeleton with per-env config (dev/test/prod) and `cdk bootstrap` instructions.
- A3. Base network stack: VPC, subnets, security groups.
- A4. CI: build/lint frontend + backend, `cdk synth` on PR (OIDC role, no static keys).

### Epic B — Authentication
- B1. Cognito User Pool + app client + Hosted UI (CDK).
- B2. Frontend login flow (Amplify Auth or Hosted UI redirect); obtain JWT.
- B3. Backend JWT validation against User Pool JWKS.

### Epic C — Backend voice proxy (Fargate)
- C1. WebSocket server skeleton; accept connection only with a valid JWT.
- C2. `VoiceProvider` interface + Nova 2 Sonic implementation (open bidirectional stream, relay audio).
- C3. Session lifecycle: start, per-turn events, barge-in/INTERRUPTED, reconnect on stream limit, end.
- C4. Static `AgentConfig` (name, system prompt, model id, voice id) + empty `ToolRegistry`.
- C5. Containerize; ECR + ECS Fargate service + ALB (CDK); least-privilege task role (single model ARN).

### Epic D — Frontend voice UX
- D1. Mic capture + WebAudio PCM encoding to Nova Sonic's expected format.
- D2. WebSocket client; stream audio up, play audio down as it arrives.
- D3. Voice state machine (6 states) driven by backend events.
- D4. Text mode input (type→response) sharing the same session channel.
- D5. Immediate mic feedback, captions (optional), reconnect handling, error UI.

### Epic E — Avatar
- E1. Three.js scene + Ready Player Me GLB (or TalkingHead); persistent neutral render.
- E2. `AvatarController` interface consuming voice-state events + output audio.
- E3. Audio-driven lip-sync (amplitude/viseme estimation) during SPEAKING.
- E4. Listening / thinking / interrupted / error animations wired to states.

### Epic F — Static hosting
- F1. Frontend build → private S3 bucket + CloudFront (OAC), CORS locked to SPA origin (CDK).
- F2. Wire Cognito callback URLs + WSS endpoint into the build config per env.

### Epic G — Observability
- G1. Backend emits `TimeToFirstAudio`, `EndToEndTurnLatency`, `SessionDuration`, `TurnsPerSession`, `Interruptions`, `ConnectionErrors`, `AudioErrors`.
- G2. Structured logs (metadata only, no audio/PII).
- G3. CloudWatch dashboard + alarms (error rate, p95 time-to-first-audio).

### Epic H — Docs / ops
- H1. README: prerequisites, deploy, destroy, env vars, costs, limitations.
- H2. Verify Nova 2 Sonic region availability + model access enabled in the target account.
- H3. Re-verify current pricing before any pilot.

## 6. Sequencing / dependencies

A → B → C → (D, E in parallel) → F → G → H. D and E can proceed in parallel once C exposes the event/audio contract.

## 7. Out-of-scope guardrails

If any task starts pulling in KB/RAG/tools/multi-agent/portal work, stop — that belongs to a later phase. Keep new capability behind the four interfaces rather than wiring it into Phase 0.

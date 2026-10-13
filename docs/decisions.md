# Phase 0 — Decision Record (ADRs)

Each decision states the choice, the reason, alternatives considered, and consequences. No technology decision is made without a documented reason.

---

## ADR-001 — Use Amazon Nova 2 Sonic (speech-to-speech) as the voice engine
- **Decision**: Use Nova 2 Sonic on Bedrock via `InvokeModelWithBidirectionalStream`.
- **Reason**: Native barge-in and turn-taking, unified understanding+generation (no glue latency), AWS-native, tool-use support (async in Nova 2) for the future platform. These are the hardest parts of a natural voice UX and the model provides them.
- **Alternatives**: Transcribe+LLM+Polly pipeline (more moving parts, we own endpointing/barge-in); external realtime voice (vendor lock-in, data leaves AWS).
- **Consequences**: Slight AWS-model coupling, mitigated by the `VoiceProvider` interface. Must verify region availability and pricing.

## ADR-002 — Backend WebSocket proxy on Fargate (not direct browser→Bedrock)
- **Decision**: Browser connects to a Fargate WebSocket service that validates the Cognito JWT and relays to Bedrock.
- **Reason**: Keeps AWS credentials out of the browser; becomes the seam for tools, Knowledge Bases, guardrails, multi-agent routing, and observability. Long-lived bidirectional streams fit a persistent process better than Lambda.
- **Alternatives**: Direct SigV4 WS from browser (simplest, but strands server-side logic in the client and puts temp creds in browser); API Gateway WebSocket + Lambda (awkward for continuous long-lived audio).
- **Consequences**: One extra hop and an always-on task cost floor. Acceptable for the extensibility gained.

## ADR-003 — WebGL 3D avatar (Three.js + Ready Player Me / TalkingHead), not a managed video provider
- **Decision**: Render a browser WebGL avatar, lip-synced from the Nova Sonic output audio.
- **Reason**: $0 incremental cost vs. ~$0.10–$0.37/min managed; no second realtime transport to synchronize; audio stays in our stack (privacy); trivially replaceable via the `AvatarController` interface.
- **Alternatives**: HeyGen LiveAvatar / D-ID / Simli (photoreal but costly, vendor lock-in, data egress, sync complexity); pre-rendered video (not interactive — rejected).
- **Consequences**: Stylized rather than photoreal. If photorealism becomes a hard requirement, swap the avatar layer without touching voice.

## ADR-004 — Frontend: Vite + React static SPA
- **Decision**: Vite + React, deployed static to S3 + CloudFront.
- **Reason**: No SSR needed for Phase 0; simplest to host and secure behind CloudFront + Cognito; excellent WebAudio/WebSocket/Three.js (R3F) support; fast DX.
- **Alternatives**: Next.js (SSR overhead unnecessary now; can be a separate app for the future admin portal); CRA (legacy).
- **Consequences**: A future SSR admin portal will be a separate Next.js app; the end-user POC stays a static client.

## ADR-005 — Authentication via Amazon Cognito
- **Decision**: Cognito User Pool for identity; JWT validated server-side; Identity Pool only if the browser ever needs scoped temp creds.
- **Reason**: Managed, AWS-native, integrates with CloudFront/ALB and the future portal; keeps long-lived keys out of the browser.
- **Alternatives**: Custom auth (more work, more risk); third-party IdP (unnecessary now, can federate into Cognito later).
- **Consequences**: Cognito Hosted UI styling constraints; acceptable for POC.

## ADR-006 — Infrastructure as Code with AWS CDK (TypeScript)
- **Decision**: AWS CDK in TypeScript, one app, per-environment stacks (dev/test/prod).
- **Reason**: Prompt preference; same language as the frontend; same-day AWS service support; higher-level constructs; straightforward multi-env.
- **Alternatives**: Terraform (strong, but HCL and a separate toolchain); raw CloudFormation (verbose).
- **Consequences**: Team must be comfortable with CDK/TypeScript; bootstrap required per account/region.

## ADR-007 — Observability via Amazon CloudWatch
- **Decision**: CloudWatch custom metrics, structured logs (metadata only), dashboard, alarms.
- **Reason**: AWS-native, no extra vendor, sufficient for POC latency/error tracking.
- **Alternatives**: Third-party APM (overkill for POC).
- **Consequences**: Metrics must be emitted deliberately by the backend; no raw audio/PII in logs.

## ADR-008 — Abstract Voice, Agent, Avatar, and Tools behind interfaces
- **Decision**: Define `VoiceProvider`, `AgentConfig`, `AvatarController`, and `ToolRegistry` interfaces from day one; Phase 0 ships one static agent config and empty tool registry.
- **Reason**: Lets the platform evolve (multiple agents, KB, MCP/AgentCore tools, alternate voice/avatar) without rewriting the frontend/backend.
- **Alternatives**: Hard-couple to Nova Sonic + WebGL (faster now, expensive to unwind later).
- **Consequences**: Small upfront design cost; large future flexibility.

## Decisions intentionally deferred (kept abstract)
- Vector store choice (Amazon S3 Vectors vs. Bedrock Knowledge Bases) — evaluate in the KB phase.
- Tool transport (direct Lambda vs. MCP vs. AgentCore) — behind `ToolRegistry`.
- Photoreal vs. stylized avatar for production — behind `AvatarController`.
- Multi-tenancy model — out of Phase 0.

---

## As-built ADRs (decisions made during implementation & AWS deployment)

These were not in the original proposal; they emerged while building and deploying
Phase 0 and are now part of the shipped system.

## ADR-009 — Front the WebSocket with CloudFront (single origin), not a public ALB URL
- **Decision**: One CloudFront distribution serves the SPA and reverse-proxies the WebSocket to the ALB under `/session*`, `/ws*`, `/health*`.
- **Reason**: The SPA is served over HTTPS from CloudFront. A browser on an HTTPS page cannot open an insecure `ws://` connection (mixed content), and the ALB has no TLS cert without a custom domain. Routing `wss://` through CloudFront gives a secure same-origin endpoint with no custom domain / ACM needed.
- **Alternatives**: Direct `wss://` to the ALB with an ACM cert + custom domain (more setup, needs a domain); terminate TLS on the container (managing certs in-app).
- **Consequences**: One extra hop (CloudFront→ALB). CloudFront behavior for the WS path uses `CACHING_DISABLED` + `ALL_VIEWER` origin request policy so the JWT query string and upgrade headers pass through.

## ADR-010 — Runtime `config.json` instead of build-time env injection
- **Decision**: The deploy writes `/config.json` (WSS endpoint, Cognito ids, authDisabled) to S3; the SPA fetches it at startup. Local dev falls back to Vite env vars.
- **Reason**: The real endpoint/Cognito values only exist after deploy (chicken-and-egg with a build-time bake). Runtime config lets the exact same SPA build run in any environment without rebuilding.
- **Alternatives**: Rebuild the SPA per environment with `VITE_*` vars baked in (couples build to deploy, slower iteration).
- **Consequences**: One extra fetch at startup; `main.tsx` awaits `loadConfig()` before render.

## ADR-011 — Dedicated HTTP health server on port 8081 (not the websockets hook on 8080)
- **Decision**: Run a plain `http.server` for `GET /health` on 8081; ALB target group health-checks 8081; open the task SG for 8081 from the ALB; set `healthCheckGracePeriod` 120s.
- **Reason**: Serving `/health` via the `websockets` `process_request` hook on the traffic port (8080) produced `Target.Timeout` behind the ALB — the ALB opened the TCP connection but never got an HTTP response it accepted. A standard HTTP server returns an unambiguous 200. The L3 pattern only auto-opens the SG for the traffic port, so a different health port must be opened explicitly.
- **Alternatives**: Health on 8080 via websockets hook (proved unreliable behind the ALB); container-level `HEALTHCHECK` (doesn't drive the ALB target health).
- **Consequences**: Container exposes two ports (8080 traffic, 8081 health); one explicit SG ingress rule.

## ADR-012 — Use the CRT HTTP transport for Nova Sonic bidirectional streaming
- **Decision**: Configure `aws-sdk-bedrock-runtime` with `AWSCRTHTTPClient` (`awscrt`).
- **Reason**: `InvokeModelWithBidirectionalStream` is a duplex event stream; the default aiohttp transport raised `UnsupportedTransportError`. Only the CRT transport supports duplex streaming.
- **Alternatives**: None viable for bidirectional streaming with this SDK.
- **Consequences**: `awscrt` (~4 MB wheel) is a required dependency.

## ADR-013 — Add `aws-credentials-http` so Fargate resolves the task role
- **Decision**: Include `aws-credentials-http` in the backend requirements.
- **Reason**: The smithy modular credential chain needs this provider to read ECS task-role credentials from the container credential endpoint (`AWS_CONTAINER_CREDENTIALS_RELATIVE_URI`). Without it the SDK warned "EcsContainer credential source was detected but no provider claims it" and Bedrock calls failed. Locally it worked only because credentials came from env vars.
- **Alternatives**: Inject static keys as env vars (insecure, defeats the task-role model).
- **Consequences**: One extra dependency; the browser/backend credential model stays role-based and keyless.

## ADR-014 — Create the Cognito app client in the FrontendStack; validate JWT against the pool only
- **Decision**: The `UserPoolClient` is a standalone resource in the FrontendStack (callbacks = CloudFront domain). The backend validates the id_token's signature/issuer/expiry with `verify_at_hash: false` and does not require the client id.
- **Reason**: The client's OAuth callback URLs need the CloudFront domain, which only exists in the FrontendStack. Using `userPool.addClient()` would attach the client to the pool in the AuthStack and create a stack dependency cycle. Cognito id_tokens carry an `at_hash` claim that `python-jose` tries to verify against an access_token we don't have; skipping that check is correct when we only validate the id_token. Not requiring the client id in the backend also keeps the stack graph acyclic (backend only needs the pool id).
- **Alternatives**: `userPool.addClient()` (cycle); pass the access_token too (unnecessary complexity); strict `aud` check (would require wiring the client id into the backend).
- **Consequences**: Backend trusts any valid token from the pool; acceptable for a single-client POC. Tighten with an explicit `aud`/`client_id` check if multiple clients are added later.

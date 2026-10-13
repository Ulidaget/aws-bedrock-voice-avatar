# Phase 0 — Final Answers

Direct answers to the 15 questions required before implementation. Supporting detail lives in the other `docs/` files.

### 1. Recommended voice architecture
AWS-native **speech-to-speech**: the browser streams mic audio over WSS to a **Fargate WebSocket proxy**, which relays to **Amazon Nova 2 Sonic** on Bedrock via `InvokeModelWithBidirectionalStream` and streams audio back. This is Architecture A.

### 2. Nova Sonic vs. separate STT → LLM → TTS?
**Nova 2 Sonic.** A single speech-to-speech model gives native barge-in and turn-taking and removes STT→LLM→TTS glue latency — the parts that most determine conversational feel and are hardest to build well. The pipeline stays documented as a fallback behind the `VoiceProvider` interface.

### 3. Avatar technology for the POC
A **WebGL 3D avatar** in the browser (Three.js + a Ready Player Me GLB, or `met4citizen/TalkingHead`), lip-synced from the agent's output audio. Real-time interactive, $0 incremental cost, audio stays in our stack, easily replaceable.

### 4. Custom WebGL/Three.js or external provider?
**Custom WebGL/Three.js** for Phase 0. Managed providers (HeyGen LiveAvatar/D-ID/Simli) add ~$0.10–$0.37/min, a second realtime transport to synchronize, vendor lock-in, and data egress — not justified unless photorealism is a hard requirement. The `AvatarController` interface lets us switch later.

### 5. Frontend framework
**Vite + React**, built as a static SPA on S3 + CloudFront. No SSR needed now; simplest to host and secure. A future admin portal can be a separate Next.js app.

### 6. Backend architecture
A **Fargate (ECS) WebSocket proxy** behind an ALB. It validates the Cognito JWT and owns the Bedrock stream. It is the seam where tools, Knowledge Bases, multi-agent routing, and observability attach later. Lambda is a poor fit for long-lived bidirectional audio.

### 7. Streaming protocol
**WebSocket (WSS)** browser⇄backend; **Bedrock bidirectional streaming** (`InvokeModelWithBidirectionalStream`) backend⇄model. No WebRTC needed because the WebGL avatar renders locally off our audio.

### 8. Authentication
**Amazon Cognito** User Pool issues JWTs; the backend validates them (JWKS) before opening any Bedrock stream. The **browser holds no AWS credentials** — the Fargate task role calls Bedrock. An Identity Pool is added only if the browser ever needs scoped temp creds.

### 9. AWS services actually required
Bedrock (Nova 2 Sonic), Cognito, ECS/Fargate + ALB, VPC, ECR, S3, CloudFront, CloudWatch, IAM. Nothing else in Phase 0.

### 10. Local vs. AWS
- **Local**: frontend dev server, backend proxy run against Bedrock with developer credentials, avatar/lip-sync tuning, iteration.
- **AWS**: Bedrock (always remote), plus Cognito/Fargate/ALB/S3/CloudFront/CloudWatch for any shared or deployed environment.

### 11. Managed through IaC
**Everything**, via AWS CDK (TypeScript): VPC, Cognito, ECR, Fargate service + ALB, task/execution roles, S3 + CloudFront (OAC), CloudWatch dashboard/alarms, per-env stacks (dev/test/prod). No resources created by hand.

### 12. Main cost drivers
1) Nova 2 Sonic voice minutes (~$0.015/min planning anchor) — dominant at scale. 2) Always-on Fargate/ALB — fixed monthly floor. 3) Avatar = $0 (WebGL). Others (CloudFront/S3/Cognito/CloudWatch) are minor at POC scale. Verify pricing officially before budgeting.

### 13. Main technical risks
- Nova 2 Sonic **region availability** and model-access enablement.
- **Latency** in the real network path (must measure, not assume).
- Browser **audio capture/format** correctness for Nova Sonic and playback glitches.
- **Barge-in** UX correctness (stop playback + avatar promptly).
- ~8-minute **stream limit** → reconnect handling.
- Lip-sync quality from amplitude/viseme estimation (no phoneme timings from the model).
- Pricing drift vs. the estimates.

### 14. Decisions to keep abstract
The four interfaces: **`VoiceProvider`**, **`AgentConfig`**, **`AvatarController`**, **`ToolRegistry`**. Also deferred and kept open: vector store (S3 Vectors vs. Bedrock KB), tool transport (Lambda vs. MCP vs. AgentCore), photoreal-vs-stylized avatar, and multi-tenancy model.

### 15. Exact tasks to implement Phase 0
See `phase-0-scope.md` §5, Epics A–H: A) repo + CDK bootstrap + CI; B) Cognito auth; C) Fargate voice proxy + Nova 2 Sonic `VoiceProvider`; D) frontend voice UX + 6-state machine + text mode; E) WebGL avatar + `AvatarController` + lip-sync; F) S3/CloudFront static hosting; G) CloudWatch metrics/logs/dashboard; H) docs + region/pricing verification. Sequence: A→B→C→(D,E parallel)→F→G→H.

---

**Recommendation:** proceed to implementation of Phase 0 with Architecture A as specified, starting with Epic A. Implementation should begin only after this proposal is reviewed and the Nova 2 Sonic region/pricing checks (H2, H3) are confirmed.

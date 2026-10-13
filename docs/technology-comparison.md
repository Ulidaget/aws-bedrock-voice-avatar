# Phase 0 — Technology Comparison / Decision Matrix

> Per the constraints, this matrix uses qualitative ratings — **Strong / Moderate / Limited / Requires investigation** — instead of arbitrary numeric scores, and explains the evidence behind each. Content was rephrased for compliance with licensing restrictions.

Rating meaning:
- **Strong** — clear, documented fit for Phase 0 with low risk.
- **Moderate** — works, with known trade-offs or extra effort.
- **Limited** — possible but a poor fit or costly for Phase 0.
- **Requires investigation** — plausible but not yet verified for our exact use.

---

## 1. Voice / conversational engine

| Criterion | Nova 2 Sonic (speech-to-speech) | Transcribe + Bedrock LLM + Polly (pipeline) | External realtime voice (e.g., OpenAI Realtime) |
|---|---|---|---|
| Latency | **Strong** — single model, no glue hops; low latency by design | **Moderate** — three hops compound | **Strong** — realtime by design |
| Streaming | **Strong** — bidirectional stream, continuous audio both ways | **Strong** — each service streams | **Strong** |
| Barge-in / interruption | **Strong** — native | **Limited** — must build endpointing + stop-Polly logic | **Strong** — native |
| Natural turn-taking | **Strong** — native | **Limited** — custom | **Strong** |
| Voice quality | **Strong** — expressive, prosody-adaptive | **Strong** — Polly neural/generative | **Strong** |
| Conversational quality | **Strong** — unified understanding+generation | **Moderate** — depends on orchestration | **Strong** |
| Browser compatibility | **Moderate** — needs backend proxy or SigV4 WS; standard WebAudio capture | **Moderate** — same | **Moderate** |
| AWS integration | **Strong** — native Bedrock | **Strong** — all AWS | **Limited** — third party |
| Complexity | **Moderate** — one stream to manage | **High** — orchestrate 3 services + turn logic | **Moderate** |
| Cost | **Moderate** — ~$3/M speech-in, $12/M speech-out tokens, ~$0.015/min est. | **Moderate** — Transcribe + LLM + Polly summed | **Requires investigation** — often higher |
| Scalability | **Strong** — Bedrock managed | **Strong** — all managed | **Strong** |
| Extensibility (tools/KB) | **Strong** — tool use; Nova 2 async tool calling | **Strong** — full control | **Moderate** |
| Vendor lock-in | **Moderate** — AWS model, but behind our interface | **Moderate** — swappable parts, AWS-bound | **Strong lock-in** — non-AWS |
| Security / data residency | **Strong** — stays in AWS account/region | **Strong** — stays in AWS | **Limited** — leaves AWS |
| Licensing | **Strong** — AWS commercial terms | **Strong** | **Requires investigation** |

Evidence: Nova Sonic uses `InvokeModelWithBidirectionalStream` with native barge-in and turn-taking ([bidirectional guide](https://docs.aws.amazon.com/nova/latest/userguide/speech-bidirection.html), [telephony guide](https://aws.amazon.com/blogs/machine-learning/building-ai-powered-voice-applications-amazon-nova-sonic-telephony-integration-guide/)); Nova 2 Sonic adds 7 languages, async tool calling, 1M context ([What's New](https://aws.amazon.com/about-aws/whats-new/2025/12/amazon-nova-2-sonic-real-time-conversational-ai/)). Pricing signal from [llm-stats](https://llm-stats.com/models/nova-2-sonic) and [summary](https://rywalker.com/research/aws-nova-2-sonic) — verify on the [AWS Nova pricing page](https://aws.amazon.com/nova/pricing/) before committing budget.

**Winner for Phase 0: Nova 2 Sonic.** Native barge-in and turn-taking are the differentiators; they are the hardest parts to build well and directly determine perceived conversational quality.

---

## 2. Avatar technology

| Criterion | WebGL 3D (Three.js + Ready Player Me / TalkingHead) | Managed realtime video (HeyGen LiveAvatar / D-ID / Simli) | Pre-rendered AI video |
|---|---|---|---|
| Real-time interactive | **Strong** | **Strong** | **Limited** — not interactive |
| Lip-sync | **Moderate** — viseme/amplitude driven, good enough | **Strong** — photoreal, provider-rendered | **Strong** but offline |
| Real-time performance | **Strong** — client GPU | **Moderate** — depends on provider/network | n/a |
| Latency | **Strong** — local render | **Moderate** — Simli <~300ms, others higher | n/a |
| Browser compatibility | **Strong** — WebGL everywhere | **Moderate** — WebRTC + their SDK | **Strong** — plain video |
| Cost | **Strong** — no per-minute avatar fee | **Limited** — ~$0.10–$0.37/min managed | **Moderate** — per video |
| API/SDK availability | **Strong** — open source | **Strong** — commercial SDKs | **Strong** |
| WebRTC/WebSocket | **Strong** — none required (drives off our audio) | **Moderate** — second realtime transport to sync | n/a |
| Ease of integration | **Moderate** — we own animation states | **Moderate** — sync two realtime streams | **Strong** |
| Replaceability | **Strong** — behind avatar interface | **Moderate** — most visible component locked-in | **Moderate** |
| Privacy/security | **Strong** — audio stays client/AWS | **Limited** — audio/text to third party | **Limited** |
| Commercial usage | **Requires investigation** — check RPM/model license | **Moderate** — commercial plans exist | **Moderate** |

Evidence: TalkingHead does real-time in-browser lip-sync on GLB avatars ([GitHub](https://github.com/met4citizen/talkinghead)); managed APIs are WebRTC audio-in/video-out ([Lemonslice](https://lemonslice.com/i/best-avatar-api)); managed per-minute cost $0.10–$0.37 ([Forasoft](https://www.forasoft.com/blog/article/interactive-ai-avatar-development)); Simli ~<300ms ([comparison](https://meetcody.ai/blog/real-time-ai-avatar-models-compared/)).

**Winner for Phase 0: WebGL 3D avatar.** No per-minute fee, no second realtime transport to synchronize against Nova's audio, audio never leaves our stack, and it is trivially replaceable by a managed provider later if we want photoreal. Managed video is the right call only if photorealism is a hard Phase 0 requirement — it is not.

---

## 3. Frontend framework

| Criterion | Next.js | Vite + React (SPA) | Create-React-App |
|---|---|---|---|
| Realtime audio / WebAudio | **Strong** | **Strong** | **Strong** |
| WebSocket/WebRTC | **Strong** | **Strong** | **Strong** |
| Avatar/WebGL (Three.js/R3F) | **Strong** | **Strong** | **Moderate** |
| Static hosting on S3/CloudFront | **Moderate** — SSR adds moving parts; static export ok | **Strong** — pure static build | **Strong** |
| Build speed / DX | **Moderate** | **Strong** | **Limited** — legacy |
| Future admin portal (routing, SSR/SEO) | **Strong** | **Moderate** | **Limited** |
| Simplicity for Phase 0 | **Moderate** | **Strong** | **Moderate** |

**Winner for Phase 0: Vite + React**, deployed as a static SPA to S3 + CloudFront. Phase 0 needs no SSR; a static SPA is the simplest thing to host behind CloudFront and to secure with Cognito. If the future admin portal wants SSR/SEO, it can be a separate Next.js app — the POC frontend stays a static client.

---

## 4. Backend compute for the voice stream

| Criterion | Fargate (ECS) long-lived WS | API Gateway WebSocket + Lambda | Direct browser→Bedrock (SigV4 WS, no backend) |
|---|---|---|---|
| Long-lived bidirectional stream | **Strong** — persistent process | **Limited** — Lambda 15-min cap, per-message model, awkward for continuous audio | **Strong** |
| Insert tools/KB/guardrails later | **Strong** | **Moderate** | **Limited** — logic would live in browser |
| Keep AWS creds off browser | **Strong** | **Strong** | **Limited** — temp creds in browser |
| Cost at low volume | **Moderate** — always-on task | **Strong** — pay per use | **Strong** — no backend |
| Ops complexity | **Moderate** | **Moderate** | **Strong** — least infra |
| Observability seam | **Strong** | **Moderate** | **Limited** |

Evidence: AWS ships both a direct SigV4 browser→Bedrock sample ([drive-thru](https://github.com/aws-solutions-library-samples/sample-voice-ai-powered-drive-thru-with-amazon-nova-sonic)) and a Cognito-authenticated Python backend WebSocket sample ([sonic CDK agent](https://github.com/aws-samples/sample-sonic-cdk-agent)).

**Winner for Phase 0: Fargate WebSocket proxy.** It is the seam where tools, Knowledge Bases, multi-agent routing, and observability will attach. The direct pattern is cheaper but strands all future server-side logic in the browser.

---

## 5. Infrastructure as Code

| Criterion | AWS CDK | Terraform | CloudFormation (raw) |
|---|---|---|---|
| AWS-native / same-day service support | **Strong** | **Moderate** | **Strong** |
| Language (TypeScript alongside React) | **Strong** | **Moderate** — HCL | **Limited** — YAML/JSON |
| Multi-env (dev/test/prod) | **Strong** — context/stages | **Strong** — workspaces | **Moderate** |
| Ecosystem / constructs | **Strong** | **Strong** | **Limited** |
| Team familiarity | **Requires investigation** | **Requires investigation** | **Requires investigation** |

**Winner: AWS CDK** (TypeScript), matching the prompt's stated preference and letting IaC share a language with the frontend. No strong technical reason to deviate.

---

## Summary of picks

| Layer | Phase 0 choice |
|---|---|
| Voice | Amazon Nova 2 Sonic (speech-to-speech, Bedrock bidirectional stream) |
| Avatar | WebGL 3D (Three.js + Ready Player Me GLB, or TalkingHead), audio-driven lip-sync |
| Frontend | Vite + React static SPA |
| Backend | Fargate (ECS) WebSocket proxy |
| Auth | Amazon Cognito (User Pool + Identity Pool) |
| IaC | AWS CDK (TypeScript) |
| Observability | Amazon CloudWatch (metrics, logs) |

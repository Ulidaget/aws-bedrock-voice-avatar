# Phase 0 — Voice + Avatar POC

A browser-based conversational AI agent: the user speaks, a persistent avatar reacts while listening/thinking/speaking, and the agent replies with natural, low-latency streamed voice.

> **Status: Phase 0 implemented.** The research/architecture proposal lives in `docs/`; a working monorepo (`frontend/`, `backend/`, `infra/`) implements it. See `LOCAL-DEV.md` to run it locally and `PROJECT-STRUCTURE.md` for the layout. Verified: frontend `tsc`+`vite build` clean, backend modules compile, CDK app synthesizes all 5 stacks.

## Run it

- Local development: see `LOCAL-DEV.md` (backend via `docker compose up` or Python; frontend via `npm run dev`). Requires Nova 2 Sonic model access in your AWS account.
- Deploy to AWS: see the Deployment section below (`cdk deploy`).

## What this is (and is not)

- **Is**: a minimal but production-oriented POC to validate the core voice + avatar experience on AWS.
- **Is not**: the full platform. No Knowledge Bases, RAG, multi-agent, admin portal, MCP, tools, analytics, billing, or multi-tenancy in Phase 0. Those are deliberately deferred behind stable interfaces.

## Recommended stack (see `docs/`)

| Layer | Choice |
|---|---|
| Frontend | Vite + React static SPA (S3 + CloudFront) |
| Voice / AI | Amazon Nova 2 Sonic (speech-to-speech) on Amazon Bedrock |
| Backend | AWS Fargate (ECS) WebSocket proxy |
| Streaming | Browser⇄backend WSS; backend⇄Bedrock `InvokeModelWithBidirectionalStream` |
| Avatar | WebGL 3D (Three.js + Ready Player Me / TalkingHead), audio-driven lip-sync |
| Auth | Amazon Cognito |
| IaC | AWS CDK (TypeScript) |
| Monitoring | Amazon CloudWatch |

## Documentation map

- `docs/architecture-research.md` — voice + avatar + architecture-options research.
- `docs/technology-comparison.md` — qualitative decision matrix.
- `docs/architecture.md` — recommended architecture.
- `docs/security.md` — security model.
- `docs/cost-analysis.md` — cost model + scenarios.
- `docs/decisions.md` — ADRs with reasons.
- `docs/phase-0-scope.md` — scope + exact task breakdown.
- `diagrams/` — `architecture.md`, `voice-sequence.md`, `component-diagram.md` (Mermaid).

---

## Prerequisites

- AWS account with permission to deploy VPC, ECS/Fargate, ALB, Cognito, S3, CloudFront, CloudWatch, ECR, IAM.
- **Amazon Bedrock model access enabled for Nova 2 Sonic** in your target region (request access in the Bedrock console).
- Confirm **Nova 2 Sonic region availability**; pick a supported region and pin all resources to it.
- Node.js LTS + npm/pnpm, AWS CLI v2, AWS CDK v2 (`npm i -g aws-cdk`), Docker (to build the backend image).
- A modern browser (Chrome/Edge/Firefox) with microphone access over HTTPS.

## AWS account requirements

- One account per environment is cleanest (dev/test/prod), or one account with per-env stacks.
- `cdk bootstrap` run once per account/region.
- No IAM users with static keys; use OIDC-federated roles for CI.

## Local development

> These commands describe the intended layout once implementation starts (`docs/phase-0-scope.md`, Epics A–H). They are not runnable yet.

```bash
# frontend
cd frontend
cp .env.example .env      # set VITE_WSS_ENDPOINT, VITE_COGNITO_* (public IDs only)
npm install
npm run dev               # run dev server manually in your terminal

# backend (voice proxy) — run locally against Bedrock with your dev credentials
cd ../backend
cp .env.example .env      # region, model id, cognito user pool id/jwks
# start per backend README (do not commit .env)
```

Local mode uses your developer AWS credentials via the standard AWS provider chain (env/SSO/profile) — **never** hard-code keys and never ship them to the browser.

## Environment variables

Frontend (public, safe to expose):
- `VITE_WSS_ENDPOINT` — backend WebSocket URL.
- `VITE_COGNITO_USER_POOL_ID`, `VITE_COGNITO_CLIENT_ID`, `VITE_COGNITO_DOMAIN` — Cognito public identifiers.
- `VITE_AVATAR_MODEL_URL` — GLB avatar asset URL.

Backend (server-side only):
- `AWS_REGION`, `BEDROCK_MODEL_ID` (Nova 2 Sonic).
- `COGNITO_USER_POOL_ID` (for JWKS validation).
- `ALLOWED_ORIGIN` — the SPA origin for CORS.

Secrets, if any, come from AWS Secrets Manager / SSM at runtime. Only `.env.example` with placeholders is committed; `.env` is git-ignored.

## Deployment (CDK)

```bash
cd infra
npm install
cdk bootstrap                       # once per account/region
cdk deploy --all --context env=dev  # deploy dev stacks
```

Order (handled by stack dependencies): network → Cognito → ECR/backend service + ALB → S3/CloudFront SPA → CloudWatch dashboard. Build and push the backend container to ECR as part of deploy; build and upload the SPA to S3 and invalidate CloudFront.

## Destroying the environment

```bash
cd infra
cdk destroy --all --context env=dev
```

Empty the SPA S3 bucket first if `autoDeleteObjects` is not enabled. Confirm the ECR repository, log groups, and Cognito pool are removed (or retained intentionally). Destroying stops the always-on Fargate cost.

## Estimated costs

Planning estimates (verify current pricing first — see `docs/cost-analysis.md`):

- **Development (10 users/day)**: ~$50–$80/month (mostly the always-on Fargate/ALB floor).
- **Small pilot (100 users/day)**: ~$140–$170/month.
- **Larger pilot (1,000 users/day)**: ~$1,100–$1,200/month (voice-dominated).

Main driver is Nova 2 Sonic voice minutes (~$0.015/min planning anchor). The WebGL avatar adds **$0**; a managed video avatar would add roughly 13× the voice cost.

## Known limitations (Phase 0)

- Single, static agent (no multi-agent, no KB/RAG, no tools/MCP).
- Stylized WebGL avatar, not photoreal; lip-sync is audio-amplitude/viseme-estimated, not phoneme-perfect.
- Nova Sonic streams cap around ~8 minutes; long sessions require reconnect handling.
- Latency numbers in the docs are estimates until measured in your region.
- Pricing figures must be re-verified against official AWS pages before any budget commitment.
- Region availability for Nova 2 Sonic must be confirmed before deployment.

## Attribution

External facts were verified against AWS documentation, AWS blogs/solution samples, and vendor pages, with inline links in the `docs/`. Content was rephrased for compliance with licensing restrictions.

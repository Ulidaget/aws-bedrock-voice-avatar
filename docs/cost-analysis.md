# Phase 0 — Cost Analysis

> Prices change and must be re-verified on official pages before budgeting. The numbers below are **planning estimates** with explicit assumptions, not quotes. Verify against the [AWS Nova pricing page](https://aws.amazon.com/nova/pricing/), [Amazon Bedrock pricing](https://aws.amazon.com/bedrock/pricing/), and the pricing pages for Fargate, CloudFront, S3, Cognito, and CloudWatch in your target region.

Content was rephrased for compliance with licensing restrictions.

---

## 1. Main cost drivers (ranked)

1. **Conversational voice model (Nova 2 Sonic)** — by far the dominant driver; scales with minutes of conversation.
2. **Backend compute (Fargate)** — an always-on task; fixed monthly floor regardless of traffic.
3. **Avatar** — **$0** in the recommended WebGL design (client-side render). Would become a top driver if a managed video provider were chosen (~$0.10–$0.37/min per [Forasoft](https://www.forasoft.com/blog/article/interactive-ai-avatar-development)).
4. Everything else (CloudFront, S3, Cognito, CloudWatch, data transfer, ALB) — small at POC scale.

## 2. Key pricing signals (verify before use)

- **Nova 2 Sonic**: reported around **$3 per million speech-input tokens** and **$12 per million speech-output tokens** (~$0.003 / $0.012 per 1K), with a rough estimate near **$0.015 per minute** of conversation ([summary](https://rywalker.com/research/aws-nova-2-sonic), [llm-stats](https://llm-stats.com/models/nova-2-sonic)). Text tokens are billed separately at lower rates. **Treat ~$0.015/min as the planning anchor and confirm officially.**
- **Fargate**: billed per vCPU-second and GB-second while a task runs. A single small always-on task (e.g., 0.5 vCPU / 1 GB) is a low but non-zero fixed monthly cost.
- **ALB**: hourly + LCU charges — small but a fixed floor.
- **CloudFront / S3**: static SPA hosting is cents-scale at POC traffic.
- **Cognito**: has a monthly active user free tier; POC user counts are typically within or near it.
- **CloudWatch**: metrics/logs/dashboard are cents-scale at POC volume.

## 3. Assumptions for scenarios

- Average conversation length: **3 minutes** of active audio per user session.
- Voice cost anchor: **$0.015 / minute** (Nova 2 Sonic, planning estimate).
- One always-on Fargate task; fixed infra (Fargate + ALB + CloudFront + S3 + CloudWatch) modeled as a **~$40–$70/month floor** (region-dependent; verify).
- 22 working days/month for "users/day" scenarios.
- Avatar = WebGL = $0 incremental.

Voice cost per session ≈ 3 min × $0.015 = **~$0.045/session**.

## 4. Scenarios

### Development — 10 users/day
- Sessions/month ≈ 10 × 22 = 220 → voice ≈ 220 × $0.045 ≈ **$10/month**.
- Plus fixed floor ~$40–$70.
- **Total ≈ $50–$80/month**, dominated by the always-on Fargate floor, not usage.

### Small pilot — 100 users/day
- Sessions/month ≈ 100 × 22 = 2,200 → voice ≈ **$99/month**.
- Plus fixed floor ~$40–$70 (may nudge up slightly with traffic).
- **Total ≈ $140–$170/month**.

### Larger pilot — 1,000 users/day
- Sessions/month ≈ 1,000 × 22 = 22,000 → voice ≈ **$990/month**.
- Fixed floor grows modestly (possibly a second Fargate task / more LCUs / more CloudWatch) → ~$100–$200.
- **Total ≈ $1,100–$1,200/month**, now clearly voice-dominated.

### Sensitivity: if a managed video avatar were used instead
- At ~$0.20/min × 3 min = **$0.60/session** — roughly **13× the voice cost**. At the larger pilot that adds **~$13,200/month**. This is the single biggest reason Phase 0 chooses a WebGL avatar.

## 5. Cost controls

- Cap session length (Nova Sonic's ~8-min stream also bounds this) and concurrent sessions per user.
- Scale Fargate to zero/one outside pilot hours where acceptable.
- CloudWatch billing alarms + AWS Budgets on Bedrock spend.
- Pin a single region to avoid cross-region data transfer.
- Keep the avatar client-side to hold avatar cost at $0.

## 6. What is NOT costed here (out of Phase 0 scope)

Knowledge Bases / vector store, document ingestion, MCP/tool Lambdas, multi-agent infra, analytics dashboards, and multi-tenancy. These will add cost in later phases and should be re-estimated then.

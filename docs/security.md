# Phase 0 — Security Model

> Hard rule: **never expose long-lived AWS access keys in the browser** and **never hard-code secrets**. All infrastructure is created via IaC, never by hand.

---

## 1. Identity and authentication

- **Amazon Cognito User Pool** is the identity provider. Users authenticate via the Cognito Hosted UI (or Amplify Auth) and receive short-lived JWTs (ID + access tokens).
- The browser sends the JWT when opening the WebSocket to the backend.
- The **Fargate backend validates the JWT** against the User Pool JWKS (issuer, audience, expiry, signature) before starting any Bedrock stream. Invalid/expired tokens are rejected at connect time.
- An **Identity Pool is included only if** the browser ever needs scoped temporary AWS credentials. In the recommended backend-proxy design the browser calls Bedrock through our backend, so the browser needs **no AWS credentials at all** — this is the safer default.

## 2. AWS credentials and IAM

- The browser holds **zero** AWS credentials.
- The Fargate **task role** has a least-privilege policy allowing only `bedrock:InvokeModelWithBidirectionalStream` (and `bedrock:InvokeModel` if needed) on the specific Nova 2 Sonic model ARN, scoped to the deployment region.
- Separate execution role for pulling the ECR image and writing CloudWatch logs.
- No IAM users with static keys. CI/CD uses OIDC-federated roles, not stored keys.

## 3. API / WebSocket authorization

- WebSocket upgrade requires a valid Cognito JWT; connections without one are refused.
- The backend enforces per-connection session ownership (a connection can only drive its own session).
- Enforce Nova Sonic's ~8-minute stream limit gracefully with reconnect; cap concurrent sessions per user to limit abuse.

## 4. Network and transport

- All traffic is **TLS**: WSS from browser through CloudFront/ALB; SigV4-over-TLS from backend to Bedrock (internal to AWS).
- CloudFront in front of the SPA; S3 bucket is private with Origin Access Control (no public bucket).
- Fargate tasks run in private subnets; only the ALB is internet-facing. Security groups restrict ALB→task traffic to the WS port.

## 5. CORS

- The SPA origin (CloudFront domain / custom domain) is the only allowed origin for the API/WebSocket and for Cognito app-client callback URLs.
- No wildcard `*` origins in production stages.

## 6. Rate limiting and abuse control

- ALB + application-level connection limits per authenticated user.
- Optional AWS WAF on CloudFront/ALB for basic rate-based rules.
- Session length and concurrency caps (above) also bound Bedrock spend from a single account.

## 7. Audio and conversation data privacy

- Phase 0 does **not** persist raw audio. Audio is streamed and discarded after the turn.
- If transcripts/conversation history are stored later, store them encrypted (DynamoDB/S3 with KMS) and scoped to the user; define retention. Not in Phase 0 scope beyond in-memory session history.
- Never log raw audio or full transcripts to CloudWatch. Logs carry metadata only (timings, event types, error codes, session id, user sub).

## 8. Secrets management

- No secrets in the frontend bundle. Cognito app-client public IDs are not secrets; client **secrets** (if any) live only server-side.
- Any backend secret (rare in Phase 0) goes in AWS Secrets Manager or SSM Parameter Store (SecureString), injected as env at runtime — never committed.
- `.env` files are git-ignored; only `.env.example` with placeholder keys is committed.

## 9. Logging and auditing

- CloudTrail records Bedrock and IAM API calls at the account level.
- CloudWatch Logs for backend structured logs (metadata only).
- CloudWatch alarms on auth failures and error spikes.

## 10. PII considerations

- Speech is inherently personal data. Treat audio as sensitive: transient handling, no persistence in Phase 0, TLS end to end, region pinned for data residency.
- Reference by identifier (Cognito `sub`) rather than by name/email in logs.
- Document a data-flow note for compliance review before any pilot with real users.

## 11. Security checklist for Phase 0

- [ ] Browser holds no AWS keys.
- [ ] JWT validated server-side before Bedrock stream opens.
- [ ] Task role limited to the one Nova 2 Sonic model ARN.
- [ ] S3 private + CloudFront OAC; tasks in private subnets.
- [ ] TLS everywhere; CORS locked to the SPA origin.
- [ ] No raw audio/transcripts in logs; no secrets in the bundle.
- [ ] Session length + concurrency caps enforced.
- [ ] All resources created by CDK, none by hand.

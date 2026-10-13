# Deploy to AWS (Option 2: deploy / destroy on demand)

This deploys the whole POC to AWS. When you're done demoing, `cdk destroy`
tears it all down so you stop paying. Expect **15-25 min** per deploy/destroy.

## Architecture when deployed

```
Browser (HTTPS)
   |
   v
CloudFront distribution  ── default behavior ──► S3 (private, OAC)  = the SPA
   |                      ── /session, /ws ─────► ALB ► Fargate (voice proxy)
   |                                                      |
   |                                                      v
   |                                        Bedrock Nova 2 Sonic (bidi stream)
Cognito (Hosted UI)  ◄── login redirect ── SPA
```

CloudFront fronts BOTH the SPA and the WebSocket, so the browser talks `wss://`
on the same HTTPS origin (no mixed-content, no custom domain / ACM needed).

## Prerequisites (one time)

1. AWS credentials configured (`aws sts get-caller-identity` works).
2. Nova 2 Sonic model access enabled in your region (already confirmed for
   `us-east-1`, account 034362033822).
3. Docker Desktop running (CDK builds the backend image during deploy).
4. CDK bootstrapped in the account/region (one time):
   ```
   cd infra
   node node_modules\aws-cdk\bin\cdk bootstrap --context env=dev
   ```

## Deploy

```powershell
# 1. Build the SPA so CloudFront has something to serve.
cd frontend
npm.cmd run build

# 2. Deploy all stacks.
cd ..\infra
node node_modules\aws-cdk\bin\cdk deploy --all --context env=dev --require-approval never
```

When it finishes, CDK prints outputs. Note:
- `Phase0-dev-Frontend.SpaUrl`  → open this in the browser.
- `Phase0-dev-Frontend.WssEndpoint` → the wss:// URL (already baked into config.json).

> Windows note: `cdk` is invoked via `node node_modules\aws-cdk\bin\cdk` because
> npm script shims may be blocked by PowerShell execution policy. `npx cdk` also
> works if your policy allows it.

## Create a demo user (Cognito)

Sign-up is disabled (admin-created users only). Create one:

```powershell
# Get the User Pool Id from the deploy outputs (Phase0-dev-Auth.UserPoolId), then:
aws cognito-idp admin-create-user ^
  --user-pool-id <USER_POOL_ID> ^
  --username demo@example.com ^
  --user-attributes Name=email,Value=demo@example.com Name=email_verified,Value=true ^
  --message-action SUPPRESS

# Set a permanent password:
aws cognito-idp admin-set-user-password ^
  --user-pool-id <USER_POOL_ID> ^
  --username demo@example.com ^
  --password "YourStrongPassw0rd!" ^
  --permanent
```

Then open `SpaUrl`, click **Sign in**, log in with those credentials, and start
the conversation.

## Destroy (stop paying)

```powershell
cd infra
node node_modules\aws-cdk\bin\cdk destroy --all --context env=dev --force
```

In `dev` this removes the S3 bucket (auto-emptied), CloudFront, ALB, Fargate,
VPC/NAT, and the Cognito pool. Verify in the console afterwards that nothing
lingers (CloudWatch log groups are set to auto-delete in dev).

## Cost while deployed

Roughly **$40-70/month prorated** while it's up (NAT ~$33/mo + ALB ~$16/mo +
Fargate ~$29/mo, all prorated hourly) plus Nova Sonic voice minutes (~$0.015/min).
Destroying stops all of it except any residual S3/logs.

## Troubleshooting

- **Login loops / redirect mismatch**: the Cognito callback URL must equal the
  CloudFront `SpaUrl`. It's wired automatically; if you use a custom domain,
  update the app client callback URLs.
- **WebSocket won't connect**: confirm the Fargate service is `RUNNING` (ECS
  console) and the CloudFront `/session*` behavior points at the ALB.
- **403 from Bedrock**: check the task role has Nova Sonic invoke permission and
  the region matches where the model is enabled.
- **CloudFront still serving old SPA**: deploys invalidate `/*`, but give it a
  few minutes to propagate, or hard-refresh.

# Phase 0 — Deployment Notes & Lessons Learned

A chronological log of the real obstacles hit while building and deploying Phase 0,
and how each was resolved. Useful for anyone re-deploying or extending the project.

## Environment quirks (Windows + OneDrive)

- **PowerShell execution policy blocks npm shims.** Call `npm.cmd` (not `npm`) or
  invoke tools by path, e.g. `node node_modules\aws-cdk\bin\cdk`.
- **The project lives under a OneDrive path with spaces and parentheses.** `tsc`
  and `cdk synth` are very slow there due to synced I/O; `ripgrep`/grep may skip
  `node_modules`. Prefer redirecting command output to a file and reading it.
- **`cdk synth` needs Docker** for the backend asset bundle. If Docker Desktop
  isn't fully up, synth hangs. To validate templates without Docker, set
  `CDK_DOCKER=echo` before `cdk synth`.

## Runtime bugs fixed (backend)

1. **websockets handler signature.** `websockets>=14` calls the handler with only
   the connection (`handle_connection(ws)`); the path/headers come from
   `ws.request`. The old `(ws, path)` signature raised `TypeError: missing 1
   required positional argument: 'path'`.
2. **Nova Sonic SDK 0.11 API.** The client is `AsyncBedrockRuntimeClient`, built
   from `await AsyncBedrockRuntimeConfig.resolve(region=..., transport=...)`;
   the stream is `await client.invoke_model_with_bidirectional_stream(input=...)`
   and output is read via `output, stream = await duplex.await_output()` then
   `async for event in stream`. The older `BedrockRuntimeClient` / manual `Config`
   from the AWS example no longer exist.
3. **Duplex transport.** Bidirectional streaming requires the CRT transport
   (`AWSCRTHTTPClient` + `awscrt`); the default aiohttp transport raises
   `UnsupportedTransportError`. (ADR-012)
4. **Double audio.** Two causes: (a) React StrictMode double-mounted and opened two
   WebSockets — removed StrictMode and guarded `VoiceClient.connect()`; (b) the
   audio player's `flush()` only lowered gain instead of stopping scheduled
   `AudioBufferSourceNode`s — it now tracks and truly stops sources. Also, do NOT
   flush on every SPEAKING→LISTENING transition (the model splits a reply into
   several audio blocks and briefly returns to LISTENING between them) — flush only
   on a real barge-in (INTERRUPTED).
5. **Duplicate transcript.** Nova Sonic emits assistant text twice (SPECULATIVE and
   FINAL stages); the backend now drops the SPECULATIVE copy.

## Deployment bugs fixed (AWS)

6. **Invalid AWS credentials.** The pre-existing `~/.aws` access key was inactive
   (`InvalidClientTokenId`); replaced with a valid one. Also, an empty
   `AWS_SESSION_TOKEN` in the generated `.env` broke SigV4 with
   `UnrecognizedClientException` — only write the token when the profile actually
   has one; switched docker-compose to `env_file`.
7. **ALB health check failing → exitCode 137.** First the health endpoint was on
   an unreachable port (8081 without SG/mapping); then moving it into the
   websockets `process_request` on 8080 caused `Target.Timeout`. Final fix: a
   dedicated `http.server` on 8081 + explicit SG ingress for 8081 from the ALB +
   `healthCheckGracePeriod` 120s. (ADR-011)
8. **CDK dependency cycle.** `userPool.addClient()` in the FrontendStack attached
   the client to the pool (AuthStack), creating Auth↔Frontend cycle. Fixed by
   creating a standalone `UserPoolClient` in the FrontendStack. (ADR-014)
9. **Auth `at_hash` rejection.** `python-jose` rejected the Cognito id_token with
   "No access_token provided to compare against at_hash claim." Fixed with
   `options={"verify_at_hash": False}` (we only validate the id_token). (ADR-014)
10. **Fargate couldn't get the task role.** Missing `aws-credentials-http` meant the
    smithy chain couldn't read the container credentials; Bedrock calls failed and
    the session closed silently. Adding the package fixed it. (ADR-013)

## Stuck-stack recovery

- A failed Backend deploy can leave the stack in `CREATE_IN_PROGRESS`, which blocks
  updates. `cancel-update-stack` does NOT apply to a CREATE. Use
  `aws cloudformation delete-stack --stack-name Phase0-dev-Backend` to abort/clean
  it, wait until `describe-stacks` reports it no longer exists, then redeploy.
- You can redeploy a single stack (`cdk deploy Phase0-dev-Backend`) without
  touching Network/Auth — much faster than a full destroy/deploy.

## Useful diagnostic commands

```powershell
# Which stacks / status
aws cloudformation describe-stacks --stack-name Phase0-dev-Backend --region us-east-1 --query "Stacks[0].StackStatus"

# Target health (get ARN first, then health)
aws elbv2 describe-target-groups --region us-east-1 --query "TargetGroups[?contains(TargetGroupName,'Phase0')].TargetGroupArn" --output text
aws elbv2 describe-target-health --region us-east-1 --target-group-arn <ARN> --query "TargetHealthDescriptions[].TargetHealth"

# Task stop reason (if tasks are dying)
aws ecs list-tasks --region us-east-1 --cluster <CLUSTER> --desired-status STOPPED
aws ecs describe-tasks --region us-east-1 --cluster <CLUSTER> --tasks <ID> --query "tasks[0].{stopCode:stopCode,stoppedReason:stoppedReason,exitCode:containers[0].exitCode}"

# Backend logs (find the log group name first)
aws logs describe-log-groups --region us-east-1 --query "logGroups[?contains(logGroupName,'ServiceLogs')].logGroupName" --output text
aws logs tail <LOG_GROUP> --region us-east-1 --since 10m

# Security group ingress (confirm 8081 is open for health)
aws ec2 describe-security-groups --region us-east-1 --filters "Name=group-name,Values=*VoiceProxy*" --query "SecurityGroups[].IpPermissions[].{from:FromPort,to:ToPort}"
```

## Cost reminder

Option 2 (deploy/destroy on demand). Destroy when done to stop the ~$40-70/month
floor (NAT + ALB + Fargate):

```
node node_modules\aws-cdk\bin\cdk destroy --all --context env=dev --force
```

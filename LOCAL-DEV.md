# Local Development

Run the whole POC on your machine against real Amazon Bedrock (Nova 2 Sonic).
No AWS infra needed for local dev — only Bedrock model access.

## 0. Prerequisites
- Node.js LTS, Python 3.12, Docker (optional, for the backend container).
- AWS credentials with Bedrock access and **Nova 2 Sonic model access enabled**
  in your region. Export them in your shell:
  ```powershell
  $env:AWS_ACCESS_KEY_ID = "..."
  $env:AWS_SECRET_ACCESS_KEY = "..."
  $env:AWS_SESSION_TOKEN = "..."   # if using temporary creds
  $env:AWS_REGION = "us-east-1"
  ```

## 1. Backend (voice proxy)

Option A — One command (recommended, Windows):
```powershell
.\start-local.cmd
```
This reads your AWS CLI credentials, writes a git-ignored `.env`, verifies the
credentials, and runs `docker compose up --build`. Leave it running.

Option B — Docker manually:
```powershell
# export your AWS creds into the shell first, then:
docker compose up --build
```

Option B — Python directly:
```powershell
cd backend
python -m venv .venv; .\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env    # AUTH_DISABLED=true for local
python -m app.main
```
Backend listens on `ws://localhost:8080/session` (health on `:8081/health`).

> Windows note: if PowerShell blocks npm scripts, call `npm.cmd` instead of `npm`,
> or run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.

## 2. Frontend (SPA)
```powershell
cd frontend
Copy-Item .env.example .env     # VITE_AUTH_DISABLED=true, VITE_WSS_ENDPOINT=ws://localhost:8080/session
npm.cmd install
npm.cmd run dev
```
Open http://localhost:5173, click **Start conversation**, allow the microphone,
and speak. Talk over the assistant to test barge-in.

## 3. What "auth disabled" means locally
Both `AUTH_DISABLED=true` (backend) and `VITE_AUTH_DISABLED=true` (frontend) skip
Cognito so you can iterate without a User Pool. **Never** enable these in a
deployed environment — the CDK backend stack sets `AUTH_DISABLED=false`.

## 4. Troubleshooting
- No audio out: browsers require a user gesture before audio; the Start button
  handles this. Check the tab isn't muted.
- Mic denied: allow microphone for localhost in the browser site settings.
- Bedrock AccessDenied: confirm Nova 2 Sonic access is enabled and the region matches.
- Nothing happens on Start: check the backend logs for the Bedrock stream open.

@echo off
REM ---------------------------------------------------------------------------
REM run-local.cmd — run the voice proxy backend WITHOUT Docker (Python venv).
REM
REM   1. Creates/uses a .venv and installs requirements (first run only).
REM   2. Exports your AWS CLI credentials into the process environment
REM      (the Nova Sonic SDK reads creds from env vars).
REM   3. Starts the WebSocket server on ws://localhost:8080/session.
REM ---------------------------------------------------------------------------
setlocal
cd /d "%~dp0"

if not exist .venv (
  echo Creating virtual environment...
  python -m venv .venv
)
call .venv\Scripts\activate.bat

echo Installing dependencies (first run may take a few minutes)...
python -m pip install --quiet --upgrade pip
python -m pip install --quiet -r requirements.txt
if errorlevel 1 (
  echo ERROR: dependency install failed.
  exit /b 1
)

echo Loading AWS credentials from CLI profile...
for /f "delims=" %%i in ('aws configure get aws_access_key_id') do set AWS_ACCESS_KEY_ID=%%i
for /f "delims=" %%i in ('aws configure get aws_secret_access_key') do set AWS_SECRET_ACCESS_KEY=%%i
for /f "delims=" %%i in ('aws configure get aws_session_token') do set AWS_SESSION_TOKEN=%%i
for /f "delims=" %%i in ('aws configure get region') do set AWS_REGION=%%i
if "%AWS_REGION%"=="" set AWS_REGION=us-east-1

if "%AWS_ACCESS_KEY_ID%"=="" (
  echo ERROR: no AWS credentials found. Run `aws configure` first.
  exit /b 1
)

REM Local dev settings
set AUTH_DISABLED=true
set BEDROCK_MODEL_ID=amazon.nova-2-sonic-v1:0
set PORT=8080
set HOST=0.0.0.0
set ALLOWED_ORIGIN=http://localhost:5173
set MAX_SESSION_SECONDS=450

echo Starting voice proxy on ws://localhost:8080/session (Ctrl+C to stop)...
python -m app.main
endlocal

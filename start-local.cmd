@echo off
REM ---------------------------------------------------------------------------
REM start-local.cmd — brings up the backend voice proxy for LOCAL testing.
REM
REM What it does:
REM   1. Reads your AWS credentials from the configured CLI profile (default).
REM   2. Writes them to a local .env file that docker-compose injects into the
REM      backend container (the Nova Sonic SDK reads creds from env vars).
REM   3. Starts the backend with `docker compose up --build`.
REM
REM The generated .env is git-ignored. Delete it when you're done.
REM Frontend runs separately:  cd frontend & npm.cmd run dev
REM ---------------------------------------------------------------------------
setlocal
cd /d "%~dp0"

echo Reading AWS credentials from CLI profile...
for /f "delims=" %%i in ('aws configure get aws_access_key_id') do set AK=%%i
for /f "delims=" %%i in ('aws configure get aws_secret_access_key') do set SK=%%i
for /f "delims=" %%i in ('aws configure get aws_session_token') do set ST=%%i
for /f "delims=" %%i in ('aws configure get region') do set RG=%%i
if "%RG%"=="" set RG=us-east-1

if "%AK%"=="" (
  echo ERROR: No AWS access key found. Run `aws configure` first.
  exit /b 1
)

echo Writing .env for docker-compose...
> .env echo AWS_ACCESS_KEY_ID=%AK%
>> .env echo AWS_SECRET_ACCESS_KEY=%SK%
>> .env echo AWS_REGION=%RG%
REM Only write a session token when the profile actually has one. An empty or
REM stale token causes AWS to reject requests with UnrecognizedClientException.
if not "%ST%"=="" (
  >> .env echo AWS_SESSION_TOKEN=%ST%
)

echo Verifying credentials...
aws sts get-caller-identity
if errorlevel 1 (
  echo ERROR: credentials are invalid. Fix them and retry.
  exit /b 1
)

echo Starting backend (docker compose up --build)...
docker compose up --build
endlocal

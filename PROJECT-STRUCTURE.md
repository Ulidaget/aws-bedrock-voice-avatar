# Project Structure

```
phase0-voice-avatar-poc/
├── README.md                 High-level overview, deploy, destroy, costs
├── PROJECT-STRUCTURE.md      This file
├── .gitignore
├── docs/                     Research + architecture proposal (Phase 0)
├── diagrams/                 Mermaid diagrams
│
├── backend/                  Python WebSocket voice proxy (Fargate)
│   ├── app/
│   │   ├── main.py               WebSocket server entrypoint
│   │   ├── config.py             Env-driven settings
│   │   ├── auth.py               Cognito JWT validation
│   │   ├── session.py            Per-connection session lifecycle
│   │   ├── observability.py      Structured logging + metrics
│   │   ├── agent/
│   │   │   ├── agent_config.py    AgentConfig (static in Phase 0)
│   │   │   └── tool_registry.py   ToolRegistry (empty in Phase 0)
│   │   └── voice/
│   │       ├── base.py            VoiceProvider interface
│   │       └── nova_sonic.py      Nova 2 Sonic implementation
│   ├── requirements.txt
│   ├── Dockerfile
│   └── .env.example
│
├── frontend/                 Vite + React SPA
│   ├── index.html
│   ├── package.json
│   ├── tsconfig.json
│   ├── vite.config.ts
│   ├── .env.example
│   └── src/
│       ├── main.tsx
│       ├── App.tsx
│       ├── config.ts
│       ├── auth/                  Cognito auth client
│       ├── voice/                 Mic capture, WS client, state machine
│       ├── avatar/                AvatarController + WebGL avatar
│       └── ui/                    React components
│
└── infra/                    AWS CDK (TypeScript)
    ├── package.json
    ├── tsconfig.json
    ├── cdk.json
    ├── bin/app.ts
    └── lib/
        ├── network-stack.ts
        ├── auth-stack.ts
        ├── backend-stack.ts
        ├── frontend-stack.ts
        └── observability-stack.ts
```

## Language choices
- **Backend: Python** — matches the existing repo stack and AWS Nova Sonic bidirectional-stream samples.
- **Frontend: TypeScript (Vite + React)**.
- **Infra: TypeScript (AWS CDK v2)**.

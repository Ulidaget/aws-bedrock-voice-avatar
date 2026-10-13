# Component Diagram — Phase 0

Logical components and the four replaceable interfaces.

```mermaid
flowchart TB
    subgraph FE["Frontend (Vite + React SPA)"]
        UI["Conversation UI\n(text + voice modes)"]
        AUDIO["Audio I/O\n(capture PCM / playback)"]
        VSM["Voice State Machine"]
        AVI["AvatarController «interface»"]
        AVIMPL["WebGL avatar impl\n(Three.js + RPM / TalkingHead)"]
        WSCLIENT["WebSocket client"]
        AUTHC["Auth client (Cognito)"]
    end

    subgraph BE["Backend (Fargate WS proxy)"]
        WSSRV["WebSocket server"]
        JWTV["JWT validator"]
        VP["VoiceProvider «interface»"]
        VPIMPL["Nova 2 Sonic impl\n(bidirectional stream)"]
        AC["AgentConfig «interface»\n(static: name, prompt, model, voice)"]
        TR["ToolRegistry «interface»\n(empty in Phase 0)"]
        MET["Metrics/Logging emitter"]
    end

    subgraph AWS["AWS Managed"]
        COG["Cognito User Pool"]
        BED["Bedrock Nova 2 Sonic"]
        CWX["CloudWatch"]
    end

    UI --> AUDIO
    UI --> VSM
    VSM --> AVI --> AVIMPL
    AUDIO --> AVIMPL
    UI --> WSCLIENT
    AUTHC --> COG
    WSCLIENT -->|WSS + JWT| WSSRV

    WSSRV --> JWTV --> COG
    WSSRV --> VP --> VPIMPL --> BED
    VP --> AC
    VP --> TR
    WSSRV --> MET --> CWX

    classDef iface fill:#eef,stroke:#66f,stroke-width:1px;
    class AVI,VP,AC,TR iface
```

Replaceable seams (blue = interface):
- **VoiceProvider** — swap Nova 2 Sonic for a STT+LLM+TTS pipeline or another vendor.
- **AgentConfig** — swap the static config for per-agent records (future multi-agent + KB + tools).
- **AvatarController** — swap WebGL for a managed video avatar provider.
- **ToolRegistry** — plug in Lambda / MCP / AgentCore tools later.
```

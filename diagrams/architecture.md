# Architecture Diagram — Phase 0 (Voice + Avatar POC)

Recommended Architecture A: AWS-native speech-to-speech + WebGL avatar.

```mermaid
flowchart LR
    subgraph Browser["Browser (Vite + React SPA)"]
        MIC["Mic capture\n(getUserMedia + WebAudio, PCM)"]
        WSC["WebSocket client"]
        PLAY["Audio playback"]
        AV["WebGL avatar\n(Three.js / RPM / TalkingHead)\naudio-driven lip-sync"]
        SM["Voice state machine\nIDLE/LISTENING/PROCESSING/\nSPEAKING/INTERRUPTED/ERROR"]
    end

    subgraph Edge["AWS Edge / Hosting"]
        CF["CloudFront"]
        S3["S3 (private, OAC)\nSPA static assets"]
    end

    subgraph Auth["Amazon Cognito"]
        UP["User Pool + Hosted UI\n(JWT)"]
    end

    subgraph AWSVPC["AWS VPC"]
        ALB["Application Load Balancer\n(TLS, WSS)"]
        FG["Fargate (ECS) service\nWebSocket proxy\nJWT validation\nVoiceProvider + AgentConfig\nToolRegistry (empty)"]
    end

    BR2["Amazon Bedrock\nNova 2 Sonic\nInvokeModelWithBidirectionalStream"]
    CW["Amazon CloudWatch\nmetrics / logs / alarms"]
    ECR["Amazon ECR\ncontainer image"]

    S3 --- CF
    CF -->|serve SPA| Browser
    Browser -->|login| UP
    UP -->|JWT| Browser

    MIC --> WSC
    WSC -->|WSS + JWT, PCM audio up| CF
    CF --> ALB --> FG
    FG -->|validate JWT| UP
    FG <-->|bidirectional audio + events| BR2
    FG -->|audio + state events down| ALB --> CF --> WSC
    WSC --> PLAY
    WSC --> SM --> AV
    PLAY --> AV

    FG --> CW
    ECR --> FG
```

Notes:
- Browser holds **no AWS credentials**; the Fargate task role calls Bedrock.
- Avatar is driven by the same audio + state events, so it can be swapped without touching voice logic.
- `ToolRegistry` and per-agent `AgentConfig` are present as seams but empty/static in Phase 0.

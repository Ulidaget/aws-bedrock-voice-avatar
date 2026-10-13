# Voice Sequence Diagram — Phase 0

End-to-end conversational turn, including barge-in.

```mermaid
sequenceDiagram
    actor User
    participant Br as Browser (SPA + Avatar)
    participant Cog as Cognito
    participant FG as Fargate WS Proxy
    participant NS as Bedrock Nova 2 Sonic
    participant CW as CloudWatch

    User->>Br: Open app
    Br->>Cog: Login (Hosted UI)
    Cog-->>Br: JWT
    Br->>FG: Open WSS (JWT)
    FG->>Cog: Validate JWT (JWKS)
    Cog-->>FG: OK
    FG->>NS: Open bidirectional stream (agent config, voice id)
    FG-->>Br: Session ready (state: IDLE)

    User->>Br: Speaks 🎤
    Br->>Br: State -> LISTENING (avatar listening)
    loop streaming PCM
        Br->>FG: audio chunk up
        FG->>NS: audio chunk up
    end

    NS-->>FG: user turn end / thinking
    FG-->>Br: state: PROCESSING (avatar thinking)

    NS-->>FG: audio chunk down (start)
    FG-->>Br: state: SPEAKING + first audio
    Br->>CW: metric TimeToFirstAudio
    loop streaming audio down
        NS-->>FG: audio chunk
        FG-->>Br: audio chunk
        Br->>Br: play + lip-sync (avatar talking)
    end

    Note over User,Br: Barge-in
    User->>Br: Speaks over agent 🎤
    Br->>FG: audio up (during SPEAKING)
    FG->>NS: audio up
    NS-->>FG: interrupt
    FG-->>Br: state: INTERRUPTED
    Br->>Br: stop playback, avatar stops talking -> LISTENING
    Br->>CW: metric Interruptions++

    NS-->>FG: response complete
    FG-->>Br: state: IDLE
    FG->>CW: metrics EndToEndTurnLatency, TurnsPerSession
```

```text
User
 ↓ speaks
Browser (mic capture, PCM)
 ↓ WSS
Voice layer (Fargate proxy → Nova 2 Sonic bidirectional stream)
 ↓
AI Agent (Nova 2 Sonic: understand + generate)
 ↓ audio + events
Voice response (streamed audio back through proxy)
 ↓
Avatar (state machine: listening → thinking → speaking + lip-sync → idle)
```

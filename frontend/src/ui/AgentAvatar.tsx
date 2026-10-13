import { VoiceStateName } from "../config";

interface Props {
  state: VoiceStateName;
  amplitude: number;
}

const STATE_COLOR: Record<VoiceStateName, string> = {
  IDLE: "#475569",
  LISTENING: "#22c55e",
  PROCESSING: "#f59e0b",
  SPEAKING: "#3b82f6",
  INTERRUPTED: "#ef4444",
  ERROR: "#dc2626",
};

export function AgentAvatar({ state, amplitude: _amplitude }: Props) {
  const color = STATE_COLOR[state];
  const isActive = state !== "IDLE" && state !== "ERROR";
  const isSpeaking = state === "SPEAKING";
  const isListening = state === "LISTENING";

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: "100%" }}>
      <style>{`
        @keyframes ag-pulse { 0% { opacity: 0.7; transform: scale(1); } 100% { opacity: 0; transform: scale(1.4); } }
        @keyframes ag-wave  { 0%,100% { height: 5px; } 50% { height: 28px; } }
      `}</style>

      {/* Avatar container */}
      <div style={{ position: "relative", width: 240, height: 240 }}>
        {/* Animated glow ring */}
        {isActive && (
          <div style={{
            position: "absolute",
            inset: -14,
            borderRadius: "50%",
            border: `3px solid ${color}`,
            animation: "ag-pulse 1.8s ease-out infinite",
            pointerEvents: "none",
          }} />
        )}

        <svg
          viewBox="0 0 240 240"
          style={{
            width: 240,
            height: 240,
            filter: isActive ? `drop-shadow(0 0 14px ${color}55)` : "none",
            transition: "filter 0.4s",
          }}
        >
          <defs>
            <clipPath id="ag-hex">
              <polygon points="120,4 226,62 226,178 120,236 14,178 14,62" />
            </clipPath>
            <linearGradient id="ag-bg" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#1a3660" />
              <stop offset="100%" stopColor="#0b1d3a" />
            </linearGradient>
            <linearGradient id="ag-shirt" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#1e4a8a" />
              <stop offset="100%" stopColor="#0d2d5c" />
            </linearGradient>
          </defs>

          {/* Hex border */}
          <polygon
            points="120,4 226,62 226,178 120,236 14,178 14,62"
            fill="url(#ag-bg)"
            stroke={color}
            strokeWidth="3.5"
            style={{ transition: "stroke 0.4s" }}
          />

          <g clipPath="url(#ag-hex)">
            <rect width="240" height="240" fill="url(#ag-bg)" />

            {/* Body / shirt */}
            <path d="M0,270 Q0,175 120,158 Q240,175 240,270Z" fill="url(#ag-shirt)" />

            {/* Collar */}
            <path d="M102,158 L120,178 L138,158 L128,152 L120,164 L112,152Z" fill="#e8c9a8" />

            {/* Neck */}
            <rect x="106" y="136" width="28" height="24" rx="7" fill="#d4956a" />

            {/* Head */}
            <ellipse cx="120" cy="104" rx="46" ry="48" fill="#e8b98a" />

            {/* Hair */}
            <path d="M74,100 Q74,54 120,52 Q166,54 166,100 Q166,68 120,65 Q74,68 74,100Z" fill="#3b2010" />
            <path d="M74,100 Q72,116 76,126 Q74,106 74,100Z" fill="#3b2010" />
            <path d="M166,100 Q168,116 164,126 Q166,106 166,100Z" fill="#3b2010" />

            {/* Eyebrows */}
            <path d="M95,88 Q104,84 112,87" fill="none" stroke="#3b2010" strokeWidth="2.5" strokeLinecap="round" />
            <path d="M128,87 Q136,84 145,88" fill="none" stroke="#3b2010" strokeWidth="2.5" strokeLinecap="round" />

            {/* Eyes whites */}
            <ellipse cx="104" cy="99" rx="8" ry="9" fill="white" />
            <ellipse cx="136" cy="99" rx="8" ry="9" fill="white" />
            {/* Irises */}
            <ellipse cx="105" cy="100" rx="5" ry="6" fill="#2d1a0a" />
            <ellipse cx="137" cy="100" rx="5" ry="6" fill="#2d1a0a" />
            {/* Highlight */}
            <circle cx="107" cy="98" r="1.8" fill="white" />
            <circle cx="139" cy="98" r="1.8" fill="white" />

            {/* Nose */}
            <path d="M117,110 Q120,116 123,110" fill="none" stroke="#c07850" strokeWidth="2" strokeLinecap="round" />

            {/* Mouth */}
            <path
              d={isSpeaking ? "M105,125 Q120,138 135,125" : "M107,124 Q120,133 133,124"}
              fill="none"
              stroke="#b07050"
              strokeWidth="3"
              strokeLinecap="round"
            />

            {/* Headset band */}
            <path d="M75,98 Q120,58 165,98" fill="none" stroke="#1e293b" strokeWidth="8" strokeLinecap="round" />

            {/* Left earpiece */}
            <circle cx="75" cy="106" r="15" fill="#1e293b" />
            <circle cx="75" cy="106" r="9" fill={isListening ? "#22c55e" : "#1d4ed8"} style={{ transition: "fill 0.3s" }} />
            <circle cx="75" cy="106" r="4" fill={isListening ? "#bbf7d0" : "#93c5fd"} style={{ transition: "fill 0.3s" }} />

            {/* Right earpiece */}
            <circle cx="165" cy="106" r="15" fill="#1e293b" />
            <circle cx="165" cy="106" r="9" fill={isListening ? "#22c55e" : "#1d4ed8"} style={{ transition: "fill 0.3s" }} />
            <circle cx="165" cy="106" r="4" fill={isListening ? "#bbf7d0" : "#93c5fd"} style={{ transition: "fill 0.3s" }} />

            {/* Mic arm */}
            <path d="M75,120 Q56,136 62,152" fill="none" stroke="#1e293b" strokeWidth="5.5" strokeLinecap="round" />

            {/* Mic capsule */}
            <rect x="56" y="150" width="14" height="11" rx="5.5" fill={isSpeaking ? "#3b82f6" : "#334155"} style={{ transition: "fill 0.3s" }} />
            {isSpeaking && (
              <circle cx="63" cy="156" r="3.5" fill="#bfdbfe" opacity="0.9" />
            )}
          </g>
        </svg>
      </div>

      {/* Voice wave bars */}
      <div style={{ display: "flex", alignItems: "center", gap: 5, height: 40, marginTop: 6 }}>
        {[0.1, 0.5, 0.9, 1.3, 0.7, 0.3, 1.1].map((delay, i) => (
          <div
            key={i}
            style={{
              width: 4,
              borderRadius: 2,
              background: color,
              height: isSpeaking ? undefined : 4,
              minHeight: 4,
              animation: isSpeaking ? `ag-wave 1.2s ease-in-out ${delay}s infinite` : "none",
              transition: "background 0.4s",
            }}
          />
        ))}
      </div>
    </div>
  );
}

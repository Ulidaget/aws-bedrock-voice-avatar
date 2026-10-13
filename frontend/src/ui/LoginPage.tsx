import { isAuthDisabled } from "../auth/auth";

interface Props {
  onLogin: () => void;
}

export function LoginPage({ onLogin }: Props) {
  return (
    <>
      <style>{`
        body { margin: 0; }
        @keyframes pulse-ring {
          0%   { transform: scale(1); opacity: 0.5; }
          100% { transform: scale(1.7); opacity: 0; }
        }
        @keyframes wave {
          0%,100% { height: 12px; }
          50%      { height: 28px; }
        }
        .lp-btn:hover {
          background: #2563eb !important;
          transform: translateY(-2px) !important;
          box-shadow: 0 12px 32px rgba(59,130,246,0.55) !important;
        }
        .lp-btn:active { transform: translateY(0) !important; }
      `}</style>

      <div style={s.bg}>
        <div style={s.blob1} />
        <div style={s.blob2} />

        <div style={s.card}>
          {/* Icon */}
          <div style={s.iconWrap}>
            <div style={s.ring} />
            <MicIcon />
          </div>

          {/* Wave bars */}
          <div style={s.waveRow}>
            {[0.6, 1, 1.4, 0.8, 1.2, 0.5, 1.1].map((delay, i) => (
              <div
                key={i}
                style={{
                  ...s.bar,
                  animationDelay: `${delay}s`,
                  opacity: 0.5 + i * 0.07,
                }}
              />
            ))}
          </div>

          {/* Brand */}
          <p style={s.brand}>HONNE · AI VOICE</p>

          {/* Headline */}
          <h1 style={s.title}>Your AI Voice Assistant</h1>
          <p style={s.sub}>
            Real-time conversations powered by&nbsp;AWS&nbsp;Bedrock.
            <br />
            Sign in to start your session.
          </p>

          {/* CTA */}
          <button className="lp-btn" style={s.btn} onClick={onLogin}>
            <LoginIcon />
            Sign in with SSO
          </button>

          {isAuthDisabled() && (
            <p style={s.devNote}>⚡ Auth disabled — local dev mode</p>
          )}
        </div>

        <p style={s.footer}>Powered by AWS Bedrock · Nova Sonic · Amazon Cognito</p>
      </div>
    </>
  );
}

/* ── SVG icons ─────────────────────────────────────────────────────────── */

function MicIcon() {
  return (
    <svg width="36" height="36" viewBox="0 0 24 24" fill="none"
      stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="22" />
      <line x1="8"  y1="22" x2="16" y2="22" />
    </svg>
  );
}

function LoginIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      style={{ marginRight: 8, flexShrink: 0 }}>
      <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
      <polyline points="10 17 15 12 10 7" />
      <line x1="15" y1="12" x2="3" y2="12" />
    </svg>
  );
}

/* ── Styles ─────────────────────────────────────────────────────────────── */

const s: Record<string, React.CSSProperties> = {
  bg: {
    minHeight: "100vh",
    background: "linear-gradient(145deg, #060d1f 0%, #0f172a 55%, #080f20 100%)",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    position: "relative",
    overflow: "hidden",
  },
  blob1: {
    position: "absolute",
    top: "-240px",
    left: "-240px",
    width: "700px",
    height: "700px",
    borderRadius: "50%",
    background: "radial-gradient(circle, rgba(59,130,246,0.13) 0%, transparent 65%)",
    pointerEvents: "none",
  },
  blob2: {
    position: "absolute",
    bottom: "-240px",
    right: "-180px",
    width: "650px",
    height: "650px",
    borderRadius: "50%",
    background: "radial-gradient(circle, rgba(139,92,246,0.11) 0%, transparent 65%)",
    pointerEvents: "none",
  },
  card: {
    position: "relative",
    zIndex: 1,
    background: "rgba(15,23,42,0.75)",
    border: "1px solid rgba(255,255,255,0.07)",
    backdropFilter: "blur(24px)",
    WebkitBackdropFilter: "blur(24px)",
    borderRadius: "28px",
    padding: "52px 48px 44px",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "14px",
    width: "100%",
    maxWidth: "420px",
    boxShadow: "0 40px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.04)",
    textAlign: "center",
  },
  iconWrap: {
    position: "relative",
    width: "88px",
    height: "88px",
    background: "linear-gradient(135deg, #3b82f6 0%, #6366f1 100%)",
    borderRadius: "50%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    boxShadow: "0 10px 40px rgba(59,130,246,0.45)",
    marginBottom: "4px",
  },
  ring: {
    position: "absolute",
    inset: "-10px",
    borderRadius: "50%",
    border: "2px solid rgba(99,102,241,0.45)",
    animation: "pulse-ring 2.2s ease-out infinite",
  },
  waveRow: {
    display: "flex",
    alignItems: "center",
    gap: "5px",
    height: "32px",
  },
  bar: {
    width: "4px",
    borderRadius: "2px",
    background: "linear-gradient(to top, #3b82f6, #8b5cf6)",
    animation: "wave 1.4s ease-in-out infinite",
  },
  brand: {
    color: "#3b82f6",
    fontSize: "11px",
    fontWeight: 700,
    letterSpacing: "0.18em",
    margin: "0",
    textTransform: "uppercase",
  },
  title: {
    color: "#f1f5f9",
    fontSize: "26px",
    fontWeight: 700,
    margin: "0",
    letterSpacing: "-0.025em",
    lineHeight: 1.2,
  },
  sub: {
    color: "#64748b",
    fontSize: "14px",
    lineHeight: "1.65",
    margin: "0",
  },
  btn: {
    marginTop: "8px",
    background: "#3b82f6",
    color: "#fff",
    border: "none",
    borderRadius: "14px",
    padding: "15px 36px",
    fontSize: "15px",
    fontWeight: 600,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    boxShadow: "0 6px 20px rgba(59,130,246,0.4)",
    transition: "background 0.2s, transform 0.15s, box-shadow 0.2s",
    width: "100%",
    letterSpacing: "0.01em",
  },
  devNote: {
    color: "#475569",
    fontSize: "12px",
    margin: "0",
  },
  footer: {
    position: "absolute",
    bottom: "24px",
    color: "#1e293b",
    fontSize: "12px",
    letterSpacing: "0.06em",
    zIndex: 1,
  },
};

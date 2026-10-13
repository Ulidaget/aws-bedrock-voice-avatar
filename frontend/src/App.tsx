import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { config, VoiceStateName } from "./config";
import { VoiceClient } from "./voice/VoiceClient";
import { AgentAvatar } from "./ui/AgentAvatar";
import { AdminPanel } from "./ui/AdminPanel";
import { MyConversations } from "./ui/MyConversations";
import { LoginPage } from "./ui/LoginPage";
import { adminApi } from "./admin/adminApi";

// C10-B: voices the end user can pick (language-specific in Nova Sonic).
const USER_VOICES: { id: string; label: string }[] = [
  { id: "", label: "Default (agent's voice)" },
  { id: "lupe", label: "Español — Lupe (F)" },
  { id: "carlos", label: "Español — Carlos (M)" },
  { id: "matthew", label: "English — Matthew (M)" },
  { id: "tiffany", label: "English — Tiffany (F)" },
  { id: "ambre", label: "Français — Ambre (F)" },
  { id: "lorenzo", label: "Italiano — Lorenzo (M)" },
  { id: "greta", label: "Deutsch — Greta (F)" },
];
const VOICE_KEY = "phase0_pref_voice";
import {
  captureTokenFromUrl,
  getGroups,
  getToken,
  isAdmin,
  isAuthDisabled,
  isAuthenticated,
  login,
  logout,
} from "./auth/auth";

interface TranscriptLine {
  role: string;
  text: string;
}

const STATE_LABEL: Record<VoiceStateName, string> = {
  IDLE: "Idle",
  LISTENING: "Listening…",
  PROCESSING: "Thinking…",
  SPEAKING: "Speaking",
  INTERRUPTED: "Interrupted",
  ERROR: "Error",
};

export default function App() {
  const [authed, setAuthed] = useState(false);
  const [connected, setConnected] = useState(false);
  const [state, setState] = useState<VoiceStateName>("IDLE");
  const [amplitude, setAmplitude] = useState(0);
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [agentId, setAgentId] = useState<string>(config.defaultAgentId);
  const [view, setView] = useState<"chat" | "admin" | "history">("chat");
  const [agentOptions, setAgentOptions] = useState(config.agents);
  const [voiceId, setVoiceId] = useState<string>(
    () => localStorage.getItem(VOICE_KEY) ?? ""
  );
  const [textInput, setTextInput] = useState("");
  const clientRef = useRef<VoiceClient | null>(null);
  const admin = isAdmin();

  useEffect(() => {
    captureTokenFromUrl();
    setAuthed(isAuthenticated());
  }, []);

  // C2: populate the picker from the API (enabled agents). Fall back to the
  // static list if the call fails (e.g. API not configured in local dev).
  useEffect(() => {
    if (!config.apiUrl) return;
    const myGroups = new Set(getGroups());
    adminApi
      .list()
      .then((list) => {
        // C8: only show enabled agents the user is allowed to use. An agent
        // with no allowedGroups is open to everyone. (The backend enforces this
        // server-side too; here it's just to avoid offering agents that would
        // be rejected.)
        const visible = list.filter((a) => {
          if (!a.enabled) return false;
          const allowed = a.allowedGroups ?? [];
          if (allowed.length === 0) return true;
          return allowed.some((g) => myGroups.has(g));
        });
        if (visible.length > 0) {
          setAgentOptions(visible.map((a) => ({ id: a.agentId, label: a.name })));
        }
      })
      .catch(() => {
        /* keep static fallback */
      });
  }, [authed]);

  const client = useMemo(
    () =>
      new VoiceClient(
        {
          onState: (s) => setState(s),
          onTranscript: (role, text) =>
            setTranscript((prev) => [...prev, { role, text }]),
          onError: (m) => setError(m),
          onAmplitude: (a) => setAmplitude(a),
        },
        () => getToken()
      ),
    []
  );
  clientRef.current = client;

  const handleStart = useCallback(async () => {
    setError(null);
    setTranscript([]);
    // C10-B: pass the user's preferred voice (empty -> agent default).
    await client.connect(agentId, voiceId || undefined);
    setConnected(true);
  }, [client, agentId, voiceId]);

  const onVoiceChange = useCallback((v: string) => {
    setVoiceId(v);
    if (v) localStorage.setItem(VOICE_KEY, v);
    else localStorage.removeItem(VOICE_KEY);
  }, []);

  const handleStop = useCallback(async () => {
    await client.disconnect();
    setConnected(false);
  }, [client]);

  const handleInterrupt = useCallback(() => client.interrupt(), [client]);

  const handleSendText = useCallback(() => {
    const text = textInput.trim();
    if (!text) return;
    setTranscript((prev) => [...prev, { role: "USER", text }]);
    setTextInput("");
    if (connected) client.sendText(text);
  }, [textInput, connected, client]);

  if (!authed) {
    return <LoginPage onLogin={login} />;
  }

  return (
    <div style={styles.app}>
      <style>{`body { margin: 0; }`}</style>
      <div style={styles.inner}>
      <header style={styles.header}>
        <h1 style={{ fontSize: 20, margin: 0, color: "#f1f5f9", fontWeight: 600 }}>Your AI Voice Assistant</h1>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {!connected && (
            <button
              style={styles.ghost}
              onClick={() => setView(view === "history" ? "chat" : "history")}
            >
              {view === "history" ? "← Back to chat" : "My conversations"}
            </button>
          )}
          {admin && (
            <button
              style={styles.ghost}
              onClick={() => setView(view === "admin" ? "chat" : "admin")}
            >
              {view === "admin" ? "← Back to chat" : "Admin"}
            </button>
          )}
          {!isAuthDisabled() && (
            <button style={styles.ghost} onClick={logout}>
              Sign out
            </button>
          )}
        </div>
      </header>

      {view === "admin" ? (
        <div style={{ marginTop: 16 }}>
          <AdminPanel />
        </div>
      ) : view === "history" ? (
        <div style={{ marginTop: 16 }}>
          <MyConversations onClose={() => setView("chat")} />
        </div>
      ) : (
      <main style={styles.main}>
        <section style={styles.avatarPanel}>
          <AgentAvatar state={state} amplitude={amplitude} />
          <div style={styles.statusRow}>
            <span style={{ ...styles.badge, ...badgeColor(state) }}>{STATE_LABEL[state]}</span>
          </div>
          {!connected && agentOptions.length > 1 && (
            <div style={styles.agentRow}>
              <label style={styles.agentLabel} htmlFor="agent-select">
                Agent
              </label>
              <select
                id="agent-select"
                style={styles.agentSelect}
                value={agentId}
                onChange={(e) => setAgentId(e.target.value)}
              >
                {agentOptions.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label}
                  </option>
                ))}
              </select>
            </div>
          )}
          {!connected && (
            <div style={styles.agentRow}>
              <label style={styles.agentLabel} htmlFor="voice-select">
                Voice
              </label>
              <select
                id="voice-select"
                style={styles.agentSelect}
                value={voiceId}
                onChange={(e) => onVoiceChange(e.target.value)}
              >
                {USER_VOICES.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.label}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div style={styles.controls}>
            {!connected ? (
              <button style={styles.primary} onClick={handleStart}>
                Start conversation
              </button>
            ) : (
              <>
                <button style={styles.warn} onClick={handleInterrupt}>
                  Interrupt
                </button>
                <button style={styles.danger} onClick={handleStop}>
                  End
                </button>
              </>
            )}
          </div>
          {error && <p style={styles.error}>{error}</p>}
          <p style={styles.hint}>
            Just speak — no need to press record. Talk over the assistant to interrupt.
          </p>
        </section>

        <section style={styles.transcriptPanel}>
          <h2 style={{ fontSize: 16, color: "#e2e8f0", margin: "0 0 12px" }}>Transcript</h2>
          <div style={styles.transcript}>
            {transcript.length === 0 && (
              <p style={{ color: "#475569" }}>Transcript will appear here…</p>
            )}
            {transcript.map((line, i) => (
              <div key={i} style={{ marginBottom: 8 }}>
                <strong style={{ color: "#64748b" }}>
                  {line.role === "USER" ? "You" : "Assistant"}:
                </strong>{" "}
                <span style={{ color: "#e2e8f0" }}>{line.text}</span>
              </div>
            ))}
          </div>
          <div style={styles.textInputRow}>
            <input
              style={styles.textInput}
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSendText()}
              placeholder="O escribe un mensaje…"
            />
            <button
              style={styles.sendBtn}
              onClick={handleSendText}
              disabled={!textInput.trim()}
            >
              Enviar
            </button>
          </div>
        </section>
      </main>
      )}
      </div>
    </div>
  );
}

function badgeColor(state: VoiceStateName) {
  const map: Record<VoiceStateName, string> = {
    IDLE: "#6b7280",
    LISTENING: "#22c55e",
    PROCESSING: "#f59e0b",
    SPEAKING: "#3b82f6",
    INTERRUPTED: "#ef4444",
    ERROR: "#dc2626",
  };
  return { background: map[state] };
}

const styles: Record<string, React.CSSProperties> = {
  app: { minHeight: "100vh", background: "linear-gradient(145deg, #060d1f 0%, #0f172a 55%, #080f20 100%)", fontFamily: "system-ui, -apple-system, sans-serif" },
  inner: { maxWidth: 1000, margin: "0 auto", padding: 24 },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", background: "rgba(15,23,42,0.85)", backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 16, padding: "14px 20px", marginBottom: 24 },
  main: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 },
  avatarPanel: { background: "rgba(10,22,40,0.9)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 16, padding: 16, color: "#fff" },
  transcriptPanel: { background: "rgba(15,23,42,0.75)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 16, padding: 16, minHeight: 360 },
  transcript: { maxHeight: 340, overflowY: "auto" },
  statusRow: { display: "flex", justifyContent: "center", marginTop: 12 },
  badge: { color: "#fff", padding: "4px 12px", borderRadius: 999, fontSize: 13 },
  agentRow: { display: "flex", gap: 8, justifyContent: "center", alignItems: "center", marginTop: 14 },
  agentLabel: { fontSize: 13, color: "#94a3b8" },
  agentSelect: { background: "#1e293b", color: "#fff", border: "1px solid #334155", borderRadius: 8, padding: "6px 10px", fontSize: 14 },
  controls: { display: "flex", gap: 8, justifyContent: "center", marginTop: 16 },
  primary: { background: "#3b82f6", color: "#fff", border: 0, borderRadius: 10, padding: "10px 18px", cursor: "pointer", fontSize: 15 },
  warn: { background: "#f59e0b", color: "#fff", border: 0, borderRadius: 10, padding: "10px 18px", cursor: "pointer" },
  danger: { background: "#ef4444", color: "#fff", border: 0, borderRadius: 10, padding: "10px 18px", cursor: "pointer" },
  ghost: { background: "transparent", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 10, padding: "6px 12px", cursor: "pointer", color: "#94a3b8" },
  error: { color: "#fca5a5", textAlign: "center", marginTop: 12 },
  hint: { color: "#64748b", fontSize: 13, textAlign: "center", marginTop: 12 },
  textInputRow: { display: "flex", gap: 8, marginTop: 12, borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 12 },
  textInput: { flex: 1, background: "#1e293b", border: "1px solid #334155", borderRadius: 8, padding: "8px 12px", fontSize: 14, color: "#f1f5f9", outline: "none" },
  sendBtn: { background: "#3b82f6", color: "#fff", border: 0, borderRadius: 8, padding: "8px 16px", cursor: "pointer", fontSize: 14, flexShrink: 0 },
};

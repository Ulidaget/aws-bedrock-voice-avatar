import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { config, VoiceStateName } from "./config";
import { VoiceClient } from "./voice/VoiceClient";
import { AvatarStage } from "./ui/AvatarStage";
import { AdminPanel } from "./ui/AdminPanel";
import { MyConversations } from "./ui/MyConversations";
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

  if (!authed) {
    return (
      <div style={styles.centered}>
        <h1>Phase 0 — Voice + Avatar POC</h1>
        <p>Please sign in to start a voice session.</p>
        <button style={styles.primary} onClick={login}>
          Sign in
        </button>
        {isAuthDisabled() && (
          <p style={{ opacity: 0.6, marginTop: 12 }}>
            (Auth is disabled for local dev — you can start directly.)
          </p>
        )}
      </div>
    );
  }

  return (
    <div style={styles.app}>
      <header style={styles.header}>
        <h1 style={{ fontSize: 20, margin: 0 }}>Phase 0 — Voice + Avatar POC</h1>
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
          <AvatarStage state={state} amplitude={amplitude} />
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
          <h2 style={{ fontSize: 16 }}>Transcript</h2>
          <div style={styles.transcript}>
            {transcript.length === 0 && (
              <p style={{ opacity: 0.5 }}>Transcript will appear here…</p>
            )}
            {transcript.map((line, i) => (
              <div key={i} style={{ marginBottom: 8 }}>
                <strong style={{ opacity: 0.7 }}>
                  {line.role === "USER" ? "You" : "Assistant"}:
                </strong>{" "}
                {line.text}
              </div>
            ))}
          </div>
        </section>
      </main>
      )}
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
  app: { maxWidth: 1000, margin: "0 auto", padding: 24, fontFamily: "system-ui, sans-serif" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center" },
  main: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, marginTop: 16 },
  avatarPanel: { background: "#0f172a", borderRadius: 16, padding: 16, color: "#fff" },
  transcriptPanel: { background: "#f8fafc", borderRadius: 16, padding: 16, minHeight: 360 },
  transcript: { maxHeight: 340, overflowY: "auto" },
  statusRow: { display: "flex", justifyContent: "center", marginTop: 12 },
  badge: { color: "#fff", padding: "4px 12px", borderRadius: 999, fontSize: 13 },
  agentRow: { display: "flex", gap: 8, justifyContent: "center", alignItems: "center", marginTop: 14 },
  agentLabel: { fontSize: 13, opacity: 0.7 },
  agentSelect: { background: "#1e293b", color: "#fff", border: "1px solid #334155", borderRadius: 8, padding: "6px 10px", fontSize: 14 },
  controls: { display: "flex", gap: 8, justifyContent: "center", marginTop: 16 },
  primary: { background: "#3b82f6", color: "#fff", border: 0, borderRadius: 10, padding: "10px 18px", cursor: "pointer", fontSize: 15 },
  warn: { background: "#f59e0b", color: "#fff", border: 0, borderRadius: 10, padding: "10px 18px", cursor: "pointer" },
  danger: { background: "#ef4444", color: "#fff", border: 0, borderRadius: 10, padding: "10px 18px", cursor: "pointer" },
  ghost: { background: "transparent", border: "1px solid #cbd5e1", borderRadius: 10, padding: "6px 12px", cursor: "pointer" },
  error: { color: "#fca5a5", textAlign: "center", marginTop: 12 },
  hint: { opacity: 0.6, fontSize: 13, textAlign: "center", marginTop: 12 },
  centered: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "100vh", gap: 8, fontFamily: "system-ui, sans-serif" },
};

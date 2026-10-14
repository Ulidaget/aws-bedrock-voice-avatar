import { useCallback, useEffect, useState } from "react";
import {
  adminApi,
  AdminApiError,
  ConversationSummary,
  ConversationTurn,
} from "../admin/adminApi";
import { TranscriptView } from "./TranscriptView";

/**
 * C10-A: the signed-in user's OWN conversation history. Any authenticated user
 * can open this; the API returns only the caller's conversations (filtered by
 * the JWT sub server-side).
 */
export function MyConversations({ onClose }: { onClose: () => void }) {
  const [list, setList] = useState<ConversationSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openAgent, setOpenAgent] = useState<string | null>(null);
  const [turns, setTurns] = useState<ConversationTurn[] | null>(null);
  const [loadingTurns, setLoadingTurns] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setList(await adminApi.listMyConversations());
    } catch (e) {
      setError(e instanceof AdminApiError ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const open = async (agentId: string) => {
    setOpenAgent(agentId);
    setTurns(null);
    setLoadingTurns(true);
    setError(null);
    try {
      const res = await adminApi.getMyConversation(agentId);
      setTurns(res.turns);
    } catch (e) {
      setError(e instanceof AdminApiError ? e.message : String(e));
    } finally {
      setLoadingTurns(false);
    }
  };

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <h2 style={{ margin: 0, fontSize: 18, color: "#f1f5f9" }}>My conversations</h2>
        <button style={s.ghost} onClick={onClose}>
          ← Back to chat
        </button>
      </div>

      {error && <p style={s.error}>{error}</p>}

      {loading ? (
        <p style={{ color: "#64748b" }}>Loading…</p>
      ) : openAgent ? (
        <div>
          <button style={s.ghost} onClick={() => setOpenAgent(null)}>
            ← Back to list
          </button>
          <h3 style={{ color: "#f1f5f9" }}>{openAgent}</h3>
          {loadingTurns ? (
            <p style={{ color: "#64748b" }}>Loading transcript…</p>
          ) : (
            <TranscriptView turns={turns ?? []} />
          )}
        </div>
      ) : list.length === 0 ? (
        <p style={{ color: "#64748b" }}>
          You have no saved conversations yet. They appear here after talking
          with an agent that remembers conversations.
        </p>
      ) : (
        <table style={s.table}>
          <thead>
            <tr>
              <th style={s.th}>Agent</th>
              <th style={s.th}>Turns</th>
              <th style={s.th}>Last activity</th>
              <th style={s.th}></th>
            </tr>
          </thead>
          <tbody>
            {list.map((c) => (
              <tr key={c.agentId}>
                <td style={s.td}>{c.agentId}</td>
                <td style={s.td}>{c.turns}</td>
                <td style={s.td}>
                  {c.lastActivity
                    ? new Date(c.lastActivity).toLocaleString()
                    : "—"}
                </td>
                <td style={s.td}>
                  <button style={s.small} onClick={() => open(c.agentId)}>
                    View
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  wrap: { background: "rgba(15,23,42,0.75)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 16, padding: 20 },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 14, color: "#e2e8f0" },
  th: { textAlign: "left", borderBottom: "2px solid rgba(255,255,255,0.08)", padding: "8px 6px", color: "#64748b" },
  td: { borderBottom: "1px solid rgba(255,255,255,0.05)", padding: "8px 6px", color: "#e2e8f0" },
  small: { background: "#1e293b", color: "#94a3b8", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, padding: "4px 10px", cursor: "pointer", fontSize: 13 },
  ghost: { background: "transparent", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 10, padding: "6px 14px", cursor: "pointer", color: "#94a3b8" },
  error: { color: "#fca5a5", background: "rgba(239,68,68,0.15)", padding: "8px 12px", borderRadius: 8 },
};

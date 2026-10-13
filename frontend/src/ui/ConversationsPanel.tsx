import { useCallback, useEffect, useState } from "react";
import {
  adminApi,
  AdminApiError,
  ConversationSummary,
  ConversationTurn,
} from "../admin/adminApi";
import { TranscriptView } from "./TranscriptView";

/**
 * C7 Conversations panel (read-only, admin only).
 *
 * Lists stored conversations (from the C4 memory table) and shows the turns of
 * a selected one as a chat transcript. Privacy: admins can read user
 * transcripts; this is gated by the admin group on the API.
 */
export function ConversationsPanel() {
  const [list, setList] = useState<ConversationSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<ConversationSummary | null>(null);
  const [turns, setTurns] = useState<ConversationTurn[] | null>(null);
  const [loadingTurns, setLoadingTurns] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setList(await adminApi.listConversations());
    } catch (e) {
      setError(e instanceof AdminApiError ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const open = async (c: ConversationSummary) => {
    setSelected(c);
    setTurns(null);
    setLoadingTurns(true);
    setError(null);
    try {
      const res = await adminApi.getConversation(c.userSub, c.agentId);
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
        <h2 style={{ margin: 0, fontSize: 18 }}>Conversations</h2>
        <button style={s.ghost} onClick={refresh}>
          Refresh
        </button>
      </div>
      <p style={{ opacity: 0.6, fontSize: 12, marginTop: 0 }}>
        Transcripts of past voice conversations (auto-expire after ~30 days).
      </p>

      {error && <p style={s.error}>{error}</p>}

      {loading ? (
        <p style={{ opacity: 0.6 }}>Loading…</p>
      ) : selected ? (
        <div>
          <button style={s.ghost} onClick={() => setSelected(null)}>
            ← Back to list
          </button>
          <h3 style={{ marginBottom: 4 }}>
            {selected.agentId} · {selected.userSub}
          </h3>
          {loadingTurns ? (
            <p style={{ opacity: 0.6 }}>Loading transcript…</p>
          ) : (
            <TranscriptView turns={turns ?? []} />
          )}
        </div>
      ) : list.length === 0 ? (
        <p style={{ opacity: 0.6 }}>
          No conversations yet. They appear here once an agent with "Remember
          conversations" has talked with a user.
        </p>
      ) : (
        <table style={s.table}>
          <thead>
            <tr>
              <th style={s.th}>Agent</th>
              <th style={s.th}>User</th>
              <th style={s.th}>Turns</th>
              <th style={s.th}>Last activity</th>
              <th style={s.th}></th>
            </tr>
          </thead>
          <tbody>
            {list.map((c) => (
              <tr key={`${c.userSub}|${c.agentId}`}>
                <td style={s.td}>{c.agentId}</td>
                <td style={{ ...s.td, fontFamily: "monospace", fontSize: 12 }}>
                  {c.userSub}
                </td>
                <td style={s.td}>{c.turns}</td>
                <td style={s.td}>
                  {c.lastActivity
                    ? new Date(c.lastActivity).toLocaleString()
                    : "—"}
                </td>
                <td style={s.td}>
                  <button style={s.small} onClick={() => open(c)}>
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
  wrap: { background: "#f8fafc", borderRadius: 16, padding: 20 },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 14 },
  th: {
    textAlign: "left",
    borderBottom: "2px solid #e2e8f0",
    padding: "8px 6px",
    opacity: 0.7,
  },
  td: { borderBottom: "1px solid #eef2f7", padding: "8px 6px" },
  small: {
    background: "#e2e8f0",
    border: 0,
    borderRadius: 8,
    padding: "4px 10px",
    cursor: "pointer",
    fontSize: 13,
  },
  ghost: {
    background: "transparent",
    border: "1px solid #cbd5e1",
    borderRadius: 10,
    padding: "6px 14px",
    cursor: "pointer",
  },
  error: { color: "#b91c1c", background: "#fee2e2", padding: "8px 12px", borderRadius: 8 },
  dayHeader: {
    display: "flex",
    gap: 8,
    alignItems: "center",
    width: "100%",
    background: "#eef2f7",
    border: "1px solid #e2e8f0",
    borderRadius: 10,
    padding: "8px 12px",
    cursor: "pointer",
    fontSize: 14,
    fontWeight: 600,
  },
};

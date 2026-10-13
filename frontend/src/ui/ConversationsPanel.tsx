import { useCallback, useEffect, useState } from "react";
import {
  adminApi,
  AdminApiError,
  ConversationSummary,
  ConversationTurn,
} from "../admin/adminApi";
import { TranscriptView } from "./TranscriptView";

// Approximate Nova Sonic text-token pricing (USD per 1 000 tokens).
// Audio-stream costs are additional and not captured here.
const PRICE_IN  = 0.0008;  // input
const PRICE_OUT = 0.0032;  // output

function estCost(input = 0, output = 0): string {
  const usd = (input / 1000) * PRICE_IN + (output / 1000) * PRICE_OUT;
  if (usd < 0.000_1) return "< $0.0001";
  return `~$${usd.toFixed(4)}`;
}

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
        <h2 style={{ margin: 0, fontSize: 18, color: "#f1f5f9" }}>Conversations</h2>
        <button style={s.ghost} onClick={refresh}>
          Refresh
        </button>
      </div>
      <p style={{ color: "#475569", fontSize: 12, marginTop: 0 }}>
        Transcripts of past voice conversations (auto-expire after ~30 days).
        Token counts are text estimates; audio-stream charges are additional.
      </p>

      {error && <p style={s.error}>{error}</p>}

      {loading ? (
        <p style={{ color: "#64748b" }}>Loading…</p>
      ) : selected ? (
        <div>
          <button style={s.ghost} onClick={() => setSelected(null)}>
            ← Back to list
          </button>
          <h3 style={{ marginBottom: 4, color: "#f1f5f9" }}>
            {selected.agentId} · {selected.userSub}
          </h3>
          {selected.inputTokens !== undefined && (
            <p style={{ color: "#64748b", fontSize: 13, margin: "0 0 12px" }}>
              Tokens in: <strong style={{ color: "#94a3b8" }}>{selected.inputTokens.toLocaleString()}</strong>
              {" · "}
              Tokens out: <strong style={{ color: "#94a3b8" }}>{selected.outputTokens?.toLocaleString()}</strong>
              {" · "}
              Est. cost: <strong style={{ color: "#34d399" }}>{estCost(selected.inputTokens, selected.outputTokens)}</strong>
            </p>
          )}
          {loadingTurns ? (
            <p style={{ color: "#64748b" }}>Loading transcript…</p>
          ) : (
            <TranscriptView turns={turns ?? []} />
          )}
        </div>
      ) : list.length === 0 ? (
        <p style={{ color: "#64748b" }}>
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
              <th style={s.th}>Tokens In</th>
              <th style={s.th}>Tokens Out</th>
              <th style={s.th}>Est. Cost</th>
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
                  {c.inputTokens !== undefined ? c.inputTokens.toLocaleString() : "—"}
                </td>
                <td style={s.td}>
                  {c.outputTokens !== undefined ? c.outputTokens.toLocaleString() : "—"}
                </td>
                <td style={{ ...s.td, color: "#34d399" }}>
                  {c.inputTokens !== undefined
                    ? estCost(c.inputTokens, c.outputTokens)
                    : "—"}
                </td>
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
  wrap: { background: "rgba(15,23,42,0.75)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 16, padding: 20 },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 13, color: "#e2e8f0" },
  th: { textAlign: "left", borderBottom: "2px solid rgba(255,255,255,0.08)", padding: "8px 6px", color: "#64748b" },
  td: { borderBottom: "1px solid rgba(255,255,255,0.05)", padding: "8px 6px", color: "#e2e8f0" },
  small: { background: "#1e293b", color: "#94a3b8", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, padding: "4px 10px", cursor: "pointer", fontSize: 13 },
  ghost: { background: "transparent", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 10, padding: "6px 14px", cursor: "pointer", color: "#94a3b8" },
  error: { color: "#fca5a5", background: "rgba(239,68,68,0.15)", padding: "8px 12px", borderRadius: 8 },
};

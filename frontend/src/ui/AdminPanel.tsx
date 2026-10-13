import { useCallback, useEffect, useState } from "react";
import { adminApi, Agent, AgentInput, AdminApiError } from "../admin/adminApi";
import { KnowledgeSection } from "./KnowledgeSection";
import { ConversationsPanel } from "./ConversationsPanel";
import { UsersPanel } from "./UsersPanel";
import { Group } from "../admin/adminApi";

// Nova Sonic voices (id + human label). Spanish voices are lupe/carlos.
// Source: AWS Nova Sonic "available voices" docs.
const VOICES: { id: string; label: string }[] = [
  { id: "lupe", label: "Lupe — Español (femenina)" },
  { id: "carlos", label: "Carlos — Español (masculino)" },
  { id: "matthew", label: "Matthew — English US (male)" },
  { id: "tiffany", label: "Tiffany — English US (female)" },
  { id: "amy", label: "Amy — English UK (female)" },
  { id: "ambre", label: "Ambre — Français (féminine)" },
  { id: "florian", label: "Florian — Français (masculin)" },
  { id: "beatrice", label: "Beatrice — Italiano (femminile)" },
  { id: "lorenzo", label: "Lorenzo — Italiano (maschile)" },
  { id: "greta", label: "Greta — Deutsch (weiblich)" },
  { id: "lennart", label: "Lennart — Deutsch (männlich)" },
];

// C5: tools the agent can be given (must match backend AVAILABLE_TOOL_NAMES).
const TOOLS: { name: string; label: string; hint?: string }[] = [
  { name: "get_current_time", label: "Current time — the agent can tell the date/time" },
  {
    name: "search_knowledge",
    label: "Search knowledge base — look up documents mid-conversation",
    hint: "Requires 'Use knowledge base' to be enabled.",
  },
  {
    name: "get_order_status",
    label: "Consultar pedido — look up an order's status by number",
    hint: "Calls the order-service business Lambda.",
  },
];

const EMPTY: AgentInput = {
  agentId: "",
  name: "",
  description: "",
  systemPrompt: "",
  modelId: "amazon.nova-2-sonic-v1:0",
  voiceId: "lupe",
  knowledgeBaseIds: [],
  toolNames: [],
  rememberConversations: false,
  allowedGroups: [],
  enabled: true,
};

export function AdminPanel() {
  const [tab, setTab] = useState<"agents" | "conversations" | "users">("agents");
  const [agents, setAgents] = useState<Agent[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<AgentInput | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setAgents(await adminApi.list());
      // C8: groups for the agent editor's allowedGroups multi-select.
      // Best-effort — a non-admin (or missing endpoint) shouldn't break the list.
      try {
        setGroups(await adminApi.listGroups());
      } catch {
        setGroups([]);
      }
    } catch (e) {
      setError(e instanceof AdminApiError ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const startCreate = () => {
    setEditing({ ...EMPTY });
    setIsNew(true);
  };
  const startEdit = (a: Agent) => {
    setEditing({ ...EMPTY, ...a });
    setIsNew(false);
  };
  const cancel = () => setEditing(null);

  const save = async () => {
    if (!editing) return;
    setSaving(true);
    setError(null);
    try {
      if (isNew) await adminApi.create(editing);
      else await adminApi.update(editing.agentId, editing);
      setEditing(null);
      await refresh();
    } catch (e) {
      setError(e instanceof AdminApiError ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    if (!confirm(`Delete agent "${id}"?`)) return;
    setError(null);
    try {
      await adminApi.remove(id);
      await refresh();
    } catch (e) {
      setError(e instanceof AdminApiError ? e.message : String(e));
    }
  };

  const setField = (k: keyof AgentInput, v: string | boolean) =>
    setEditing((prev) => (prev ? { ...prev, [k]: v } : prev));

  // C3: the agent opts into RAG via knowledgeBaseIds. We use the platform-wide
  // KB (alias "default"), which the backend resolves to the real KB id.
  const kbEnabled = (editing?.knowledgeBaseIds?.length ?? 0) > 0;
  const setKbEnabled = (on: boolean) =>
    setEditing((prev) =>
      prev ? { ...prev, knowledgeBaseIds: on ? ["default"] : [] } : prev
    );

  // C8: per-agent access control. Toggle groups in allowedGroups (empty = all).
  const groupAllowed = (name: string) =>
    (editing?.allowedGroups ?? []).includes(name);
  const setGroupAllowed = (name: string, on: boolean) =>
    setEditing((prev) => {
      if (!prev) return prev;
      const current = new Set(prev.allowedGroups ?? []);
      if (on) current.add(name);
      else current.delete(name);
      return { ...prev, allowedGroups: Array.from(current) };
    });

  // C5: tool use. Toggle individual tools in the agent's toolNames list.
  const toolEnabled = (name: string) =>
    (editing?.toolNames ?? []).includes(name);
  const setToolEnabled = (name: string, on: boolean) =>
    setEditing((prev) => {
      if (!prev) return prev;
      const current = new Set(prev.toolNames ?? []);
      if (on) current.add(name);
      else current.delete(name);
      return { ...prev, toolNames: Array.from(current) };
    });

  const tabBar = (
    <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
      <button
        style={tab === "agents" ? s.primary : s.ghost}
        onClick={() => setTab("agents")}
      >
        Agents
      </button>
      <button
        style={tab === "conversations" ? s.primary : s.ghost}
        onClick={() => setTab("conversations")}
      >
        Conversations
      </button>
      <button
        style={tab === "users" ? s.primary : s.ghost}
        onClick={() => setTab("users")}
      >
        Users
      </button>
    </div>
  );

  if (tab === "conversations") {
    return (
      <div>
        {tabBar}
        <ConversationsPanel />
      </div>
    );
  }

  if (tab === "users") {
    return (
      <div>
        {tabBar}
        <UsersPanel />
      </div>
    );
  }

  return (
    <div>
      {tabBar}
      <div style={s.wrap}>
      <div style={s.header}>
        <h2 style={{ margin: 0, fontSize: 18, color: "#f1f5f9" }}>Agents</h2>
        <button style={s.primary} onClick={startCreate}>
          + New agent
        </button>
      </div>

      {error && <p style={s.error}>{error}</p>}
      {loading ? (
        <p style={{ opacity: 0.6 }}>Loading…</p>
      ) : (
        <table style={s.table}>
          <thead>
            <tr>
              <th style={s.th}>ID</th>
              <th style={s.th}>Name</th>
              <th style={s.th}>Model</th>
              <th style={s.th}>Voice</th>
              <th style={s.th}>Enabled</th>
              <th style={s.th}></th>
            </tr>
          </thead>
          <tbody>
            {agents.map((a) => (
              <tr key={a.agentId}>
                <td style={s.td}>{a.agentId}</td>
                <td style={s.td}>{a.name}</td>
                <td style={s.td}>{a.modelId}</td>
                <td style={s.td}>{a.voiceId}</td>
                <td style={s.td}>{a.enabled ? "yes" : "no"}</td>
                <td style={s.td}>
                  <button style={s.small} onClick={() => startEdit(a)}>
                    Edit
                  </button>{" "}
                  <button style={s.smallDanger} onClick={() => remove(a.agentId)}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            {agents.length === 0 && (
              <tr>
                <td style={s.td} colSpan={6}>
                  No agents yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}

      {editing && (
        <div style={s.form}>
          <h3 style={{ marginTop: 0, color: "#f1f5f9" }}>{isNew ? "New agent" : `Edit ${editing.agentId}`}</h3>
          <label style={s.label}>
            Agent ID
            <input
              style={s.input}
              value={editing.agentId}
              disabled={!isNew}
              placeholder="e.g. sales (lowercase, dashes)"
              onChange={(e) => setField("agentId", e.target.value)}
            />
          </label>
          <label style={s.label}>
            Name
            <input style={s.input} value={editing.name} onChange={(e) => setField("name", e.target.value)} />
          </label>
          <label style={s.label}>
            Description
            <input
              style={s.input}
              value={editing.description ?? ""}
              onChange={(e) => setField("description", e.target.value)}
            />
          </label>
          <label style={s.label}>
            System prompt
            <textarea
              style={{ ...s.input, minHeight: 100, fontFamily: "inherit" }}
              value={editing.systemPrompt}
              onChange={(e) => setField("systemPrompt", e.target.value)}
            />
          </label>
          <div style={{ display: "flex", gap: 12 }}>
            <label style={{ ...s.label, flex: 1 }}>
              Model ID
              <input style={s.input} value={editing.modelId} onChange={(e) => setField("modelId", e.target.value)} />
            </label>
            <label style={{ ...s.label, flex: 1 }}>
              Voice
              <select
                style={s.input}
                value={editing.voiceId}
                onChange={(e) => setField("voiceId", e.target.value)}
              >
                {VOICES.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label style={{ display: "flex", gap: 8, alignItems: "center", margin: "8px 0", color: "#e2e8f0", fontSize: 14 }}>
            <input
              type="checkbox"
              checked={kbEnabled}
              onChange={(e) => setKbEnabled(e.target.checked)}
            />
            Use knowledge base (ground answers in uploaded documents)
          </label>

          {kbEnabled && (
            <KnowledgeSection agentId={editing.agentId} isNew={isNew} />
          )}

          <div
            style={{
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 12,
              padding: 14,
              margin: "10px 0",
            }}
          >
            <h4 style={{ margin: "0 0 8px", color: "#e2e8f0" }}>Tools (function calling)</h4>
            {TOOLS.map((t) => (
              <label
                key={t.name}
                style={{ display: "flex", gap: 8, alignItems: "flex-start", margin: "6px 0", color: "#e2e8f0", fontSize: 14 }}
              >
                <input
                  type="checkbox"
                  checked={toolEnabled(t.name)}
                  onChange={(e) => setToolEnabled(t.name, e.target.checked)}
                />
                <span>
                  {t.label}
                  {t.hint && (
                    <span style={{ display: "block", opacity: 0.6, fontSize: 12 }}>
                      {t.hint}
                    </span>
                  )}
                </span>
              </label>
            ))}
          </div>

          <label style={{ display: "flex", gap: 8, alignItems: "center", margin: "8px 0", color: "#e2e8f0", fontSize: 14 }}>
            <input
              type="checkbox"
              checked={editing.rememberConversations ?? false}
              onChange={(e) => setField("rememberConversations", e.target.checked)}
            />
            Remember conversations (recall past chats with the same user)
          </label>

          <div
            style={{
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 12,
              padding: 14,
              margin: "10px 0",
            }}
          >
            <h4 style={{ margin: "0 0 4px", color: "#f1f5f9" }}>Access (groups)</h4>
            <p style={{ color: "#64748b", fontSize: 12, margin: "0 0 8px" }}>
              Leave empty to allow everyone. Select groups to restrict who can
              use this agent.
            </p>
            {groups.length === 0 ? (
              <span style={{ opacity: 0.5, fontSize: 13 }}>
                No groups yet — create some in the Users tab.
              </span>
            ) : (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {groups.map((g) => (
                  <button
                    key={g.name}
                    type="button"
                    onClick={() => setGroupAllowed(g.name, !groupAllowed(g.name))}
                    style={
                      groupAllowed(g.name)
                        ? { background: "#3b82f6", color: "#fff", border: 0, borderRadius: 999, padding: "4px 12px", cursor: "pointer", fontSize: 13 }
                        : { background: "#1e293b", color: "#94a3b8", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 999, padding: "4px 12px", cursor: "pointer", fontSize: 13 }
                    }
                  >
                    {g.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          <label style={{ display: "flex", gap: 8, alignItems: "center", margin: "8px 0", color: "#e2e8f0", fontSize: 14 }}>
            <input
              type="checkbox"
              checked={editing.enabled}
              onChange={(e) => setField("enabled", e.target.checked)}
            />
            Enabled (visible to end users)
          </label>
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button style={s.primary} onClick={save} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </button>
            <button style={s.ghost} onClick={cancel} disabled={saving}>
              Cancel
            </button>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  wrap: { background: "rgba(15,23,42,0.75)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 16, padding: 20 },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 14, color: "#e2e8f0" },
  th: { textAlign: "left", borderBottom: "2px solid rgba(255,255,255,0.08)", padding: "8px 6px", color: "#64748b" },
  td: { borderBottom: "1px solid rgba(255,255,255,0.05)", padding: "8px 6px", color: "#e2e8f0" },
  form: { background: "rgba(10,22,40,0.9)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12, padding: 16, marginTop: 16 },
  label: { display: "flex", flexDirection: "column", gap: 4, fontSize: 13, marginBottom: 10, color: "#94a3b8" },
  input: { background: "#1e293b", border: "1px solid #334155", borderRadius: 8, padding: "8px 10px", fontSize: 14, color: "#f1f5f9" },
  primary: { background: "#3b82f6", color: "#fff", border: 0, borderRadius: 10, padding: "8px 16px", cursor: "pointer" },
  ghost: { background: "transparent", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 10, padding: "8px 16px", cursor: "pointer", color: "#94a3b8" },
  small: { background: "#1e293b", color: "#94a3b8", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, padding: "4px 10px", cursor: "pointer", fontSize: 13 },
  smallDanger: { background: "rgba(239,68,68,0.15)", color: "#fca5a5", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 8, padding: "4px 10px", cursor: "pointer", fontSize: 13 },
  error: { color: "#fca5a5", background: "rgba(239,68,68,0.15)", padding: "8px 12px", borderRadius: 8 },
};

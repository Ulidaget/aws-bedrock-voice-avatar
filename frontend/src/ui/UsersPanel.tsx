import { useCallback, useEffect, useState } from "react";
import { adminApi, AdminApiError, AdminUser, Group } from "../admin/adminApi";

/**
 * C8 Users panel (admin only): manage Cognito users and groups.
 * - list users with their groups; create/invite by email; enable/disable
 * - add/remove a user to/from a group
 * - list/create groups
 */
export function UsersPanel() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [newGroup, setNewGroup] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [u, g] = await Promise.all([
        adminApi.listUsers(),
        adminApi.listGroups(),
      ]);
      setUsers(u);
      setGroups(g);
    } catch (e) {
      setError(e instanceof AdminApiError ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError(e instanceof AdminApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const createUser = () => {
    if (!newEmail.trim()) return;
    run(async () => {
      await adminApi.createUser(newEmail.trim());
      setNewEmail("");
    });
  };

  const createGroup = () => {
    if (!newGroup.trim()) return;
    run(async () => {
      await adminApi.createGroup(newGroup.trim());
      setNewGroup("");
    });
  };

  const toggleGroup = (u: AdminUser, group: string) => {
    const has = u.groups.includes(group);
    run(() =>
      has
        ? adminApi.removeUserFromGroup(u.username, group)
        : adminApi.addUserToGroup(u.username, group)
    );
  };

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <h2 style={{ margin: 0, fontSize: 18 }}>Users & groups</h2>
        <button style={s.ghost} onClick={refresh} disabled={busy}>
          Refresh
        </button>
      </div>

      {error && <p style={s.error}>{error}</p>}

      {/* Create user + create group */}
      <div style={{ display: "flex", gap: 24, flexWrap: "wrap", margin: "8px 0 16px" }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            style={s.input}
            placeholder="user@email.com"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
          />
          <button style={s.primary} onClick={createUser} disabled={busy}>
            Invite user
          </button>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            style={s.input}
            placeholder="new group name"
            value={newGroup}
            onChange={(e) => setNewGroup(e.target.value)}
          />
          <button style={s.primary} onClick={createGroup} disabled={busy}>
            Create group
          </button>
        </div>
      </div>

      {loading ? (
        <p style={{ opacity: 0.6 }}>Loading…</p>
      ) : (
        <table style={s.table}>
          <thead>
            <tr>
              <th style={s.th}>User</th>
              <th style={s.th}>Status</th>
              <th style={s.th}>Groups</th>
              <th style={s.th}></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.username}>
                <td style={s.td}>{u.email || u.username}</td>
                <td style={s.td}>
                  {u.enabled ? (u.status ?? "—") : "disabled"}
                </td>
                <td style={s.td}>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {groups.map((g) => {
                      const on = u.groups.includes(g.name);
                      return (
                        <button
                          key={g.name}
                          onClick={() => toggleGroup(u, g.name)}
                          disabled={busy}
                          style={on ? s.chipOn : s.chipOff}
                          title={on ? "Click to remove" : "Click to add"}
                        >
                          {g.name}
                        </button>
                      );
                    })}
                    {groups.length === 0 && (
                      <span style={{ opacity: 0.5, fontSize: 12 }}>
                        no groups yet
                      </span>
                    )}
                  </div>
                </td>
                <td style={s.td}>
                  <button
                    style={u.enabled ? s.smallDanger : s.small}
                    disabled={busy}
                    onClick={() =>
                      run(() => adminApi.setUserEnabled(u.username, !u.enabled))
                    }
                  >
                    {u.enabled ? "Disable" : "Enable"}
                  </button>
                </td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr>
                <td style={s.td} colSpan={4}>
                  No users yet.
                </td>
              </tr>
            )}
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
    marginBottom: 12,
  },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 14 },
  th: {
    textAlign: "left",
    borderBottom: "2px solid #e2e8f0",
    padding: "8px 6px",
    opacity: 0.7,
  },
  td: { borderBottom: "1px solid #eef2f7", padding: "8px 6px", verticalAlign: "top" },
  input: { border: "1px solid #cbd5e1", borderRadius: 8, padding: "8px 10px", fontSize: 14 },
  primary: { background: "#3b82f6", color: "#fff", border: 0, borderRadius: 10, padding: "8px 16px", cursor: "pointer" },
  ghost: { background: "transparent", border: "1px solid #cbd5e1", borderRadius: 10, padding: "6px 14px", cursor: "pointer" },
  small: { background: "#dcfce7", color: "#166534", border: 0, borderRadius: 8, padding: "4px 10px", cursor: "pointer", fontSize: 13 },
  smallDanger: { background: "#fee2e2", color: "#b91c1c", border: 0, borderRadius: 8, padding: "4px 10px", cursor: "pointer", fontSize: 13 },
  chipOn: { background: "#3b82f6", color: "#fff", border: 0, borderRadius: 999, padding: "3px 10px", cursor: "pointer", fontSize: 12 },
  chipOff: { background: "#e2e8f0", color: "#334155", border: 0, borderRadius: 999, padding: "3px 10px", cursor: "pointer", fontSize: 12 },
  error: { color: "#b91c1c", background: "#fee2e2", padding: "8px 12px", borderRadius: 8 },
};

import { useMemo, useState } from "react";
import { ConversationTurn } from "../admin/adminApi";

/**
 * Shared transcript viewer: turns grouped by day into collapsible sections,
 * most recent day expanded by default. Used by the admin ConversationsPanel
 * (C7) and the end-user "My conversations" view (C10).
 */
export function TranscriptView({ turns }: { turns: ConversationTurn[] }) {
  const dayGroups = useMemo(() => {
    const byDay = new Map<string, ConversationTurn[]>();
    for (const t of turns) {
      const d = t.createdAt ? new Date(t.createdAt) : null;
      const key =
        d && !isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : "unknown";
      if (!byDay.has(key)) byDay.set(key, []);
      byDay.get(key)!.push(t);
    }
    return Array.from(byDay.entries())
      .sort()
      .map(([day, dayTurns]) => {
        const first = dayTurns[0]?.createdAt;
        const label =
          day === "unknown" || !first
            ? "Unknown date"
            : new Date(first).toLocaleDateString(undefined, {
                weekday: "long",
                year: "numeric",
                month: "long",
                day: "numeric",
              });
        return { day, label, turns: dayTurns };
      });
  }, [turns]);

  const [openDays, setOpenDays] = useState<Set<string>>(() => {
    const days = dayGroups.map((g) => g.day);
    const latest = days[days.length - 1];
    return latest ? new Set([latest]) : new Set();
  });

  if (dayGroups.length === 0) {
    return <p style={{ opacity: 0.6 }}>No turns in this conversation.</p>;
  }

  return (
    <div style={{ marginTop: 12 }}>
      {dayGroups.map((g) => {
        const isOpen = openDays.has(g.day);
        return (
          <div key={g.day} style={{ marginBottom: 8 }}>
            <button
              style={dayHeader}
              onClick={() =>
                setOpenDays((prev) => {
                  const next = new Set(prev);
                  if (next.has(g.day)) next.delete(g.day);
                  else next.add(g.day);
                  return next;
                })
              }
            >
              <span>{isOpen ? "▾" : "▸"}</span>
              <span style={{ flex: 1, textAlign: "left" }}>{g.label}</span>
              <span style={{ opacity: 0.55, fontSize: 12 }}>
                {g.turns.length} turns
              </span>
            </button>
            {isOpen && (
              <div style={{ padding: "8px 4px" }}>
                {g.turns.map((t, i) => (
                  <div
                    key={i}
                    style={{
                      display: "flex",
                      justifyContent:
                        t.role === "USER" ? "flex-end" : "flex-start",
                      margin: "6px 0",
                    }}
                  >
                    <div
                      style={{
                        maxWidth: "75%",
                        background: t.role === "USER" ? "rgba(59,130,246,0.2)" : "rgba(255,255,255,0.06)",
                        border: `1px solid ${t.role === "USER" ? "rgba(59,130,246,0.3)" : "rgba(255,255,255,0.08)"}`,
                        borderRadius: 12,
                        padding: "8px 12px",
                        fontSize: 14,
                        color: "#e2e8f0",
                      }}
                    >
                      <div style={{ color: "#64748b", fontSize: 11, marginBottom: 2 }}>
                        {t.role}
                        {t.createdAt
                          ? ` · ${new Date(t.createdAt).toLocaleTimeString()}`
                          : ""}
                      </div>
                      {t.text}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

const dayHeader: React.CSSProperties = {
  display: "flex",
  gap: 8,
  alignItems: "center",
  width: "100%",
  background: "rgba(255,255,255,0.05)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 10,
  padding: "8px 12px",
  cursor: "pointer",
  fontSize: 14,
  fontWeight: 600,
  color: "#e2e8f0",
};

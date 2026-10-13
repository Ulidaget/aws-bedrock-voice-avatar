import { useCallback, useEffect, useRef, useState } from "react";
import { adminApi, AdminApiError, KbDocument } from "../admin/adminApi";

/**
 * C3 Knowledge Base section for the agent editor.
 *
 * - Lists the documents uploaded for this agent (S3 prefix agents/{id}/).
 * - Uploads new documents via presigned PUT URLs (direct to S3).
 * - Deletes documents.
 * - Re-indexes the knowledge base (Bedrock StartIngestionJob).
 *
 * Documents are namespaced by agentId, so the agent must exist first. For a
 * brand-new (unsaved) agent we prompt the user to save before managing docs.
 */
export function KnowledgeSection({
  agentId,
  isNew,
}: {
  agentId: string;
  isNew: boolean;
}) {
  const [docs, setDocs] = useState<KbDocument[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const refresh = useCallback(async () => {
    if (isNew || !agentId) return;
    setLoading(true);
    setError(null);
    try {
      setDocs(await adminApi.listDocuments(agentId));
    } catch (e) {
      setError(e instanceof AdminApiError ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [agentId, isNew]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const onUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await adminApi.uploadDocument(agentId, file);
      setNotice(`Uploaded "${file.name}". Re-index to make it searchable.`);
      if (fileRef.current) fileRef.current.value = "";
      await refresh();
    } catch (err) {
      setError(err instanceof AdminApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const onRemove = async (key: string) => {
    if (!confirm(`Delete document "${key}"?`)) return;
    setBusy(true);
    setError(null);
    try {
      await adminApi.removeDocument(agentId, key);
      await refresh();
    } catch (err) {
      setError(err instanceof AdminApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const onReindex = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await adminApi.reindex(agentId);
      setNotice(
        `Re-index started (status: ${res.status ?? "STARTING"}). It may take a ` +
          `minute for new content to become searchable.`
      );
    } catch (err) {
      setError(err instanceof AdminApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  if (isNew) {
    return (
      <div style={box}>
        <h4 style={{ margin: "0 0 6px" }}>Knowledge base</h4>
        <p style={{ color: "#64748b", fontSize: 13, margin: 0 }}>
          Save the agent first, then reopen it to upload documents.
        </p>
      </div>
    );
  }

  return (
    <div style={box}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h4 style={{ margin: 0, color: "#f1f5f9" }}>Knowledge base documents</h4>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            type="button"
            style={ghost}
            disabled={busy}
            onClick={() => fileRef.current?.click()}
          >
            {busy ? "Working…" : "Upload document"}
          </button>
          <button type="button" style={primary} disabled={busy} onClick={onReindex}>
            Re-index
          </button>
        </div>
      </div>
      <input
        ref={fileRef}
        type="file"
        style={{ display: "none" }}
        onChange={onUpload}
        accept=".pdf,.txt,.md,.doc,.docx,.html,.csv"
      />

      {error && <p style={errBox}>{error}</p>}
      {notice && <p style={noticeBox}>{notice}</p>}

      {loading ? (
        <p style={{ color: "#64748b", fontSize: 13 }}>Loading documents…</p>
      ) : docs.length === 0 ? (
        <p style={{ color: "#64748b", fontSize: 13 }}>
          No documents yet. Upload a file, then re-index.
        </p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: "10px 0 0" }}>
          {docs.map((d) => (
            <li key={d.key} style={row}>
              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>
                {d.key}
              </span>
              <span style={{ opacity: 0.6, fontSize: 12, marginRight: 10 }}>
                {(d.size / 1024).toFixed(1)} KB
              </span>
              <button
                type="button"
                style={smallDanger}
                disabled={busy}
                onClick={() => onRemove(d.key)}
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const box: React.CSSProperties = {
  background: "rgba(255,255,255,0.04)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 12,
  padding: 14,
  margin: "10px 0",
  color: "#e2e8f0",
};
const row: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  padding: "6px 0",
  borderBottom: "1px solid rgba(255,255,255,0.06)",
  fontSize: 14,
  color: "#e2e8f0",
};
const primary: React.CSSProperties = {
  background: "#3b82f6",
  color: "#fff",
  border: 0,
  borderRadius: 8,
  padding: "6px 12px",
  cursor: "pointer",
  fontSize: 13,
};
const ghost: React.CSSProperties = {
  background: "transparent",
  border: "1px solid rgba(255,255,255,0.15)",
  borderRadius: 8,
  padding: "6px 12px",
  cursor: "pointer",
  fontSize: 13,
  color: "#94a3b8",
};
const smallDanger: React.CSSProperties = {
  background: "rgba(239,68,68,0.15)",
  color: "#fca5a5",
  border: "1px solid rgba(239,68,68,0.3)",
  borderRadius: 8,
  padding: "4px 10px",
  cursor: "pointer",
  fontSize: 13,
};
const errBox: React.CSSProperties = {
  color: "#fca5a5",
  background: "rgba(239,68,68,0.15)",
  padding: "6px 10px",
  borderRadius: 8,
  fontSize: 13,
};
const noticeBox: React.CSSProperties = {
  color: "#86efac",
  background: "rgba(34,197,94,0.12)",
  padding: "6px 10px",
  borderRadius: 8,
  fontSize: 13,
};

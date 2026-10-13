/**
 * Admin API client (C2). Thin fetch wrapper over the CRUD HTTP API, adding the
 * Cognito id_token as a Bearer token. The API enforces auth + the admin group;
 * this client just surfaces friendly errors.
 */
import { config } from "../config";
import { getToken } from "../auth/auth";

export interface Agent {
  agentId: string;
  name: string;
  description?: string;
  systemPrompt: string;
  modelId: string;
  voiceId: string;
  knowledgeBaseIds?: string[];
  toolNames?: string[];
  rememberConversations?: boolean;
  allowedGroups?: string[];
  enabled: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export type AgentInput = Omit<Agent, "createdAt" | "updatedAt">;

// C3: knowledge base document management.
export interface KbDocument {
  key: string;
  size: number;
  lastModified?: string | null;
}

interface PresignResponse {
  uploadUrl: string;
  key: string;
  contentType: string;
}

// C7: conversation history (read-only).
export interface ConversationSummary {
  userSub: string;
  agentId: string;
  turns: number;
  lastActivity: string;
}

export interface ConversationTurn {
  role: string; // "USER" | "ASSISTANT"
  text: string;
  createdAt: string;
  sessionId: string;
}

// C8: users & groups.
export interface AdminUser {
  username: string;
  email?: string | null;
  enabled: boolean;
  status?: string;
  groups: string[];
}

export interface Group {
  name: string;
  description?: string;
}

export class AdminApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function base(): string {
  const url = config.apiUrl;
  if (!url) throw new AdminApiError(0, "Admin API URL not configured");
  return url.replace(/\/$/, "");
}

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = getToken();
  const res = await fetch(`${base()}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401) throw new AdminApiError(401, "Not authenticated");
  if (res.status === 403)
    throw new AdminApiError(403, "You need the 'admin' group for this action");
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new AdminApiError(res.status, (data as any).message ?? `HTTP ${res.status}`);
  }
  return data as T;
}

export const adminApi = {
  list: () => req<{ agents: Agent[] }>("GET", "/agents").then((r) => r.agents),
  get: (id: string) => req<Agent>("GET", `/agents/${encodeURIComponent(id)}`),
  create: (agent: AgentInput) => req<Agent>("POST", "/agents", agent),
  update: (id: string, agent: AgentInput) =>
    req<Agent>("PUT", `/agents/${encodeURIComponent(id)}`, agent),
  remove: (id: string) => req<void>("DELETE", `/agents/${encodeURIComponent(id)}`),

  // --- C3 knowledge base documents ---
  listDocuments: (agentId: string) =>
    req<{ documents: KbDocument[] }>(
      "GET",
      `/agents/${encodeURIComponent(agentId)}/documents`
    ).then((r) => r.documents),

  /**
   * Upload a document for an agent: ask the API for a presigned PUT URL, then
   * PUT the file bytes straight to S3 (bypasses the API Gateway payload limit).
   */
  uploadDocument: async (agentId: string, file: File) => {
    const presign = await req<PresignResponse>(
      "POST",
      `/agents/${encodeURIComponent(agentId)}/documents`,
      { filename: file.name, contentType: file.type || "application/octet-stream" }
    );
    const put = await fetch(presign.uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": presign.contentType },
      body: file,
    });
    if (!put.ok) {
      throw new AdminApiError(put.status, `Upload failed (HTTP ${put.status})`);
    }
    return presign.key;
  },

  removeDocument: (agentId: string, key: string) =>
    req<void>(
      "DELETE",
      `/agents/${encodeURIComponent(agentId)}/documents/${encodeURIComponent(key)}`
    ),

  reindex: (agentId: string) =>
    req<{ ingestionJobId?: string; status?: string }>(
      "POST",
      `/agents/${encodeURIComponent(agentId)}/reindex`
    ),

  // --- C7 conversation history ---
  listConversations: () =>
    req<{ conversations: ConversationSummary[] }>("GET", "/conversations").then(
      (r) => r.conversations
    ),

  getConversation: (userSub: string, agentId: string) =>
    req<{ userSub: string; agentId: string; turns: ConversationTurn[] }>(
      "GET",
      `/conversations/${encodeURIComponent(userSub)}/${encodeURIComponent(agentId)}`
    ),

  // --- C10 the caller's OWN conversations (any authenticated user) ---
  listMyConversations: () =>
    req<{ conversations: ConversationSummary[] }>(
      "GET",
      "/me/conversations"
    ).then((r) => r.conversations),
  getMyConversation: (agentId: string) =>
    req<{ userSub: string; agentId: string; turns: ConversationTurn[] }>(
      "GET",
      `/me/conversations/${encodeURIComponent(agentId)}`
    ),

  // --- C8 users & groups ---
  listUsers: () =>
    req<{ users: AdminUser[] }>("GET", "/users").then((r) => r.users),
  createUser: (email: string) =>
    req<{ username: string; status?: string }>("POST", "/users", { email }),
  setUserEnabled: (username: string, enabled: boolean) =>
    req<void>(
      "POST",
      `/users/${encodeURIComponent(username)}/${enabled ? "enable" : "disable"}`
    ),
  addUserToGroup: (username: string, group: string) =>
    req<void>("POST", `/users/${encodeURIComponent(username)}/groups`, { group }),
  removeUserFromGroup: (username: string, group: string) =>
    req<void>(
      "DELETE",
      `/users/${encodeURIComponent(username)}/groups/${encodeURIComponent(group)}`
    ),
  listGroups: () =>
    req<{ groups: Group[] }>("GET", "/groups").then((r) => r.groups),
  createGroup: (name: string, description?: string) =>
    req<{ name: string }>("POST", "/groups", { name, description }),
};

/**
 * App configuration.
 *
 * Two sources, in priority order:
 *  1. Runtime `/config.json` — written by the CDK deploy with the real
 *     CloudFront/Cognito values. This lets the SAME built SPA work in any
 *     environment without rebuilding.
 *  2. Vite env vars (`.env`) — used for local development.
 *
 * Call `loadConfig()` once at startup (main.tsx) before rendering.
 */
export type VoiceStateName =
  | "IDLE"
  | "LISTENING"
  | "PROCESSING"
  | "SPEAKING"
  | "INTERRUPTED"
  | "ERROR";

interface AppConfig {
  wssEndpoint: string;
  authDisabled: boolean;
  cognito: {
    userPoolId: string;
    clientId: string;
    domain: string;
    redirectUri: string;
  };
  avatarModelUrl: string;
  inputSampleRate: number;
  outputSampleRate: number;
  // C1 multi-agent: which agent to run and the list shown in the picker.
  defaultAgentId: string;
  agents: { id: string; label: string }[];
  // C2 admin API base URL (set by the deploy in config.json).
  apiUrl: string;
}

// Defaults from Vite env (local dev). Mutated by loadConfig() when a runtime
// /config.json is present (AWS deploy).
export const config: AppConfig = {
  wssEndpoint: import.meta.env.VITE_WSS_ENDPOINT ?? "ws://localhost:8080/session",
  authDisabled: (import.meta.env.VITE_AUTH_DISABLED ?? "true") === "true",
  cognito: {
    userPoolId: import.meta.env.VITE_COGNITO_USER_POOL_ID ?? "",
    clientId: import.meta.env.VITE_COGNITO_CLIENT_ID ?? "",
    domain: import.meta.env.VITE_COGNITO_DOMAIN ?? "",
    redirectUri: import.meta.env.VITE_COGNITO_REDIRECT_URI ?? window.location.origin,
  },
  avatarModelUrl: import.meta.env.VITE_AVATAR_MODEL_URL ?? "",
  inputSampleRate: 16000,
  outputSampleRate: 24000,
  // C1: hard-coded agent list for now. C2 (admin API) will make this dynamic.
  // Ids must match the seeded DynamoDB records.
  defaultAgentId: "default",
  agents: [
    { id: "default", label: "General Assistant" },
    { id: "sales", label: "Sales Assistant" },
    { id: "support", label: "Support Assistant" },
  ],
  apiUrl: import.meta.env.VITE_API_URL ?? "",
};

/**
 * Load runtime config from /config.json if present. On AWS, the deploy writes
 * this file with the real values. Locally it usually 404s and we keep the
 * Vite-env defaults.
 */
export async function loadConfig(): Promise<void> {
  try {
    const res = await fetch("/config.json", { cache: "no-store" });
    if (!res.ok) return;
    const runtime = await res.json();

    if (runtime.wssEndpoint) config.wssEndpoint = runtime.wssEndpoint;
    if (typeof runtime.authDisabled === "boolean")
      config.authDisabled = runtime.authDisabled;
    if (runtime.cognito) {
      config.cognito.userPoolId = runtime.cognito.userPoolId ?? config.cognito.userPoolId;
      config.cognito.clientId = runtime.cognito.clientId ?? config.cognito.clientId;
      config.cognito.domain = runtime.cognito.domain ?? config.cognito.domain;
      // On AWS the redirect URI is always this SPA's own origin.
      config.cognito.redirectUri = window.location.origin;
    }
    if (runtime.avatarModelUrl) config.avatarModelUrl = runtime.avatarModelUrl;
    if (runtime.defaultAgentId) config.defaultAgentId = runtime.defaultAgentId;
    if (Array.isArray(runtime.agents) && runtime.agents.length > 0)
      config.agents = runtime.agents;
    if (runtime.apiUrl) config.apiUrl = runtime.apiUrl;
  } catch {
    // No runtime config (local dev) — keep Vite-env defaults.
  }
}

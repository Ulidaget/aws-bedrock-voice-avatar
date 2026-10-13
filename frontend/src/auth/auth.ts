/**
 * Minimal Cognito Hosted-UI auth client (OAuth2 implicit/redirect).
 *
 * Phase 0 keeps this dependency-free: it redirects to the Cognito Hosted UI and
 * reads the token from the URL fragment on return. In local dev
 * (VITE_AUTH_DISABLED=true) it returns null and the backend runs with
 * AUTH_DISABLED=true too.
 *
 * The token is used only to open the WebSocket; the browser holds no AWS creds.
 */
import { config } from "../config";

const TOKEN_KEY = "phase0_id_token";

export function isAuthDisabled(): boolean {
  return config.authDisabled;
}

export function getToken(): string | null {
  return sessionStorage.getItem(TOKEN_KEY);
}

/** Parse #id_token=... on redirect return; store it. Returns true if captured. */
export function captureTokenFromUrl(): boolean {
  if (!window.location.hash) return false;
  const params = new URLSearchParams(window.location.hash.slice(1));
  const token = params.get("id_token");
  if (token) {
    sessionStorage.setItem(TOKEN_KEY, token);
    history.replaceState(null, "", window.location.pathname);
    return true;
  }
  return false;
}

export function login(): void {
  const { domain, clientId, redirectUri } = config.cognito;
  if (!domain || !clientId) {
    alert("Cognito is not configured. Set VITE_COGNITO_* or use VITE_AUTH_DISABLED=true.");
    return;
  }
  const url =
    `https://${domain}/oauth2/authorize` +
    `?client_id=${encodeURIComponent(clientId)}` +
    `&response_type=token` +
    `&scope=openid+email` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}`;
  window.location.href = url;
}

export function logout(): void {
  sessionStorage.removeItem(TOKEN_KEY);
  const { domain, clientId, redirectUri } = config.cognito;
  if (domain && clientId) {
    window.location.href =
      `https://${domain}/logout` +
      `?client_id=${encodeURIComponent(clientId)}` +
      `&logout_uri=${encodeURIComponent(redirectUri)}`;
  }
}

export function isAuthenticated(): boolean {
  return isAuthDisabled() || !!getToken();
}

/**
 * Client-side check of whether the user is in the Cognito `admin` group, to
 * decide whether to show the Admin tab. This is NOT a security boundary — the
 * Admin API enforces the group server-side. We just decode the JWT payload
 * (no signature verification needed here).
 */
export function isAdmin(): boolean {
  return getGroups().includes("admin");
}

/**
 * C8: the Cognito groups of the current user, decoded from the id_token.
 * NOT a security boundary — the backend enforces access. Used only to filter
 * the agent picker and decide UI affordances (like the Admin tab).
 */
export function getGroups(): string[] {
  if (isAuthDisabled()) return ["admin"]; // local dev convenience
  const token = getToken();
  if (!token) return [];
  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    const groups = payload["cognito:groups"];
    if (Array.isArray(groups)) return groups.map(String);
    if (typeof groups === "string")
      return groups.split(/[\s,]+/).filter(Boolean);
    return [];
  } catch {
    return [];
  }
}

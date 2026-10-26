// Google Drive auth state (09 §2). Access tokens live in module memory only;
// the refresh token is owned by Windows Credential Manager inside Rust.
import { invoke } from "@tauri-apps/api/core";

export interface AuthTokens {
  access_token: string;
  expires_at: number;
}

export interface SyncClientConfig {
  clientId: string;
  clientSecret?: string;
}

const CLIENT_ID_KEY = "folio.sync.clientId";
const CLIENT_SECRET_KEY = "folio.sync.clientSecret";

function env(name: string): string {
  const viteEnv = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  return viteEnv?.[name] ?? "";
}

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function getClientConfig(): SyncClientConfig {
  const localId = typeof localStorage !== "undefined" ? localStorage.getItem(CLIENT_ID_KEY) : null;
  const localSecret =
    typeof localStorage !== "undefined" ? localStorage.getItem(CLIENT_SECRET_KEY) : null;
  return {
    clientId: localId || env("VITE_GOOGLE_CLIENT_ID"),
    clientSecret: localSecret || env("VITE_GOOGLE_CLIENT_SECRET") || undefined,
  };
}

/** Developer convenience: allow pasting a Desktop OAuth client in Settings. */
export function saveClientConfig(config: SyncClientConfig): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(CLIENT_ID_KEY, config.clientId.trim());
  if (config.clientSecret) localStorage.setItem(CLIENT_SECRET_KEY, config.clientSecret);
  else localStorage.removeItem(CLIENT_SECRET_KEY);
}

let tokens: AuthTokens | null = null;

function isFresh(t: AuthTokens | null): boolean {
  return !!t && t.expires_at - Date.now() > 60_000;
}

export function forgetAccessToken(): void {
  tokens = null;
}

export async function hasRefreshToken(): Promise<boolean> {
  if (!isTauri()) return false;
  try {
    return await invoke<boolean>("oauth_status");
  } catch {
    return false;
  }
}

export async function signIn(): Promise<AuthTokens> {
  if (!isTauri()) throw new Error("AUTH:Google Drive sync requires the desktop app.");
  const cfg = getClientConfig();
  tokens = await invoke<AuthTokens>("oauth_sign_in", {
    clientId: cfg.clientId,
    clientSecret: cfg.clientSecret ?? null,
  });
  return tokens;
}

export async function ensureAccessToken(force = false): Promise<string> {
  if (!force && isFresh(tokens)) return tokens!.access_token;
  const cfg = getClientConfig();
  tokens = await invoke<AuthTokens>("oauth_refresh", {
    clientId: cfg.clientId,
    clientSecret: cfg.clientSecret ?? null,
  });
  return tokens.access_token;
}

export async function signOut(): Promise<void> {
  tokens = null;
  if (!isTauri()) return;
  await invoke("oauth_sign_out");
}

// Local crash/rejection log. Folio has no telemetry: lines are appended to
// `%APPDATA%/Folio/user/logs/folio.log` by the Rust `log_error` command, which
// rotates the file at 512 KB. Browser/dev builds only write to the console.
import { invoke } from "@tauri-apps/api/core";

export const ERROR_LOG_CONTEXT = "folio";

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function describe(error: unknown): string {
  if (error instanceof Error) {
    return error.stack ? `${error.message}\n${error.stack}` : error.message;
  }
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error) ?? String(error);
  } catch {
    return String(error);
  }
}

/** Record a handled or unhandled failure without ever throwing itself. */
export function reportError(error: unknown, context: string = ERROR_LOG_CONTEXT): void {
  const message = describe(error) || "Unknown error";
  try {
    console.error(`[${context}]`, error);
  } catch {
    /* console may be unavailable in a broken webview */
  }
  if (!isTauri()) return;
  void invoke("log_error", { context, message }).catch(() => {
    // Diagnostics must never break the feature that reported the error.
  });
}

/** Install window-level capture handlers; returns an uninstall function. */
export function installGlobalErrorHandlers(): () => void {
  if (typeof window === "undefined") return () => {};
  const onError = (event: ErrorEvent) => {
    if (!event.error && !event.message) return;
    reportError(event.error ?? event.message, "window.error");
  };
  const onRejection = (event: PromiseRejectionEvent) => {
    reportError(event.reason, "unhandledrejection");
  };
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
  };
}

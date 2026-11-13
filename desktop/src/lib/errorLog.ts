// Local crash/rejection log. Folio has no telemetry: lines are appended to
// `%APPDATA%/Folio/user/logs/folio.log` by the Rust `log_error` command, which
// rotates the file at 512 KB. Browser/dev builds only write to the console.
import { invoke } from "@tauri-apps/api/core";
import { pushToast } from "../shell/toasts";

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

export interface HandleErrorOptions {
  /** Diagnostic context written to the log, e.g. "reader.annotations". */
  context: string;
  /** Message for the user as an error toast. When omitted, only logged. */
  userMessage?: string;
  /** Optional per-item failure lines shown behind a "Details" disclosure. */
  details?: string[];
}

/**
 * Single entry point for handled failures: always writes the log line, and
 * optionally surfaces an error toast. Never throws.
 */
export function handleError(error: unknown, options: HandleErrorOptions): void {
  reportError(error, options.context);
  if (!options.userMessage) return;
  try {
    pushToast({
      tone: "error",
      text: options.userMessage,
      details: options.details,
    });
  } catch {
    /* the log line above already recorded the failure */
  }
}

/** Resolve a display message with a fallback, as used across screens. */
export function describeError(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
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

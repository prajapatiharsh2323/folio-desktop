// Render-error recovery (P0-3). A render exception anywhere used to unmount
// the whole tree into a blank window. Two boundaries: one around the whole
// app (root) and one around the reader, which offers "Back to library".
// All failures go through the local error log; nothing leaves the machine.
import { Component, type ErrorInfo, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { reportError } from "../lib/errorLog";
import { FolioButton } from "../components/FolioButton";

interface ErrorBoundaryProps {
  children: ReactNode;
  /** "root": reload + log folder + copy diagnostics. "reader": back to library. */
  variant: "root" | "reader";
  /** Reader recovery action (route to library); the reader flushes on unmount. */
  onRecover?: () => void;
}

interface ErrorBoundaryState {
  error: Error | null;
}

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function copyDiagnostics(error: Error | null): Promise<boolean> {
  const lines = [
    `Folio ${__APP_VERSION__}`,
    `user-agent: ${navigator.userAgent}`,
    error ? `error: ${error.name}: ${error.message}\n${error.stack ?? ""}` : "error: (unknown)",
  ];
  const text = lines.join("\n");
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Clipboard API can be unavailable; fall back to a temporary textarea.
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    const err = error instanceof Error ? error : new Error(String(error));
    // Attach the component stack so the log points at the failing subtree.
    if (info.componentStack && !err.stack?.includes("Component stack")) {
      err.stack = `${err.stack ?? err.message}\nComponent stack:${info.componentStack}`;
    }
    reportError(err, this.props.variant === "reader" ? "render.reader" : "render.root");
  }

  private reset = () => {
    this.setState({ error: null });
  };

  private reload = () => {
    window.location.reload();
  };

  private backToLibrary = () => {
    this.reset();
    this.props.onRecover?.();
  };

  private openLogFolder = () => {
    if (!isTauri()) return;
    void invoke("open_log_dir").catch(() => {
      // Nothing more we can do from a broken tree; the log is still on disk.
    });
  };

  private copy = async () => {
    const ok = await copyDiagnostics(this.state.error);
    if (!ok) return;
    this.setState((s) => ({ ...s }));
  };

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    const reader = this.props.variant === "reader";
    return (
      <div
        className={
          reader ? "folio-errorboundary folio-errorboundary--reader" : "folio-errorboundary"
        }
      >
        <h1 className="folio-errorboundary__title">
          {reader ? "This book couldn't keep going" : "Something went wrong"}
        </h1>
        <p className="folio-errorboundary__text">
          {reader
            ? "A problem stopped this book from displaying. Your library, notes and reading position are safe."
            : "A problem stopped Folio from displaying. Your library and reading position are safe."}
        </p>
        <div className="folio-errorboundary__actions">
          {reader && (
            <FolioButton variant="primary" onClick={this.backToLibrary}>
              Back to library
            </FolioButton>
          )}
          <FolioButton variant="secondary" onClick={this.reload}>
            Reload
          </FolioButton>
          <FolioButton variant="secondary" onClick={this.openLogFolder} disabled={!isTauri()}>
            Open log folder
          </FolioButton>
          <FolioButton variant="secondary" onClick={() => void this.copy()}>
            Copy diagnostics
          </FolioButton>
          {!reader && (
            <FolioButton variant="secondary" onClick={this.reset}>
              Try again
            </FolioButton>
          )}
        </div>
        <p className="folio-errorboundary__detail">{error.message}</p>
      </div>
    );
  }
}

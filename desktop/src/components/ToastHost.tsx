import { useEffect, useState } from "react";
import { FolioIcons } from "./FolioIcons";
import { useToasts, type Toast } from "../shell/toasts";

const AUTO_DISMISS_MS = 4000;

/**
 * The global message stack (R14): up to three snackbars, newest last.
 * Success and info messages auto-dismiss after 4 s; errors and busy messages
 * stay until dismissed so a failure cannot vanish unread. Hovering the stack
 * or focusing anything inside it pauses the timers; leaving resumes them
 * with a fresh window.
 */
export function ToastHost() {
  const toasts = useToasts((s) => s.toasts);
  const dismiss = useToasts((s) => s.dismiss);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused || toasts.length === 0) return;
    const autoIds = toasts
      .filter((t) => t.tone === "success" || t.tone === "info")
      .map((t) => t.id);
    if (autoIds.length === 0) return;
    // One window for the whole stack: pausing cancels it, resuming (or any
    // change to the stack) restarts the full duration.
    const timer = setTimeout(() => {
      autoIds.forEach((id) => dismiss(id));
    }, AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [toasts, paused, dismiss]);

  if (toasts.length === 0) return null;

  return (
    <div
      className="folio-toast-stack"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setPaused(false);
      }}
    >
      {toasts.map((toast) => (
        <Snackbar key={toast.id} toast={toast} dismiss={dismiss} />
      ))}
    </div>
  );
}

function Snackbar({ toast, dismiss }: { toast: Toast; dismiss: (id?: string) => void }) {
  const isError = toast.tone === "error";
  const role = isError ? "alert" : "status";
  return (
    <div
      className={`folio-snackbar folio-snackbar--${toast.tone}`}
      role={role}
      aria-live={isError ? "assertive" : "polite"}
    >
      <span className="folio-snackbar__text">{toast.text}</span>
      {toast.details && toast.details.length > 0 && (
        <details className="folio-snackbar__details">
          <summary>Details</summary>
          <ul>
            {toast.details.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </details>
      )}
      {toast.action && toast.tone !== "busy" && (
        <button
          type="button"
          className="folio-snackbar__action"
          onClick={() => {
            toast.action!.run();
            dismiss(toast.id);
          }}
        >
          {toast.action.label}
        </button>
      )}
      {toast.tone !== "busy" && (
        <button
          type="button"
          className="folio-snackbar__close"
          aria-label="Dismiss message"
          onClick={() => dismiss(toast.id)}
        >
          <FolioIcons.Close size="sm" />
        </button>
      )}
    </div>
  );
}

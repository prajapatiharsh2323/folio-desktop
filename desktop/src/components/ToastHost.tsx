import { useEffect } from "react";
import { FolioIcons } from "./FolioIcons";
import { useToasts } from "../shell/toasts";

const SUCCESS_MS = 4000;

/**
 * One global message at a time. Success disappears after 4 s; errors stay
 * until dismissed (or replaced) so a failed import cannot vanish unread.
 * Busy messages stay for the duration of the operation.
 */
export function ToastHost() {
  const toast = useToasts((s) => s.toast);
  const dismiss = useToasts((s) => s.dismiss);

  useEffect(() => {
    if (!toast) return;
    if (toast.tone === "busy" || toast.tone === "error") return;
    const id = toast.id;
    const timer = setTimeout(() => dismiss(id), SUCCESS_MS);
    return () => clearTimeout(timer);
  }, [toast, dismiss]);

  if (!toast) return null;

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

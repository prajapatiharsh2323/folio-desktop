// Global transient messages (import results, recovery notices, navigation
// confirmations, Undo actions). These live outside a single screen so a
// message can survive a route change, and they stack (R14): at most three at
// once, keyed messages replace in place, errors persist until dismissed.
import { create } from "zustand";

export type ToastTone = "busy" | "success" | "error" | "info";

export interface Toast {
  id: string;
  tone: ToastTone;
  text: string;
  /** Optional per-file failure lines shown behind a "Details" disclosure. */
  details?: string[];
  /**
   * Optional single action (e.g. "Back", "Undo"). Shown as a button in the
   * host; running it dismisses the toast.
   */
  action?: { label: string; run: () => void };
  /**
   * Collision-safe identity (R14): pushing a toast whose key matches an
   * existing toast replaces it in place instead of stacking a duplicate
   * (e.g. the same navigation notice fired twice in a row).
   */
  key?: string;
}

/** Visible at once; the oldest non-error toast is evicted beyond this. */
const MAX_TOASTS = 3;

interface ToastState {
  toasts: Toast[];
  push: (toast: Omit<Toast, "id">) => string;
  /** Remove one toast by id; without an id, dismiss every toast. */
  dismiss: (id?: string) => void;
}

let sequence = 0;

export const useToasts = create<ToastState>((set, get) => ({
  toasts: [],
  push: (toast) => {
    const id = `toast-${++sequence}`;
    const next: Toast = { ...toast, id };
    const current = get().toasts;
    const keyIndex = toast.key !== undefined ? current.findIndex((t) => t.key === toast.key) : -1;
    let list: Toast[];
    if (keyIndex !== -1) {
      // Replace in place, keeping the slot; the fresh id means a stale
      // auto-dismiss timer from the replaced toast cannot dismiss this one.
      list = current.slice();
      list[keyIndex] = next;
    } else {
      list = [...current, next];
      if (list.length > MAX_TOASTS) {
        // Evict the oldest message that is not an error (errors persist
        // until the user dismisses them), never the toast being pushed;
        // when every other visible toast is an error, drop the oldest one.
        const last = list.length - 1;
        const evict = list.findIndex((t, i) => i !== last && t.tone !== "error");
        list.splice(evict === -1 ? 0 : evict, 1);
      }
    }
    set({ toasts: list });
    return id;
  },
  dismiss: (id) => {
    if (id === undefined) {
      set({ toasts: [] });
      return;
    }
    set({ toasts: get().toasts.filter((t) => t.id !== id) });
  },
}));

/** Imperative helper for stores and non-React code. */
export function pushToast(toast: Omit<Toast, "id">): string {
  return useToasts.getState().push(toast);
}

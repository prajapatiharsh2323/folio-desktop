// Global transient messages (import results, recovery notices, tour dismissal).
// These live outside a single screen so a message can survive a route change.
import { create } from "zustand";

export type ToastTone = "busy" | "success" | "error" | "info";

export interface Toast {
  id: string;
  tone: ToastTone;
  text: string;
  /** Optional per-file failure lines shown behind a "Details" disclosure. */
  details?: string[];
}

interface ToastState {
  toast: Toast | null;
  push: (toast: Omit<Toast, "id">) => string;
  dismiss: (id?: string) => void;
}

let sequence = 0;

export const useToasts = create<ToastState>((set, get) => ({
  toast: null,
  push: (toast) => {
    const id = `toast-${++sequence}`;
    set({ toast: { ...toast, id } });
    return id;
  },
  dismiss: (id) => {
    const current = get().toast;
    if (!current) return;
    // An explicit id must match so a stale timer cannot dismiss a newer toast.
    if (id !== undefined && current.id !== id) return;
    set({ toast: null });
  },
}));

/** Imperative helper for stores and non-React code. */
export function pushToast(toast: Omit<Toast, "id">): string {
  return useToasts.getState().push(toast);
}

// Shared focus-trap for dialogs and panels (03 §5.4: focus-trapped surfaces).

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

export function trapTabKey(container: HTMLElement, e: KeyboardEvent): void {
  if (e.key !== "Tab") return;
  const focusables = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => el.offsetParent !== null
  );
  if (focusables.length === 0) {
    e.preventDefault();
    return;
  }
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  const active = document.activeElement as HTMLElement | null;

  if (e.shiftKey) {
    if (active === first || !container.contains(active)) {
      e.preventDefault();
      last.focus();
    }
  } else {
    if (active === last || !container.contains(active)) {
      e.preventDefault();
      first.focus();
    }
  }
}

export function focusFirstIn(container: HTMLElement): void {
  const target =
    container.querySelector<HTMLElement>("[data-autofocus]") ??
    container.querySelector<HTMLElement>(FOCUSABLE) ??
    container;
  target.focus();
}

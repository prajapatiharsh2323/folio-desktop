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
    (el) => el.offsetParent !== null,
  );
  if (focusables.length === 0) {
    e.preventDefault();
    return;
  }
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  const active = document.activeElement as HTMLElement | null;
  // The dialog may focus a heading (tabindex="-1") on open. That element is
  // inside the container but is not a tab stop, so treat it as outside for
  // wrapping purposes instead of letting the first Tab escape the dialog.
  const onStop = active !== null && focusables.includes(active);

  if (e.shiftKey) {
    if (!onStop || active === first) {
      e.preventDefault();
      last.focus();
    }
  } else {
    if (!onStop || active === last) {
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

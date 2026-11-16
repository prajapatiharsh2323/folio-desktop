/**
 * Last-opened-wins registry for modal surfaces.
 *
 * Several surfaces can listen for Escape on `document` at once (a dialog opened
 * from a panel, the tour over the shell). Without a stack every listener would
 * react, so Escape closed the whole stack instead of the top surface.
 */
export type ModalToken = symbol;

const stack: ModalToken[] = [];

export function pushModal(): ModalToken {
  const token = Symbol("modal");
  stack.push(token);
  syncAppRootInert();
  return token;
}

export function popModal(token: ModalToken): void {
  const index = stack.indexOf(token);
  if (index >= 0) stack.splice(index, 1);
  syncAppRootInert();
}

export function isTopModal(token: ModalToken | null | undefined): boolean {
  return token != null && stack[stack.length - 1] === token;
}

export function modalDepth(): number {
  return stack.length;
}

/** Test helper: drop registrations left behind by an interrupted render. */
export function resetModalStack(): void {
  stack.length = 0;
  syncAppRootInert();
}

/**
 * X3: while any modal surface is open, the regions around it (sidebar, the
 * screen roots, the reader root) become `inert` — nothing under the modal can
 * be tabbed into or clicked, including by assistive tech. An ancestor that
 * CONTAINS the modal root (dialogs render inside their screen) stays
 * interactive, so the modal itself is never inerted.
 */
export function syncAppRootInert(): void {
  if (typeof document === "undefined") return;
  const candidates = document.querySelectorAll<HTMLElement>(
    ".folio-sidebar, .folio-screen, .folio-reader",
  );
  const modalRoots = document.querySelectorAll(
    "[data-folio-modal], [role='dialog'][aria-modal='true'], [aria-modal='true']",
  );
  if (modalRoots.length === 0) {
    candidates.forEach((el) => el.removeAttribute("inert"));
    return;
  }
  const keep = new Set<HTMLElement>();
  modalRoots.forEach((modal) => {
    candidates.forEach((el) => {
      if (el === modal || el.contains(modal)) keep.add(el);
    });
  });
  candidates.forEach((el) => {
    if (keep.has(el)) el.removeAttribute("inert");
    else el.setAttribute("inert", "");
  });
}

/**
 * True when a modal surface owns the keyboard: dialogs, panels, onboarding, or
 * the tour. Global shortcuts must not fire underneath these.
 *
 * The check is DOM-based (all modal roots carry `data-folio-modal`, an overlay,
 * or `aria-modal`) so it does not depend on onboarding state in tests that
 * render a screen in isolation.
 */
export function hasBlockingOverlay(): boolean {
  if (typeof document === "undefined") return false;
  return !!document.querySelector(
    "[data-folio-modal], .folio-overlay, [role='dialog'][aria-modal='true']"
  );
}

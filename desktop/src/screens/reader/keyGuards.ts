// Key-target guards for the reader keyboard matrix (07 §2): text entry and
// sliders own their keys — typing a query or nudging the scrubber must never
// turn the page. Chrome buttons deliberately do NOT own the arrow keys: page
// turns keep working while a toolbar control has focus, which is what a
// permanent dock makes obvious.

export function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(
    target.closest(
      "input, textarea, select, [contenteditable='true'], [role='textbox'], [role='slider'], [role='spinbutton'], [role='dialog']",
    ),
  );
}

/** Space/Enter belong to a focused control; arrows still page-turn. */
export function isActivatableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(
    target.closest(
      "button, a[href], [role='button'], [role='menuitem'], [role='switch'], [role='radio']",
    ),
  );
}

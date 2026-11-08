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
  return token;
}

export function popModal(token: ModalToken): void {
  const index = stack.indexOf(token);
  if (index >= 0) stack.splice(index, 1);
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
}

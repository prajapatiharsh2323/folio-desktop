// PDF document permissions → Folio capability (PDF plan D2). Pure logic so
// the decision is unit-testable without pdf.js; the caller fetches the
// permission set via PDFDocumentProxy.getPermissions().
//
// pdf.js reports the permissions of the /Encrypt dictionary as a set of
// PermissionFlag numbers (PRINT 0x04, MODIFY_CONTENTS 0x08, COPY 0x10, …),
// or null when the document is unencrypted. D2 honours the no-copy flag by
// disabling Copy / Share-as-image — reading itself is never blocked, and
// accessibility extraction (COPY_FOR_ACCESSIBILITY 0x200) stays available
// to screen readers regardless.

const PERMISSION_COPY = 0x10;

/** True when the document grants no copy permission. Unencrypted PDFs and
 *  encrypted ones that grant COPY are both copyable. */
export function noCopyFromPermissions(perms: Set<number> | null | undefined): boolean {
  if (!perms || perms.size === 0) return false;
  return !perms.has(PERMISSION_COPY);
}

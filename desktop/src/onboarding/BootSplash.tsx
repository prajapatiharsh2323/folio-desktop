/** Calm canvas + wordmark shown while boot tasks resolve (usually < 1 s). */
export function BootSplash() {
  return (
    <div className="folio-boot" role="status" aria-label="Starting Folio">
      <div className="folio-boot__wordmark">Folio</div>
    </div>
  );
}

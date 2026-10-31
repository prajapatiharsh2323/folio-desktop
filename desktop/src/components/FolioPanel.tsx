import { useEffect, useRef } from "react";
import { FolioIcons } from "./FolioIcons";
import { focusFirstIn, trapTabKey } from "./focusTrap";

interface FolioPanelProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  /** 360 (default) or 400 (wide) per 03 §5.4 */
  width?: 360 | 400;
  children: React.ReactNode;
}

/** Right-anchored panel replacing mobile bottom sheets (03 §5.4):
 * surface, hairline left border, x6 padding, ESC/backdrop closes, focus-trapped. */
export function FolioPanel({ open, onClose, title, width = 360, children }: FolioPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    if (!panel) return;

    const prevActive = document.activeElement as HTMLElement | null;
    focusFirstIn(panel);

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      trapTabKey(panel, e);
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      prevActive?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      <div className="folio-overlay" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        className="folio-panel"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        style={{ width }}
        onKeyDown={(e) => trapTabKey(panelRef.current!, e.nativeEvent)}
      >
        <div className="folio-panel__header">
          {title && <h2 className="folio-panel__title">{title}</h2>}
          <button type="button" className="folio-iconbtn" onClick={onClose} aria-label="Close panel">
            <FolioIcons.Close />
          </button>
        </div>
        <div className="folio-panel__content">{children}</div>
      </div>
    </>
  );
}

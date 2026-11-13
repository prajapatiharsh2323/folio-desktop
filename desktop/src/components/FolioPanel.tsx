import { useEffect, useRef } from "react";
import { FolioIcons } from "./FolioIcons";
import { focusFirstIn, trapTabKey } from "./focusTrap";
import { isTopModal, popModal, pushModal } from "../shell/modalStack";

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
  // The effect below must not depend on `onClose`: callers pass inline arrow
  // functions, which would re-run the effect (focus + modal push/pop) on
  // every parent re-render and steal focus from inputs inside the panel.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    if (!panel) return;

    const prevActive = document.activeElement as HTMLElement | null;
    focusFirstIn(panel);
    const token = pushModal();

    const onKey = (e: KeyboardEvent) => {
      if (!isTopModal(token)) return;
      if (e.key === "Escape") {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      trapTabKey(panel, e);
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      popModal(token);
      prevActive?.focus();
    };
  }, [open]);

  if (!open) return null;

  return (
    <>
      <div className="folio-overlay" onClick={onClose} aria-hidden="true" />
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- focus-trap container: keydown only handles Tab trapping, all inner controls are focusable */}
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
          <button
            type="button"
            className="folio-iconbtn"
            onClick={onClose}
            aria-label="Close panel"
          >
            <FolioIcons.Close />
          </button>
        </div>
        <div className="folio-panel__content">{children}</div>
      </div>
    </>
  );
}

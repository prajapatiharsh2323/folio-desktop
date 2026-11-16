import { useEffect, useLayoutEffect, useRef, useState } from "react";

export interface FolioMenuItem {
  key: string;
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  danger?: boolean;
  /** Renders a thin divider above this item. */
  separatorBefore?: boolean;
}

export interface ViewportRect {
  top: number;
  left: number;
  right: number;
  bottom: number;
}

const MENU_WIDTH = 232;
const ITEM_HEIGHT = 44;

/**
 * Small anchored action menu (L4 per-book "…"): Escape/outside-press close,
 * viewport-clamped position, focus moves to the first enabled item. The root
 * carries `data-folio-modal` so library-level global shortcuts ("\/Ctrl+I")
 * stay suppressed while it is open.
 */
export function FolioMenu({
  anchorRect,
  items,
  onClose,
  label,
}: {
  /** The trigger button's getBoundingClientRect(), captured at open. */
  anchorRect: ViewportRect | null;
  items: FolioMenuItem[];
  onClose: () => void;
  /** Accessible name, e.g. "Actions for Dune". */
  label: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  // Clamp after first paint, once the real height is known.
  useLayoutEffect(() => {
    if (!anchorRect) {
      setPos(null);
      return;
    }
    const height = items.length * ITEM_HEIGHT + 12;
    const left = Math.max(
      8,
      Math.min(anchorRect.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - 8),
    );
    const below = anchorRect.bottom + 4;
    const top =
      below + height > window.innerHeight - 8 ? Math.max(8, anchorRect.top - height - 4) : below;
    setPos({ top, left });
  }, [anchorRect, items.length]);

  useEffect(() => {
    if (!pos) return;
    const first = ref.current?.querySelector<HTMLButtonElement>(
      "button[role='menuitem']:not([disabled])",
    );
    first?.focus();
  }, [pos]);

  useEffect(() => {
    if (!pos) return;
    const onDocDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("mousedown", onDocDown);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDocDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [pos, onClose]);

  if (!pos) return null;

  return (
    <div
      ref={ref}
      className="folio-menu"
      role="menu"
      aria-label={label}
      data-folio-modal
      style={{ top: pos.top, left: pos.left, width: MENU_WIDTH }}
    >
      {items.map((item) => (
        <div key={item.key} className={item.separatorBefore ? "folio-menu__group" : undefined}>
          {item.separatorBefore && <div className="folio-menu__separator" role="separator" />}
          <button
            type="button"
            role="menuitem"
            className={`folio-menu__item${item.danger ? " folio-menu__item--danger" : ""}`}
            disabled={item.disabled}
            onClick={() => {
              onClose();
              item.onSelect();
            }}
          >
            {item.label}
          </button>
        </div>
      ))}
    </div>
  );
}

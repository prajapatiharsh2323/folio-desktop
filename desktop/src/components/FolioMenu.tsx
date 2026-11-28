import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";

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
  const enabledIndexes = items
    .map((item, index) => (item.disabled ? -1 : index))
    .filter((index) => index >= 0);
  const [activeIndex, setActiveIndex] = useState(() => enabledIndexes[0] ?? 0);

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
    ref.current?.querySelectorAll<HTMLButtonElement>("button[role='menuitem']")[activeIndex]?.focus();
  }, [pos, activeIndex]);

  /** WAI-ARIA menu keys: wrap between enabled items, Home/End to the ends. */
  const onMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (enabledIndexes.length === 0) return;
    let next: number | undefined;
    const at = enabledIndexes.indexOf(activeIndex);
    switch (event.key) {
      case "ArrowDown":
      case "ArrowRight":
        next = enabledIndexes[(at + 1 + enabledIndexes.length) % enabledIndexes.length];
        break;
      case "ArrowUp":
      case "ArrowLeft":
        next = enabledIndexes[(at - 1 + enabledIndexes.length) % enabledIndexes.length];
        break;
      case "Home":
        next = enabledIndexes[0];
        break;
      case "End":
        next = enabledIndexes[enabledIndexes.length - 1];
        break;
      default:
        return;
    }
    if (next === undefined) return;
    event.preventDefault();
    event.stopPropagation();
    setActiveIndex(next);
  };

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
      tabIndex={-1}
      data-folio-modal
      onKeyDown={onMenuKeyDown}
      style={{ top: pos.top, left: pos.left, width: MENU_WIDTH }}
    >
      {items.map((item, i) => (
        <div key={item.key} className={item.separatorBefore ? "folio-menu__group" : undefined}>
          {item.separatorBefore && <div className="folio-menu__separator" role="separator" />}
          <button
            type="button"
            role="menuitem"
            tabIndex={i === activeIndex ? 0 : -1}
            className={`folio-menu__item${item.danger ? " folio-menu__item--danger" : ""}`}
            disabled={item.disabled}
            onMouseEnter={() => setActiveIndex(i)}
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

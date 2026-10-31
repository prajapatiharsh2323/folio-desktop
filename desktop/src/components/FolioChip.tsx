import type { ButtonHTMLAttributes, ReactNode } from "react";

interface FolioChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  selected?: boolean;
  /** Render as a radiogroup member (single-select filters, 03 §7):
   * `role="radio"` + `aria-checked` instead of `aria-pressed`. Wrap the
   * group in `role="radiogroup"`. */
  asRadio?: boolean;
  children: ReactNode;
}

/** Filter chip: 32px pill; selected = accent-container; pressed scale .97 (03 §4, §6). */
export function FolioChip({
  selected = false,
  asRadio = false,
  className,
  children,
  ...rest
}: FolioChipProps) {
  const cls = ["folio-chip", selected && "is-selected", className].filter(Boolean).join(" ");
  return (
    <button
      type="button"
      className={cls}
      role={asRadio ? "radio" : undefined}
      {...(asRadio ? { "aria-checked": selected } : { "aria-pressed": selected })}
      {...rest}
    >
      {children}
    </button>
  );
}

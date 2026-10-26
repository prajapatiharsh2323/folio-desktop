import type { ButtonHTMLAttributes, ReactNode } from "react";

interface FolioChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  selected?: boolean;
  children: ReactNode;
}

/** Filter chip: 32px pill; selected = accent-container; pressed scale .97 (03 §4, §6). */
export function FolioChip({ selected = false, className, children, ...rest }: FolioChipProps) {
  const cls = ["folio-chip", selected && "is-selected", className].filter(Boolean).join(" ");
  return (
    <button type="button" className={cls} aria-pressed={selected} {...rest}>
      {children}
    </button>
  );
}

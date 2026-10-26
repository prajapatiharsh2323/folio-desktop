import type { ReactNode } from "react";

interface FolioRowProps {
  onClick?: () => void;
  children: ReactNode;
  className?: string;
}

/** Generic hairline-divided row; hover = surface-subtle over 140 ms (03 §4, §6). */
export function FolioRow({ onClick, children, className }: FolioRowProps) {
  const clickable = typeof onClick === "function";
  const cls = ["folio-row", clickable && "folio-row--clickable", className]
    .filter(Boolean)
    .join(" ");
  if (clickable) {
    return (
      <button type="button" className={cls} onClick={onClick}>
        {children}
      </button>
    );
  }
  return <div className={cls}>{children}</div>;
}

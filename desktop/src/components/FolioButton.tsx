import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";

interface FolioButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  children: ReactNode;
}

/** Primary/secondary/ghost/danger action button. Height 50, r8 (03 §4). */
export function FolioButton({ variant = "primary", className, children, ...rest }: FolioButtonProps) {
  const cls = ["folio-btn", `folio-btn--${variant}`, className].filter(Boolean).join(" ");
  return (
    <button type="button" className={cls} {...rest}>
      {children}
    </button>
  );
}

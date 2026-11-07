import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "default" | "sm";

interface FolioButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: ButtonSize;
  children: ReactNode;
}

/** Primary/secondary/ghost/danger action button. Height 50 (default) or 36 (sm), r8 (03 §4). */
export function FolioButton({
  variant = "primary",
  size = "default",
  className,
  children,
  ...rest
}: FolioButtonProps) {
  const cls = [
    "folio-btn",
    `folio-btn--${variant}`,
    size !== "default" && `folio-btn--${size}`,
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <button type="button" className={cls} {...rest}>
      {children}
    </button>
  );
}

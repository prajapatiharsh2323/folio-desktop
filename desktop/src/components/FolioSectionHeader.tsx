import type { ReactNode } from "react";

interface FolioSectionHeaderProps {
  children: ReactNode;
}

/** Overline group header for settings/panels (03 §5.7). */
export function FolioSectionHeader({ children }: FolioSectionHeaderProps) {
  return <div className="folio-section-header">{children}</div>;
}

// Shared presentation primitives for the EPUB and PDF appearance panels.
// Small and deliberately dumb: both panels keep their own preference models,
// these only give their sections/rows/footer a consistent rhythm.
import type { ReactNode } from "react";
import { FolioSectionHeader } from "./FolioSectionHeader";

interface AppearanceSectionProps {
  title: string;
  children: ReactNode;
  /** Optional caption under the section body. */
  description?: ReactNode;
  className?: string;
}

export function AppearanceSection({
  title,
  children,
  description,
  className = "",
}: AppearanceSectionProps) {
  return (
    <section className={`folio-appearance__section ${className}`.trim()}>
      <FolioSectionHeader>{title}</FolioSectionHeader>
      {children}
      {description ? <p className="folio-helper folio-helper--muted">{description}</p> : null}
    </section>
  );
}

interface AppearanceSwitchRowProps {
  label: string;
  checked: boolean;
  onChange: () => void;
  /** Accessible name; defaults to the visible label. */
  ariaLabel?: string;
  description?: string;
}

/** Label + helper on the left, switch on the right (switch is never orphaned). */
export function AppearanceSwitchRow({
  label,
  checked,
  onChange,
  ariaLabel,
  description,
}: AppearanceSwitchRowProps) {
  return (
    <div className="folio-appearance__switch-row">
      <span className="folio-appearance__switch-copy">
        <span className="folio-appearance__switch-label">{label}</span>
        {description ? (
          <span className="folio-helper folio-helper--muted">{description}</span>
        ) : null}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={ariaLabel ?? label}
        className={`folio-switch${checked ? " is-on" : ""}`}
        onClick={onChange}
      >
        <span className="folio-switch__thumb" />
      </button>
    </div>
  );
}

/** Sticky reset area; lives inside FolioPanel's scrollable content region. */
export function AppearancePanelFooter({ children }: { children: ReactNode }) {
  return <div className="folio-appearance__footer">{children}</div>;
}

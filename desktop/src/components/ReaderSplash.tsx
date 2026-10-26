import { FolioButton } from "./FolioButton";

const TINT_VARS = [
  "var(--folio-tint-sage-grey)",
  "var(--folio-tint-parchment)",
  "var(--folio-tint-eucalyptus)",
  "var(--folio-tint-clay)",
  "var(--folio-tint-slate)",
  "var(--folio-tint-oat)",
  "var(--folio-tint-stone)",
  "var(--folio-tint-moss)",
];

export type SplashPhase = "loading" | "fading" | "done" | "error";

interface ReaderSplashProps {
  phase: SplashPhase;
  title: string;
  author: string | null;
  coverUrl: string | null;
  tint: number;
  errorMessage: string | null;
  onRetry: () => void;
  onBack: () => void;
}

/** Splash (04 §1/§11): themed canvas, cover or generated tint art, spinner.
 * Error state replaces the spinner with Retry / Back (04 §1 step 2, §11). */
export function ReaderSplash({
  phase,
  title,
  author,
  coverUrl,
  tint,
  errorMessage,
  onRetry,
  onBack,
}: ReaderSplashProps) {
  if (phase === "done") return null;

  const initials = title
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
  const background = TINT_VARS[Math.abs(tint) % TINT_VARS.length];

  return (
    <div
      className={`folio-reader-splash${phase === "fading" ? " is-fading" : ""}`}
      role={phase === "error" ? "alertdialog" : "status"}
      aria-live="polite"
      aria-label={phase === "error" ? "This book can't be opened" : `Opening ${title}`}
    >
      <div className="folio-reader-splash__card">
        <div
          className="folio-reader-splash__cover"
          style={coverUrl ? undefined : { background }}
          aria-hidden="true"
        >
          {coverUrl ? (
            <img src={coverUrl} alt="" />
          ) : (
            <span className="folio-reader-splash__initials">{initials || "F"}</span>
          )}
        </div>
        <div className="folio-reader-splash__title" title={title}>
          {title}
        </div>
        {author && <div className="folio-reader-splash__author">{author}</div>}

        {phase === "error" ? (
          <div className="folio-reader-splash__error">
            <div className="folio-reader-splash__error-title">This book can't be opened</div>
            <p className="folio-helper">
              {errorMessage || "The file may be damaged or use an unsupported format."}
            </p>
            <div className="folio-reader-splash__actions">
              <FolioButton variant="primary" onClick={onRetry}>
                Try again
              </FolioButton>
              <FolioButton variant="secondary" onClick={onBack}>
                Back to library
              </FolioButton>
            </div>
          </div>
        ) : (
          <div className="folio-reader-spinner" role="progressbar" aria-label="Opening book" />
        )}
      </div>
    </div>
  );
}

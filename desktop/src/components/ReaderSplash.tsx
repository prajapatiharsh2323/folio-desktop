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

/** Open progress for the splash bar (R12). */
export interface SplashProgress {
  stage: "unpack" | "prepare";
  /** 0..1 when known; null = indeterminate. */
  fraction: number | null;
}

interface ReaderSplashProps {
  phase: SplashPhase;
  title: string;
  author: string | null;
  coverUrl: string | null;
  tint: number;
  /** R12: live open progress; null once the book is open or failed. */
  progress: SplashProgress | null;
  errorMessage: string | null;
  onRetry: () => void;
  onBack: () => void;
}

/** Splash (04 §1/§11): themed canvas, cover or generated tint art, spinner.
 * Error state replaces the spinner with Retry / Back (04 §1 step 2, §11).
 * R12: while the book opens, a progress bar shows the stage — indeterminate
 * while unpacking the archive, a determinate percent while preparing pages. */
export function ReaderSplash({
  phase,
  title,
  author,
  coverUrl,
  tint,
  progress,
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
          <>
            <div className="folio-reader-spinner" role="progressbar" aria-label="Opening book" />
            {phase === "loading" && progress && (
              <div className="folio-reader-splash__progress">
                <div
                  className={`folio-reader-splash__progressbar${progress.fraction === null ? " is-indeterminate" : ""}`}
                  style={
                    progress.fraction === null
                      ? undefined
                      : ({
                          "--folio-progress": `${Math.round(progress.fraction * 100)}%`,
                        } as React.CSSProperties)
                  }
                  role="progressbar"
                  aria-label={progress.stage === "unpack" ? "Unpacking book" : "Preparing pages"}
                  aria-valuemin={progress.fraction === null ? undefined : 0}
                  aria-valuemax={progress.fraction === null ? undefined : 100}
                  aria-valuenow={
                    progress.fraction === null ? undefined : Math.round(progress.fraction * 100)
                  }
                >
                  <span className="folio-reader-splash__progressfill" />
                </div>
                <span className="folio-reader-splash__progresslabel">
                  {progress.stage === "unpack"
                    ? "Unpacking book…"
                    : progress.fraction === null
                      ? "Preparing pages…"
                      : `Preparing pages… ${Math.round(progress.fraction * 100)}%`}
                </span>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

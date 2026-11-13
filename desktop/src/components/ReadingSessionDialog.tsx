import { FolioDialog } from "./FolioDialog";
import { FolioButton } from "./FolioButton";
import { FolioIcons } from "./FolioIcons";

interface ReadingSessionDialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  chapterTitle: string;
  percent: number;
  timeLeft: string | null;
  sessionDurationMs: number;
  totalReadingTimeMs: number;
  totalChapters?: number;
}

function formatDuration(ms: number): string {
  if (ms < 60000) return "Just started (< 1 min)";
  const totalMinutes = Math.floor(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes} min`;
  if (minutes === 0) return `${hours} hr`;
  return `${hours} hr ${minutes} min`;
}

/**
 * Reading session information dialog (Phase 7.2):
 * Displays reading pace metrics, time remaining, and current session duration
 * using Folio's existing ReadingPaceStats infrastructure.
 */
export function ReadingSessionDialog({
  open,
  onClose,
  title,
  chapterTitle,
  percent,
  timeLeft,
  sessionDurationMs,
  totalReadingTimeMs,
  totalChapters,
}: ReadingSessionDialogProps) {
  const roundedPercent = Math.round(Math.min(100, Math.max(0, percent)));

  return (
    <FolioDialog
      open={open}
      onClose={onClose}
      title="Reading Session"
      actions={
        <FolioButton variant="primary" onClick={onClose}>
          Done
        </FolioButton>
      }
    >
      <div className="folio-session-info">
        <div className="folio-session-info__book">
          <div className="folio-session-info__title">{title}</div>
          <div className="folio-session-info__chapter">{chapterTitle}</div>
        </div>

        <div className="folio-session-info__progress-bar">
          <div
            className="folio-session-info__progress-fill"
            style={{ width: `${roundedPercent}%` }}
          />
        </div>

        <div className="folio-session-info__grid">
          <div className="folio-session-info__card">
            <span className="folio-session-info__icon">
              <FolioIcons.Clock size="sm" />
            </span>
            <span className="folio-session-info__label">This session</span>
            <span className="folio-session-info__value">{formatDuration(sessionDurationMs)}</span>
          </div>

          <div className="folio-session-info__card">
            <span className="folio-session-info__icon">
              <FolioIcons.Book size="sm" />
            </span>
            <span className="folio-session-info__label">Book progress</span>
            <span className="folio-session-info__value">{roundedPercent}%</span>
          </div>

          <div className="folio-session-info__card">
            <span className="folio-session-info__icon">
              <FolioIcons.Sort size="sm" />
            </span>
            <span className="folio-session-info__label">Estimated remaining</span>
            <span className="folio-session-info__value">{timeLeft ?? "Calibrating pace…"}</span>
          </div>

          <div className="folio-session-info__card">
            <span className="folio-session-info__icon">
              <FolioIcons.Toc size="sm" />
            </span>
            <span className="folio-session-info__label">Total reading time</span>
            <span className="folio-session-info__value">
              {formatDuration(totalReadingTimeMs + sessionDurationMs)}
            </span>
          </div>
        </div>

        {totalChapters !== undefined && totalChapters > 0 && (
          <p className="folio-session-info__note">
            This publication contains {totalChapters} chapters.
          </p>
        )}
      </div>
    </FolioDialog>
  );
}

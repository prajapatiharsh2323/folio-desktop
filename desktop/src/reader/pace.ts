// Reading pace (04 §9, 1:1 port of ReadingPaceStats.kt math):
// accumulate wall-clock ONLY between two *forward* continuous moves
// (delta < 5 percentage points). Jumps/scrubs/suspension break the session;
// backward moves never credit. Time-to-finish formula guarded on percentRead.

export interface PaceState {
  sessionsMs: number;
  percentRead: number;
}

const CONTINUOUS_DELTA_PP = 5;

export class ReadingPaceStats {
  private sessionsMs: number;
  private percentRead: number;
  private anchorTs: number | null = null;
  private anchorPercent: number | null = null;

  constructor(state?: PaceState | null) {
    this.sessionsMs = Math.max(0, state?.sessionsMs ?? 0);
    this.percentRead = Math.max(0, state?.percentRead ?? 0);
  }

  /** A continuous forward move (page turn forward). `percent` 0..100. */
  onForwardMove(percent: number, nowMs: number): void {
    const clamped = Math.min(100, Math.max(0, percent));
    if (this.anchorTs === null || this.anchorPercent === null) {
      // first move of the session: anchor only, no credit yet
      this.anchorTs = nowMs;
      this.anchorPercent = clamped;
    } else {
      const delta = clamped - this.anchorPercent;
      if (delta > 0 && delta < CONTINUOUS_DELTA_PP) {
        this.sessionsMs += nowMs - this.anchorTs;
        this.anchorTs = nowMs;
        this.anchorPercent = clamped;
      } else if (delta >= CONTINUOUS_DELTA_PP) {
        // jump — do not credit the gap; re-anchor
        this.anchorTs = nowMs;
        this.anchorPercent = clamped;
      } else {
        // backward or same position — no credit; re-anchor so the gap before
        // the back-move isn't credited later
        this.anchorTs = nowMs;
        this.anchorPercent = clamped;
      }
    }
    if (clamped > this.percentRead) this.percentRead = clamped;
  }

  /** Jump / scrub / sheet open / suspension: break the session without credit. */
  breakSession(nowMs: number): void {
    this.anchorTs = nowMs;
    this.anchorPercent = null;
  }

  /** Current persisted state. */
  state(): PaceState {
    return {
      sessionsMs: Math.round(this.sessionsMs),
      percentRead: Math.round(this.percentRead * 10) / 10,
    };
  }

  /** Time-to-finish minutes (04 §9): sessionsMs/1000/60 × ((100−p)/percentRead). */
  timeLeftMinutes(percent: number): number | null {
    const p = Math.min(100, Math.max(0, percent));
    if (this.percentRead <= 0 || p >= 100) return null;
    return this.minutesForFraction((100 - p) / 100);
  }

  /** Minutes to read a fraction of the book (0..1) at the observed pace. */
  minutesForFraction(fraction: number): number | null {
    const f = Math.min(1, Math.max(0, fraction));
    if (this.percentRead <= 0 || f <= 0) return null;
    const readFraction = this.percentRead / 100;
    if (readFraction <= 0) return null;
    const minutes = (this.sessionsMs / 1000 / 60) * (f / readFraction);
    if (!Number.isFinite(minutes) || minutes < 0) return null;
    return minutes;
  }
}

/** Pillar display (R11): "≈ N min left" under an hour, "≈ H h M min left"
 *  beyond it (the minute part is dropped on the exact hour), hidden below a
 *  minute. */
export function formatTimeLeft(minutes: number | null): string | null {
  if (minutes === null) return null;
  if (minutes < 1) return null;
  if (minutes < 60) return `≈ ${Math.max(1, Math.round(minutes))} min left`;
  const hours = Math.floor(minutes / 60);
  const mins = Math.round(minutes - hours * 60);
  if (mins === 0) return `≈ ${hours} h left`;
  if (mins === 60) return `≈ ${hours + 1} h left`;
  return `≈ ${hours} h ${mins} min left`;
}

/** Per-chapter display (R11): "≈ N min left in chapter" / null under a minute. */
export function formatChapterTimeLeft(minutes: number | null): string | null {
  if (minutes === null) return null;
  if (minutes < 1) return null;
  return `≈ ${Math.round(minutes)} min left in chapter`;
}

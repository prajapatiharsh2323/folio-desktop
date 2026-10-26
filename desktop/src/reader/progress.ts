// Progress persistence with write gates (04 §8):
//   - write if changed ≥ 0.4% absolute OR ≥ 500 ms since last write
//   - at least every 3 s while turning (locators keep arriving)
//   - flush-on-close always writes final (only if changed)
//   - no seek writes for the first 60 s after a restore (anti-loop)
import { roundPercent } from "../model/defaults";
import type { PaceState } from "./pace";

export interface ProgressSnapshot {
  location: string;
  percent: number;
  pace?: PaceState | null;
}

const GATE_PERCENT = 0.4;
const GATE_MS = 500;
const TURN_PERIODIC_MS = 3000;
const RESTORE_SUPPRESS_MS = 60000;

export class ProgressWriter {
  private lastWritten: ProgressSnapshot | null = null;
  private lastWriteTs = 0;
  private lastLocatorTs = 0;
  private restoreDoneTs: number | null = null;
  private pending: ProgressSnapshot | null = null;

  constructor(
    private persist: (p: ProgressSnapshot) => Promise<void>,
    private now: () => number = () => Date.now()
  ) {}

  /** True once any progress snapshot has been persisted. */
  get hasWritten(): boolean {
    return this.lastWritten !== null;
  }

  /** Called after the restore `go()` completes — suppress writes for 60 s. */
  restoreCompleted(): void {
    this.restoreDoneTs = this.now();
  }

  /** Write the post-restore snapshot once, then suppress seek writes for 60 s
   *  (04 §8: "immediately write progress.json once ... no seek writes"). */
  async writeRestored(next: ProgressSnapshot): Promise<boolean> {
    const now = this.now();
    const snapshot: ProgressSnapshot = {
      ...next,
      percent: roundPercent(next.percent),
    };
    await this.write(snapshot, now);
    this.restoreDoneTs = now;
    return true;
  }

  private suppressed(now: number): boolean {
    return this.restoreDoneTs !== null && now - this.restoreDoneTs < RESTORE_SUPPRESS_MS;
  }

  shouldWrite(next: ProgressSnapshot, now: number): boolean {
    if (this.lastWritten === null) return true;
    const delta = Math.abs(next.percent - this.lastWritten.percent);
    if (delta >= GATE_PERCENT) return true;
    if (now - this.lastWriteTs >= GATE_MS && next.location !== this.lastWritten.location) return true;
    // periodic write while turning (locators arriving)
    if (now - this.lastWriteTs >= TURN_PERIODIC_MS && this.lastLocatorTs > this.lastWriteTs) return true;
    return false;
  }

  /** Feed each locator event. Returns true when a write was performed. */
  async onLocator(next: ProgressSnapshot): Promise<boolean> {
    return this.record(next, false);
  }

  /** Scrubbing to a position: treated like a locator, but suppressible during
   *  the 60 s restore window (04 §8 "no seek writes"). */
  async onScrub(next: ProgressSnapshot): Promise<boolean> {
    return this.record(next, true);
  }

  private async record(next: ProgressSnapshot, isSeek: boolean): Promise<boolean> {
    const now = this.now();
    this.lastLocatorTs = now;
    const snapshot: ProgressSnapshot = {
      ...next,
      percent: roundPercent(next.percent),
    };
    if (isSeek && this.suppressed(now)) {
      this.pending = snapshot;
      return false;
    }
    if (!this.shouldWrite(snapshot, now)) {
      this.pending = snapshot;
      return false;
    }
    await this.write(snapshot, now);
    return true;
  }

  /** Flush-on-close: always writes the latest locator if anything changed (04 §8). */
  async flush(): Promise<boolean> {
    const now = this.now();
    const candidate = this.pending;
    if (!candidate) return false;
    if (
      this.lastWritten !== null &&
      candidate.percent === this.lastWritten.percent &&
      candidate.location === this.lastWritten.location
    ) {
      return false;
    }
    await this.write(candidate, now);
    return true;
  }

  private async write(snapshot: ProgressSnapshot, now: number): Promise<void> {
    await this.persist(snapshot);
    this.lastWritten = snapshot;
    this.pending = null;
    this.lastWriteTs = now;
  }
}

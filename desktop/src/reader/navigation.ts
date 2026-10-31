import type { ReaderEngine } from "./ReaderEngine";

/**
 * Hooks the coordinator uses to integrate with reader-side state without
 * knowing how that state works. See ReaderScreen for the concrete wiring.
 */
export interface ReaderNavigationHooks {
  /** Called just before a user-initiated move (pace session break). */
  onBeforeMove: () => void;
  /**
   * Seek-gate mirror. While true, locator events are written through the
   * scrub path of the ProgressWriter instead of the continuous-reading path.
   */
  onSeekingChanged: (seeking: boolean) => void;
}

/**
 * Single coordination point for user-initiated navigation (04 §5): page
 * clicks, keyboard, TOC, in-book search, scrubbing and Home/End all funnel
 * through here. The engine stays responsible for talking to Readium — this
 * coordinator does not create or reconfigure the navigator.
 *
 * It owns exactly three things:
 * 1. the seek gate (with refcounting, so overlapping jumps cannot un-gate
 *    the writer while an earlier jump is still settling),
 * 2. outcome sequencing — a request that resolves after a newer one has been
 *    issued is "superseded": its ok/failure no longer describes the reader's
 *    position and is not reported,
 * 3. a boolean contract at every call site, so failures can be surfaced.
 */
export class ReaderNavigationCoordinator {
  /** Id of the most recent request; completion results are compared to it. */
  private seq = 0;
  /** Number of navigation requests currently resolving. */
  private inflight = 0;
  /** In-flight requests that gate the seek state. */
  private seekGated = 0;

  constructor(
    private readonly engine: ReaderEngine,
    private readonly hooks: ReaderNavigationHooks
  ) {}

  /**
   * Was a navigation issued through this coordinator and is it still
   * resolving? ReaderScreen can use this to avoid double-handling.
   */
  get busy(): boolean {
    return this.inflight > 0;
  }

  /** Next page (right zone, ArrowRight/PageDown/Space). Not seek-gated:
   * continuous reading — locator events flow through the normal writer path. */
  async next(): Promise<boolean> {
    this.assertEngine();
    this.hooks.onBeforeMove();
    return this.run(false, () => this.engine.goForward());
  }

  /** Previous page (left zone, ArrowLeft/PageUp/Shift+Space). */
  async previous(): Promise<boolean> {
    this.assertEngine();
    this.hooks.onBeforeMove();
    return this.run(false, () => this.engine.goBackward());
  }

  /** Chapter navigation: TOC picks and in-book search hits. */
  async goToHref(href: string): Promise<boolean> {
    if (!href) return false;
    this.assertEngine();
    this.hooks.onBeforeMove();
    return this.run(true, () => this.engine.go(href));
  }

  /** Progress jump: scrub release, Home/End. Clamped to 0..100. */
  async goToPercent(percent: number): Promise<boolean> {
    if (!Number.isFinite(percent)) return false;
    const clamped = Math.min(100, Math.max(0, percent));
    this.assertEngine();
    this.hooks.onBeforeMove();
    return this.run(true, () => this.engine.go({ percent: clamped }));
  }

  private async run(seek: boolean, nav: () => Promise<boolean>): Promise<boolean> {
    const id = ++this.seq;
    this.inflight++;
    if (seek) {
      this.seekGated++;
      this.hooks.onSeekingChanged(true);
    }
    try {
      const ok = await nav();
      // A newer request has been issued since; it owns the position, so the
      // stale outcome is not allowed to look like a failure.
      return id === this.seq ? ok : true;
    } finally {
      this.inflight--;
      if (seek) {
        this.seekGated--;
        if (this.seekGated === 0) this.hooks.onSeekingChanged(false);
      }
    }
  }

  /** Guard against a destroyed engine dangling behind a stale coordinator. */
  private assertEngine(): void {
    if (!this.engine) throw new Error("navigation after engine teardown");
  }
}

/** Factory used by ReaderScreen per engine instance. */
export function createNavigationCoordinator(
  engine: ReaderEngine,
  hooks: ReaderNavigationHooks
): ReaderNavigationCoordinator {
  return new ReaderNavigationCoordinator(engine, hooks);
}

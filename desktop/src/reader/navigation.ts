import type { ReaderEngine } from "./ReaderEngine";

/**
 * Where a move came from. Kept so the reader can tell "the user picked a
 * chapter" apart from "the user is holding the arrow key", and so a stale
 * completion never reports itself as a failure for an unrelated surface.
 */
export type NavigationOrigin =
  | "button"
  | "keyboard"
  | "page-edge"
  | "contents"
  | "search"
  | "slider"
  | "bookmark"
  | "annotation";

/**
 * Result of one coordinated move.
 *
 * `superseded` means a newer destination was issued before this one landed;
 * its `ok` is deliberately true so call sites do not surface a failure notice
 * for a move the user already replaced.
 */
export interface NavigationOutcome {
  ok: boolean;
  superseded: boolean;
  reason?: string;
}

export interface AnnotationTarget {
  location: string | null | undefined;
  /** Second-step text anchor (quote + up to 32 chars of context). */
  anchor?: { quote: string; prefix: string; suffix: string } | null;
}

/**
 * Hooks the coordinator uses to integrate with reader-side state without
 * knowing how that state works. See ReaderScreen for the concrete wiring.
 */
export interface ReaderNavigationHooks {
  /** Called just before a move actually starts (pace session break). */
  onBeforeMove: () => void;
  /**
   * Seek-gate mirror. While true, locator events are written through the
   * scrub path of the ProgressWriter instead of the continuous-reading path.
   */
  onSeekingChanged: (seeking: boolean) => void;
  /** Newest, non-superseded failure — used for user-facing notices. */
  onOutcome?: (outcome: NavigationOutcome, origin: NavigationOrigin) => void;
}

interface Task {
  id: number;
  origin: NavigationOrigin;
  absolute: boolean;
  move: () => Promise<boolean>;
  resolve: (outcome: NavigationOutcome) => void;
  /** Removed from the queue before it ever started (replaced or invalidated). */
  dropped: boolean;
}

const FAILED_MOVE = "The reader could not complete that move.";

/**
 * Single coordination point for user-initiated navigation (04 §5): buttons,
 * page-edge clicks, keyboard, contents, in-book search, scrubbing, bookmarks
 * and annotation jumps all funnel through here.
 *
 * The engine still owns Readium — this coordinator never creates or
 * reconfigures the navigator. It owns four things:
 *
 * 1. **Serialization** — at most one engine move is in flight, so two
 *    Readium navigation calls can never fight over the position.
 * 2. **Coalescing** — absolute destinations (href / percent / annotation)
 *    share one pending slot; only the newest un-started destination survives.
 *    A destination also drops page turns that were queued against the
 *    pre-jump position.
 * 3. **Ordering** — page turns keep FIFO order, including turns issued after
 *    an absolute destination (they run after it lands).
 * 4. **Outcome discipline** — the seek gate always settles, superseded
 *    completions are never reported as failures, and the newest failure is
 *    surfaced through `onOutcome`.
 */
export class ReaderNavigationCoordinator {
  /** Id of the most recent request of any kind. */
  private seq = 0;
  /** Id of the most recent absolute destination — owns the final position. */
  private latestAbsoluteId = 0;
  /** Page turns waiting to run, in order. */
  private queue: Task[] = [];
  /** The single pending absolute destination (last write wins). */
  private pending: Task | null = null;
  private running = false;
  private seeking = false;

  constructor(
    private readonly engine: ReaderEngine,
    private readonly hooks: ReaderNavigationHooks,
  ) {}

  /** Is any move running or queued? */
  get busy(): boolean {
    return this.running || this.queue.length > 0 || this.pending !== null;
  }

  /** Next page (button, edge zone, ArrowRight/PageDown/Space). */
  next(origin: NavigationOrigin = "keyboard"): Promise<NavigationOutcome> {
    return this.enqueuePageTurn(origin, () => this.engine.goForward());
  }

  /** Previous page (button, edge zone, ArrowLeft/PageUp/Shift+Space). */
  previous(origin: NavigationOrigin = "keyboard"): Promise<NavigationOutcome> {
    return this.enqueuePageTurn(origin, () => this.engine.goBackward());
  }

  /** Chapter navigation: contents picks. */
  goToHref(href: string, origin: NavigationOrigin = "contents"): Promise<NavigationOutcome> {
    if (!href) {
      return Promise.resolve({
        ok: false,
        superseded: false,
        reason: "That section has no destination.",
      });
    }
    return this.enqueueAbsolute(origin, () => this.engine.go(href));
  }

  /** Progress jump: scrub release, Home/End. Clamped to 0..100. */
  goToPercent(percent: number, origin: NavigationOrigin = "slider"): Promise<NavigationOutcome> {
    if (!Number.isFinite(percent)) {
      return Promise.resolve({
        ok: false,
        superseded: false,
        reason: "That position is not valid.",
      });
    }
    const clamped = Math.min(100, Math.max(0, percent));
    return this.enqueueAbsolute(origin, () => this.engine.go({ percent: clamped }));
  }

  /**
   * Bookmark / note / highlight jump. Lands on the chapter first, then makes a
   * best-effort anchored jump to the quote. A failed anchor is not a failed
   * navigation — the chapter position is still the right place.
   */
  goToAnnotation(
    target: AnnotationTarget,
    origin: NavigationOrigin = "annotation",
  ): Promise<NavigationOutcome> {
    const location = target.location ?? "";
    if (!location) {
      return Promise.resolve({
        ok: false,
        superseded: false,
        reason: "That item has no saved reading location.",
      });
    }
    const anchor = target.anchor;
    return this.enqueueAbsolute(origin, async () => {
      const landed = await this.engine.go(location);
      if (!landed) return false;
      if (anchor?.quote?.trim() && this.engine.goAnchored) {
        try {
          await this.engine.goAnchored(anchor.quote, anchor.prefix ?? "", anchor.suffix ?? "");
        } catch {
          /* the chapter landing already succeeded */
        }
      }
      return true;
    });
  }

  private enqueuePageTurn(
    origin: NavigationOrigin,
    move: () => Promise<boolean>,
  ): Promise<NavigationOutcome> {
    return this.enqueue({ origin, absolute: false, move });
  }

  private enqueueAbsolute(
    origin: NavigationOrigin,
    move: () => Promise<boolean>,
  ): Promise<NavigationOutcome> {
    return this.enqueue({ origin, absolute: true, move });
  }

  private enqueue(request: {
    origin: NavigationOrigin;
    absolute: boolean;
    move: () => Promise<boolean>;
  }): Promise<NavigationOutcome> {
    this.assertEngine();
    const id = ++this.seq;
    let resolve!: (outcome: NavigationOutcome) => void;
    const task: Task = {
      id,
      origin: request.origin,
      absolute: request.absolute,
      move: request.move,
      resolve: (outcome) => resolve(outcome),
      dropped: false,
    };
    const promise = new Promise<NavigationOutcome>((r) => {
      resolve = r;
    });

    if (request.absolute) {
      this.latestAbsoluteId = id;
      // Only the newest un-started destination matters.
      if (this.pending) this.drop(this.pending);
      // Queued turns describe the position the user is leaving.
      for (const queued of this.queue.splice(0)) this.drop(queued);
      this.pending = task;
    } else {
      this.queue.push(task);
    }

    void this.drain();
    return promise;
  }

  private drop(task: Task): void {
    task.dropped = true;
    task.resolve({ ok: true, superseded: true });
  }

  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      for (;;) {
        const task = this.takeNext();
        if (!task) break;
        await this.execute(task);
      }
    } finally {
      this.running = false;
      // Never leave the writer stuck in seek mode.
      this.setSeeking(false);
    }
  }

  private takeNext(): Task | null {
    if (this.pending) {
      const task = this.pending;
      this.pending = null;
      return task;
    }
    return this.queue.shift() ?? null;
  }

  private async execute(task: Task): Promise<void> {
    this.hooks.onBeforeMove();
    if (task.absolute) this.setSeeking(true);

    let outcome: NavigationOutcome;
    try {
      const ok = await task.move();
      const superseded = this.isSuperseded(task);
      outcome = {
        ok: superseded ? true : ok,
        superseded,
        reason: ok ? undefined : FAILED_MOVE,
      };
    } catch (error) {
      const superseded = this.isSuperseded(task);
      outcome = {
        ok: superseded,
        superseded,
        reason: error instanceof Error ? error.message : FAILED_MOVE,
      };
    } finally {
      if (task.absolute) this.setSeeking(false);
    }

    task.resolve(outcome);
    if (!outcome.superseded && !outcome.ok) {
      this.hooks.onOutcome?.(outcome, task.origin);
    }
  }

  private isSuperseded(task: Task): boolean {
    if (task.dropped) return true;
    // A page turn only loses to an explicit drop; a destination loses to any
    // newer destination (that one owns where the reader ends up).
    return task.absolute && this.latestAbsoluteId > task.id;
  }

  private setSeeking(next: boolean): void {
    if (this.seeking === next) return;
    this.seeking = next;
    this.hooks.onSeekingChanged(next);
  }

  /** Guard against a destroyed engine dangling behind a stale coordinator. */
  private assertEngine(): void {
    if (!this.engine) throw new Error("navigation after engine teardown");
  }
}

/** Factory used by ReaderScreen per engine instance. */
export function createNavigationCoordinator(
  engine: ReaderEngine,
  hooks: ReaderNavigationHooks,
): ReaderNavigationCoordinator {
  return new ReaderNavigationCoordinator(engine, hooks);
}

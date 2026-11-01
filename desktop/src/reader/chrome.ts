// Reader chrome lifecycle + click zones (03 §5.3, 04 §5, 07 §2, 08 §2).
//
// Visible ⇄ hidden, hiding after CHROME_IDLE_MS of no interaction. Anything the
// user is actively working with holds the chrome open: an open menu, panel or
// dialog, an active search, a text selection, a scrub, keyboard focus inside
// the controls, or the pointer resting on them. The bottom-edge hairline stays
// visible when the chrome hides, so progress is never lost from view.
//
// Click zones are narrow edge bands (page back / page forward) with everything
// in between passing through to the publication — clicking text must never
// toggle the chrome or interrupt a selection.

export const CHROME_IDLE_MS = 3000;
export const SCRUB_GRACE_MS = 1200;
/** Hovering the bottom band reveals the dock for this long, even at rest. */
export const PILLAR_HOVER_MS = 3000;

/** Reasons the chrome must stay on screen. Set semantics: one hold per reason. */
export type ChromeHold =
  | "menu"
  | "panel"
  | "dialog"
  | "search"
  | "selection"
  | "scrub"
  | "focus"
  | "pointer";

export type ChromeVisibility = "visible" | "hidden";

export class ChromeStateMachine {
  private visibility: ChromeVisibility = "visible";
  private lastActivityTs: number;
  private holds = new Set<ChromeHold>();
  private pillarHoverUntil = 0;
  private scrubGraceUntil: number | null = null;

  constructor(private now: () => number = () => Date.now()) {
    this.lastActivityTs = this.now();
  }

  get visible(): boolean {
    return this.visibility === "visible";
  }

  /** True while a menu, panel, dialog, focus or similar hold is active. */
  get held(): boolean {
    return this.holds.size > 0;
  }

  /** Pointer/keyboard activity — show and reschedule the hide. */
  onActivity(): void {
    this.lastActivityTs = this.now();
    this.pillarHoverUntil = 0;
    this.scrubGraceUntil = null;
    this.visibility = "visible";
  }

  /** Cursor rests in the bottom reveal band: show the dock and hold it. */
  onPillarHover(): void {
    this.pillarHoverUntil = this.now() + PILLAR_HOVER_MS;
    this.visibility = "visible";
  }

  /** Keep the chrome up for a named interaction (idempotent per reason). */
  hold(reason: ChromeHold): void {
    const isNew = !this.holds.has(reason);
    this.holds.add(reason);
    if (isNew) {
      this.visibility = "visible";
      this.lastActivityTs = this.now();
    }
  }

  /** Release a named interaction; the idle countdown restarts. */
  release(reason: ChromeHold): void {
    if (this.holds.delete(reason)) this.lastActivityTs = this.now();
  }

  /** `m` / explicit toggle. Refuses to hide the controls out from under a user. */
  toggle(): ChromeVisibility {
    if (this.holds.size > 0) {
      this.visibility = "visible";
      return this.visibility;
    }
    this.scrubGraceUntil = null;
    this.visibility = this.visible ? "hidden" : "visible";
    this.pillarHoverUntil = 0;
    if (this.visible) this.lastActivityTs = this.now();
    return this.visibility;
  }

  onScrubStart(): void {
    this.scrubGraceUntil = null;
    this.hold("scrub");
  }

  onScrubEnd(): void {
    this.release("scrub");
    this.scrubGraceUntil = this.now() + SCRUB_GRACE_MS;
  }

  /** Drive periodically (e.g. 250 ms); returns the new visibility. */
  tick(): ChromeVisibility {
    const now = this.now();
    if (this.holds.size > 0) {
      this.visibility = "visible";
      return this.visibility;
    }
    if (this.scrubGraceUntil !== null) {
      if (now < this.scrubGraceUntil) {
        this.visibility = "visible";
        return this.visibility;
      }
      this.scrubGraceUntil = null;
      this.visibility = "hidden";
      return this.visibility;
    }
    if (this.visible && this.pillarHoverUntil > now) return this.visibility;
    if (this.visible && now - this.lastActivityTs >= CHROME_IDLE_MS) {
      this.visibility = "hidden";
    }
    return this.visibility;
  }
}

/** Fraction of the canvas that pages back/forward. */
export const EDGE_ZONE_RATIO = 0.08;
export const EDGE_ZONE_MIN_PX = 48;
export const EDGE_ZONE_MAX_PX = 96;

/** Width of one edge band for a canvas of `width` CSS px. */
export function readerEdgeZoneWidth(width: number): number {
  if (!(width > 0)) return 0;
  return Math.min(EDGE_ZONE_MAX_PX, Math.max(EDGE_ZONE_MIN_PX, width * EDGE_ZONE_RATIO));
}

export interface ReaderClickInput {
  x: number;
  width: number;
  /** The click landed on a link/interactive element (supplied by the engine). */
  interactive: boolean;
  /** The engine already consumed the event (target attributes, scripts). */
  defaultPrevented: boolean;
}

export type ReaderClickIntent = "passthrough" | "previous" | "next";

/**
 * Click intent (04 §5): interactive elements and engine-handled events always
 * pass through (links, footnotes, controls). Otherwise only the narrow edge
 * bands navigate; the reading column is inert so text clicks and selection
 * drags never change the reader's position or chrome state.
 */
export function intentForReaderClick(info: ReaderClickInput): ReaderClickIntent {
  if (info.defaultPrevented || info.interactive) return "passthrough";
  if (!(info.width > 0)) return "passthrough";
  const edge = readerEdgeZoneWidth(info.width);
  if (info.x <= edge) return "previous";
  if (info.x >= info.width - edge) return "next";
  return "passthrough";
}

// Reader chrome auto-hide state machine (03 §5.3, 04 §5):
// visible ⇄ hidden; hide after CHROME_IDLE_MS of no pointer activity;
// scrubbing keeps chrome visible and holds a 1.2 s grace after scrub end;
// middle-third click toggles chrome explicitly (04 §5).

export const CHROME_IDLE_MS = 3000;
export const SCRUB_GRACE_MS = 1200;

export type ChromeVisibility = "visible" | "hidden";

export class ChromeStateMachine {
  private visibility: ChromeVisibility = "visible";
  private lastActivityTs = 0;
  private scrubEndTs: number | null = null;
  private scrubbing = false;

  constructor(private now: () => number = () => Date.now()) {
    this.lastActivityTs = this.now();
  }

  get visible(): boolean {
    return this.visibility === "visible";
  }

  /** Pointer activity / menu hover — show and reschedule the hide. */
  onActivity(): void {
    this.lastActivityTs = this.now();
    this.visibility = "visible";
  }

  /** Middle-third click toggles chrome (04 §5). */
  toggle(): void {
    this.visibility = this.visible ? "hidden" : "visible";
    if (this.visible) this.lastActivityTs = this.now();
  }

  onScrubStart(): void {
    this.scrubbing = true;
    this.scrubEndTs = null;
    this.visibility = "visible";
  }

  onScrubEnd(): void {
    this.scrubbing = false;
    this.scrubEndTs = this.now();
  }

  /** Drive periodically (e.g. 250 ms); returns the new visibility. */
  tick(): ChromeVisibility {
    const now = this.now();
    if (this.scrubbing) return this.visibility;
    if (this.scrubEndTs !== null) {
      if (now - this.scrubEndTs >= SCRUB_GRACE_MS) {
        this.scrubEndTs = null;
        this.visibility = "hidden";
      }
      return this.visibility;
    }
    if (this.visible && now - this.lastActivityTs >= CHROME_IDLE_MS) {
      this.visibility = "hidden";
    }
    return this.visibility;
  }

  /** Click-zone resolution (04 §5): thirds over the reader canvas. */
  static zoneForClick(x: number, width: number): "back" | "forward" | "toggle" {
    const third = width / 3;
    if (x < third) return "back";
    if (x > width - third) return "forward";
    return "toggle";
  }
}

export interface ReaderClickInput {
  x: number;
  width: number;
  /** The click landed on a link/interactive element (supplied by the engine). */
  interactive: boolean;
  /** The engine already consumed the event (target attributes, scripts). */
  defaultPrevented: boolean;
}

export type ReaderClickIntent = "passthrough" | "back" | "forward" | "toggle";

/**
 * Click intent (04 §5): taps on interactive elements or events the engine
 * already handled go back to the engine (links, footnotes, controls);
 * everything else is resolved by the thirds zones.
 */
export function intentForReaderClick(info: ReaderClickInput): ReaderClickIntent {
  if (info.defaultPrevented || info.interactive) return "passthrough";
  return ChromeStateMachine.zoneForClick(info.x, info.width);
}

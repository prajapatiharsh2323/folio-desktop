import { describe, it, expect } from "vitest";
import {
  createNavigationCoordinator,
  type NavigationOutcome,
  type NavigationOrigin,
  type ReaderNavigationHooks,
} from "../src/reader/navigation";
import type { ReaderEngine } from "../src/reader/ReaderEngine";

type Deferred = { resolve: (ok: boolean) => void; promise: Promise<boolean> };

function deferred(): Deferred {
  let resolve!: (ok: boolean) => void;
  const promise = new Promise<boolean>((r) => (resolve = r));
  return { resolve, promise };
}

/** Let the coordinator's queue advance past a completed engine call. */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Engine double implementing only the navigation surface the coordinator
 * touches. Every call is recorded and can be resolved out of order, which is
 * how serialization and coalescing are asserted.
 */
class FakeEngine {
  goCalls: Array<string | { percent: number }> = [];
  turnCalls: string[] = [];
  anchoredCalls: Array<{ quote: string; prefix: string; suffix: string }> = [];
  /** Fail the next call after it starts instead of returning a promise. */
  throwOnNext: Error | null = null;
  anchorResult = true;
  private goDeferreds: Deferred[] = [];
  private turnDeferreds: Deferred[] = [];

  go(locator: string | { percent: number }): Promise<boolean> {
    this.goCalls.push(locator);
    if (this.throwOnNext) {
      const error = this.throwOnNext;
      this.throwOnNext = null;
      return Promise.reject(error);
    }
    const d = deferred();
    this.goDeferreds.push(d);
    return d.promise;
  }

  goForward(): Promise<boolean> {
    return this.pushTurn("forward");
  }

  goBackward(): Promise<boolean> {
    return this.pushTurn("backward");
  }

  async goAnchored(quote: string, prefix: string, suffix: string): Promise<boolean> {
    this.anchoredCalls.push({ quote, prefix, suffix });
    return this.anchorResult;
  }

  private pushTurn(direction: "forward" | "backward"): Promise<boolean> {
    this.turnCalls.push(direction);
    const d = deferred();
    this.turnDeferreds.push(d);
    return d.promise;
  }

  goAt(i: number): Deferred {
    const d = this.goDeferreds[i];
    if (!d) throw new Error(`no go() call at ${i}`);
    return d;
  }

  turnAt(i: number): Deferred {
    const d = this.turnDeferreds[i];
    if (!d) throw new Error(`no turn() call at ${i}`);
    return d;
  }
}

function makeHooks() {
  const calls: {
    before: number;
    seeking: boolean[];
    outcomes: Array<{ outcome: NavigationOutcome; origin: NavigationOrigin }>;
  } = { before: 0, seeking: [], outcomes: [] };
  const hooks: ReaderNavigationHooks = {
    onBeforeMove: () => {
      calls.before++;
    },
    onSeekingChanged: (seeking) => {
      calls.seeking.push(seeking);
    },
    onOutcome: (outcome, origin) => {
      calls.outcomes.push({ outcome, origin });
    },
  };
  return { hooks, calls };
}

function setup() {
  const fake = new FakeEngine();
  const { hooks, calls } = makeHooks();
  const nav = createNavigationCoordinator(fake as unknown as ReaderEngine, hooks);
  return { fake, nav, calls };
}

describe("ReaderNavigationCoordinator", () => {
  it("routes page turns and never touches the seek gate", async () => {
    const { fake, nav, calls } = setup();

    const next = nav.next();
    expect(fake.turnCalls).toEqual(["forward"]);
    fake.turnAt(0).resolve(true);
    await expect(next).resolves.toEqual({ ok: true, superseded: false });

    const prev = nav.previous();
    fake.turnAt(1).resolve(true);
    await expect(prev).resolves.toEqual({ ok: true, superseded: false });

    expect(fake.turnCalls).toEqual(["forward", "backward"]);
    expect(calls.seeking).toEqual([]);
    expect(calls.before).toBe(2);
  });

  it("passes the engine's outcome through for href navigation", async () => {
    const { fake, nav } = setup();

    const ok = nav.goToHref("chap1.xhtml");
    fake.goAt(0).resolve(true);
    await expect(ok).resolves.toEqual({ ok: true, superseded: false });

    const bad = nav.goToHref("chap2.xhtml");
    fake.goAt(1).resolve(false);
    await expect(bad).resolves.toEqual({
      ok: false,
      superseded: false,
      reason: "The reader could not complete that move.",
    });

    expect(fake.goCalls).toEqual(["chap1.xhtml", "chap2.xhtml"]);
  });

  it("clamps percent jumps and rejects non-finite values without moving", async () => {
    const { fake, nav } = setup();

    await expect(nav.goToPercent(Number.NaN)).resolves.toMatchObject({ ok: false });

    const over = nav.goToPercent(120);
    fake.goAt(0).resolve(true);
    await over;
    await settle();

    const under = nav.goToPercent(-5);
    fake.goAt(1).resolve(true);
    await under;
    await settle();

    const middle = nav.goToPercent(63.5);
    fake.goAt(2).resolve(true);
    await middle;

    expect(fake.goCalls).toEqual([{ percent: 100 }, { percent: 0 }, { percent: 63.5 }]);
  });

  it("rejects empty hrefs without touching the engine", async () => {
    const { fake, nav } = setup();
    await expect(nav.goToHref("")).resolves.toMatchObject({ ok: false, superseded: false });
    expect(fake.goCalls).toEqual([]);
  });

  it("sets the seek gate for the duration of a jump", async () => {
    const { fake, nav, calls } = setup();

    const jump = nav.goToPercent(40);
    expect(calls.seeking).toEqual([true]);
    fake.goAt(0).resolve(true);
    await jump;
    expect(calls.seeking).toEqual([true, false]);
  });

  it("serializes engine calls: one move in flight at a time", async () => {
    const { fake, nav } = setup();

    const first = nav.goToHref("a.xhtml");
    const second = nav.goToHref("b.xhtml");
    // The newer destination waits instead of racing Readium.
    expect(fake.goCalls).toEqual(["a.xhtml"]);

    fake.goAt(0).resolve(true);
    await expect(first).resolves.toMatchObject({ ok: true, superseded: true });
    await settle();
    expect(fake.goCalls).toEqual(["a.xhtml", "b.xhtml"]);

    fake.goAt(1).resolve(true);
    await expect(second).resolves.toEqual({ ok: true, superseded: false });
  });

  it("coalesces obsolete pending jumps into the newest destination", async () => {
    const { fake, nav } = setup();

    const first = nav.goToPercent(10);
    const dropped = nav.goToPercent(20);
    const latest = nav.goToPercent(30);

    await expect(dropped).resolves.toEqual({ ok: true, superseded: true });
    expect(fake.goCalls).toEqual([{ percent: 10 }]);

    fake.goAt(0).resolve(true);
    await first;
    await settle();
    // 20% never reached the engine at all.
    expect(fake.goCalls).toEqual([{ percent: 10 }, { percent: 30 }]);

    fake.goAt(1).resolve(true);
    await expect(latest).resolves.toEqual({ ok: true, superseded: false });
  });

  it("a chapter destination drops page turns queued against the old position", async () => {
    const { fake, nav } = setup();

    const runningTurn = nav.next();
    const queuedTurn = nav.next();
    const jump = nav.goToHref("chapter.xhtml");

    await expect(queuedTurn).resolves.toEqual({ ok: true, superseded: true });

    fake.turnAt(0).resolve(true);
    await runningTurn;
    await settle();
    expect(fake.turnCalls).toEqual(["forward"]);
    expect(fake.goCalls).toEqual(["chapter.xhtml"]);

    fake.goAt(0).resolve(true);
    await jump;
  });

  it("a page turn issued after a destination runs after it", async () => {
    const { fake, nav } = setup();

    const jump = nav.goToHref("chapter.xhtml");
    const turn = nav.next();
    expect(fake.turnCalls).toEqual([]);

    fake.goAt(0).resolve(true);
    await jump;
    await settle();
    expect(fake.turnCalls).toEqual(["forward"]);

    fake.turnAt(0).resolve(true);
    await expect(turn).resolves.toEqual({ ok: true, superseded: false });
  });

  it("preserves rapid sequential page turns, one at a time", async () => {
    const { fake, nav } = setup();

    const a = nav.next();
    const b = nav.next();
    const c = nav.next();
    expect(fake.turnCalls).toEqual(["forward"]);

    fake.turnAt(0).resolve(true);
    await settle();
    expect(fake.turnCalls).toEqual(["forward", "forward"]);

    fake.turnAt(1).resolve(true);
    await settle();
    expect(fake.turnCalls).toEqual(["forward", "forward", "forward"]);

    fake.turnAt(2).resolve(true);
    await expect(Promise.all([a, b, c])).resolves.toEqual([
      { ok: true, superseded: false },
      { ok: true, superseded: false },
      { ok: true, superseded: false },
    ]);
  });

  it("settles the seek gate when the engine throws", async () => {
    const { fake, nav, calls } = setup();

    fake.throwOnNext = new Error("navigator gone");
    await expect(nav.goToPercent(50)).resolves.toEqual({
      ok: false,
      superseded: false,
      reason: "navigator gone",
    });
    expect(calls.seeking).toEqual([true, false]);
    expect(nav.busy).toBe(false);
  });

  it("never reports a superseded failure, but does report the newest one", async () => {
    const { fake, nav, calls } = setup();

    const stale = nav.goToPercent(10);
    const newest = nav.goToPercent(20);

    fake.goAt(0).resolve(false);
    await expect(stale).resolves.toMatchObject({ ok: true, superseded: true });
    expect(calls.outcomes).toEqual([]);

    fake.goAt(1).resolve(false);
    await expect(newest).resolves.toMatchObject({ ok: false, superseded: false });
    expect(calls.outcomes).toHaveLength(1);
    expect(calls.outcomes[0].origin).toBe("slider");
    expect(calls.outcomes[0].outcome.ok).toBe(false);
  });

  it("keeps the origin of the request that actually moved", async () => {
    const { fake, nav, calls } = setup();

    const jump = nav.goToHref("chapter.xhtml", "contents");
    fake.goAt(0).resolve(false);
    await jump;

    expect(calls.outcomes[0].origin).toBe("contents");
  });

  it("reports busy while running or queued", async () => {
    const { fake, nav } = setup();
    expect(nav.busy).toBe(false);

    const first = nav.next();
    expect(nav.busy).toBe(true);
    const second = nav.next();
    expect(nav.busy).toBe(true);

    fake.turnAt(0).resolve(true);
    await first;
    expect(nav.busy).toBe(true); // second still queued
    await settle();

    fake.turnAt(1).resolve(true);
    await second;
    await settle();
    expect(nav.busy).toBe(false);

    const jump = nav.goToHref("x.xhtml");
    expect(nav.busy).toBe(true);
    fake.goAt(0).resolve(false);
    await jump;
    await settle();
    expect(nav.busy).toBe(false);
  });

  it("jumps to an annotation in two steps: chapter, then text anchor", async () => {
    const { fake, nav } = setup();

    const jump = nav.goToAnnotation({
      location: "ch.xhtml?p=0.4",
      anchor: { quote: "Call me Ishmael", prefix: "pre", suffix: "post" },
    });
    expect(fake.goCalls).toEqual(["ch.xhtml?p=0.4"]);

    fake.goAt(0).resolve(true);
    await expect(jump).resolves.toEqual({ ok: true, superseded: false });
    expect(fake.anchoredCalls).toEqual([
      { quote: "Call me Ishmael", prefix: "pre", suffix: "post" },
    ]);
  });

  it("a failed text anchor does not fail the chapter landing", async () => {
    const { fake, nav } = setup();
    fake.anchorResult = false;

    const jump = nav.goToAnnotation({
      location: "ch.xhtml",
      anchor: { quote: "quote", prefix: "", suffix: "" },
    });
    fake.goAt(0).resolve(true);
    await expect(jump).resolves.toEqual({ ok: true, superseded: false });
  });

  it("rejects an annotation with no location without moving", async () => {
    const { fake, nav } = setup();
    await expect(nav.goToAnnotation({ location: null })).resolves.toMatchObject({
      ok: false,
      superseded: false,
    });
    expect(fake.goCalls).toEqual([]);
  });
});

describe("position history (R4 back navigation)", () => {
  function setupHistory(initial = "ch1.xhtml") {
    const fake = new FakeEngine();
    const { hooks, calls } = makeHooks();
    let current = initial;
    hooks.getCurrentLocation = () => current;
    const nav = createNavigationCoordinator(fake as unknown as ReaderEngine, hooks);
    return { fake, nav, calls, setCurrent: (v: string) => (current = v) };
  }

  /** goAt, but tolerant of the drain loop needing a tick to start the move. */
  async function goAtWait(fake: FakeEngine, i: number): Promise<Deferred> {
    for (let t = 0; t < 20; t++) {
      try {
        return fake.goAt(i);
      } catch {
        await new Promise((r) => setTimeout(r, 5));
      }
    }
    return fake.goAt(i);
  }

  it("records the position left behind and goBack returns to it", async () => {
    const { fake, nav, setCurrent } = setupHistory();

    const move = nav.goToHref("ch2.xhtml", "contents");
    fake.goAt(0).resolve(true);
    await expect(move).resolves.toEqual({ ok: true, superseded: false });
    setCurrent("ch2.xhtml");
    expect(nav.canGoBack()).toBe(true);

    const back = nav.goBack();
    fake.goAt(1).resolve(true);
    await expect(back).resolves.toEqual({ ok: true, superseded: false });
    expect(fake.goCalls).toEqual(["ch2.xhtml", "ch1.xhtml"]);
    expect(nav.canGoBack()).toBe(false);
  });

  it("an internal link follow is recorded like any absolute move", async () => {
    const { fake, nav, setCurrent } = setupHistory();

    const move = nav.goToHref("footnote.xhtml#fn1", "link");
    fake.goAt(0).resolve(true);
    await move;
    await settle();
    setCurrent("footnote.xhtml");

    const back = nav.goBack();
    fake.goAt(1).resolve(true);
    await back;
    expect(fake.goCalls).toEqual(["footnote.xhtml#fn1", "ch1.xhtml"]);
  });

  it("back with no recorded position fails without moving", async () => {
    const { fake, nav } = setupHistory();

    await expect(nav.goBack()).resolves.toMatchObject({
      ok: false,
      superseded: false,
      reason: "No earlier position to go back to.",
    });
    expect(fake.goCalls).toEqual([]);
  });

  it("a scrub jump records nothing, a back move records nothing", async () => {
    const { fake, nav, setCurrent } = setupHistory();

    const jump = nav.goToPercent(40, "slider");
    fake.goAt(0).resolve(true);
    await jump;
    await settle();
    setCurrent("mid.xhtml");
    expect(nav.canGoBack()).toBe(false);

    // Seed one entry, go back, then check the landing was not recorded.
    const move = nav.goToHref("ch2.xhtml", "contents");
    fake.goAt(1).resolve(true);
    await move;
    await settle();
    setCurrent("ch2.xhtml");

    const back = nav.goBack();
    fake.goAt(2).resolve(true);
    await back;
    setCurrent("ch1.xhtml");
    expect(nav.canGoBack()).toBe(false);
  });

  it("a coalesced destination chain records only the starting position", async () => {
    const { fake, nav, setCurrent } = setupHistory();

    const first = nav.goToHref("ch2.xhtml", "contents");
    const second = nav.goToHref("ch3.xhtml", "search");
    // first is already executing (the drain took it), so it resolves as
    // superseded only when its in-flight engine move settles.
    (await goAtWait(fake, 0)).resolve(true);
    await expect(first).resolves.toMatchObject({ ok: true, superseded: true });
    (await goAtWait(fake, 1)).resolve(true);
    await expect(second).resolves.toEqual({ ok: true, superseded: false });
    await settle();
    setCurrent("ch3.xhtml");

    const back = nav.goBack();
    (await goAtWait(fake, 2)).resolve(true);
    await back;
    // Back returned to the original position, not the superseded ch2.
    expect(fake.goCalls.at(-1)).toBe("ch1.xhtml");
  });

  it("a jump to the current position records nothing", async () => {
    const { fake, nav } = setupHistory();

    const move = nav.goToHref("ch1.xhtml", "contents");
    fake.goAt(0).resolve(true);
    await move;
    expect(nav.canGoBack()).toBe(false);
  });

  it("keeps history bounded at 50 entries", async () => {
    const { fake, nav, setCurrent } = setupHistory();

    for (let i = 1; i <= 55; i++) {
      const move = nav.goToHref(`ch${i + 1}.xhtml`, "contents");
      fake.goAt(i - 1).resolve(true);
      await move;
      await settle();
      setCurrent(`ch${i + 1}.xhtml`);
    }

    expect(nav.canGoBack()).toBe(true);
    // Back pops the newest recorded position first.
    let back = nav.goBack();
    (await goAtWait(fake, 55)).resolve(true);
    await back;
    expect(fake.goCalls.at(-1)).toBe("ch55.xhtml");

    // Exactly 50 entries were kept: ch55 is #50; the next 49 pops succeed
    // (reaching ch6), then the stack is empty.
    for (let i = 54; i >= 6; i--) {
      back = nav.goBack();
      (await goAtWait(fake, 56 + (54 - i))).resolve(true);
      await back;
    }
    expect(fake.goCalls.at(-1)).toBe("ch6.xhtml");
    expect(nav.canGoBack()).toBe(false);
    await expect(nav.goBack()).resolves.toMatchObject({ ok: false });
  });
});

describe("forward history (X1 Alt+Right)", () => {
  function setupHistory(initial = "ch1.xhtml") {
    const fake = new FakeEngine();
    const { hooks } = makeHooks();
    let current = initial;
    hooks.getCurrentLocation = () => current;
    const nav = createNavigationCoordinator(fake as unknown as ReaderEngine, hooks);
    return { fake, nav, setCurrent: (v: string) => (current = v) };
  }

  it("goForward returns to the position Back left behind", async () => {
    const { fake, nav, setCurrent } = setupHistory();

    const move = nav.goToHref("ch2.xhtml", "contents");
    fake.goAt(0).resolve(true);
    await move;
    await settle();
    setCurrent("ch2.xhtml");

    const back = nav.goBack();
    fake.goAt(1).resolve(true);
    await back;
    setCurrent("ch1.xhtml");
    expect(nav.canGoForward()).toBe(true);

    const fwd = nav.goForward();
    await settle();
    fake.goAt(2).resolve(true);
    await expect(fwd).resolves.toEqual({ ok: true, superseded: false });
    expect(fake.goCalls.at(-1)).toBe("ch2.xhtml");
    setCurrent("ch2.xhtml");
    // consumed
    expect(nav.canGoForward()).toBe(false);
  });

  it("a new absolute move clears the forward stack", async () => {
    const { fake, nav, setCurrent } = setupHistory();

    let move = nav.goToHref("ch2.xhtml", "contents");
    fake.goAt(0).resolve(true);
    await move;
    await settle();
    setCurrent("ch2.xhtml");

    const back = nav.goBack();
    fake.goAt(1).resolve(true);
    await back;
    setCurrent("ch1.xhtml");
    expect(nav.canGoForward()).toBe(true);

    // A fresh destination abandons the re-advance chain.
    move = nav.goToHref("ch5.xhtml", "contents");
    await settle();
    fake.goAt(2).resolve(true);
    await move;
    setCurrent("ch5.xhtml");
    expect(nav.canGoForward()).toBe(false);
    await expect(nav.goForward()).resolves.toMatchObject({ ok: false });
    void back;
  });

  it("a scrub jump also clears the forward stack but records no history", async () => {
    const { fake, nav, setCurrent } = setupHistory();

    const move = nav.goToHref("ch2.xhtml", "contents");
    fake.goAt(0).resolve(true);
    await move;
    await settle();
    setCurrent("ch2.xhtml");

    const back = nav.goBack();
    fake.goAt(1).resolve(true);
    await back;
    setCurrent("ch1.xhtml");

    const jump = nav.goToPercent(40, "slider");
    await settle();
    fake.goAt(2).resolve(true);
    await jump;
    setCurrent("mid.xhtml");
    expect(nav.canGoForward()).toBe(false);
    expect(nav.canGoBack()).toBe(false);
  });

  it("forward with nothing to re-advance to fails without moving", async () => {
    const { fake, nav } = setupHistory();
    await expect(nav.goForward()).resolves.toMatchObject({
      ok: false,
      superseded: false,
      reason: "No later position to go forward to.",
    });
    expect(fake.goCalls).toEqual([]);
  });
});

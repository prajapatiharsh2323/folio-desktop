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

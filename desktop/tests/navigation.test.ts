import { describe, it, expect } from "vitest";
import {
  createNavigationCoordinator,
  type ReaderNavigationHooks,
} from "../src/reader/navigation";
import type { ReaderEngine } from "../src/reader/ReaderEngine";

type Deferred = { resolve: (ok: boolean) => void; promise: Promise<boolean> };

function deferred(): Deferred {
  let resolve!: (ok: boolean) => void;
  const promise = new Promise<boolean>((r) => (resolve = r));
  return { resolve, promise };
}

/**
 * Engine double implementing only the navigation surface the coordinator
 * touches. Calls are recorded; each navigation produces a deferrable result
 * so tests control resolution order explicitly.
 */
class FakeEngine {
  goCalls: Array<string | { percent: number }> = [];
  turnCalls: string[] = [];
  private goDeferreds: Deferred[] = [];
  private turnDeferreds: Deferred[] = [];

  go(locator: string | { percent: number }): Promise<boolean> {
    this.goCalls.push(locator);
    const d = deferred();
    this.goDeferreds.push(d);
    return d.promise;
  }

  goForward(): Promise<boolean> {
    this.turnCalls.push("forward");
    return this.pushTurn();
  }

  goBackward(): Promise<boolean> {
    this.turnCalls.push("backward");
    return this.pushTurn();
  }

  private pushTurn(): Promise<boolean> {
    const d = deferred();
    this.turnDeferreds.push(d);
    return d.promise;
  }

  /** Deferred of the i-th go() call (FIFO). */
  goAt(i: number): Deferred {
    return this.goDeferreds[i];
  }

  /** Deferred of the i-th turn call (FIFO). */
  turnAt(i: number): Deferred {
    return this.turnDeferreds[i];
  }
}

function makeHooks() {
  const calls: { before: number; seeking: boolean[] } = { before: 0, seeking: [] };
  const hooks: ReaderNavigationHooks = {
    onBeforeMove: () => {
      calls.before++;
    },
    onSeekingChanged: (seeking) => {
      calls.seeking.push(seeking);
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
    fake.turnAt(0).resolve(true);
    await expect(next).resolves.toBe(true);

    const prev = nav.previous();
    fake.turnAt(1).resolve(true);
    await expect(prev).resolves.toBe(true);

    expect(fake.turnCalls).toEqual(["forward", "backward"]);
    expect(calls.seeking).toEqual([]);
    expect(calls.before).toBe(2);
  });

  it("passes the engine's outcome through for href navigation", async () => {
    const { fake, nav } = setup();

    const ok = nav.goToHref("chap1.xhtml");
    fake.goAt(0).resolve(true);
    await expect(ok).resolves.toBe(true);

    const bad = nav.goToHref("chap2.xhtml");
    fake.goAt(1).resolve(false);
    await expect(bad).resolves.toBe(false);

    expect(fake.goCalls).toEqual(["chap1.xhtml", "chap2.xhtml"]);
  });

  it("clamps percent jumps and rejects non-finite values", async () => {
    const { fake, nav } = setup();

    const over = nav.goToPercent(120);
    fake.goAt(0).resolve(true);
    await over;

    const under = nav.goToPercent(-5);
    fake.goAt(1).resolve(true);
    await under;

    const backwards = nav.goToPercent(63.5);
    fake.goAt(2).resolve(true);
    await backwards;

    await expect(nav.goToPercent(Number.NaN)).resolves.toBe(false);

    expect(fake.goCalls).toEqual([
      { percent: 100 },
      { percent: 0 },
      { percent: 63.5 },
    ]);
  });

  it("rejects empty hrefs without touching the engine", async () => {
    const { fake, nav } = setup();
    await expect(nav.goToHref("")).resolves.toBe(false);
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

  it("releases the seek gate only after the last overlapping jump resolves", async () => {
    const { fake, nav, calls } = setup();

    const a = nav.goToHref("a.xhtml");
    const b = nav.goToHref("b.xhtml");

    // First resolves while the second is still in flight.
    fake.goAt(0).resolve(true);
    await a;
    expect(calls.seeking).toEqual([true, true]);

    fake.goAt(1).resolve(true);
    await b;
    expect(calls.seeking.at(-1)).toBe(false);
  });

  it("a superseded navigation is not reported as a failure", async () => {
    const { fake, nav } = setup();

    const first = nav.goToHref("old.xhtml"); // id 1
    const second = nav.goToHref("new.xhtml"); // id 2, now current

    // The older request settles after the newer one was issued and fails.
    fake.goAt(0).resolve(false);
    await expect(first).resolves.toBe(true); // superseded → not a failure

    fake.goAt(1).resolve(true);
    await expect(second).resolves.toBe(true);
  });

  it("a superseded navigation resolves true even when it failed", async () => {
    const { fake, nav } = setup();

    const first = nav.goToPercent(10); // id 1 (gated)
    const second = nav.goToPercent(20); // id 2 (gated)

    fake.goAt(0).resolve(false);
    await expect(first).resolves.toBe(true);
    // Gate must still be held open: second has not resolved yet.
    fake.goAt(1).resolve(true);
    await second;
  });

  it("reports busy true while any navigation is resolving", async () => {
    const { fake, nav } = setup();
    expect(nav.busy).toBe(false);
    const turning = nav.next();
    expect(nav.busy).toBe(true);
    fake.turnAt(0).resolve(true);
    await turning;
    expect(nav.busy).toBe(false);

    const turning2 = nav.goToHref("x.xhtml");
    expect(nav.busy).toBe(true);
    fake.goAt(0).resolve(false);
    await turning2;
    expect(nav.busy).toBe(false);
  });
});

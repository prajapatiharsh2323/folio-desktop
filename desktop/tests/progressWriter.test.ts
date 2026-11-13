import { describe, expect, it } from "vitest";
import { ProgressWriter, type ProgressSnapshot } from "../src/reader/progress";

function setup() {
  let now = 10_000;
  const writes: ProgressSnapshot[] = [];
  const writer = new ProgressWriter(
    async (snapshot) => {
      writes.push(snapshot);
    },
    () => now,
  );
  return {
    writer,
    writes,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe("ProgressWriter", () => {
  it("writes the first locator immediately", async () => {
    const { writer, writes } = setup();
    expect(await writer.onLocator({ location: "a", percent: 1 })).toBe(true);
    expect(writes).toHaveLength(1);
  });

  it("holds sub-threshold moves until flush", async () => {
    const { writer, writes } = setup();
    await writer.onLocator({ location: "a", percent: 1 });
    expect(await writer.onLocator({ location: "b", percent: 1.1 })).toBe(false);
    expect(writes).toHaveLength(1);

    expect(await writer.flush()).toBe(true);
    expect(writes.at(-1)?.location).toBe("b");
  });

  it("does not rewrite an unchanged pending snapshot", async () => {
    const { writer } = setup();
    await writer.onLocator({ location: "a", percent: 1 });
    await writer.onLocator({ location: "b", percent: 1.1 });
    await writer.flush();
    expect(await writer.flush()).toBe(false);
  });

  it("suppresses scrub writes during the restore window but flushes them", async () => {
    const { writer, writes, advance } = setup();
    await writer.writeRestored({ location: "a", percent: 10 });
    advance(1000);
    expect(await writer.onScrub({ location: "b", percent: 60 })).toBe(false);
    expect(writes).toHaveLength(1);

    expect(await writer.flush()).toBe(true);
    expect(writes.at(-1)?.percent).toBe(60);
  });

  it("accepts a locator once the periodic gate expires", async () => {
    const { writer, writes, advance } = setup();
    await writer.onLocator({ location: "a", percent: 1 });
    advance(3001);
    expect(await writer.onLocator({ location: "b", percent: 1.1 })).toBe(true);
    expect(writes).toHaveLength(2);
  });
});

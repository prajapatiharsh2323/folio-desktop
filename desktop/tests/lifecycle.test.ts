import { describe, expect, it, vi } from "vitest";
import { flushAndClose } from "../src/lib/lifecycle";

describe("flushAndClose", () => {
  it("closes when both persistence steps succeed", async () => {
    const close = vi.fn();
    const result = await flushAndClose(
      async () => undefined,
      async () => undefined,
      close
    );
    expect(result).toEqual({ flushFailed: false, releaseFailed: false });
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("still closes and reports a failed flush", async () => {
    const close = vi.fn();
    const result = await flushAndClose(
      async () => {
        throw new Error("disk");
      },
      async () => undefined,
      close
    );
    expect(result.flushFailed).toBe(true);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("still closes when releasing the sleep lock throws", async () => {
    const close = vi.fn();
    const result = await flushAndClose(
      async () => undefined,
      async () => {
        throw new Error("power");
      },
      close
    );
    expect(result.releaseFailed).toBe(true);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("tolerates missing controllers", async () => {
    const close = vi.fn();
    const result = await flushAndClose(() => undefined, () => undefined, close);
    expect(result.flushFailed).toBe(false);
    expect(close).toHaveBeenCalledTimes(1);
  });
});

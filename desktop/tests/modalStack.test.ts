import { afterEach, describe, expect, it } from "vitest";
import {
  isTopModal,
  modalDepth,
  popModal,
  pushModal,
  resetModalStack,
} from "../src/shell/modalStack";

afterEach(resetModalStack);

describe("modal stack", () => {
  it("tracks the topmost surface", () => {
    const first = pushModal();
    const second = pushModal();

    expect(modalDepth()).toBe(2);
    expect(isTopModal(second)).toBe(true);
    expect(isTopModal(first)).toBe(false);

    popModal(second);
    expect(isTopModal(first)).toBe(true);
  });

  it("handles out-of-order unmounts", () => {
    const first = pushModal();
    const second = pushModal();

    popModal(first);
    expect(modalDepth()).toBe(1);
    expect(isTopModal(second)).toBe(true);

    popModal(second);
    expect(modalDepth()).toBe(0);
    expect(isTopModal(second)).toBe(false);
  });

  it("treats unknown or missing tokens as not topmost", () => {
    expect(isTopModal(null)).toBe(false);
    expect(isTopModal(Symbol("never-pushed"))).toBe(false);
  });
});

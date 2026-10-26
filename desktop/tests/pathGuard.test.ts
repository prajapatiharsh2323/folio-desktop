import { describe, it, expect } from "vitest";
import { normalizePath } from "../src/lib/paths";

describe("path guard", () => {
  it("accepts absolute paths", () => {
    expect(normalizePath("/a/b/c")).toBe("/a/b/c");
  });

  it("rejects relative paths", () => {
    expect(() => normalizePath("foo/bar")).toThrow();
  });

  it("rejects traversal", () => {
    expect(() => normalizePath("/a/../b")).toThrow();
    expect(() => normalizePath("/a/..")).toThrow();
  });

  it("rejects null bytes", () => {
    expect(() => normalizePath("/a/b\0c")).toThrow();
  });

  it("collapses redundant slashes", () => {
    expect(normalizePath("/a//b///c")).toBe("/a/b/c");
  });

  it("rejects empty", () => {
    expect(() => normalizePath("")).toThrow();
  });
});
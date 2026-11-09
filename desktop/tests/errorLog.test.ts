import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(() => Promise.resolve()),
}));

import { invoke } from "@tauri-apps/api/core";
import { installGlobalErrorHandlers, reportError } from "../src/lib/errorLog";

const invokeMock = vi.mocked(invoke);

function setTauri(on: boolean) {
  const w = window as unknown as Record<string, unknown>;
  if (on) w.__TAURI_INTERNALS__ = {};
  else delete w.__TAURI_INTERNALS__;
}

beforeEach(() => {
  invokeMock.mockClear();
  setTauri(false);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  setTauri(false);
  vi.restoreAllMocks();
});

describe("local error log", () => {
  it("never calls Tauri outside the desktop runtime", () => {
    reportError(new Error("browser only"), "test");
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("sends context plus message and stack to the Rust logger", () => {
    setTauri(true);
    reportError(new Error("disk full"), "settings.restore");
    expect(invokeMock).toHaveBeenCalledTimes(1);
    const [command, args] = invokeMock.mock.calls[0];
    expect(command).toBe("log_error");
    expect(args).toMatchObject({ context: "settings.restore" });
    expect(String((args as { message: string }).message)).toContain("disk full");
  });

  it("survives values that cannot be stringified", () => {
    setTauri(true);
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => reportError(circular, "odd")).not.toThrow();
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });

  it("captures window errors while installed and stops after cleanup", () => {
    setTauri(true);
    const uninstall = installGlobalErrorHandlers();

    window.dispatchEvent(new ErrorEvent("error", { message: "window boom" }));
    expect(invokeMock).toHaveBeenCalledTimes(1);

    uninstall();
    window.dispatchEvent(new ErrorEvent("error", { message: "ignored" }));
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });
});

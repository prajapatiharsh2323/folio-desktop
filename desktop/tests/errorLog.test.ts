import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(() => Promise.resolve()),
}));

import { invoke } from "@tauri-apps/api/core";
import { installGlobalErrorHandlers, reportError, handleError } from "../src/lib/errorLog";
import { useToasts } from "../src/shell/toasts";

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

describe("handleError", () => {
  beforeEach(() => {
    useToasts.setState({ toast: null });
  });

  it("always logs, and toasts with the given user message", () => {
    setTauri(true);
    handleError(new Error("note write failed"), {
      context: "reader.annotations",
      userMessage: "The note could not be saved.",
    });
    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock.mock.calls[0][0]).toBe("log_error");
    expect(useToasts.getState().toast).toMatchObject({
      tone: "error",
      text: "The note could not be saved.",
    });
  });

  it("logs without a toast when no user message is given", () => {
    setTauri(true);
    handleError(new Error("silent path"), { context: "reader.paint" });
    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(useToasts.getState().toast).toBeNull();
  });

  it("passes detail lines through to the toast", () => {
    handleError(new Error("batch"), {
      context: "import.queue",
      userMessage: "Some files could not be imported.",
      details: ["a.epub: too large"],
    });
    expect(useToasts.getState().toast?.details).toEqual(["a.epub: too large"]);
  });

  it("still logs when the toast host is unavailable", () => {
    setTauri(true);
    const spy = vi.spyOn(useToasts, "getState").mockImplementation(() => {
      throw new Error("host gone");
    });
    expect(() =>
      handleError(new Error("boom"), { context: "x", userMessage: "Shown" }),
    ).not.toThrow();
    expect(invokeMock).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});

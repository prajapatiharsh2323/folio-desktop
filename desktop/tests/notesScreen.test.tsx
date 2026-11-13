import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const h = vi.hoisted(() => ({
  load: vi.fn(),
  list: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
}));

vi.mock("../src/store/libraryUi", () => ({
  getLibraryManager: () => ({
    load: h.load,
    annotations: {
      list: h.list,
      update: h.update,
      remove: h.remove,
    },
  }),
}));

import { NotesScreen } from "../src/screens/NotesScreen";
import { useRouteStore } from "../src/store/routeStore";
import { useToasts } from "../src/shell/toasts";
import { resetModalStack } from "../src/shell/modalStack";

const NOTE = {
  id: "a1",
  docId: "d1",
  quote: "A remembered line",
  prefix: "",
  suffix: "",
  location: null,
  kind: "note" as const,
  color: null,
  note: "Original note",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

let container: HTMLDivElement | null = null;
let root: Root | null = null;

function button(label: string): HTMLButtonElement {
  const found = Array.from(container!.querySelectorAll<HTMLButtonElement>("button")).find(
    (b) => b.getAttribute("aria-label") === label || b.textContent?.trim() === label,
  );
  if (!found) throw new Error(`button ${label} not found`);
  return found;
}

function dialogButton(label: string): HTMLButtonElement {
  const dialog = container!.querySelector(".folio-dialog");
  const found = Array.from(dialog?.querySelectorAll<HTMLButtonElement>("button") ?? []).find(
    (b) => b.getAttribute("aria-label") === label || b.textContent?.trim() === label,
  );
  if (!found) throw new Error(`dialog button ${label} not found`);
  return found;
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function render() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<NotesScreen />);
  });
  await flush();
}

beforeEach(() => {
  resetModalStack();
  useToasts.setState({ toast: null });
  useRouteStore.setState({ route: "notes", readerRequest: null, readerOrigin: null });
  h.load.mockReset();
  h.list.mockReset();
  h.update.mockReset();
  h.remove.mockReset();
  h.load.mockResolvedValue({
    schema: 1,
    docs: [{ id: "d1", slug: "dune", title: "Dune" }],
  });
  h.list.mockResolvedValue([{ ...NOTE }]);
  h.update.mockResolvedValue(undefined);
  h.remove.mockResolvedValue(undefined);
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = null;
  root = null;
});

describe("Notes screen write safety", () => {
  it("keeps the edit dialog open with the draft when saving fails", async () => {
    h.update.mockRejectedValue(new Error("disk is read-only"));
    await render();

    act(() => button("Edit note").click());
    const textarea = container!.querySelector("textarea")!;
    expect(document.body.textContent).toContain("Edit note");

    await act(async () => {
      button("Save").click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(h.update).toHaveBeenCalledTimes(1);
    expect(useToasts.getState().toast?.tone).toBe("error");
    expect(useToasts.getState().toast?.text).toContain("read-only");
    expect(container!.querySelector("textarea")).toBe(textarea);
    expect(document.body.textContent).toContain("Edit note");
  });

  it("can retry a failed save without reopening the dialog", async () => {
    h.update.mockRejectedValueOnce(new Error("temporary"));
    await render();

    act(() => button("Edit note").click());
    await act(async () => {
      button("Save").click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(useToasts.getState().toast?.tone).toBe("error");

    await act(async () => {
      button("Save").click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(h.update).toHaveBeenCalledTimes(2);
    expect(container!.querySelector("textarea")).toBeNull();
    expect(useToasts.getState().toast?.tone).toBe("error");
  });

  it("keeps the delete confirmation open when deleting fails", async () => {
    h.remove.mockRejectedValue(new Error("busy"));
    await render();

    act(() => button("Delete").click());
    expect(document.body.textContent).toContain("Delete this note?");

    await act(async () => {
      dialogButton("Delete").click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(h.remove).toHaveBeenCalledWith("a1");
    expect(useToasts.getState().toast?.tone).toBe("error");
    expect(document.body.textContent).toContain("Delete this note?");
  });
});

// useAnnotations R5 behaviour: re-highlighting an overlapping span recolours
// or toggles the existing annotation (never duplicates), colour updates and
// deletes repaint, and delete offers an Undo toast that restores the record.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const h = vi.hoisted(() => {
  const annotations: unknown[] = [];
  const calls = { add: [] as unknown[], update: [] as unknown[], remove: [] as string[] };
  const ok = { fail: false };
  return { annotations, calls, ok };
});

vi.mock("../src/store/libraryUi", () => ({
  getLibraryManager: () => ({
    annotations: {
      listForDoc: async (docId: string) =>
        (h.annotations as Array<{ docId: string }>).filter((a) => a.docId === docId),
      add: async (a: unknown) => {
        if (h.ok.fail) throw new Error("disk full");
        h.calls.add.push(a);
        h.annotations.push(a);
      },
      update: async (id: string, patch: unknown) => {
        if (h.ok.fail) throw new Error("disk full");
        h.calls.update.push([id, patch]);
        const idx = (h.annotations as Array<{ id: string }>).findIndex((a) => a.id === id);
        h.annotations[idx] = { ...(h.annotations[idx] as object), ...(patch as object) };
      },
      remove: async (id: string) => {
        if (h.ok.fail) throw new Error("disk full");
        h.calls.remove.push(id);
        const idx = (h.annotations as Array<{ id: string }>).findIndex((a) => a.id === id);
        if (idx === -1) return false;
        h.annotations.splice(idx, 1);
        return true;
      },
    },
  }),
}));

import { useAnnotations } from "../src/screens/reader/useAnnotations";
import type { Annotation } from "../src/model/types";
import type { ReaderEngine, TextSelectionInfo } from "../src/reader/ReaderEngine";
import { resolveReaderTheme } from "../src/reader/readerThemes";
import type { RefObject } from "react";
import { useToasts } from "../src/shell/toasts";

let root: Root | null = null;
let container: HTMLDivElement;

function makeAnnotation(overrides: Partial<Annotation> = {}): Annotation {
  return {
    id: "a1",
    docId: "d1",
    chapterId: null,
    quote: "the quoted line",
    prefix: "",
    suffix: "",
    location: "ch1.xhtml?p=0.2#frag",
    kind: "highlight",
    color: "yellow",
    note: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function selection(overrides: Partial<TextSelectionInfo> = {}): TextSelectionInfo {
  return {
    quote: "the quoted line",
    prefix: "",
    suffix: "",
    location: "ch1.xhtml?p=0.2#frag",
    rect: { top: 10, left: 10, bottom: 12, right: 100 },
    ...overrides,
  };
}

interface Harness {
  result: {
    annotations: Annotation[];
    refreshAnnotations: (id?: string) => Promise<Annotation[]>;
    toggleHighlight: (color: string, sel: TextSelectionInfo) => Promise<void>;
    updateAnnotation: (id: string, patch: Partial<Annotation>) => Promise<boolean>;
    deleteAnnotation: (a: Annotation) => Promise<boolean>;
  };
}

let harness: Harness | null = null;

async function renderHook(docId: string | undefined, load = true) {
  function Probe() {
    const value = useAnnotations({
      docId,
      engineRef: {
        current: { applyDecorations: async () => {} } as unknown as ReaderEngine,
      } as RefObject<ReaderEngine | null>,
      resolveChapterId: () => null,
      showNavNotice: () => {},
      clearSelection: () => {},
      theme: resolveReaderTheme("light", false),
    });
    harness = { result: value as Harness["result"] };
    return null;
  }
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(<Probe />);
  });
  if (load && docId) {
    await act(async () => {
      await harness!.result.refreshAnnotations(docId);
    });
  }
}

function reset() {
  if (root) {
    act(() => {
      root!.unmount();
    });
  }
  h.annotations.length = 0;
  h.calls.add.length = 0;
  h.calls.update.length = 0;
  h.calls.remove.length = 0;
  h.ok.fail = false;
  root = null;
  harness = null;
  document.body.innerHTML = "";
  useToasts.getState().dismiss();
}

describe("useAnnotations overlap + undo (R5)", () => {
  beforeEach(reset);

  it("recolours an overlapping highlight instead of duplicating it", async () => {
    h.annotations.push(makeAnnotation({ id: "h1", color: "yellow" }));
    await renderHook("d1");
    await act(async () => {
      await harness!.result.toggleHighlight("pink", selection());
    });
    expect(h.calls.add).toHaveLength(0);
    const [updatedId, updatedPatch] = h.calls.update[0] as [string, Partial<Annotation>];
    expect(updatedId).toBe("h1");
    expect(updatedPatch).toMatchObject({ color: "pink" });
    expect(harness!.result.annotations).toHaveLength(1);
    expect(harness!.result.annotations[0].color).toBe("pink");
  });

  it("toggles off an overlapping highlight on the same colour", async () => {
    h.annotations.push(makeAnnotation({ id: "h1", color: "yellow" }));
    await renderHook("d1");
    await act(async () => {
      await harness!.result.toggleHighlight("yellow", selection({ quote: "quoted" }));
    });
    expect(h.calls.remove).toEqual(["h1"]);
    expect(h.calls.add).toHaveLength(0);
    expect(harness!.result.annotations).toHaveLength(0);
  });

  it("creates when no highlight overlaps the selection", async () => {
    h.annotations.push(makeAnnotation({ id: "other", quote: "something else" }));
    await renderHook("d1");
    await act(async () => {
      await harness!.result.toggleHighlight("green", selection({ quote: "the quoted line" }));
    });
    expect(h.calls.add).toHaveLength(1);
    expect(harness!.result.annotations.some((a) => a.id === "other")).toBe(true);
  });

  it("delete removes, repaints, and Undo restores the same record", async () => {
    const record = makeAnnotation({ id: "h1", color: "blue", note: "keep me" });
    h.annotations.push(record);
    await renderHook("d1");
    await act(async () => {
      await harness!.result.deleteAnnotation(record);
    });
    expect(h.calls.remove).toEqual(["h1"]);
    expect(harness!.result.annotations).toHaveLength(0);

    const toast = useToasts.getState().toasts[0];
    expect(toast?.text).toContain("deleted");
    expect(toast?.action?.label).toBe("Undo");
    await act(async () => {
      toast!.action!.run();
    });
    // The exact record comes back (id, colour, note, timestamps preserved).
    expect(h.calls.add).toHaveLength(1);
    expect(h.annotations[0]).toEqual(record);
    expect(harness!.result.annotations[0].note).toBe("keep me");
  });

  it("a failed delete shows an error and does not toast Undo", async () => {
    const record = makeAnnotation({ id: "h1" });
    h.annotations.push(record);
    h.ok.fail = true;
    await renderHook("d1");
    await act(async () => {
      const ok = await harness!.result.deleteAnnotation(record);
      expect(ok).toBe(false);
    });
    expect(useToasts.getState().toasts[0]?.action?.label).not.toBe("Undo");
    expect(harness!.result.annotations).toHaveLength(1);
  });

  it("updateAnnotation persists a patch and repaints", async () => {
    h.annotations.push(makeAnnotation({ id: "h1" }));
    await renderHook("d1");
    await act(async () => {
      const ok = await harness!.result.updateAnnotation("h1", { note: "new note" });
      expect(ok).toBe(true);
    });
    expect(h.calls.update).toHaveLength(1);
    expect(harness!.result.annotations[0].note).toBe("new note");
  });
});

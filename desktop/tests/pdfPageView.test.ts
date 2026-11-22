// PdfPageView canvas queue (PDF plan §7.2) with a fake renderer — the queue
// logic is DOM-only and must be testable without pdf.js.
import { describe, expect, it, vi } from "vitest";
import { PdfPageView, type PageRenderer, type PageTextFactory } from "../src/pdf/pdfPageView";
import { layoutPages, type PageLayout } from "../src/pdf/pdfLayout";

const VIEW = { width: 840, height: 900 };
const LETTER = { width: 612, height: 792 };

function makeLayout(pages: number): PageLayout {
  return layoutPages(
    Array.from({ length: pages }, () => LETTER),
    VIEW,
    1,
    "none",
  );
}

function makeRenderer(): PageRenderer & { calls: number[][] } {
  const calls: number[][] = [];
  return {
    calls,
    render(page) {
      calls.push([page]);
      return Promise.resolve();
    },
  };
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("PdfPageView", () => {
  it("creates page boxes only for the visible window and positions them", () => {
    const container = document.createElement("div");
    const renderer = makeRenderer();
    const view = new PdfPageView(container, renderer);
    const layout = makeLayout(10);
    view.sync(layout, [1, 2], 1);

    const boxes = container.querySelectorAll(".folio-pdf-pagebox");
    expect(boxes).toHaveLength(2);
    const first = layout.placements[0];
    const wrapper = boxes[0] as HTMLElement;
    expect(wrapper.style.left).toBe(`${first.left}px`);
    expect(wrapper.style.top).toBe(`${first.top}px`);
    expect(wrapper.style.width).toBe(`${first.width}px`);
    expect(wrapper.dataset.page).toBe("1");
    expect(wrapper.querySelector("canvas")?.className).toBe("folio-pdf-page");
    // every box carries the text + decoration layers even without a factory
    expect(wrapper.querySelector(".folio-pdf-textlayer")).not.toBeNull();
    expect(wrapper.querySelector(".folio-pdf-decorations")).not.toBeNull();
    expect(renderer.calls.map((c) => c[0])).toEqual([1, 2]);
    view.destroy();
  });

  it("does not re-render clean pages on subsequent syncs", async () => {
    const container = document.createElement("div");
    const renderer = makeRenderer();
    const view = new PdfPageView(container, renderer);
    const layout = makeLayout(4);
    view.sync(layout, [1, 2], 1);
    await flush();
    expect(renderer.calls).toHaveLength(2);
    // same layout, overlapping window: nothing dirty
    view.sync(layout, [2, 3], 1);
    await flush();
    expect(renderer.calls.map((c) => c[0])).toEqual([1, 2, 3]);
    view.destroy();
  });

  it("evicts far pages and keeps memory bounded", async () => {
    const container = document.createElement("div");
    const renderer = makeRenderer();
    const view = new PdfPageView(container, renderer);
    const layout = makeLayout(20);
    // walk the window down the document; more than 8 canvases must not pile up
    view.sync(layout, [1, 3], 1);
    await flush();
    view.sync(layout, [6, 8], 1);
    await flush();
    view.sync(layout, [12, 14], 1);
    await flush();
    expect(container.querySelectorAll("canvas").length).toBeLessThanOrEqual(8);
    // pages outside the window were dropped, including their renderer handles
    expect(renderer.release).toBeUndefined(); // fake has no release hook
    view.destroy();
  });

  it("calls the renderer's release hook on eviction and destroy", async () => {
    const container = document.createElement("div");
    const calls: number[][] = [];
    const renderer: PageRenderer = {
      render: () => Promise.resolve(),
      release: (page) => {
        calls.push([page]);
      },
    };
    const view = new PdfPageView(container, renderer);
    const layout = makeLayout(24);
    // walk far enough down the document to exceed the 8-canvas cap
    view.sync(layout, [1, 3], 1);
    await flush();
    view.sync(layout, [7, 9], 1);
    await flush();
    view.sync(layout, [13, 15], 1);
    await flush();
    view.sync(layout, [19, 20], 1);
    await flush();
    expect(container.querySelectorAll("canvas").length).toBeLessThanOrEqual(8);
    expect(calls.length).toBeGreaterThan(0); // evicted pages released
    const before = calls.length;
    view.destroy();
    expect(calls.length).toBeGreaterThan(before); // teardown releases the rest
    expect(container.querySelectorAll("canvas")).toHaveLength(0);
  });

  it("invalidation forces a re-render on the next sync", async () => {
    const container = document.createElement("div");
    const renderer = makeRenderer();
    const view = new PdfPageView(container, renderer);
    const layout = makeLayout(3);
    view.sync(layout, [1, 2], 1);
    await flush();
    expect(renderer.calls.map((c) => c[0])).toEqual([1, 2]);
    view.invalidate(2);
    view.sync(layout, [1, 2], 1);
    await flush();
    expect(renderer.calls.map((c) => c[0])).toEqual([1, 2, 2]);
    view.destroy();
  });

  it("drops stale renders after a re-layout (dirty size change)", async () => {
    const container = document.createElement("div");
    const renderer = makeRenderer();
    const view = new PdfPageView(container, renderer);
    view.sync(makeLayout(2), [1, 2], 1);
    await flush();
    const before = renderer.calls.length;
    // zoom reflow: same page numbers, new sizes
    view.sync(layoutPages([LETTER, LETTER], VIEW, 1.5, "none"), [1, 2], 1);
    await flush();
    expect(renderer.calls.length).toBe(before + 2);
    expect(view.destroy()).toBeUndefined();
  });

  it("stops queueing after destroy", async () => {
    const container = document.createElement("div");
    const renderer = makeRenderer();
    const view = new PdfPageView(container, renderer);
    const layout = makeLayout(2);
    view.sync(layout, [1, 2], 1);
    view.destroy();
    const after = renderer.calls.length;
    view.sync(layout, [1, 2], 1);
    expect(renderer.calls.length).toBe(after);
  });

  it("caps the backing store at dpr 2", async () => {
    const container = document.createElement("div");
    const renderer = makeRenderer();
    const view = new PdfPageView(container, renderer);
    const layout = makeLayout(1);
    view.sync(layout, [1, 1], 4); // 4× display must clamp to 2
    await flush();
    const canvas = container.querySelector("canvas")!;
    expect(canvas.width).toBe(Math.round(layout.placements[0].width * 2));
    expect(canvas.height).toBe(Math.round(layout.placements[0].height * 2));
    // CSS size rides the page box, not the canvas
    const box = container.querySelector(".folio-pdf-pagebox") as HTMLElement;
    expect(box.style.width).toBe(`${layout.placements[0].width}px`);
    expect(box.style.getPropertyValue("--scale-factor")).toBe(String(layout.scale));
    view.destroy();
  });

  it("renders failures release their slot and retry later", async () => {
    const container = document.createElement("div");
    let fail = true;
    const render = vi.fn((_page: number) =>
      fail ? Promise.reject(new Error("boom")) : Promise.resolve(),
    );
    const view = new PdfPageView(container, { render } as unknown as PageRenderer);
    const layout = makeLayout(1);
    view.sync(layout, [1, 1], 1);
    await flush();
    expect(render).toHaveBeenCalledTimes(1);
    fail = false;
    view.sync(layout, [1, 1], 1); // failed page is dirty again → retry
    await flush();
    expect(render).toHaveBeenCalledTimes(2);
    view.destroy();
  });

  it("attaches text layers lazily and re-attaches on resize", async () => {
    const container = document.createElement("div");
    const renderer = makeRenderer();
    const attached: number[] = [];
    const released: number[] = [];
    let block = false;
    const textFactory: PageTextFactory = {
      async attach(page) {
        if (block) throw new Error("no text");
        attached.push(page);
      },
      release: (page) => {
        released.push(page);
      },
    };
    const ready: number[] = [];
    const view = new PdfPageView(container, renderer, {
      textFactory,
      onTextReady: (page) => ready.push(page),
    });
    const layout = makeLayout(2);
    view.sync(layout, [1, 2], 1);
    await flush();
    expect(attached).toEqual([1, 2]);
    expect(ready).toEqual([1, 2]);
    // clean re-sync: no re-attach
    view.sync(layout, [1, 2], 1);
    await flush();
    expect(attached).toEqual([1, 2]);
    // a zoom reflow re-attaches every visible page
    view.sync(layoutPages([LETTER, LETTER], VIEW, 1.5, "none"), [1, 2], 1);
    await flush();
    expect(attached).toEqual([1, 2, 1, 2]);
    expect(ready).toEqual([1, 2, 1, 2]);
    // attach failure keeps the page usable and does not fire onTextReady
    block = true;
    view.sync(layout, [1, 1], 1); // size changed back → re-attach attempt fails
    await flush();
    expect(attached).toEqual([1, 2, 1, 2]); // throw happens before any push
    expect(ready).toEqual([1, 2, 1, 2]);
    view.destroy();
    expect(released.length).toBeGreaterThan(0);
  });

  it("releases a render slot when an unrelated sync happens before it settles", async () => {
    const container = document.createElement("div");
    const calls: number[] = [];
    let settle!: () => void;
    const renderer: PageRenderer = {
      render(page) {
        calls.push(page);
        return new Promise<void>((resolve) => {
          settle = resolve;
        });
      },
    };
    const view = new PdfPageView(container, renderer);
    const layout = makeLayout(1);
    view.sync(layout, [1, 1], 1);
    // The old generation guard returned early here without releasing the
    // token, permanently locking the page's render slot.
    view.sync(layout, [1, 1], 1);
    settle();
    await flush();
    view.invalidate(1);
    view.sync(layout, [1, 1], 1);
    await flush();
    expect(calls).toEqual([1, 1]);
    view.destroy();
  });

  it("cancels an in-flight render when a new size supersedes it", async () => {
    const container = document.createElement("div");
    const cancels: number[] = [];
    let settle!: () => void;
    const renderer: PageRenderer = {
      render: () =>
        new Promise<void>((resolve) => {
          settle = resolve;
        }),
      cancel: (page) => {
        cancels.push(page);
      },
    };
    const view = new PdfPageView(container, renderer);
    view.sync(makeLayout(1), [1, 1], 1);
    view.sync(layoutPages([LETTER], VIEW, 1.5, "none"), [1, 1], 1);
    expect(cancels).toEqual([1]);
    settle();
    await flush();
    view.destroy();
  });

  it("never commits a stale text layer onto a newer layout", async () => {
    const container = document.createElement("div");
    const ready: number[] = [];
    const settles: Array<() => void> = [];
    const textFactory: PageTextFactory = {
      attach() {
        return new Promise<void>((resolve) => settles.push(resolve));
      },
      release() {},
    };
    const view = new PdfPageView(
      container,
      {
        render: () => Promise.resolve(),
      },
      { textFactory, onTextReady: () => ready.push(1) },
    );
    view.sync(makeLayout(1), [1, 1], 1);
    view.sync(layoutPages([LETTER], VIEW, 1.5, "none"), [1, 1], 1);
    expect(settles).toHaveLength(2);
    settles[0](); // stale first attach resolves late
    await flush();
    expect(ready).toHaveLength(0);
    expect(view.pageBox(1)!.textAttached).toBe(false);
    settles[1]();
    await flush();
    expect(ready).toHaveLength(1);
    expect(view.pageBox(1)!.textAttached).toBe(true);
    view.destroy();
  });

  it("retries a text layer that failed to attach", async () => {
    const container = document.createElement("div");
    let fail = true;
    let attaches = 0;
    const textFactory: PageTextFactory = {
      attach() {
        attaches += 1;
        return fail ? Promise.reject(new Error("no text")) : Promise.resolve();
      },
      release() {},
    };
    const view = new PdfPageView(container, { render: () => Promise.resolve() }, { textFactory });
    const layout = makeLayout(1);
    view.sync(layout, [1, 1], 1);
    await flush();
    expect(attaches).toBe(1);
    expect(view.pageBox(1)!.textAttached).toBe(false);
    fail = false;
    view.sync(layout, [1, 1], 1); // failed size was reset → re-attach
    await flush();
    expect(attaches).toBe(2);
    expect(view.pageBox(1)!.textAttached).toBe(true);
    view.destroy();
  });

  it("exposes pageBox for decoration painting and hit-testing", () => {
    const container = document.createElement("div");
    const renderer = makeRenderer();
    const view = new PdfPageView(container, renderer);
    const layout = makeLayout(3);
    view.sync(layout, [1, 2], 1);
    const box = view.pageBox(1);
    expect(box).not.toBeNull();
    expect(box!.wrapper.dataset.page).toBe("1");
    expect(box!.text.className).toBe("folio-pdf-textlayer");
    expect(box!.decorations.className).toBe("folio-pdf-decorations");
    expect(view.pageBox(3)).toBeNull(); // outside the visible window
    view.destroy();
    expect(view.pageBox(1)).toBeNull();
  });
});

// R4 2.2b noteref footnote popover: anchor detection, frame interception
// ordering, footnote body extraction/sanitization, and href resolution.
// The engine attaches these handlers capture-phase on each frame document so
// they run before the toolkit's bubble-phase Peripherals pointerup handler.
import { describe, it, expect, vi } from "vitest";
import {
  createNoterefIntercept,
  extractFootnote,
  isNoterefAnchor,
  nearestNoteref,
  resolveNoterefTarget,
} from "../src/reader/footnotes";
import { strFromU8 } from "fflate";

function anchorWith(attrs: Record<string, string>, label = "1"): HTMLAnchorElement {
  const a = document.createElement("a");
  a.href = "#fn1";
  a.textContent = label;
  for (const [k, v] of Object.entries(attrs)) a.setAttribute(k, v);
  return a;
}

function interceptHarness(hooks?: Partial<Parameters<typeof createNoterefIntercept>[0]>) {
  const onActivate = vi.fn();
  const hasSelection = vi.fn(() => false);
  const intercept = createNoterefIntercept({
    hasSelection,
    onActivate,
    ...hooks,
  });
  const doc = document.implementation.createHTMLDocument("t");
  return { onActivate, hasSelection, intercept, doc };
}

describe("isNoterefAnchor", () => {
  it("accepts epub:type=noteref", () => {
    expect(isNoterefAnchor(anchorWith({ "epub:type": "noteref" }))).toBe(true);
  });

  it("accepts a multi-token epub:type list", () => {
    expect(isNoterefAnchor(anchorWith({ "epub:type": "footnote noteref" }))).toBe(true);
  });

  it("accepts role=doc-noteref", () => {
    expect(isNoterefAnchor(anchorWith({ role: "doc-noteref" }))).toBe(true);
  });

  it("accepts the XHTML-namespaced epub:type attribute", () => {
    const a = document.createElement("a");
    a.setAttributeNS("http://www.idpf.org/2007/ops", "epub:type", "noteref");
    expect(isNoterefAnchor(a)).toBe(true);
  });

  it("rejects plain links and non-anchors", () => {
    expect(isNoterefAnchor(anchorWith({}))).toBe(false);
    expect(isNoterefAnchor(anchorWith({ "epub:type": "footnote" }))).toBe(false);
    expect(isNoterefAnchor(document.createElement("span"))).toBe(false);
    expect(isNoterefAnchor(null)).toBe(false);
  });
});

describe("nearestNoteref", () => {
  it("finds the noteref through a nested target", () => {
    const a = anchorWith({ "epub:type": "noteref" }, "3");
    const sup = document.createElement("sup");
    sup.appendChild(a);
    document.body.appendChild(sup);
    expect(nearestNoteref(sup.firstChild)).toBe(a);
    sup.remove();
  });

  it("returns null for ordinary internal links", () => {
    const a = anchorWith({});
    document.body.appendChild(a);
    expect(nearestNoteref(a)).toBeNull();
    a.remove();
  });
});

describe("createNoterefIntercept", () => {
  // jsdom has no PointerEvent constructor.
  class PointerEvent extends MouseEvent {
    readonly pointerType: string;
    readonly isPrimary: boolean;
    constructor(type: string, init: PointerEventInit & Record<string, unknown> = {}) {
      super(type, init);
      this.pointerType = String(init.pointerType ?? "");
      this.isPrimary = Boolean(init.isPrimary);
    }
  }

  function makeEvent(
    Ctor: typeof PointerEvent | typeof MouseEvent,
    init: Record<string, unknown>,
    target: EventTarget,
  ): Event {
    const ev = new Ctor("x", { cancelable: true, ...init } as never) as Event;
    Object.defineProperty(ev, "target", { value: target });
    return ev;
  }

  it("pointerup on a noteref activates and stops the event", () => {
    const { onActivate, intercept } = interceptHarness();
    const a = anchorWith({ "epub:type": "noteref" });
    const ev = makeEvent(PointerEvent, { button: 0, isPrimary: true, clientX: 40, clientY: 60 }, a);
    let bubbled = false;
    ev.stopPropagation = () => {
      bubbled = true;
    };
    intercept.onPointerUp(ev);
    expect(onActivate).toHaveBeenCalledWith(a, ev);
    expect(bubbled).toBe(true);
    expect(ev.defaultPrevented).toBe(true);
  });

  it("pointerup on a plain link is untouched", () => {
    const { onActivate, intercept } = interceptHarness();
    const a = anchorWith({});
    const ev = makeEvent(PointerEvent, { button: 0, isPrimary: true }, a);
    intercept.onPointerUp(ev);
    expect(onActivate).not.toHaveBeenCalled();
    expect(ev.defaultPrevented).toBe(false);
  });

  it("a live selection means the pointerup belongs to it, not the noteref", () => {
    const { onActivate, intercept } = interceptHarness({ hasSelection: () => true });
    const a = anchorWith({ "epub:type": "noteref" });
    const ev = makeEvent(PointerEvent, { button: 0, isPrimary: true }, a);
    intercept.onPointerUp(ev);
    expect(onActivate).not.toHaveBeenCalled();
    expect(ev.defaultPrevented).toBe(false);
  });

  it("non-primary pointers and right/middle buttons are ignored", () => {
    const { onActivate, intercept } = interceptHarness();
    const a = anchorWith({ "epub:type": "noteref" });
    for (const init of [
      { button: 2, isPrimary: true },
      { button: 1, isPrimary: true },
      { button: 0, isPrimary: false },
    ]) {
      intercept.onPointerUp(makeEvent(PointerEvent, init, a));
    }
    expect(onActivate).not.toHaveBeenCalled();
  });

  it("mouse click after pointerup is suppressed without re-triggering", () => {
    const { onActivate, intercept } = interceptHarness();
    const a = anchorWith({ "epub:type": "noteref" });
    intercept.onPointerUp(makeEvent(PointerEvent, { button: 0, isPrimary: true }, a));
    expect(onActivate).toHaveBeenCalledTimes(1);

    const click = makeEvent(MouseEvent, { button: 0, detail: 1, clientX: 5, clientY: 5 }, a);
    intercept.onClick(click);
    expect(onActivate).toHaveBeenCalledTimes(1);
    expect(click.defaultPrevented).toBe(true); // no default anchor jump
  });

  it("keyboard activation (click detail 0) triggers the popover", () => {
    const { onActivate, intercept } = interceptHarness();
    const a = anchorWith({ role: "doc-noteref" });
    const click = makeEvent(MouseEvent, { button: 0, detail: 0 }, a);
    intercept.onClick(click);
    expect(onActivate).toHaveBeenCalledTimes(1);
    expect(click.defaultPrevented).toBe(true);
  });

  it("click on a plain link passes through untouched", () => {
    const { onActivate, intercept } = interceptHarness();
    const a = anchorWith({});
    const click = makeEvent(MouseEvent, { button: 0, detail: 0 }, a);
    intercept.onClick(click);
    expect(onActivate).not.toHaveBeenCalled();
    expect(click.defaultPrevented).toBe(false);
  });
});

describe("resolveNoterefTarget", () => {
  it("resolves a relative href against the chapter directory", () => {
    expect(resolveNoterefTarget("OEBPS/text/ch1.xhtml", "notes.xhtml#fn1")).toBe(
      "OEBPS/text/notes.xhtml#fn1",
    );
  });

  it("keeps a same-document fragment on the open chapter", () => {
    expect(resolveNoterefTarget("OEBPS/text/ch1.xhtml", "#fn1")).toBe("OEBPS/text/ch1.xhtml#fn1");
  });

  it("decodes and normalizes awkward paths", () => {
    expect(resolveNoterefTarget("OEBPS/text/ch1.xhtml", "../notes/n%201.xhtml#f")).toBe(
      "OEBPS/notes/n 1.xhtml#f",
    );
  });

  it("rejects remote hrefs, empty hrefs, empty chapters", () => {
    expect(resolveNoterefTarget("OEBPS/ch1.xhtml", "https://example.com/x#f")).toBeNull();
    expect(resolveNoterefTarget("OEBPS/ch1.xhtml", "")).toBeNull();
    expect(resolveNoterefTarget("", "#fn1")).toBeNull();
  });
});

describe("extractFootnote", () => {
  function zipWith(href: string, html: string): Record<string, Uint8Array> {
    return { [href]: new TextEncoder().encode(html) };
  }

  it("extracts and sanitizes the fragment element", async () => {
    const zip = zipWith(
      "OEBPS/notes.xhtml",
      `<html><body>
        <aside id="fn1" epub:type="footnote">
          <p>A <strong>great</strong> note.</p>
          <script>alert(1)</script>
          <a href="#fn1" epub:type="footnote" role="doc-footnote">back</a>
        </aside>
        <aside id="fn2"><p>Other note.</p></aside>
      </body></html>`,
    );
    const body = await extractFootnote(zip, "OEBPS/notes.xhtml#fn1");
    expect(body).not.toBeNull();
    expect(body!.text).toContain("A great note.");
    expect(body!.html).toContain("<strong>great</strong>");
    expect(body!.html.toLowerCase()).not.toContain("<script");
    // The footnote backlink is not part of the popover body.
    expect(body!.html.toLowerCase()).not.toContain("back");
    // The other note is not included.
    expect(body!.text).not.toContain("Other note.");
  });

  it("returns null for a missing fragment id", async () => {
    const zip = zipWith("OEBPS/notes.xhtml", "<html><body><p>x</p></body></html>");
    await expect(extractFootnote(zip, "OEBPS/notes.xhtml#nope")).resolves.toBeNull();
  });

  it("returns null for a resource missing from the zip", async () => {
    await expect(extractFootnote({}, "OEBPS/absent.xhtml#fn1")).resolves.toBeNull();
  });

  it("without a fragment, the whole body is the footnote", async () => {
    const zip = zipWith(
      "OEBPS/one.xhtml",
      "<html><body><p>Standalone notes page.</p></body></html>",
    );
    const body = await extractFootnote(zip, "OEBPS/one.xhtml");
    expect(body!.text).toContain("Standalone notes page.");
  });

  it("drops images (their sources cannot resolve in a popover)", async () => {
    const zip = zipWith(
      "OEBPS/notes.xhtml",
      `<html><body><aside id="fn1">
        <p>With <img src="pic.png" alt="pic"/> image.</p>
      </aside></body></html>`,
    );
    const body = await extractFootnote(zip, "OEBPS/notes.xhtml#fn1");
    expect(body!.html.toLowerCase()).not.toContain("<img");
    expect(body!.text).toContain("With image.");
  });

  it("returns null when the footnote is blank after sanitization", async () => {
    const zip = zipWith("OEBPS/notes.xhtml", `<html><body><aside id="fn1"></aside></body></html>`);
    await expect(extractFootnote(zip, "OEBPS/notes.xhtml#fn1")).resolves.toBeNull();
  });

  it("reads encoded zip entry names", async () => {
    const html = "<html><body><aside id='fn1'><p>spaced</p></aside></body></html>";
    const zip = zipWith("OEBPS/n 1.xhtml", html);
    // sanity: the raw entry decodes to the fixture html
    expect(strFromU8(zip["OEBPS/n 1.xhtml"])).toContain("spaced");
    const body = await extractFootnote(zip, "OEBPS/n 1.xhtml#fn1");
    expect(body!.text).toContain("spaced");
  });
});

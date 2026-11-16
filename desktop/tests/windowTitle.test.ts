// X1 (Phase 4): window title helpers.
import { describe, expect, it } from "vitest";
import { APP_WINDOW_TITLE, bookWindowTitle, setWindowTitle } from "../src/lib/windowTitle";

describe("window title", () => {
  it('composes "Book — Folio" for a book and the plain app title otherwise', () => {
    expect(bookWindowTitle("Dune")).toBe("Dune — Folio");
    expect(bookWindowTitle("")).toBe(APP_WINDOW_TITLE);
  });
  it("sets the document title (browser host has no native window)", async () => {
    await setWindowTitle("Dune — Folio");
    expect(document.title).toBe("Dune — Folio");
    await setWindowTitle(APP_WINDOW_TITLE);
    expect(document.title).toBe(APP_WINDOW_TITLE);
  });
});

// UI-011: the create-collection dialog's name field must have an accessible
// name (the rename dialog already does). Synthetic empty library only.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../src/store/libraryUi", () => ({
  getLibraryManager: () => ({
    load: async () => ({
      schema: 1,
      app: "folio",
      libraryId: "00000000-0000-4000-8000-000000000000",
      updatedAt: "2026-01-01T00:00:00.000Z",
      docs: [],
    }),
    collections: { list: async () => [] },
  }),
  subscribeLibraryChanges: () => () => {},
  notifyLibraryChanged: () => {},
}));

import { CollectionsScreen } from "../src/screens/CollectionsScreen";
import { resetModalStack } from "../src/shell/modalStack";

let container: HTMLDivElement | null = null;
let root: Root | null = null;

beforeEach(() => {
  resetModalStack();
  document.body.innerHTML = "";
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = null;
  root = null;
});

describe("Collections dialog accessibility (UI-011)", () => {
  it("create-collection input has an accessible name", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(<CollectionsScreen />);
      await Promise.resolve();
      await Promise.resolve();
    });
    const newButton = Array.from(container!.querySelectorAll<HTMLButtonElement>("button")).find(
      (b) => b.getAttribute("aria-label") === "New collection",
    )!;
    expect(newButton).toBeTruthy();
    act(() => newButton.click());
    const input = container!.querySelector<HTMLInputElement>(".folio-dialog input[type='text']")!;
    expect(input).toBeTruthy();
    expect(input.getAttribute("aria-label")?.trim()).toBeTruthy();
  });
});

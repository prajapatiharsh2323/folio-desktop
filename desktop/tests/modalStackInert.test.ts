// X3 (Phase 4): the app root goes inert while a modal is open.
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  popModal,
  pushModal,
  resetModalStack,
  syncAppRootInert,
  type ModalToken,
} from "../src/shell/modalStack";

let shell: HTMLDivElement;

/** Sidebar + two screen roots; a dialog node is created but not yet modal. */
function setup(): { dialog: HTMLDivElement; otherScreen: HTMLDivElement } {
  shell = document.createElement("div");
  shell.className = "folio-app";
  const sidebar = document.createElement("aside");
  sidebar.className = "folio-sidebar";
  const screenWithDialog = document.createElement("div");
  screenWithDialog.className = "folio-screen";
  const dialog = document.createElement("div");
  screenWithDialog.appendChild(dialog);
  const otherScreen = document.createElement("div");
  otherScreen.className = "folio-screen";
  shell.append(sidebar, screenWithDialog, otherScreen);
  document.body.appendChild(shell);
  return { dialog, otherScreen };
}

/** FolioDialog renders role=dialog + aria-modal; replicate that. */
function makeModal(dialog: HTMLDivElement): void {
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
}

let token: ModalToken | null = null;

beforeEach(() => {
  resetModalStack();
});

afterEach(() => {
  if (token) {
    popModal(token);
    token = null;
  }
  shell?.remove();
});

describe("syncAppRootInert", () => {
  it("no modal → nothing is inert", () => {
    const { dialog, otherScreen } = setup();
    syncAppRootInert();
    expect(dialog.closest(".folio-screen")!.hasAttribute("inert")).toBe(false);
    expect(otherScreen.hasAttribute("inert")).toBe(false);
  });

  it("modal open → regions without the modal become inert, its ancestors stay live", () => {
    const { dialog, otherScreen } = setup();
    makeModal(dialog);
    token = pushModal();
    const screenWithDialog = dialog.closest(".folio-screen")!;
    expect(screenWithDialog.hasAttribute("inert")).toBe(false);
    expect(otherScreen.getAttribute("inert")).toBe("");
    // the sidebar (no modal inside) is inerted too
    expect(shell.querySelector(".folio-sidebar")!.getAttribute("inert")).toBe("");
  });

  it("closing the last modal clears every inert attribute", () => {
    const { dialog, otherScreen } = setup();
    makeModal(dialog);
    token = pushModal();
    expect(otherScreen.hasAttribute("inert")).toBe(true);
    // React removes the dialog before running the closing effect's cleanup,
    // so simulate that order: node gone, then popModal.
    dialog.remove();
    popModal(token);
    token = null;
    expect(otherScreen.hasAttribute("inert")).toBe(false);
  });

  it("a data-folio-modal root (menu/palette) also protects its ancestors", () => {
    const otherScreen = document.createElement("div");
    otherScreen.className = "folio-screen";
    const palette = document.createElement("div");
    palette.setAttribute("data-folio-modal", "");
    otherScreen.appendChild(palette);
    document.body.appendChild(otherScreen);
    const token2 = pushModal();
    try {
      expect(otherScreen.hasAttribute("inert")).toBe(false);
    } finally {
      popModal(token2);
      otherScreen.remove();
    }
  });
});

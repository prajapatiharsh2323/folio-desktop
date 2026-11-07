import { beforeEach, describe, expect, it } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { FolioBookRow } from "../src/components/FolioBookRow";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root | null = null;

function render(ui: React.ReactElement) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(ui);
  });
}

describe("FolioBookRow semantics", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    root = null;
  });

  it("renders the row body as a button and no action button without a handler", () => {
    render(<FolioBookRow data={{ id: "d1", title: "A Book" }} onOpen={() => {}} />);
    expect(container.querySelectorAll("button")).toHaveLength(1);
    expect(container.querySelector(".folio-book-row__more")).toBeNull();
    expect(container.querySelector("button button")).toBeNull();
  });

  it("keeps the optional action as a sibling, never nested inside the open button", () => {
    render(
      <FolioBookRow
        data={{ id: "d1", title: "A Book" }}
        onOpen={() => {}}
        onMore={() => {}}
      />
    );
    expect(container.querySelectorAll("button")).toHaveLength(2);
    expect(container.querySelector("button button")).toBeNull();
    expect(container.querySelector(".folio-book-row__more")).not.toBeNull();
  });
});

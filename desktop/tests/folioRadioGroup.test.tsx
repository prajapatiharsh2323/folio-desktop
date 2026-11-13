import { afterEach, describe, expect, it } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act, useState } from "react";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

import { FolioRadioGroup, type RadioOption } from "../src/components/FolioRadioGroup";

const OPTIONS: RadioOption<string>[] = [
  { value: "a", label: "Alpha" },
  { value: "b", label: "Beta" },
  { value: "c", label: "Gamma" },
];

let container: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = null;
  root = null;
});

function render(initial = "b", options: RadioOption<string>[] = OPTIONS) {
  const changes: string[] = [];
  function Harness() {
    const [value, setValue] = useState(initial);
    return (
      <FolioRadioGroup
        label="Test group"
        value={value}
        options={options}
        onChange={(next) => {
          changes.push(next);
          setValue(next);
        }}
      />
    );
  }
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(<Harness />));
  return changes;
}

function radios() {
  return Array.from(container!.querySelectorAll<HTMLButtonElement>('[role="radio"]'));
}

function press(target: HTMLElement, key: string) {
  act(() => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });
}

describe("FolioRadioGroup", () => {
  it("exposes native radio semantics with one tab stop", () => {
    render("b");
    const group = container!.querySelector('[role="radiogroup"]');
    expect(group?.getAttribute("aria-label")).toBe("Test group");

    const items = radios();
    expect(items.map((el) => el.getAttribute("aria-checked"))).toEqual(["false", "true", "false"]);
    expect(items.map((el) => el.tabIndex)).toEqual([-1, 0, -1]);
  });

  it("selects with click", () => {
    const changes = render("b");
    act(() => {
      radios()[2].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(changes).toEqual(["c"]);
    expect(radios()[2].getAttribute("aria-checked")).toBe("true");
  });

  it("moves with arrow keys and wraps around", () => {
    const changes = render("c");
    press(radios()[2], "ArrowRight");
    expect(changes).toEqual(["a"]);

    press(radios()[0], "ArrowLeft");
    expect(changes).toEqual(["a", "c"]);
  });

  it("jumps to the first and last options with Home and End", () => {
    const changes = render("b");
    press(radios()[1], "End");
    expect(changes).toEqual(["c"]);
    press(radios()[2], "Home");
    expect(changes).toEqual(["c", "a"]);
  });

  it("skips disabled options and ignores modified arrows", () => {
    render("a", [
      { value: "a", label: "Alpha" },
      { value: "b", label: "Beta", disabled: true },
      { value: "c", label: "Gamma" },
    ]);
    press(radios()[0], "ArrowRight");
    expect(radios()[2].getAttribute("aria-checked")).toBe("true");

    act(() => {
      radios()[2].dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "ArrowRight",
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(radios()[2].getAttribute("aria-checked")).toBe("true");
  });
});

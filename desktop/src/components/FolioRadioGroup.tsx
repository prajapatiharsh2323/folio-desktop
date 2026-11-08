import { Fragment, useRef, type CSSProperties, type ReactNode } from "react";

export interface RadioOption<T extends string> {
  value: T;
  label: ReactNode;
  disabled?: boolean;
  /** Optional chip styling (used to preview typefaces). */
  style?: CSSProperties;
}

export interface RadioRenderState<T extends string> {
  selected: boolean;
  tabIndex: number;
  select: () => void;
  setButton: (el: HTMLButtonElement | null) => void;
  option: RadioOption<T>;
}

interface FolioRadioGroupProps<T extends string> {
  label: string;
  value: T;
  options: RadioOption<T>[];
  onChange: (value: T) => void;
  className?: string;
  /** Custom swatch/preset renderer; the default renders filter chips. */
  renderOption?: (state: RadioRenderState<T>) => ReactNode;
}

/**
 * Single-select group with one tab stop and Arrow/Home/End navigation. Native
 * radio semantics are reproduced on buttons so the visual chips and swatches
 * stay unchanged.
 */
export function FolioRadioGroup<T extends string>({
  label,
  value,
  options,
  onChange,
  className,
  renderOption,
}: FolioRadioGroupProps<T>) {
  const buttons = useRef(new Map<T, HTMLButtonElement>());
  const enabled = options.filter((option) => !option.disabled);
  const selected = options.find((option) => option.value === value);
  const tabbable = selected ?? enabled[0];

  const select = (next: T) => {
    onChange(next);
    buttons.current.get(next)?.focus();
  };

  const move = (step: 1 | -1) => {
    if (enabled.length === 0) return;
    const current = enabled.findIndex((option) => option.value === value);
    const base = current >= 0 ? current : 0;
    const next = (base + step + enabled.length) % enabled.length;
    select(enabled[next].value);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        event.preventDefault();
        move(1);
        break;
      case "ArrowLeft":
      case "ArrowUp":
        event.preventDefault();
        move(-1);
        break;
      case "Home":
        event.preventDefault();
        if (enabled[0]) select(enabled[0].value);
        break;
      case "End":
        event.preventDefault();
        if (enabled.length > 0) select(enabled[enabled.length - 1].value);
        break;
      default:
        break;
    }
  };

  return (
    <div role="radiogroup" aria-label={label} className={className} onKeyDown={onKeyDown}>
      {options.map((option) => {
        const isSelected = option.value === value;
        const state: RadioRenderState<T> = {
          option,
          selected: isSelected,
          tabIndex: option.value === tabbable?.value ? 0 : -1,
          select: () => onChange(option.value),
          setButton: (el) => {
            if (el) buttons.current.set(option.value, el);
            else buttons.current.delete(option.value);
          },
        };

        if (renderOption) {
          return <Fragment key={option.value}>{renderOption(state)}</Fragment>;
        }

        return (
          <button
            key={option.value}
            ref={state.setButton}
            type="button"
            role="radio"
            aria-checked={isSelected}
            tabIndex={state.tabIndex}
            disabled={option.disabled}
            className={`folio-chip${isSelected ? " is-selected" : ""}`}
            style={option.style}
            onClick={state.select}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

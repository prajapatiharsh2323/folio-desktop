// X1 (Phase 4): the Ctrl+K command palette.
//
// A small keyboard-first launcher available from any screen: type to filter,
// ArrowUp/Down to move, Enter to run, Escape to close. It reuses FolioDialog
// so focus trapping, the Escape ladder and the modal backdrop all come from
// the shared dialog (data-folio-modal).

import { useEffect, useMemo, useRef, useState } from "react";
import { FolioDialog } from "./FolioDialog";
import { useThemeStore, type ThemeSetting } from "../theme/theme";
import { useRouteStore } from "../store/routeStore";
import { useOnboarding } from "../onboarding/onboardingState";
import { APP_WINDOW_TITLE } from "../lib/windowTitle";
import { t, useLocaleStore, type Locale } from "../i18n/i18n";

export interface PaletteCommand {
  id: string;
  label: string;
  hint?: string;
  run: () => void;
}

function buildCommands(locale: Locale): PaletteCommand[] {
  const routes = useRouteStore.getState();
  const commands: PaletteCommand[] = [
    {
      id: "nav-library",
      label: t("palette.goToLibrary", locale),
      hint: t("palette.hintLibrary", locale),
      run: () => routes.setRoute("library"),
    },
    {
      id: "nav-collections",
      label: t("palette.goToCollections", locale),
      hint: t("palette.hintCollections", locale),
      run: () => routes.setRoute("collections"),
    },
    {
      id: "nav-notes",
      label: t("palette.goToNotes", locale),
      hint: t("palette.hintNotes", locale),
      run: () => routes.setRoute("notes"),
    },
    {
      id: "nav-settings",
      label: t("palette.goToSettings", locale),
      hint: t("palette.hintSettings", locale),
      run: () => routes.setRoute("settings"),
    },
    {
      id: "theme-cycle",
      label: t("palette.switchAppearance", locale),
      hint: t("palette.hintAppearance", locale),
      run: () => {
        const order: ThemeSetting[] = ["system", "light", "dark"];
        const current = useThemeStore.getState().setting;
        const next = order[(order.indexOf(current) + 1) % order.length];
        useThemeStore.getState().setSetting(next);
      },
    },
    {
      id: "tour-replay",
      label: t("palette.replayTour", locale),
      hint: t("palette.hintTour", locale),
      run: () => useOnboarding.getState().replayTour(),
    },
  ];
  return commands;
}

/** Ctrl+K / Meta+K opens the palette from anywhere. */
export function isPaletteTrigger(event: KeyboardEvent): boolean {
  return (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key === "k";
}

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Subscribed so a locale change re-renders the command list (X5).
  const locale = useLocaleStore((s) => s.locale);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
    }
  }, [open]);

  const all = useMemo(() => buildCommands(locale), [locale]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter(
      (c) => c.label.toLowerCase().includes(q) || (c.hint ?? "").toLowerCase().includes(q),
    );
  }, [all, query]);

  // Keep the active index inside the filtered list.
  useEffect(() => {
    setActive((i) => Math.min(i, Math.max(filtered.length - 1, 0)));
  }, [filtered.length]);

  const runCommand = (command: PaletteCommand | undefined) => {
    if (!command) return;
    onClose();
    command.run();
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((i) => Math.min(i + 1, filtered.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      runCommand(filtered[active]);
    }
  };

  return (
    <FolioDialog open={open} onClose={onClose} title="Command palette">
      <input
        ref={inputRef}
        className="folio-palette-input"
        type="text"
        role="combobox"
        aria-expanded={filtered.length > 0}
        aria-controls="folio-palette-list"
        aria-activedescendant={
          filtered[active] ? `folio-palette-opt-${filtered[active].id}` : undefined
        }
        aria-label={t("palette.searchAria", locale)}
        placeholder={t("palette.searchPlaceholder", locale)}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={onKeyDown}
        autoFocus
      />
      {filtered.length === 0 ? (
        <p className="folio-palette-empty" role="status">
          {t("palette.noMatches", locale)}
        </p>
      ) : (
        <div
          id="folio-palette-list"
          ref={listRef}
          className="folio-palette-list"
          role="listbox"
          aria-label="Commands"
        >
          {filtered.map((command, i) => (
            <button
              key={command.id}
              id={`folio-palette-opt-${command.id}`}
              type="button"
              role="option"
              aria-selected={i === active}
              className={`folio-palette-option${i === active ? " is-active" : ""}`}
              onMouseMove={() => setActive(i)}
              onClick={() => runCommand(command)}
            >
              <span className="folio-palette-label">{command.label}</span>
              {command.hint && <span className="folio-palette-hint">{command.hint}</span>}
            </button>
          ))}
        </div>
      )}
      <p className="folio-palette-footer folio-helper">
        Enter runs the selection · Esc closes · {APP_WINDOW_TITLE}
      </p>
    </FolioDialog>
  );
}

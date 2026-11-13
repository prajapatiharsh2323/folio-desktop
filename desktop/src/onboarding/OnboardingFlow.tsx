import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { FolioButton } from "../components/FolioButton";
import { FolioRadioGroup } from "../components/FolioRadioGroup";
import { trapTabKey } from "../components/focusTrap";
import { READER_THEME_COLORS } from "../model/defaults";
import type { FontFamilyPref, ReadingPrefs } from "../model/types";
import { filesFromDataTransfer, onDroppedFiles, pickImportFiles } from "../lib/fileSource";
import { getLibraryManager, useLibraryUi } from "../store/libraryUi";
import { useRouteStore } from "../store/routeStore";
import { previewTheme, useThemeStore, type ThemeSetting } from "../theme/theme";
import { useOnboarding } from "./onboardingState";

/** Saving must not spin forever if the filesystem hangs. */
const SAVE_TIMEOUT_MS = 10_000;

/** How long an imported title stays on screen before setup finishes. */
const IMPORT_CONFIRM_MS = 1000;

type SizeChoice = 16 | 18 | 22;

const THEME_OPTIONS: { value: ThemeSetting; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
];

const FACE_OPTIONS: { value: FontFamilyPref; label: string; css: string }[] = [
  { value: "serif", label: "Serif", css: '"Iowan Old Style", Georgia, serif' },
  { value: "sans", label: "Sans", css: '"Segoe UI", system-ui, sans-serif' },
];

const SIZE_OPTIONS: { value: SizeChoice; label: string }[] = [
  { value: 16, label: "Small" },
  { value: 18, label: "Medium" },
  { value: 22, label: "Large" },
];

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function sizeChoiceFor(px: number): SizeChoice {
  if (px <= 17) return 16;
  if (px <= 20) return 18;
  return 22;
}

function colorsFor(theme: ThemeSetting): { bg: string; text: string } {
  if (theme === "system") {
    const dark =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches;
    return READER_THEME_COLORS[dark ? "dark" : "light"];
  }
  return READER_THEME_COLORS[theme];
}

function faceCssFor(face: FontFamilyPref): string {
  return FACE_OPTIONS.find((option) => option.value === face)?.css ?? FACE_OPTIONS[0].css;
}

/** A quiet, screen-reader-only step label on the dot pair. */
function ProgressDots({ step }: { step: 1 | 2 }) {
  return (
    <div
      className="folio-setup__progress"
      role="img"
      aria-label={step === 1 ? "Step 1 of 2" : "Step 2 of 2"}
    >
      <span className={`folio-setup__dot${step === 1 ? " is-active" : ""}`} />
      <span className={`folio-setup__dot${step === 2 ? " is-active" : ""}`} />
    </div>
  );
}

function isEnterActivationTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return true;
  if (el.closest("[role='radiogroup'], button, input, textarea, select, a")) return false;
  return true;
}

function focusHeading(ref: React.RefObject<HTMLElement | null>): void {
  ref.current?.focus();
}

/**
 * First-run setup is two screens, owned by the onboarding state machine:
 * `look` (reading appearance) → `library` (add a book).
 */
export function OnboardingFlow() {
  const stage = useOnboarding((s) => s.stage);
  return stage === "library" ? <AddBookStep /> : <LookStep />;
}

/**
 * Step 1: one choice about reading. Theme selects the app and reading theme,
 * which preview live on the whole canvas; nothing is written until Continue.
 */
function LookStep() {
  const completePrefs = useOnboarding((s) => s.completePrefs);
  const storedAppTheme = useThemeStore((s) => s.setting);
  const setAppTheme = useThemeStore((s) => s.setSetting);

  const [theme, setTheme] = useState<ThemeSetting>(storedAppTheme);
  const [face, setFace] = useState<FontFamilyPref>("serif");
  const [size, setSize] = useState<SizeChoice>(18);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  // The saved values load in the background; a user who has already answered
  // must not have their choice overwritten by a late read.
  const touched = useRef(false);

  useEffect(() => {
    focusHeading(headingRef);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const current: ReadingPrefs = await getLibraryManager().prefs.global();
        if (cancelled || touched.current) return;
        setFace(current.fontFamily === "sans" ? "sans" : "serif");
        setSize(sizeChoiceFor(current.fontSize));
      } catch {
        // Defaults are already on screen; Continue re-reads before it writes.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Live preview on the whole canvas; nothing is persisted by this effect.
  useEffect(() => {
    previewTheme(theme);
  }, [theme]);
  useEffect(() => () => previewTheme(null), []);

  const chooseTheme = (next: ThemeSetting) => {
    touched.current = true;
    setTheme(next);
  };
  const chooseFace = (next: FontFamilyPref) => {
    touched.current = true;
    setFace(next);
  };
  const chooseSize = (next: SizeChoice) => {
    touched.current = true;
    setSize(next);
  };

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const lm = getLibraryManager();
      const current = await lm.prefs.global();
      // Only the fields this screen owns are written; other global prefs and
      // unknown schema-1 keys stay exactly as they were.
      await withTimeout(
        lm.prefs.writeGlobal({
          ...current,
          theme,
          fontFamily: face,
          fontSize: size,
        }),
        SAVE_TIMEOUT_MS,
      );
      setAppTheme(theme);
      completePrefs();
    } catch {
      setError("Couldn't save. Try again, or Skip.");
    } finally {
      setSaving(false);
    }
  };

  const skip = () => {
    setError(null);
    previewTheme(null);
    completePrefs();
  };

  const previewColors = colorsFor(theme);

  return (
    <div className="folio-setup" data-folio-modal>
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- focus-trap container: Tab trapping + Enter activation for the step's primary action */}
      <div
        className="folio-setup__panel folio-setup__step"
        role="dialog"
        aria-modal="true"
        aria-labelledby="folio-setup-title"
        ref={panelRef}
        onKeyDown={(e) => {
          if (panelRef.current) trapTabKey(panelRef.current, e.nativeEvent);
          if (e.key === "Enter" && !saving && isEnterActivationTarget(e.target)) {
            e.preventDefault();
            void save();
          }
        }}
      >
        <div className="folio-boot__wordmark folio-setup__wordmark">Folio</div>

        <div className="folio-setup__content">
          <h1 id="folio-setup-title" className="folio-setup__title" ref={headingRef} tabIndex={-1}>
            How do you like to read?
          </h1>

          <section className="folio-setup__group" aria-labelledby="folio-setup-theme">
            <span className="folio-setup__label" id="folio-setup-theme">
              Theme
            </span>
            <FolioRadioGroup<ThemeSetting>
              label="Theme"
              className="folio-setup__themes"
              value={theme}
              options={THEME_OPTIONS}
              onChange={chooseTheme}
              renderOption={({ option, selected, tabIndex, select, setButton }) => {
                const colors = READER_THEME_COLORS[option.value];
                const system = option.value === "system";
                const pageStyle: CSSProperties = system
                  ? {
                      background: `linear-gradient(115deg, ${READER_THEME_COLORS.light.bg} 0 49.5%, ${READER_THEME_COLORS.dark.bg} 50.5% 100%)`,
                    }
                  : { background: colors.bg, color: colors.text };
                return (
                  <button
                    ref={setButton}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    tabIndex={tabIndex}
                    className={`folio-setup__swatch${selected ? " is-selected" : ""}`}
                    onClick={select}
                  >
                    <span className="folio-setup__swatch-page" style={pageStyle} aria-hidden="true">
                      Aa
                    </span>
                    <span className="folio-setup__swatch-label">{option.label}</span>
                  </button>
                );
              }}
            />
          </section>

          <section className="folio-setup__group" aria-labelledby="folio-setup-face">
            <span className="folio-setup__label" id="folio-setup-face">
              Typeface
            </span>
            <FolioRadioGroup<FontFamilyPref>
              label="Typeface"
              className="folio-setup__segmented"
              value={face}
              options={FACE_OPTIONS.map((option) => ({
                value: option.value,
                label: option.label,
                style: { fontFamily: option.css },
              }))}
              onChange={chooseFace}
            />
          </section>

          <section className="folio-setup__group" aria-labelledby="folio-setup-size">
            <span className="folio-setup__label" id="folio-setup-size">
              Size
            </span>
            <FolioRadioGroup
              label="Size"
              className="folio-setup__segmented"
              value={String(size)}
              options={SIZE_OPTIONS.map((option) => ({
                value: String(option.value),
                label: option.label,
              }))}
              onChange={(next) => chooseSize(Number(next) as SizeChoice)}
            />
          </section>

          <div
            className="folio-setup__preview"
            style={{
              backgroundColor: previewColors.bg,
              color: previewColors.text,
              fontFamily: faceCssFor(face),
              fontSize: `${size}px`,
            }}
            aria-hidden="true"
          >
            <p>
              The quick brown fox jumps over the lazy dog, and the quiet page asks nothing more of
              you than a little attention.
            </p>
          </div>
        </div>

        {error && (
          <p className="folio-setup__error" role="alert">
            {error}
          </p>
        )}

        <div className="folio-setup__footer">
          <div className="folio-setup__actions">
            <FolioButton variant="primary" onClick={() => void save()} disabled={saving}>
              {saving ? "Saving…" : "Continue"}
            </FolioButton>
            <button type="button" className="folio-link folio-setup__skip" onClick={skip}>
              Skip
            </button>
          </div>
          <ProgressDots step={1} />
        </div>
      </div>
    </div>
  );
}

/**
 * Step 2: add one book, or finish with the defaults. The tour is offered here
 * but never opens by itself.
 */
function AddBookStep() {
  const completeSetup = useOnboarding((s) => s.completeSetup);
  const replayTour = useOnboarding((s) => s.replayTour);
  const setRoute = useRouteStore((s) => s.setRoute);
  const importPicked = useLibraryUi((s) => s.importPicked);

  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addedTitle, setAddedTitle] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const finishTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    focusHeading(headingRef);
    return () => {
      if (finishTimer.current) clearTimeout(finishTimer.current);
    };
  }, []);

  const finish = useCallback(() => {
    completeSetup();
    setRoute("library");
  }, [completeSetup, setRoute]);

  const importFiles = useCallback(
    async (files: { name: string; bytes: Uint8Array }[]) => {
      if (files.length === 0 || busy) return;
      setBusy(true);
      setError(null);
      setAddedTitle(null);
      try {
        const result = await importPicked(files);
        if (result.failures.length > 0 || result.added + result.skipped === 0) {
          setError("Couldn't import that file. Try again.");
          return;
        }
        setAddedTitle(result.title ?? files[0].name);
        finishTimer.current = setTimeout(() => {
          finishTimer.current = null;
          finish();
        }, IMPORT_CONFIRM_MS);
      } catch {
        setError("Couldn't import that file. Try again.");
      } finally {
        setBusy(false);
      }
    },
    [busy, finish, importPicked],
  );

  const chooseFiles = async () => {
    if (busy) return;
    setError(null);
    try {
      const files = await pickImportFiles();
      await importFiles(files);
    } catch {
      setError("Couldn't open the file picker. Try again.");
    }
  };

  // Tauri delivers OS drops: the webview event drives the over/leave visuals
  // and the granted `folio://drop-granted` event carries the readable files.
  // This screen owns the window, so it listens directly instead of waiting
  // for the Library screen.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    (async () => {
      try {
        const { getCurrentWebview } = await import("@tauri-apps/api/webview");
        const un = await getCurrentWebview().onDragDropEvent((event) => {
          if (event.payload.type === "over") setDragOver(true);
          else if (event.payload.type === "leave") setDragOver(false);
          else if (event.payload.type === "drop") {
            setDragOver(false);
            // Paths are handled by the granted event below.
          }
        });
        if (cancelled) un();
        else unlisten = un;
      } catch {
        /* browser dev: the HTML5 handlers cover it */
      }
    })();
    let unDrop: (() => void) | undefined;
    let dropCancelled = false;
    void onDroppedFiles((picked) => {
      void importFiles(picked);
    }).then((un) => {
      if (dropCancelled) un();
      else unDrop = un;
    });
    return () => {
      cancelled = true;
      dropCancelled = true;
      unlisten?.();
      unDrop?.();
    };
  }, [importFiles]);

  const later = () => {
    setError(null);
    finish();
  };

  const tour = () => {
    finish();
    replayTour();
  };

  return (
    <div className="folio-setup" data-folio-modal>
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- focus-trap container: Tab trapping + Enter activation for the step's primary action */}
      <div
        className="folio-setup__panel folio-setup__step"
        role="dialog"
        aria-modal="true"
        aria-labelledby="folio-setup-title"
        ref={panelRef}
        onKeyDown={(e) => {
          if (panelRef.current) trapTabKey(panelRef.current, e.nativeEvent);
          if (e.key === "Enter" && !busy && isEnterActivationTarget(e.target)) {
            e.preventDefault();
            void chooseFiles();
          }
        }}
      >
        <div className="folio-boot__wordmark folio-setup__wordmark">Folio</div>

        <div className="folio-setup__content">
          <h1 id="folio-setup-title" className="folio-setup__title" ref={headingRef} tabIndex={-1}>
            Add your first book
          </h1>

          <div
            className={`folio-setup__drop${dragOver ? " is-dragging" : ""}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              void filesFromDataTransfer(e.dataTransfer).then((files) => {
                if (files.length > 0) void importFiles(files);
              });
            }}
          >
            {addedTitle ? (
              <p className="folio-setup__added" role="status">
                {addedTitle}
              </p>
            ) : (
              <>
                <p className="folio-setup__drop-copy">Drop an EPUB, HTML or text file</p>
                <FolioButton variant="primary" onClick={() => void chooseFiles()} disabled={busy}>
                  {busy ? "Importing…" : "Choose files"}
                </FolioButton>
              </>
            )}
          </div>

          {error && (
            <p className="folio-setup__error" role="alert">
              {error}
            </p>
          )}
        </div>

        <div className="folio-setup__footer">
          <div className="folio-setup__actions">
            <button type="button" className="folio-link" onClick={later}>
              I&apos;ll do this later
            </button>
            <button type="button" className="folio-link folio-setup__tour-link" onClick={tour}>
              Take a short tour
            </button>
          </div>
          <ProgressDots step={2} />
        </div>
      </div>
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import { FolioButton } from "../components/FolioButton";
import { trapTabKey } from "../components/focusTrap";
import { DEFAULT_READING_PREFS } from "../model/defaults";
import type { ReadingPrefs } from "../model/types";
import { getLibraryManager } from "../store/libraryUi";
import { previewTheme, useThemeStore, type ThemeSetting } from "../theme/theme";
import { PreferencesEditor } from "./PreferencesEditor";
import { appThemeForReadingTheme } from "./themeLink";
import { useOnboarding } from "./onboardingState";

/** Saving must not spin forever if the filesystem hangs. */
const SAVE_TIMEOUT_MS = 10_000;

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
      }
    );
  });
}

/**
 * First-run setup: welcome copy plus the shared preference editor. Saving
 * writes the global ReadingPrefs through the existing repository, so books
 * without a per-book override inherit these defaults.
 */
export function OnboardingFlow() {
  const completePrefs = useOnboarding((s) => s.completePrefs);
  const storedAppTheme = useThemeStore((s) => s.setting);
  const setAppTheme = useThemeStore((s) => s.setSetting);

  const [prefs, setPrefs] = useState<ReadingPrefs>(DEFAULT_READING_PREFS);
  // App appearance is a draft too: "Use defaults" must not write any
  // preference, so the store is only updated when the user saves.
  const [appTheme, setAppThemeDraft] = useState<ThemeSetting>(storedAppTheme);
  const [appThemeTouched, setAppThemeTouched] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loadWarning, setLoadWarning] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const current = await getLibraryManager().prefs.global();
        if (!cancelled) setPrefs(current);
      } catch {
        // Keep built-in defaults; saving still works, but say so rather than
        // making the values look like saved ones.
        if (!cancelled) {
          setLoadWarning(
            "Couldn't load your saved preferences — starting from the built-in defaults."
          );
        }
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    headingRef.current?.focus();
    return () => {
      cancelled = true;
    };
  }, []);

  // Live app-theme preview (O2). The visual result is immediate; nothing is
  // written until Save. Leaving without saving restores the saved setting.
  useEffect(() => {
    previewTheme(appTheme);
  }, [appTheme]);
  useEffect(() => () => previewTheme(null), []);

  const changePrefs = (next: ReadingPrefs) => {
    // Until the user expresses an app-theme preference, follow the reading
    // theme so a dark page is not surrounded by a light app (O6).
    if (next.theme !== prefs.theme && !appThemeTouched) {
      setAppThemeDraft(appThemeForReadingTheme(next.theme));
    }
    setPrefs(next);
  };

  const changeAppTheme = (setting: ThemeSetting) => {
    setAppThemeTouched(true);
    setAppThemeDraft(setting);
  };

  const save = async () => {
    if (saving || !loaded) return;
    setSaving(true);
    setError(null);
    try {
      const lm = getLibraryManager();
      const current = await lm.prefs.global();
      // Only the fields this editor owns are written; other global prefs and
      // unknown schema-1 keys stay exactly as they were.
      await withTimeout(
        lm.prefs.writeGlobal({
          ...current,
          theme: prefs.theme,
          fontFamily: prefs.fontFamily,
          fontSize: prefs.fontSize,
        }),
        SAVE_TIMEOUT_MS
      );
      setAppTheme(appTheme);
      completePrefs();
    } catch (e) {
      setError(
        e instanceof Error && e.message === "timeout"
          ? "Saving is taking longer than expected. Try again, or use the defaults."
          : e instanceof Error
            ? e.message
            : "Your preferences could not be saved."
      );
    } finally {
      setSaving(false);
    }
  };

  const skip = () => {
    setError(null);
    completePrefs();
  };

  return (
    <div className="folio-onboarding" data-folio-modal>
      <div
        className="folio-onboarding__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="folio-onboarding-title"
        ref={panelRef}
        onKeyDown={(e) => {
          if (panelRef.current) trapTabKey(panelRef.current, e.nativeEvent);
        }}
      >
        <div className="folio-onboarding__intro">
          <p className="folio-onboarding__step">Step 1 of 2 · Reading setup</p>
          <p className="folio-onboarding__eyebrow">Welcome to Folio</p>
          <h1
            id="folio-onboarding-title"
            className="folio-onboarding__title"
            ref={headingRef}
            tabIndex={-1}
          >
            Set up your reading experience
          </h1>
          <p className="folio-onboarding__lede">
            Pick how the app looks and how books read by default. You can change
            any of this later in Settings, and individual books can still keep
            their own appearance.
          </p>
          <ul className="folio-onboarding__points">
            <li>App appearance applies to the whole app.</li>
            <li>Reading defaults apply to books without their own overrides.</li>
            <li>Your library and notes are not changed by this setup.</li>
          </ul>
          {loadWarning && (
            <p className="folio-helper folio-onboarding__warning" role="status">
              {loadWarning}
            </p>
          )}
        </div>

        <div className="folio-onboarding__form">
          <PreferencesEditor
            prefs={prefs}
            onChange={changePrefs}
            appTheme={appTheme}
            onAppThemeChange={changeAppTheme}
            showAppAppearance
          />
        </div>

        {error && (
          <p className="folio-helper folio-onboarding__error" role="alert">
            {error}
          </p>
        )}

        <div className="folio-onboarding__actions">
          <p className="folio-onboarding__actions-note">
            Saving stores these as your defaults. Using the defaults writes
            nothing and keeps your current settings.
          </p>
          <div className="folio-onboarding__buttons">
            <FolioButton variant="secondary" onClick={skip} disabled={saving}>
              Use defaults
            </FolioButton>
            <FolioButton
              variant="primary"
              onClick={() => void save()}
              disabled={saving || !loaded}
            >
              {saving ? "Saving…" : loaded ? "Save and continue" : "Loading…"}
            </FolioButton>
          </div>
        </div>
      </div>
    </div>
  );
}

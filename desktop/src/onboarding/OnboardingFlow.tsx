import { useEffect, useRef, useState } from "react";
import { FolioButton } from "../components/FolioButton";
import { DEFAULT_READING_PREFS } from "../model/defaults";
import type { ReadingPrefs } from "../model/types";
import { getLibraryManager } from "../store/libraryUi";
import { useThemeStore, type ThemeSetting } from "../theme/theme";
import { PreferencesEditor } from "./PreferencesEditor";
import { useOnboarding } from "./onboardingState";

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
  // App appearance is a draft too: "Skip for now" must not write any
  // preference, so the store is only updated when the user saves.
  const [appTheme, setAppThemeDraft] = useState<ThemeSetting>(storedAppTheme);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const current = await getLibraryManager().prefs.global();
        if (!cancelled) setPrefs(current);
      } catch {
        /* keep built-in defaults; saving still works */
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    headingRef.current?.focus();
    return () => {
      cancelled = true;
    };
  }, []);

  const save = async () => {
    if (saving || !loaded) return;
    setSaving(true);
    setError(null);
    try {
      const lm = getLibraryManager();
      const current = await lm.prefs.global();
      // Only the fields this editor owns are written; other global prefs and
      // unknown schema-1 keys stay exactly as they were.
      await lm.prefs.writeGlobal({
        ...current,
        theme: prefs.theme,
        fontFamily: prefs.fontFamily,
        fontSize: prefs.fontSize,
      });
      setAppTheme(appTheme);
      completePrefs();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Your preferences could not be saved."
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
      >
        <div className="folio-onboarding__intro">
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
        </div>

        <div className="folio-onboarding__form">
          <PreferencesEditor
            prefs={prefs}
            onChange={setPrefs}
            appTheme={appTheme}
            onAppThemeChange={setAppThemeDraft}
            showAppAppearance
          />
        </div>

        {error && (
          <p className="folio-helper folio-onboarding__error" role="alert">
            {error}
          </p>
        )}

        <div className="folio-onboarding__actions">
          <FolioButton variant="secondary" onClick={skip} disabled={saving}>
            Skip for now
          </FolioButton>
          <FolioButton variant="primary" onClick={() => void save()} disabled={saving || !loaded}>
            {saving ? "Saving…" : loaded ? "Save and continue" : "Loading…"}
          </FolioButton>
        </div>
      </div>
    </div>
  );
}

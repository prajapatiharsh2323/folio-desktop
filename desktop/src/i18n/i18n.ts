// X5 (Phase 4 Step 4.2): string catalogue + app locale.
//
// `t(key)` resolves UI copy for the current locale with an English fallback;
// locales are intentionally conservative — this pass covers the shell chrome
// (sidebar, palette, a few shared strings) and screen copy stays English
// until a dedicated translation pass. The locale also drives `lang`/`dir` on
// `<html>` (applied pre-paint in `main.tsx`), Devanagari-aware font stacks
// (`:lang(hi)` in tokens.css) and RTL page progression in the reader.
import { create } from "zustand";
import { readStorage, writeStorage } from "../lib/storage";

export type Locale = "en" | "hi" | "ar";

export const DEFAULT_LOCALE: Locale = "en";
export const LOCALE_STORAGE_KEY = "folio.ui.locale";

/** Shown in the Settings picker under each locale's own name. */
export const LOCALES: ReadonlyArray<{ id: Locale; label: string }> = [
  { id: "en", label: "English" },
  { id: "hi", label: "हिन्दी" },
  { id: "ar", label: "العربية" },
];

const RTL_LOCALES: ReadonlySet<Locale> = new Set(["ar"]);

export function isRtlLocale(locale: Locale): boolean {
  return RTL_LOCALES.has(locale);
}

export function localeDir(locale: Locale): "ltr" | "rtl" {
  return isRtlLocale(locale) ? "rtl" : "ltr";
}

// ---- Catalogue (English is the source of truth; others may be partial) ----

const en = {
  "nav.library": "Library",
  "nav.collections": "Collections",
  "nav.notes": "Notes",
  "nav.settings": "Settings",
  "nav.aria": "Main navigation",

  "palette.searchPlaceholder": "Type a command…",
  "palette.searchAria": "Search commands",
  "palette.noMatches": "No matching commands",
  "palette.goToLibrary": "Go to Library",
  "palette.hintLibrary": "Your books",
  "palette.goToCollections": "Go to Collections",
  "palette.hintCollections": "Organise your books",
  "palette.goToNotes": "Go to Notes",
  "palette.hintNotes": "Highlights and annotations",
  "palette.goToSettings": "Go to Settings",
  "palette.hintSettings": "Preferences and backups",
  "palette.switchAppearance": "Switch appearance",
  "palette.hintAppearance": "System → light → dark",
  "palette.replayTour": "Replay the welcome tour",
  "palette.hintTour": "Five-step introduction",

  "common.loading": "Loading…",
  "common.settingsLanguage": "Language",
  "common.settingsLanguageHelper": "Interface language (RTL scripts also flip page direction)",
} as const;

export type TranslationKey = keyof typeof en;

type Translations = Partial<Record<TranslationKey, string>>;

const catalogue: Record<Locale, Translations> = {
  en,
  hi: {
    "nav.library": "पुस्तकालय",
    "nav.collections": "संग्रह",
    "nav.notes": "नोट्स",
    "nav.settings": "सेटिंग्स",
    "nav.aria": "मुख्य नेविगेशन",
    "palette.searchPlaceholder": "कमांड लिखें…",
    "palette.searchAria": "कमांड खोजें",
    "palette.noMatches": "कोई कमांड नहीं मिली",
    "palette.goToLibrary": "पुस्तकालय खोलें",
    "palette.hintLibrary": "आपकी किताबें",
    "palette.goToCollections": "संग्रह खोलें",
    "palette.hintCollections": "किताबों को व्यवस्थित करें",
    "palette.goToNotes": "नोट्स खोलें",
    "palette.hintNotes": "हाइलाइट और टिप्पणियाँ",
    "palette.goToSettings": "सेटिंग्स खोलें",
    "palette.hintSettings": "प्राथमिकताएँ और बैकअप",
    "palette.switchAppearance": "रूप बदलें",
    "palette.hintAppearance": "सिस्टम → लाइट → डार्क",
    "palette.replayTour": "स्वागत टूर फिर चलाएँ",
    "palette.hintTour": "पाँच-चरण परिचय",
    "common.loading": "लोड हो रहा है…",
    "common.settingsLanguage": "भाषा",
    "common.settingsLanguageHelper": "इंटरफ़ेस की भाषा (RTL लिपियाँ पृष्ठ की दिशा भी बदलती हैं)",
  },
  ar: {
    "nav.library": "المكتبة",
    "nav.collections": "المجموعات",
    "nav.notes": "الملاحظات",
    "nav.settings": "الإعدادات",
    "nav.aria": "التنقل الرئيسي",
    "palette.searchPlaceholder": "اكتب أمرًا…",
    "palette.searchAria": "البحث في الأوامر",
    "palette.noMatches": "لا توجد أوامر مطابقة",
    "palette.goToLibrary": "الانتقال إلى المكتبة",
    "palette.hintLibrary": "كتبك",
    "palette.goToCollections": "الانتقال إلى المجموعات",
    "palette.hintCollections": "نظّم كتبك",
    "palette.goToNotes": "الانتقال إلى الملاحظات",
    "palette.hintNotes": "الإبرازات والتعليقات",
    "palette.goToSettings": "الانتقال إلى الإعدادات",
    "palette.hintSettings": "التفضيلات والنسخ الاحتياطي",
    "palette.switchAppearance": "تبديل المظهر",
    "palette.hintAppearance": "النظام ← فاتح ← داكن",
    "palette.replayTour": "إعادة الجولة الترحيبية",
    "palette.hintTour": "مقدمة من خمس خطوات",
    "common.loading": "جارٍ التحميل…",
    "common.settingsLanguage": "اللغة",
    "common.settingsLanguageHelper":
      "لغة الواجهة (النصوص من اليمين لليسار تغيّر اتجاه تقليب الصفحات أيضًا)",
  },
};

// ---- Store + application ----

interface LocaleState {
  locale: Locale;
  setLocale: (locale: Locale) => void;
}

export function readStoredLocale(): Locale {
  const v = readStorage(LOCALE_STORAGE_KEY);
  return v === "hi" || v === "ar" ? v : "en";
}

/** Set `lang`/`dir` on the document root (idempotent). */
export function applyLocale(locale: Locale): void {
  if (typeof document === "undefined") return;
  document.documentElement.lang = locale;
  document.documentElement.dir = localeDir(locale);
}

export const useLocaleStore = create<LocaleState>((set) => ({
  locale: readStoredLocale(),
  setLocale: (locale) => {
    writeStorage(LOCALE_STORAGE_KEY, locale);
    applyLocale(locale);
    set({ locale });
  },
}));

/** Pre-paint initialisation (main.tsx), mirroring the theme/contrast hooks. */
export function initLocale(): void {
  const locale = readStoredLocale();
  applyLocale(locale);
  useLocaleStore.setState({ locale });
}

/**
 * Translate `key` for the given (or current) locale; untranslated and unknown
 * keys fall back to English, and an unknown key returns itself so missing
 * catalogue entries are visible in dev instead of silently blank.
 */
export function t(key: TranslationKey, locale?: Locale): string {
  const l = locale ?? useLocaleStore.getState().locale;
  return catalogue[l]?.[key] ?? en[key] ?? key;
}

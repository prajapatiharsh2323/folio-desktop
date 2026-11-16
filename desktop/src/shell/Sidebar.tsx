import { FolioIcons } from "../components/FolioIcons";
import { t, useLocaleStore, type TranslationKey } from "../i18n/i18n";

export type Route = "library" | "reader" | "collections" | "notes" | "settings";

interface NavItem {
  route: Route;
  labelKey: TranslationKey;
  icon: (props: { size?: "md" | "sm" }) => React.ReactNode;
}

const NAV_ITEMS: NavItem[] = [
  { route: "library", labelKey: "nav.library", icon: FolioIcons.Book },
  { route: "collections", labelKey: "nav.collections", icon: FolioIcons.Collections },
  { route: "notes", labelKey: "nav.notes", icon: FolioIcons.Notes },
  { route: "settings", labelKey: "nav.settings", icon: FolioIcons.Settings },
];

/** Quiet 232px left sidebar (03 §5.1). Hidden entirely inside the reader.
 *  X1: below 900 px the CSS collapses it to an icon rail; labels stay in the
 *  a11y tree (visually clipped) and surface as tooltips. */
export function Sidebar({ route, onNavigate }: { route: Route; onNavigate: (r: Route) => void }) {
  // Subscribed so a locale change re-renders the labels (X5).
  const locale = useLocaleStore((s) => s.locale);
  return (
    <nav className="folio-sidebar" aria-label={t("nav.aria", locale)}>
      {NAV_ITEMS.map(({ route: r, labelKey, icon: Icon }) => {
        const label = t(labelKey, locale);
        const active = route === r || (r === "library" && route === "reader");
        return (
          <button
            key={r}
            type="button"
            className={`folio-sidebar__item${active ? " is-active" : ""}`}
            aria-current={active ? "page" : undefined}
            title={label}
            data-tour={`nav-${r}`}
            onClick={() => onNavigate(r)}
          >
            <Icon />
            <span>{label}</span>
          </button>
        );
      })}
    </nav>
  );
}

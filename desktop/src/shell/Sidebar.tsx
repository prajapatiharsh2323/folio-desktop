import { FolioIcons } from "../components/FolioIcons";

export type Route = "library" | "reader" | "collections" | "notes" | "settings";

interface NavItem {
  route: Route;
  label: string;
  icon: (props: { size?: "md" | "sm" }) => React.ReactNode;
}

const NAV_ITEMS: NavItem[] = [
  { route: "library", label: "Library", icon: FolioIcons.Book },
  { route: "collections", label: "Collections", icon: FolioIcons.Collections },
  { route: "notes", label: "Notes", icon: FolioIcons.Notes },
  { route: "settings", label: "Settings", icon: FolioIcons.Settings },
];

/** Quiet 232px left sidebar (03 §5.1). Hidden entirely inside the reader. */
export function Sidebar({
  route,
  onNavigate,
}: {
  route: Route;
  onNavigate: (r: Route) => void;
}) {
  return (
    <nav className="folio-sidebar" aria-label="Main navigation">
      {NAV_ITEMS.map(({ route: r, label, icon: Icon }) => {
        const active = route === r || (r === "library" && route === "reader");
        return (
          <button
            key={r}
            type="button"
            className={`folio-sidebar__item${active ? " is-active" : ""}`}
            aria-current={active ? "page" : undefined}
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

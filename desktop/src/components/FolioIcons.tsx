import type { ReactNode, SVGProps } from "react";

type IconSize = "md" | "sm";

function make(name: string, children: ReactNode) {
  function Icon({ size = "md", ...rest }: SVGProps<SVGSVGElement> & { size?: IconSize }) {
    const cls = ["folio-icon", size === "sm" && "folio-icon--sm"].filter(Boolean).join(" ");
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={cls}
        aria-hidden="true"
        focusable="false"
        {...rest}
      >
        <title>{name}</title>
        {children}
      </svg>
    );
  }
  Icon.displayName = `FolioIcon.${name}`;
  return Icon;
}

/** Inline SVG port of Folio's icon set (03 §8): 24px default, 20px small variant. */
export const FolioIcons = {
  /** Library / book */
  Book: make(
    "Book",
    <>
      <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15.5H6.5A2.5 2.5 0 0 0 4 21z" />
      <path d="M4 18.5A2.5 2.5 0 0 1 6.5 16H20" />
    </>
  ),
  /** Collections / stacked books */
  Collections: make(
    "Collections",
    <>
      <path d="M7 4h10a2 2 0 0 1 2 2v10" />
      <rect x="3" y="8" width="14" height="12" rx="2" />
      <path d="M3 16l4-4 3 3 3-3 4 4" />
    </>
  ),
  /** Notes / annotation */
  Notes: make(
    "Notes",
    <>
      <path d="M5 4h14v13l-4 4H5z" />
      <path d="M15 21v-4h4" />
      <path d="M8.5 9h7M8.5 12.5h4.5" />
    </>
  ),
  /** Settings / sliders */
  Settings: make(
    "Settings",
    <>
      <path d="M4 7h10M18 7h2M4 12h4M12 12h8M4 17h12M20 17h0" />
      <circle cx="16" cy="7" r="2" />
      <circle cx="10" cy="12" r="2" />
      <circle cx="18" cy="17" r="2" />
    </>
  ),
  Search: make(
    "Search",
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l5 5" />
    </>
  ),
  Sort: make(
    "Sort",
    <>
      <path d="M4 6h16M6 12h12M9 18h6" />
    </>
  ),
  /** ⋯ overflow */
  More: make(
    "More",
    <>
      <circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none" />
    </>
  ),
  Plus: make("Plus", <path d="M12 5v14M5 12h14" />),
  /** ◀ back */
  Back: make("Back", <path d="M14.5 5.5L8 12l6.5 6.5" />),
  /** Aa — appearance */
  Aa: make(
    "Aa",
    <>
      <path d="M3.5 18L8 6l4.5 12M5.2 13.5h5.6" />
      <path d="M20.5 18v-3.2m0 0a2.6 2.6 0 1 0-5.2 0m5.2 0v3.2m-5.2 0a2.6 2.6 0 1 1 5.2 0" />
    </>
  ),
  Bookmark: make("Bookmark", <path d="M7 4h10v16l-5-3.5L7 20z" />),
  /** TOC / list */
  Toc: make(
    "Toc",
    <>
      <path d="M8 6h12M8 12h12M8 18h12" />
      <circle cx="4.5" cy="6" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="4.5" cy="12" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="4.5" cy="18" r="0.9" fill="currentColor" stroke="none" />
    </>
  ),
  Close: make("Close", <path d="M6 6l12 12M18 6L6 18" />),
  ChevronDown: make("ChevronDown", <path d="M6.5 9.5L12 15l5.5-5.5" />),
  Check: make("Check", <path d="M5 12.5l4.5 4.5L19 7.5" />),
  Trash: make(
    "Trash",
    <>
      <path d="M5 7h14M10 7V5h4v2M7 7l1 13h8l1-13" />
      <path d="M10 11v5M14 11v5" />
    </>
  ),
  Tag: make(
    "Tag",
    <>
      <path d="M4 5h7l9 9-7 7-9-9z" />
      <circle cx="8.5" cy="9.5" r="1.3" />
    </>
  ),
  /** Import / download-to-tray */
  Import: make(
    "Import",
    <>
      <path d="M12 4v11M7.5 10.5L12 15l4.5-4.5" />
      <path d="M5 19h14" />
    </>
  ),
  /** Folder (collections detail) */
  Folder: make("Folder", <path d="M4 6h6l2 2.5h8V18a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />),
  /** Note-plus (add note) */
  NotePlus: make(
    "NotePlus",
    <>
      <path d="M13 4H5v16h10v-6" />
      <path d="M5 4h14v7" />
      <path d="M18 13v6M15 16h6" />
    </>
  ),
  /** Palette (appearance) */
  Palette: make(
    "Palette",
    <>
      <path d="M12 3a9 9 0 1 0 0 18c1.4 0 2-1 2-2s-.6-2-2-2h-1.5a2 2 0 0 1 0-4H15a6 6 0 0 0 6-6c0-2.5-4-4-9-4z" />
      <circle cx="7.5" cy="10.5" r="1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="7.5" r="1" fill="currentColor" stroke="none" />
      <circle cx="16.5" cy="10.5" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  /** Cloud (sync) */
  Cloud: make(
    "Cloud",
    <path d="M7 18a4 4 0 0 1-.6-7.95A5.5 5.5 0 0 1 17 8.3 4.2 4.2 0 0 1 17.8 18z" />
  ),
  /** Info / about */
  Info: make(
    "Info",
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v6" />
      <circle cx="12" cy="7.5" r="0.9" fill="currentColor" stroke="none" />
    </>
  ),
} as const;

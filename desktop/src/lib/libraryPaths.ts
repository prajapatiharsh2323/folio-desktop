// Library tree path constants (02 §5). All layout knowledge lives here in TS —
// Rust never hardcodes Folio paths.

export interface LibraryPaths {
  root: string; // library root (contains library/… below? NO — root IS the library/ dir)
}

/**
 * `root` is the resolved library directory (e.g. `<appData>/Folio/library`).
 * All functions build paths under it, matching 02 §5:
 *
 *   manifest.json
 *   docs/<slug>/…
 *   user/annotations.json | progress.json | collections.json | settings.json | doc-settings.json
 *   index/text/<docId>.json
 */
export const libraryLayout = {
  manifest: (root: string) => join(root, "manifest.json"),

  docsDir: (root: string) => join(root, "docs"),
  docDir: (root: string, slug: string) => join(root, "docs", slug),
  docMeta: (root: string, slug: string) => join(root, "docs", slug, "meta.json"),
  docOriginalDir: (root: string, slug: string) => join(root, "docs", slug, "original"),
  docCleanDir: (root: string, slug: string) => join(root, "docs", slug, "clean"),
  docReadingDir: (root: string, slug: string) => join(root, "docs", slug, "reading"),
  docReadingBook: (root: string, slug: string) => join(root, "docs", slug, "reading", "book.epub"),

  userDir: (root: string) => join(root, "user"),
  annotations: (root: string) => join(root, "user", "annotations.json"),
  progress: (root: string) => join(root, "user", "progress.json"),
  collections: (root: string) => join(root, "user", "collections.json"),
  settings: (root: string) => join(root, "user", "settings.json"),
  docSettings: (root: string) => join(root, "user", "doc-settings.json"),

  indexText: (root: string, docId: string) => join(root, "index", "text", `${docId}.json`),

  /** user/window.json — desktop-only, never in backups (02 §3). */
  windowState: (appDir: string) => join(appDir, "user", "window.json"),
};

function join(...parts: string[]): string {
  return parts
    .map((p, i) => (i === 0 ? p : p.replace(/^\/+|\/+$/g, "")))
    .filter((p) => p !== "")
    .join("/");
}

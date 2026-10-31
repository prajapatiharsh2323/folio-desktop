// Schema-1 data model — canonical TypeScript shape (05-data-model-and-compat.md §1–§2).
// JSON field names, optionality, and enum string values MUST stay identical to
// mobile (Types.kt). Tolerate unknown keys on read; never rename.

export type DocKind = "article" | "book";
export type SourceFormat = "epub" | "pdf" | "html" | "txt" | "clip";
export type AnnotationKind = "highlight" | "note" | "bookmark";
export type HighlightColor = "yellow" | "green" | "blue" | "pink";

export interface Chapter {
  id: string;
  title: string;
  order: number;
  /** href relative to doc folder */
  href: string;
}

export interface DocMetaFiles {
  /** path inside library/, e.g. "original/book.epub" (relative to doc folder) */
  original?: string | null;
  clean?: string | null;
  reading?: string | null;
  cover?: string | null;
}

export interface DocMeta {
  schema: 1;
  id: string; // uuid v4
  slug: string;
  title: string;
  author?: string | null;
  kind: DocKind;
  /** BCP 47, e.g. 'en', 'hi' */
  language?: string | null;
  sourceFormat: SourceFormat;
  /** clips and web-origin files */
  sourceUrl?: string | null;
  /** site or publisher name */
  sourceName?: string | null;
  /** ISO-8601 UTC */
  capturedAt: string;
  /** ISO-8601 UTC */
  importedAt: string;
  /** SHA-256 hex of original bytes (clips: of clean/index.html) */
  contentHash: string;
  wordCount?: number | null;
  /** false only for scanned docs w/o text layer */
  searchable?: boolean;
  tags: string[];
  /** ← dual-write with collections.json */
  collectionIds: string[];
  files: DocMetaFiles;
  chapters: Chapter[];
}

export interface ProgressPace {
  sessionsMs: number;
  percentRead: number;
}

export interface Progress {
  docId: string;
  /** epubcfi(...) or chapter-href fallback */
  location: string;
  /** 0..100, one decimal */
  percent: number;
  updatedAt: string;
  pace?: ProgressPace | null;
}

export interface Annotation {
  id: string;
  docId: string;
  chapterId?: string | null;
  quote: string;
  /** up to 32 chars before quote */
  prefix: string;
  /** up to 32 chars after quote */
  suffix: string;
  /** engine hint; quote+context authoritative */
  location?: string | null;
  kind: AnnotationKind;
  color?: HighlightColor | null;
  note?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Collection {
  id: string;
  name: string;
  docIds: string[];
  createdAt: string;
  /** optional refinement (mobile-added); readers must tolerate */
  updatedAt?: string | null;
}

export interface ManifestFile {
  path: string;
  size: number;
  sha256: string;
}

export interface ManifestDoc {
  id: string;
  slug: string;
  title: string;
  contentHash: string;
  updatedAt: string;
  files: ManifestFile[];
}

export interface Manifest {
  schema: 1;
  app: "folio";
  /** uuid v4 — stable per library; schema-1 field, now carried only by backup v2 metadata */
  libraryId: string;
  updatedAt: string;
  docs: ManifestDoc[];
}

// ---- ReadingPrefs (04-reader-spec.md §3; byte-compat incl. dead fields) ----

export type ReadingTheme = "light" | "warm" | "dark" | "true-black" | "system";
export type FontFamilyPref = "serif" | "sans" | "mono" | "publisher";
export type ReadingFlow = "paginated" | "scrolled";
export type ReadingSpread = "none" | "auto" | "both";

export interface ReadingPrefs {
  schema?: 1;
  theme: ReadingTheme;
  fontFamily: FontFamilyPref;
  /** 14..32 px (default 18) */
  fontSize: number;
  /** 1.3..2.4 (default 1.6) */
  lineHeight: number;
  /** 12..64 px (default 20) */
  margin: number;
  /** default false */
  justify: boolean;
  /** default false */
  hyphenate: boolean;
  /** em 0..0.8 */
  paragraphSpacing: number;
  /** em 0..0.1 */
  letterSpacing: number;
  /** legacy-inert; desktop may honor later as column cap */
  maxWidth: number;
  /** 30..100 default 100 */
  brightness: number;
  flow: ReadingFlow;
  spread: ReadingSpread;
  /** BYTE-COMPAT DEAD FIELD — persist but ignore */
  pdfZoom: string;
}

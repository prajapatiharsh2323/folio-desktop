// EPUB → @readium/shared Publication adapter.
//
// We open EPUBs from bytes (the library stores reading/book.epub on disk), so
// there is no HTTP-served manifest to hand to the navigator. This module builds
// the RWPM-shaped Publication: container.xml → OPF → metadata + manifest +
// spine + TOC + cover, over a zip-backed Fetcher. It also synthesizes the
// positions list the navigator needs (see positions.ts).
import { strFromU8, unzipSync } from "fflate";
import {
  entryWithinCap,
  MAX_ENTRY_UNCOMPRESSED,
  MAX_TOTAL_UNCOMPRESSED,
  MAX_ZIP_ENTRIES,
  unzipLimited,
  ZipLimitError,
} from "../import/zipLimits";
import {
  Contributor,
  Contributors,
  Layout,
  Link,
  Links,
  LocalizedString,
  Locator,
  Manifest,
  Metadata,
  Properties,
  Publication,
  ReadingProgression,
  Resource,
} from "@readium/shared";
import { generatePositions, generatePositionsAsync } from "./positions";

export interface EpubPackage {
  publication: Publication;
  positions: Locator[];
  zip: Record<string, Uint8Array>;
  opfPath: string;
  /** Revokes the blob URLs created for author assets. */
  close: () => void;
}

interface ManifestItem {
  id: string;
  href: string;
  mediaType: string;
  properties: string[];
  absHref: string;
}

function parseXml(source: string, label: string): Document {
  const doc = new DOMParser().parseFromString(source, "application/xml");
  const err = doc.querySelector("parsererror");
  if (err) throw new Error(`Invalid XML in ${label}`);
  return doc;
}

function parseHtml(source: string): Document {
  return new DOMParser().parseFromString(source, "text/html");
}

function byLocalName(root: Document | Element, local: string): Element[] {
  return Array.from(root.getElementsByTagNameNS("*", local));
}

function firstByLocalName(root: Document | Element, local: string): Element | null {
  return byLocalName(root, local)[0] ?? null;
}

function textOf(el: Element | null): string {
  return el?.textContent?.replace(/\s+/g, " ").trim() ?? "";
}

function allText(doc: Document, local: string): string[] {
  return byLocalName(doc, local)
    .map((el) => textOf(el))
    .filter(Boolean);
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function normalizePath(path: string): string {
  const out: string[] = [];
  for (const part of path.replace(/\\/g, "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      out.pop();
      continue;
    }
    out.push(part);
  }
  return out.join("/");
}

/** Directory part of a zip-absolute path ("OEBPS/text/" from "OEBPS/text/ch1.xhtml"). */
export function dirname(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? "" : path.slice(0, i + 1);
}

/** Resolve an EPUB-internal href against a path inside the zip. */
export function resolveEpubHref(baseDir: string, href: string): string {
  const hashIndex = href.indexOf("#");
  const fragment = hashIndex >= 0 ? href.slice(hashIndex) : "";
  const rawPath = hashIndex >= 0 ? href.slice(0, hashIndex) : href;
  if (/^[a-z][a-z0-9+.-]*:/i.test(rawPath)) return href; // external URL
  const decoded = safeDecode(rawPath);
  const absolute = decoded.startsWith("/")
    ? normalizePath(decoded)
    : normalizePath(`${baseDir}/${decoded}`);
  return absolute + fragment;
}

/** Zip bytes for a resource path (tolerates fragments, encoding, case of separators). */
export function zipEntry(zip: Record<string, Uint8Array>, href: string): Uint8Array | undefined {
  const bare = href.split("#")[0];
  return (
    zip[bare] ??
    zip[safeDecode(bare)] ??
    zip[normalizePath(safeDecode(bare))] ??
    zip[normalizePath(bare)]
  );
}

export function mediaTypeFor(href: string): string {
  const lower = href.toLowerCase().split("#")[0];
  if (lower.endsWith(".xhtml") || lower.endsWith(".html") || lower.endsWith(".htm"))
    return "application/xhtml+xml";
  if (lower.endsWith(".css")) return "text/css";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".svg")) return "image/svg+xml";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".avif")) return "image/avif";
  if (lower.endsWith(".otf")) return "font/otf";
  if (lower.endsWith(".ttf")) return "font/ttf";
  if (lower.endsWith(".woff")) return "font/woff";
  if (lower.endsWith(".woff2")) return "font/woff2";
  if (lower.endsWith(".ncx")) return "application/x-dtbncx+xml";
  if (lower.endsWith(".opf")) return "application/oebps-package+xml";
  if (lower.endsWith(".js")) return "application/javascript";
  if (lower.endsWith(".mp3")) return "audio/mpeg";
  if (lower.endsWith(".mp4")) return "video/mp4";
  return "application/octet-stream";
}

const REMOTE_URL = /^(?:[a-z][a-z0-9+.-]*:|#|\/\/)/i;

/**
 * EPUB resources live inside a zip, but the navigator renders them from blob
 * URLs. Author images, fonts and stylesheets therefore need their references
 * rewritten to blob URLs; otherwise the iframe would request `/OEBPS/…` from
 * the app origin and every inline asset would 404.
 *
 * One resolver per opened book so blob URLs can be revoked on close.
 */
class AssetResolver {
  private readonly urls = new Map<string, string>();

  constructor(private readonly zip: Record<string, Uint8Array>) {}

  /** Blob URL for an EPUB-internal path, or null when it is not in the zip. */
  urlFor(absPath: string): string | null {
    const bare = absPath.split("#")[0];
    const cached = this.urls.get(bare);
    if (cached) return cached;
    const entry = zipEntry(this.zip, bare);
    if (!entry) return null;
    const type = mediaTypeFor(bare);
    const bytes =
      type === "text/css"
        ? new TextEncoder().encode(this.rewriteCss(strFromU8(entry), bare))
        : entry;
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
    this.urls.set(bare, url);
    return url;
  }

  /** Rewrite `url(...)` references in an author stylesheet. */
  rewriteCss(css: string, cssHref: string): string {
    const baseDir = dirname(cssHref);
    return css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (whole, quote: string, ref: string) => {
      const trimmed = ref.trim();
      if (!trimmed || REMOTE_URL.test(trimmed)) return whole;
      const abs = resolveEpubHref(baseDir, trimmed);
      const url = this.urlFor(abs);
      return url ? `url(${quote}${url}${quote})` : whole;
    });
  }

  /** Rewrite asset references in an XHTML resource (anchors stay untouched). */
  rewriteHtml(doc: Document, htmlHref: string): void {
    const baseDir = dirname(htmlHref);

    const rewriteAttr = (el: Element, attr: string) => {
      const raw = el.getAttribute(attr);
      if (!raw || REMOTE_URL.test(raw.trim())) return;
      const url = this.urlFor(resolveEpubHref(baseDir, raw.trim()));
      if (url) el.setAttribute(attr, url);
    };

    for (const el of Array.from(doc.querySelectorAll("[src]"))) rewriteAttr(el, "src");
    for (const el of Array.from(doc.querySelectorAll("[poster]"))) rewriteAttr(el, "poster");
    for (const el of Array.from(doc.querySelectorAll("[srcset]"))) {
      const raw = el.getAttribute("srcset");
      if (!raw) continue;
      const next = raw
        .split(",")
        .map((part) => {
          const [ref, ...descriptor] = part.trim().split(/\s+/);
          if (!ref || REMOTE_URL.test(ref)) return part.trim();
          const url = this.urlFor(resolveEpubHref(baseDir, ref));
          return [url ?? ref, ...descriptor].join(" ");
        })
        .join(", ");
      el.setAttribute("srcset", next);
    }
    // Stylesheets and icons (never <a href>, which the navigator resolves).
    for (const el of Array.from(doc.querySelectorAll("link[href]"))) {
      const rel = (el.getAttribute("rel") ?? "").toLowerCase();
      if (!rel.split(/\s+/).some((r) => ["stylesheet", "icon", "apple-touch-icon"].includes(r)))
        continue;
      rewriteAttr(el, "href");
    }
    // SVG <image>/<use> references.
    for (const el of Array.from(doc.querySelectorAll("image"))) {
      rewriteAttr(el, "href");
      rewriteAttr(el, "xlink:href");
    }
    for (const el of Array.from(doc.querySelectorAll("use"))) {
      rewriteAttr(el, "href");
      rewriteAttr(el, "xlink:href");
    }
  }

  revokeAll(): void {
    for (const url of this.urls.values()) URL.revokeObjectURL(url);
    this.urls.clear();
  }
}

class ZipResource extends Resource {
  constructor(
    private readonly linkValue: Link,
    private readonly entry: Uint8Array | undefined,
    private readonly assets: AssetResolver,
  ) {
    super();
  }

  async link(): Promise<Link> {
    return this.linkValue;
  }

  async length(): Promise<number | undefined> {
    return this.entry?.length;
  }

  async read(): Promise<Uint8Array | undefined> {
    if (!this.entry) return undefined;
    if (this.linkValue.mediaType.essence === "text/css") {
      return new TextEncoder().encode(
        this.assets.rewriteCss(strFromU8(this.entry), this.linkValue.href),
      );
    }
    return this.entry;
  }

  async readAsXML(): Promise<Document | undefined> {
    if (!this.entry) return undefined;
    const mediaType = this.linkValue.mediaType;
    if (!mediaType.isHTML) return super.readAsXML();
    const source = strFromU8(this.entry);
    const xmlType =
      mediaType.essence === "application/xhtml+xml" ? "application/xhtml+xml" : "text/html";
    let doc = new DOMParser().parseFromString(source, xmlType);
    if (doc.querySelector("parsererror") && xmlType !== "text/html") {
      // Malformed XHTML is common in the wild; the HTML parser is forgiving.
      doc = new DOMParser().parseFromString(source, "text/html");
    }
    this.assets.rewriteHtml(doc, this.linkValue.href);
    return doc;
  }

  close(): void {
    /* zip bytes and blob URLs are owned by the fetcher */
  }
}

class ZipFetcher {
  private readonly keys: string[];
  private readonly assets: AssetResolver;

  constructor(private readonly zip: Record<string, Uint8Array>) {
    this.keys = Object.keys(zip);
    this.assets = new AssetResolver(zip);
  }

  links(): Link[] {
    return this.keys.map((href) => new Link({ href, type: mediaTypeFor(href) }));
  }

  get(link: Link): Resource {
    return new ZipResource(link, zipEntry(this.zip, link.href), this.assets);
  }

  close(): void {
    this.assets.revokeAll();
  }
}

function readManifest(doc: Document, opfDir: string): ManifestItem[] {
  const items: ManifestItem[] = [];
  for (const el of byLocalName(doc, "item")) {
    const id = el.getAttribute("id") ?? "";
    const href = el.getAttribute("href") ?? "";
    if (!id || !href) continue;
    items.push({
      id,
      href,
      mediaType: el.getAttribute("media-type") ?? mediaTypeFor(href),
      properties: (el.getAttribute("properties") ?? "").split(/\s+/).filter(Boolean),
      absHref: resolveEpubHref(opfDir, href),
    });
  }
  return items;
}

function readSpine(
  doc: Document,
  items: ManifestItem[],
): { hrefs: string[]; tocId: string | null } {
  const byId = new Map(items.map((i) => [i.id, i]));
  const spine = firstByLocalName(doc, "spine");
  const hrefs: string[] = [];
  for (const itemref of byLocalName(doc, "itemref")) {
    const idref = itemref.getAttribute("idref") ?? "";
    const item = byId.get(idref);
    if (!item) continue;
    hrefs.push(item.absHref);
  }
  return { hrefs, tocId: spine?.getAttribute("toc") ?? null };
}

function attrsOf(el: Element, name: string): string {
  return el.getAttribute(name) ?? el.getAttributeNS("http://www.idpf.org/2007/ops", name) ?? "";
}

function parseNavList(list: Element, baseDir: string): Link[] {
  const out: Link[] = [];
  for (const child of Array.from(list.children)) {
    if (child.localName.toLowerCase() !== "li") continue;
    const linkEl = Array.from(child.children).find((c) =>
      ["a", "span"].includes(c.localName.toLowerCase()),
    );
    const nested = Array.from(child.children).find((c) =>
      ["ol", "ul"].includes(c.localName.toLowerCase()),
    );
    const title = textOf(linkEl ?? null);
    const rawHref = linkEl?.getAttribute("href") ?? "";
    const children = nested ? parseNavList(nested, baseDir) : [];
    if (!rawHref) {
      // A label-only entry: attach its children at this level.
      out.push(...children);
      continue;
    }
    out.push(
      new Link({
        href: resolveEpubHref(baseDir, rawHref),
        title: title || rawHref,
        type: mediaTypeFor(rawHref),
        children: children.length > 0 ? new Links(children) : undefined,
      }),
    );
  }
  return out;
}

function parseNavToc(navBytes: Uint8Array | undefined, navHref: string): Link[] {
  if (!navBytes) return [];
  const doc = parseHtml(strFromU8(navBytes));
  const navs = Array.from(doc.querySelectorAll("nav"));
  const tocNav =
    navs.find((nav) => {
      const type = attrsOf(nav, "type").toLowerCase();
      return (
        type === "toc" ||
        type.split(/\s+/).includes("toc") ||
        nav.getAttribute("role") === "doc-toc"
      );
    }) ??
    navs.find((nav) => Boolean(nav.querySelector("ol, ul"))) ??
    null;
  if (!tocNav) return [];
  const list = tocNav.querySelector("ol, ul");
  if (!list) return [];
  return parseNavList(list, dirname(navHref));
}

function parseNcxToc(ncxBytes: Uint8Array | undefined, ncxHref: string): Link[] {
  if (!ncxBytes) return [];
  let doc: Document;
  try {
    doc = parseXml(strFromU8(ncxBytes), "NCX");
  } catch {
    return [];
  }
  const navMap = firstByLocalName(doc, "navMap");
  if (!navMap) return [];

  const build = (parent: Element): Link[] => {
    const out: Link[] = [];
    for (const point of Array.from(parent.children)) {
      if (point.localName.toLowerCase() !== "navpoint") continue;
      const label = firstByLocalName(point, "navLabel");
      const src = firstByLocalName(point, "content")?.getAttribute("src");
      const children = build(point);
      if (!src) continue;
      out.push(
        new Link({
          href: resolveEpubHref(dirname(ncxHref), src),
          title: textOf(label) || src,
          type: mediaTypeFor(src),
          children: children.length > 0 ? new Links(children) : undefined,
        }),
      );
    }
    return out;
  };
  return build(navMap);
}

function readCover(doc: Document, items: ManifestItem[], opfDir: string): ManifestItem | null {
  // EPUB3: properties="cover-image"
  const byProperty = items.find((i) => i.properties.includes("cover-image"));
  if (byProperty) return byProperty;

  // EPUB2: <meta name="cover" content="item-id"/>
  for (const meta of byLocalName(doc, "meta")) {
    if (meta.getAttribute("name") === "cover") {
      const id = meta.getAttribute("content") ?? "";
      const item = items.find((i) => i.id === id);
      if (item) return item;
    }
  }

  // EPUB2 guide: <reference type="cover" href="..."/>
  for (const ref of byLocalName(doc, "reference")) {
    if ((ref.getAttribute("type") ?? "").toLowerCase() === "cover") {
      const href = ref.getAttribute("href") ?? "";
      if (!href) continue;
      const abs = resolveEpubHref(opfDir, href);
      const item = items.find((i) => i.absHref === abs);
      if (item) return item;
      return {
        id: "cover",
        href,
        mediaType: mediaTypeFor(href),
        properties: ["cover-image"],
        absHref: abs,
      };
    }
  }
  return null;
}

function readLayout(doc: Document): Layout | undefined {
  for (const meta of byLocalName(doc, "meta")) {
    const property = meta.getAttribute("property") ?? "";
    const name = meta.getAttribute("name") ?? "";
    const content = meta.getAttribute("content") ?? "";
    if (property === "rendition:layout" && content === "pre-paginated") return Layout.fixed;
    if (name === "fixed-layout" && content.toLowerCase() === "true") return Layout.fixed;
  }
  return undefined;
}

function readReadingProgression(doc: Document): ReadingProgression | undefined {
  const spine = firstByLocalName(doc, "spine");
  const value = (spine?.getAttribute("page-progression-direction") ?? "").toLowerCase();
  if (value === "rtl") return ReadingProgression.rtl;
  if (value === "ltr") return ReadingProgression.ltr;
  return undefined;
}

function identifierOf(doc: Document): string | undefined {
  const pkg = firstByLocalName(doc, "package");
  const uniqueId = pkg?.getAttribute("unique-identifier");
  const identifiers = byLocalName(doc, "identifier");
  if (uniqueId) {
    const match = identifiers.find((el) => el.getAttribute("id") === uniqueId);
    if (match && textOf(match)) return textOf(match);
  }
  const first = identifiers[0];
  return first && textOf(first) ? textOf(first) : undefined;
}

/**
 * Lazy zip map (R12): a `Record<string, Uint8Array>` that decompresses each
 * entry on first access instead of inflating the whole archive up front.
 * Entry names come from one central-directory walk (fflate's filter runs per
 * entry without decompressing), and every read inflates only that entry,
 * cached. Direct property reads, `in`, and `Object.keys` all behave like the
 * eager map, so ZipFetcher/AssetResolver consumers need no changes.
 */
class LazyZip {
  readonly names: string[];
  readonly nameSet: Set<string>;
  private readonly cache = new Map<string, Uint8Array>();

  constructor(private readonly bytes: Uint8Array) {
    // One directory walk with a never-matching filter: names only, no inflate.
    // The declared sizes are checked here so a hostile archive is refused
    // before any entry is ever inflated (Step 3.2, Rust zip.rs parity).
    const names: string[] = [];
    let total = 0;
    unzipSync(bytes, {
      filter: (file) => {
        names.push(file.name);
        total += file.originalSize;
        if (names.length > MAX_ZIP_ENTRIES) throw new ZipLimitError("too-many-entries");
        if (file.originalSize > MAX_ENTRY_UNCOMPRESSED) throw new ZipLimitError("entry-too-large");
        if (total > MAX_TOTAL_UNCOMPRESSED) throw new ZipLimitError("archive-too-large");
        return false;
      },
    });
    this.names = names;
    this.nameSet = new Set(names);
  }

  entry(name: string): Uint8Array | undefined {
    const cached = this.cache.get(name);
    if (cached) return cached;
    if (!this.nameSet.has(name)) return undefined;
    const hit = unzipSync(this.bytes, {
      filter: (file) => file.name === name && entryWithinCap(file.originalSize),
    });
    const data = hit[name];
    if (data) this.cache.set(name, data);
    return data;
  }
}

/** Wrap a LazyZip in the eager-map shape the rest of the pipeline expects. */
function lazyZipMap(bytes: Uint8Array): Record<string, Uint8Array> {
  const lazy = new LazyZip(bytes);
  const map = new Map<string, Uint8Array>();
  return new Proxy(map, {
    get(_target, key) {
      if (typeof key !== "string") return undefined;
      return lazy.entry(key);
    },
    has(_target, key) {
      return typeof key === "string" && lazy.nameSet.has(key);
    },
    ownKeys() {
      return [...lazy.names];
    },
    getOwnPropertyDescriptor(_target, key) {
      if (typeof key !== "string" || !lazy.nameSet.has(key)) return undefined;
      // Data descriptor so Object.keys/entries enumerate; values still flow
      // through the `get` trap above (decompress-on-access).
      return { configurable: true, enumerable: true, writable: true, value: undefined };
    },
    set() {
      return false; // the archive is read-only
    },
    deleteProperty() {
      return false;
    },
  }) as unknown as Record<string, Uint8Array>;
}

export interface EpubCore {
  publication: Publication;
  zip: Record<string, Uint8Array>;
  opfPath: string;
  /** Revokes the blob URLs created for author assets. */
  close: () => void;
}

/** Container → OPF → metadata/manifest/spine/TOC → Publication. Sync; cheap
 *  relative to decompression, so both open paths share it. */
function buildEpubCore(zip: Record<string, Uint8Array>): EpubCore {
  const containerBytes = zip["META-INF/container.xml"];
  if (!containerBytes) throw new Error("Not an EPUB: missing META-INF/container.xml");
  const container = parseXml(strFromU8(containerBytes), "META-INF/container.xml");
  const rootfile = firstByLocalName(container, "rootfile");
  const opfHref = rootfile?.getAttribute("full-path") ?? "";
  if (!opfHref) throw new Error("EPUB container has no rootfile");
  const opfPath = normalizePath(safeDecode(opfHref));
  // Some producers percent-encode the container path; try the literal entry
  // first, then the decoded one before giving up.
  const opfBytes = zip[opfHref] ?? zip[opfPath] ?? zipEntry(zip, opfPath);
  if (!opfBytes) throw new Error(`EPUB package not found: ${opfPath}`);
  const opfDir = dirname(opfPath);
  const opf = parseXml(strFromU8(opfBytes), opfPath);

  const items = readManifest(opf, opfDir);
  const { hrefs, tocId } = readSpine(opf, items);
  if (hrefs.length === 0) throw new Error("EPUB has no readable spine");

  const readingOrderItems: ManifestItem[] = [];
  const seen = new Set<string>();
  for (const href of hrefs) {
    if (seen.has(href)) continue;
    seen.add(href);
    const item = items.find((i) => i.absHref === href);
    readingOrderItems.push(
      item ?? {
        id: href,
        href,
        mediaType: mediaTypeFor(href),
        properties: [],
        absHref: href,
      },
    );
  }

  const readingOrder = readingOrderItems.map(
    (item) =>
      new Link({
        href: item.absHref,
        type: item.mediaType || mediaTypeFor(item.href),
        properties:
          item.properties.length > 0
            ? new Properties(Object.fromEntries(item.properties.map((p) => [p, true])))
            : undefined,
      }),
  );

  const cover = readCover(opf, items, opfDir);
  const coverLink = cover
    ? new Link({
        href: cover.absHref,
        type: cover.mediaType || mediaTypeFor(cover.href),
        rels: new Set(["cover"]),
        properties: new Properties({ "cover-image": true }),
      })
    : null;

  const resources = items
    .filter((item) => !seen.has(item.absHref))
    .map(
      (item) =>
        new Link({
          href: item.absHref,
          type: item.mediaType || mediaTypeFor(item.href),
          properties:
            item.properties.length > 0
              ? new Properties(Object.fromEntries(item.properties.map((p) => [p, true])))
              : undefined,
        }),
    );
  if (coverLink && !resources.some((r) => r.href === coverLink.href)) {
    resources.push(coverLink);
  }

  // TOC: EPUB3 nav document first, NCX second.
  const navItem = items.find((i) => i.properties.includes("nav"));
  let toc = navItem ? parseNavToc(zipEntry(zip, navItem.absHref), navItem.absHref) : [];
  if (toc.length === 0) {
    const ncxItem =
      items.find((i) => i.mediaType === "application/x-dtbncx+xml") ??
      items.find((i) => i.id === tocId);
    if (ncxItem) toc = parseNcxToc(zipEntry(zip, ncxItem.absHref), ncxItem.absHref);
  }

  const title = allText(opf, "title")[0] ?? "Untitled";
  const authors = allText(opf, "creator");
  const languages = allText(opf, "language");
  const modifiedRaw = byLocalName(opf, "meta").find(
    (m) => m.getAttribute("property") === "dcterms:modified",
  );
  const modifiedText = textOf(modifiedRaw ?? null);
  const modified = modifiedText ? new Date(modifiedText) : undefined;

  const metadata = new Metadata({
    title: new LocalizedString(title),
    identifier: identifierOf(opf),
    languages: languages.length > 0 ? languages : ["en"],
    authors:
      authors.length > 0
        ? new Contributors(
            authors.map((name) => new Contributor({ name: new LocalizedString(name) })),
          )
        : undefined,
    layout: readLayout(opf),
    readingProgression: readReadingProgression(opf),
    modified: modified && !Number.isNaN(modified.getTime()) ? modified : undefined,
  });

  const manifest = new Manifest({
    metadata,
    links: coverLink ? new Links([coverLink]) : undefined,
    readingOrder: new Links(readingOrder),
    resources: new Links(resources),
    toc: toc.length > 0 ? new Links(toc) : undefined,
  });

  const fetcher = new ZipFetcher(zip);
  const publication = new Publication({
    manifest,
    fetcher: fetcher as never,
  });

  return {
    publication,
    zip,
    opfPath,
    close: () => fetcher.close(),
  };
}

/** Eager open: inflate the whole archive, parse, synthesize the positions
 *  list in one synchronous pass (tests and small books). */
export function openEpubFromBytes(bytes: Uint8Array): EpubPackage {
  const zip = unzipLimited(bytes) as Record<string, Uint8Array>;
  const core = buildEpubCore(zip);
  return {
    ...core,
    positions: generatePositions(core.publication, zip),
  };
}

/** Progress reported while a book opens (R12): "unpack" is indeterminate
 *  (lazy decompression has no overall total), "prepare" walks the spine and
 *  carries a 0..1 fraction for the splash bar. */
export interface OpenProgress {
  stage: "unpack" | "prepare";
  fraction: number | null;
}

/**
 * Additive position cache hook (Step 3.2): the first open measures the spine
 * and stores the generated list; later opens skip generation entirely. The
 * store is an additive cache file — no schema-1 field is touched, and a
 * failed read/write only costs a regeneration.
 */
export interface PositionsCacheHook {
  /** Serialized cached positions, or null on miss/damage/version mismatch. */
  load(): Promise<unknown | null>;
  /** Fire-and-forget persist of the freshly generated list. */
  save(positions: Locator[]): Promise<void>;
}

/** Revive serialized locators; null when anything is malformed. */
export function deserializeCachedPositions(raw: unknown): Locator[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out: Locator[] = [];
  for (const item of raw) {
    const locator = Locator.deserialize(item);
    if (!locator?.href || !locator.locations) return null;
    out.push(locator);
  }
  return out;
}

/**
 * Async open (R12): lazily decompressed entries, the position list built one
 * spine resource at a time with yields to the event loop, and progress
 * reported for the splash. Keeps large books off a single blocking task.
 * When a cache hook is supplied, a valid cached list replaces generation.
 */
export async function openEpubFromBytesAsync(
  bytes: Uint8Array,
  onProgress?: (progress: OpenProgress) => void,
  cache?: PositionsCacheHook,
): Promise<EpubPackage> {
  onProgress?.({ stage: "unpack", fraction: null });
  const zip = lazyZipMap(bytes);
  const core = buildEpubCore(zip);
  if (cache) {
    try {
      const cached = deserializeCachedPositions(await cache.load());
      if (cached) return { ...core, positions: cached };
    } catch {
      /* damaged cache → regenerate below */
    }
  }
  onProgress?.({ stage: "prepare", fraction: 0 });
  const positions = await generatePositionsAsync(core.publication, zip, (done, total) =>
    onProgress?.({ stage: "prepare", fraction: total > 0 ? done / total : 1 }),
  );
  // Persist for the next open; a write failure never blocks this session.
  if (cache) void cache.save(positions).catch(() => undefined);
  return { ...core, positions };
}

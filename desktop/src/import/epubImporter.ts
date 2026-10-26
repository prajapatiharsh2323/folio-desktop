// EPUB import: container.xml → OPF → spine order → per-spine-item plain text;
// cover from properties="cover-image" (EPUB3) or EPUB2 meta heuristic (02 §6).
import { unzipSync, strFromU8 } from "fflate";
import { textFromHtml } from "./sanitize";

export interface EpubChapterText {
  id: string;
  title: string;
  order: number;
  href: string;
  text: string;
}

export interface EpubParseResult {
  title: string | null;
  author: string | null;
  language: string | null;
  chapters: EpubChapterText[];
  cover: { href: string; bytes: Uint8Array; ext: string } | null;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function parseEpub(bytes: Uint8Array): EpubParseResult {
  const zip = unzipSync(bytes);
  const container = new DOMParser().parseFromString(
    strFromU8(zip["META-INF/container.xml"]),
    "application/xml"
  );
  const opfPath =
    container.querySelector("rootfile")?.getAttribute("full-path") ?? "";
  if (!opfPath || !zip[opfPath]) throw new Error("container.xml → rootfile missing");

  const opfDir = opfPath.includes("/") ? opfPath.slice(0, opfPath.lastIndexOf("/") + 1) : "";
  const opf = new DOMParser().parseFromString(strFromU8(zip[opfPath]), "application/xml");

  const pick = (local: string): string | null => {
    const metaEls = opf.querySelectorAll("metadata > *");
    for (const el of Array.from(metaEls)) {
      if (el.localName === local) {
        const t = el.textContent?.trim();
        if (t) return t;
      }
    }
    return null;
  };
  const title = pick("title");
  const author = pick("creator");
  const language = pick("language");

  // manifest: id → {href, mediaType, properties}
  const manifest = new Map<string, { href: string; mediaType: string; properties: string }>();
  opf.querySelectorAll("manifest > item").forEach((item) => {
    const id = item.getAttribute("id");
    if (!id) return;
    manifest.set(id, {
      href: item.getAttribute("href") ?? "",
      mediaType: item.getAttribute("media-type") ?? "",
      properties: item.getAttribute("properties") ?? "",
    });
  });

  const resolveHref = (href: string): string => {
    if (!opfDir) return href;
    // resolve relative href against OPF dir (flat single-level is enough for imports)
    return opfDir + href;
  };

  // cover: EPUB3 properties="cover-image" first, EPUB2 meta heuristic second
  let coverHref: string | null = null;
  for (const [, v] of manifest) {
    if (v.properties.split(/\s+/).includes("cover-image")) {
      coverHref = v.href;
      break;
    }
  }
  if (!coverHref) {
    const metaCover = opf.querySelector('metadata > meta[name="cover"]')?.getAttribute("content");
    if (metaCover && manifest.get(metaCover)) coverHref = manifest.get(metaCover)!.href;
  }

  let cover: EpubParseResult["cover"] = null;
  if (coverHref) {
    const abs = resolveHref(coverHref);
    const bytes_ = zip[abs] ?? zip[coverHref];
    if (bytes_) {
      const ext = coverHref.split(".").pop()?.toLowerCase() ?? "jpg";
      cover = { href: coverHref, bytes: bytes_, ext };
    }
  }

  // spine order
  const spineIds = Array.from(opf.querySelectorAll("spine > itemref")).map((el) =>
    el.getAttribute("idref")
  );

  const chapters: EpubChapterText[] = [];
  let order = 0;
  for (const idref of spineIds) {
    const item = idref ? manifest.get(idref) : undefined;
    if (!item) continue;
    if (!/xhtml|html/i.test(item.mediaType) && !/\.x?html?$/i.test(item.href)) continue;
    const abs = resolveHref(item.href);
    const raw = zip[abs] ?? zip[item.href];
    if (!raw) continue;
    const html = strFromU8(raw);
    const doc = new DOMParser().parseFromString(html, "text/html");
    const heading =
      doc.querySelector("h1, h2, h3")?.textContent?.trim() ||
      doc.querySelector("title")?.textContent?.trim() ||
      "";
    const text = textFromHtml(html);
    if (text === "" && heading === "") continue;
    const id = idref ?? `spine-${order}`;
    chapters.push({
      id,
      title: heading || `Chapter ${order + 1}`,
      order: order++,
      href: item.href,
      text,
    });
  }

  return { title, author, language, chapters, cover };
}

export { esc };

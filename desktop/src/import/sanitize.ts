// HTML sanitizer: Folio article allow-list (02 §6, HtmlImporter behavior).
// Drops scripts/styles/forms/frames wholesale; strips non-safe attributes;
// extracts up to 40 inline data-URI images to hash-named files.

export interface ExtractedImage {
  /** sha256-hex filename stem */
  name: string;
  mime: string;
  ext: string;
  bytes: Uint8Array;
}

export interface SanitizeResult {
  html: string;
  title: string | null;
  images: ExtractedImage[];
}

const ALLOWED_TAGS = new Set([
  "p", "br", "hr", "h1", "h2", "h3", "h4", "h5", "h6",
  "ul", "ol", "li", "blockquote", "pre", "code",
  "em", "strong", "b", "i", "u", "s", "sup", "sub",
  "a", "img", "figure", "figcaption",
  "table", "thead", "tbody", "tr", "th", "td",
  "article", "section", "aside",
]);

const KEEP_CONTAINERS = new Set(["html", "head", "body"]);

const MAX_INLINE_IMAGES = 40;

function extFromMime(mime: string): string {
  if (mime.includes("png")) return "png";
  if (mime.includes("jpeg") || mime.includes("jpg")) return "jpg";
  if (mime.includes("gif")) return "gif";
  if (mime.includes("webp")) return "webp";
  if (mime.includes("svg")) return "svg";
  return "bin";
}

async function dataUriToImage(dataUri: string): Promise<ExtractedImage | null> {
  const m = dataUri.match(/^data:([^;,]+)(;base64)?,(.*)$/s);
  if (!m) return null;
  const mime = m[1] || "application/octet-stream";
  let bytes: Uint8Array;
  try {
    if (m[2]) {
      const bin = atob(m[3]);
      bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    } else {
      bytes = new TextEncoder().encode(decodeURIComponent(m[3]));
    }
  } catch {
    return null;
  }
  const digest = await crypto.subtle.digest("SHA-256", bytes.buffer as ArrayBuffer);
  const name = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return { name, mime, ext: extFromMime(mime), bytes };
}

/** Sanitize an HTML document string into Folio article HTML. */
export async function sanitizeHtml(
  input: string
): Promise<SanitizeResult> {
  const doc = new DOMParser().parseFromString(input, "text/html");

  // remove elements wholesale (with content)
  for (const sel of ["script", "style", "noscript", "iframe", "object", "embed", "form", "input", "button", "select", "textarea", "link", "meta", "nav", "footer"]) {
    doc.querySelectorAll(sel).forEach((el) => el.remove());
  }

  const title =
    doc.querySelector("title")?.textContent?.trim() ||
    doc.querySelector("h1")?.textContent?.trim() ||
    null;

  // attribute policy
  doc.querySelectorAll("*").forEach((el) => {
    const tag = el.tagName.toLowerCase();
    if (!ALLOWED_TAGS.has(tag) && !KEEP_CONTAINERS.has(tag)) {
      el.replaceWith(...Array.from(el.childNodes));
      return;
    }
    const attrs = Array.from(el.attributes);
    for (const a of attrs) el.removeAttribute(a.name);
    if (tag === "a") {
      const href = attrs.find((x) => x.name === "href")?.value ?? "";
      if (/^https?:\/\//i.test(href)) {
        el.setAttribute("href", href);
        el.setAttribute("target", "_blank");
        el.setAttribute("rel", "noopener");
      }
    }
    if (tag === "img") {
      const src = attrs.find((x) => x.name === "src")?.value ?? "";
      if (src) el.setAttribute("src", src);
      const alt = attrs.find((x) => x.name === "alt")?.value;
      if (alt) el.setAttribute("alt", alt);
    }
  });

  // extract inline data-URI images (up to 40), hash-named
  const images: ExtractedImage[] = [];
  const imgs = Array.from(doc.querySelectorAll("img"));
  for (const img of imgs) {
    const src = img.getAttribute("src") ?? "";
    if (!src.startsWith("data:")) continue;
    if (images.length >= MAX_INLINE_IMAGES) {
      img.remove();
      continue;
    }
    const image = await dataUriToImage(src);
    if (!image) {
      img.remove();
      continue;
    }
    images.push(image);
    img.setAttribute("src", `images/${image.name}.${image.ext}`);
  }

  const html = doc.body?.innerHTML ?? "";
  return { html, title, images };
}

/** Plain text from sanitized article HTML (per-spine text extraction reuse). */
export function textFromHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script,style").forEach((el) => el.remove());
  return (doc.body?.textContent ?? "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

/** Split article paragraphs into 3–5 chapters (02 §6 EpubBuilder nav). */
export function splitChapters(paragraphs: string[]): string[][] {
  const ps = paragraphs.filter((p) => p.trim() !== "");
  if (ps.length === 0) return [[""]];
  const count = Math.min(5, Math.max(3, Math.ceil(ps.length / 25)));
  const per = Math.ceil(ps.length / count);
  const out: string[][] = [];
  for (let i = 0; i < ps.length; i += per) out.push(ps.slice(i, i + per));
  return out;
}

export function paragraphsFromHtml(html: string): string[] {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const ps = Array.from(doc.querySelectorAll("p, li, h1, h2, h3, h4, h5, h6, blockquote"));
  if (ps.length === 0) {
    const text = textFromHtml(html);
    return text ? text.split(/\n{2,}/) : [];
  }
  return ps.map((p) => (p.textContent ?? "").trim()).filter((t) => t !== "");
}

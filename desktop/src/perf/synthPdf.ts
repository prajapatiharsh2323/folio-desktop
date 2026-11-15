// Deterministic synthetic PDF fixtures (PDF plan §11: "generated in the repo,
// never third-party files"). Produces minimal, real, parseable PDFs from
// plain objects — no external tooling. Text uses standard Type1 Helvetica;
// embedded-font fixtures (Devanagari, ligatures) come with Phase 3 where the
// real extraction behaviours need them.
//
// Byte-deterministic: fixed content, no dates, sequential object numbers.
export interface SynthPdfPageSize {
  width: number;
  height: number;
}

export interface SynthPdfOptions {
  pages: number;
  /** info-dict title; null omits /Title entirely */
  title?: string | null;
  author?: string | null;
  /** outline shape; "broken" emits an entry whose dest cannot resolve */
  outline?: "none" | "flat" | "nested" | "broken";
  /** page size for page i (1-based); default letter 612×792 */
  pageSize?: (i: number) => SynthPdfPageSize;
  /** /Rotate for page i (0 | 90 | 180 | 270) */
  rotate?: (i: number) => number;
  /** visible text of page i; default proves a text layer for searchability */
  textFor?: (i: number) => string;
  /** Link annotations for page i (1-based); omitted/null/empty = none. When
   *  no page has links the object layout is byte-identical to before. */
  links?: (page: number) => SynthPdfLink[] | null;
}

/** A synthetic /Link annotation. `rect` is PDF user space [x1 y1 x2 y2]
 *  (origin bottom-left, y up); default box overlaps the header text line. */
export type SynthPdfLink =
  | { kind: "goto"; page: number; rect?: [number, number, number, number] }
  | { kind: "url"; url: string; rect?: [number, number, number, number] };

/** Escape a PDF literal string (ASCII-safe octal escapes). */
function pdfString(text: string): string {
  let out = "";
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 63;
    if (ch === "(" || ch === ")" || ch === "\\") out += `\\${ch}`;
    else if (code > 0x7e || code < 0x20) out += `\\${code.toString(8).padStart(3, "0")}`;
    else out += ch;
  }
  return out;
}

const LETTER_TEXT = [
  "The quick brown fox jumps over the lazy dog.",
  "Pack my box with five dozen liquor jugs.",
  "How vexingly quick daft zebras jump while reading.",
  "Sphinx of black quartz, judge my vow in the library.",
];

interface OutlineItem {
  title: string;
  /** 1-based page, or null for a broken/unresolvable entry */
  page: number | null;
  children: OutlineItem[];
}

function outlineTree(options: SynthPdfOptions, pages: number): OutlineItem[] {
  const p = (n: number): number | null => (n >= 1 && n <= pages ? n : null);
  switch (options.outline) {
    case "flat":
      return Array.from({ length: Math.min(5, pages) }, (_, i) => ({
        title: `Section ${i + 1}`,
        page: i + 1,
        children: [],
      }));
    case "nested":
      return [
        {
          title: "Part One",
          page: p(1),
          children: [
            { title: "Chapter 1", page: p(1), children: [] },
            { title: "Chapter 2", page: p(2), children: [] },
          ],
        },
        {
          title: "Part Two",
          page: p(3),
          children: [{ title: "Chapter 3", page: p(3), children: [] }],
        },
      ];
    case "broken":
      return [
        { title: "Good entry", page: p(1), children: [] },
        { title: "Dangling entry", page: null, children: [] },
        { title: "Another good", page: p(2), children: [] },
      ];
    default:
      return [];
  }
}

class PdfWriter {
  private parts: string[] = [];
  private written = 0;

  /** Write the next sequential object; returns its 1-based id. */
  object(body: string): number {
    this.written += 1;
    this.parts.push(`${this.written} 0 obj\n${body}\nendobj\n`);
    return this.written;
  }

  get nextId(): number {
    return this.written + 1;
  }

  serialize(rootId: number, infoId: number | null): Uint8Array {
    const header = "%PDF-1.4\n%\u00E2\u00E3\u00CF\u00D3\n";
    let body = header;
    const offsets: number[] = [];
    let pos = header.length;
    for (const part of this.parts) {
      offsets.push(pos);
      body += part;
      pos += part.length;
    }
    const xrefStart = pos;
    let xref = `xref\n0 ${offsets.length + 1}\n0000000000 65535 f \n`;
    for (const offset of offsets) {
      xref += `${String(offset).padStart(10, "0")} 00000 n \n`;
    }
    const trailerDict = `<< /Size ${offsets.length + 1} /Root ${rootId} 0 R${
      infoId !== null ? ` /Info ${infoId} 0 R` : ""
    } >>`;
    const trailer = `trailer\n${trailerDict}\n` + `startxref\n${xrefStart}\n%%EOF\n`;
    const text = body + xref + trailer;
    const bytes = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i) & 0xff;
    return bytes;
  }
}

/** One outline node with its object id and tree links, assigned top-down
 *  (parents before children) so every reference is known before writing. */
interface OutlineNode {
  item: OutlineItem;
  id: number;
  parentId: number;
  prevId: number | null;
  nextId: number | null;
  children: OutlineNode[];
}

/**
 * Build the PDF. Object layout (forward references are legal, so the catalog
 * is written first):
 *   1 Catalog, 2 Pages, 3 Font,
 *   per page i (1-based): content = 4+(i-1)*2, page = 5+(i-1)*2,
 *   then (when any page has links) the /Link annotations,
 *   then the outline tree (ids assigned sequentially), then its root, then
 *   the info dict.
 */
export function buildSyntheticPdf(options: SynthPdfOptions): Uint8Array {
  const pages = Math.max(1, options.pages);
  const writer = new PdfWriter();
  const pageIdOf = (page: number): number => 5 + (page - 1) * 2;

  const items = outlineTree(options, pages);
  const hasOutline = items.length > 0;
  // Pages occupy ids 4..(4+2·pages−1) (content = 4+(i−1)·2, page = 5+(i−1)·2);
  // link annotations (when present) take the next block, then the outline
  // root (when present) the one after, so the catalog can reference it
  // without knowing the item count.
  const linkLists = Array.from({ length: pages }, (_, i) => options.links?.(i + 1) ?? null);
  const annotCount = linkLists.reduce((sum, list) => sum + (list?.length ?? 0), 0);
  const annotBase = 4 + pages * 2;
  const catalogOutlineRef = hasOutline ? annotBase + annotCount : null;
  // Annotation ids, assigned sequentially across pages (order pages are
  // written in) so page dicts can forward-reference them.
  const annotIds: (number[] | null)[] = [];
  let nextAnnot = annotBase;
  for (const list of linkLists) {
    if (!list || list.length === 0) {
      annotIds.push(null);
      continue;
    }
    annotIds.push(list.map(() => nextAnnot++));
  }

  // ---- catalog (object 1) ---------------------------------------------------
  writer.object(
    `<< /Type /Catalog /Pages 2 0 R${catalogOutlineRef !== null ? ` /Outlines ${catalogOutlineRef} 0 R` : ""} >>`,
  );
  // ---- pages root (object 2) -------------------------------------------------
  const kids = Array.from({ length: pages }, (_, i) => `${pageIdOf(i + 1)} 0 R`).join(" ");
  writer.object(`<< /Type /Pages /Kids [${kids}] /Count ${pages} >>`);
  // ---- font (object 3) --------------------------------------------------------
  writer.object(
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
  );

  // ---- pages -----------------------------------------------------------------
  for (let i = 1; i <= pages; i++) {
    const size = options.pageSize?.(i) ?? { width: 612, height: 792 };
    const rotate = options.rotate?.(i) ?? 0;
    const rotateEntry = rotate !== 0 ? ` /Rotate ${rotate}` : "";
    const isDefault = options.textFor == null;
    const text =
      options.textFor?.(i) ?? `${LETTER_TEXT[i % LETTER_TEXT.length]} Page ${i} of ${pages}.`;
    // The "Page N" footer is part of the default text: a custom textFor (e.g.
    // an empty string for scanned/image-only fixtures) must produce no text
    // at all, so the fixture really lacks a text layer.
    const content = isDefault
      ? `BT /F1 12 Tf 1 0 0 1 72 720 Tm (${pdfString(text)}) Tj ET\n` +
        `BT /F1 10 Tf 1 0 0 1 72 36 Tm (Page ${i}) Tj ET\n`
      : text.length > 0
        ? `BT /F1 12 Tf 1 0 0 1 72 720 Tm (${pdfString(text)}) Tj ET\n`
        : "";
    const contentId = writer.object(`<< /Length ${content.length} >>\nstream\n${content}endstream`);
    if (contentId !== 4 + (i - 1) * 2) throw new Error("content id drift");
    const annotIdsForPage = annotIds[i - 1];
    const annotsEntry =
      annotIdsForPage && annotIdsForPage.length > 0
        ? ` /Annots [${annotIdsForPage.map((id) => `${id} 0 R`).join(" ")}]`
        : "";
    const pageId = writer.object(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${size.width} ${size.height}]${rotateEntry} ` +
        `/Contents ${contentId} 0 R /Resources << /Font << /F1 3 0 R >> >>${annotsEntry} >>`,
    );
    if (pageId !== pageIdOf(i)) throw new Error("page id drift");
  }

  // ---- link annotations (only when any page declares links) -------------------
  for (let i = 1; i <= pages; i++) {
    const list = linkLists[i - 1];
    const ids = annotIds[i - 1];
    if (!list || !ids) continue;
    for (let j = 0; j < list.length; j++) {
      const link = list[j];
      const rect = (link.rect ?? [72, 700, 272, 724]).join(" ");
      let body = `<< /Type /Annot /Subtype /Link /Rect [${rect}] /Border [0 0 0]`;
      if (link.kind === "goto") {
        body += ` /Dest [${pageIdOf(link.page)} 0 R /XYZ null null null]`;
      } else {
        body += ` /A << /S /URI /URI (${pdfString(link.url)}) >>`;
      }
      body += " >>";
      const actual = writer.object(body);
      if (actual !== ids[j])
        throw new Error(`annotation id drift: expected ${ids[j]} got ${actual}`);
    }
  }

  // ---- outline: root written first, then items (ids assigned top-down) --------
  if (hasOutline) {
    const outlineRootId = writer.nextId; // = annotBase + annotCount (when links) else 4 + 2·pages
    if (catalogOutlineRef !== outlineRootId) throw new Error("outline root ref drift");
    let next = outlineRootId + 1;
    const assign = (list: OutlineItem[], parentId: number): OutlineNode[] =>
      list.map((item) => {
        const node: OutlineNode = {
          item,
          id: next++,
          parentId,
          prevId: null,
          nextId: null,
          children: [],
        };
        node.children = assign(item.children, node.id);
        return node;
      });
    const nodes = assign(items, outlineRootId);
    const linkAll = (level: OutlineNode[]): void => {
      for (let i = 0; i < level.length; i++) {
        if (i > 0) level[i].prevId = level[i - 1].id;
        if (i < level.length - 1) level[i].nextId = level[i + 1].id;
      }
      for (const node of level) linkAll(node.children);
    };
    linkAll(nodes);

    // The root must be written before its items so ids stay sequential.
    const rootBody = `<< /Type /Outlines /First ${nodes[0].id} 0 R /Last ${nodes[nodes.length - 1].id} 0 R /Count ${nodes.length} >>`;
    const writtenRoot = writer.object(rootBody);
    if (writtenRoot !== outlineRootId)
      throw new Error(`outline root drift: expected ${outlineRootId} got ${writtenRoot}`);

    const write = (node: OutlineNode): void => {
      const dest =
        node.item.page !== null
          ? `[${pageIdOf(node.item.page)} 0 R /XYZ null null null]`
          : `[999999 0 R /XYZ null null null]`;
      let body = `<< /Title (${pdfString(node.item.title)}) /Parent ${node.parentId} 0 R /Dest ${dest}`;
      if (node.prevId) body += ` /Prev ${node.prevId} 0 R`;
      if (node.nextId) body += ` /Next ${node.nextId} 0 R`;
      if (node.children.length > 0) {
        body += ` /First ${node.children[0].id} 0 R /Last ${node.children[node.children.length - 1].id} 0 R /Count ${node.children.length}`;
      }
      body += " >>";
      const actual = writer.object(body);
      if (actual !== node.id)
        throw new Error(`outline id drift: ${node.item.title} expected ${node.id} got ${actual}`);
      for (const child of node.children) write(child);
    };
    for (const node of nodes) write(node);
  }

  // ---- info -------------------------------------------------------------------
  const infoParts: string[] = [];
  if (options.title != null) infoParts.push(`/Title (${pdfString(options.title)})`);
  if (options.author != null) infoParts.push(`/Author (${pdfString(options.author)})`);
  const infoId = writer.object(infoParts.length > 0 ? `<< ${infoParts.join(" ")} >>` : "<< >>");

  return writer.serialize(1, infoId);
}

// ---------------------------------------------------------------------------
// Encrypted fixtures (hardening phase, plan §12): real Standard
// security-handler revision 2 (V 1, 40-bit RC4) encryption, implemented to
// match pdf.js's CipherTransformFactory exactly (verified against pdfjs-dist
// 6.5.438's #prepareKeyData/#buildObjectKey). Lets the suite exercise the
// password path and the D2 no-copy permission end-to-end with real pdf.js —
// no third-party encrypted files.
// ---------------------------------------------------------------------------

/** RFC 1321 MD5 (fixture-only: 32 bytes in, digest out). */
function md5(input: Uint8Array): Uint8Array {
  const shifts = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9,
    14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
  ];
  const kTable = new Uint32Array(64);
  for (let i = 0; i < 64; i++) {
    kTable[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) >>> 0;
  }
  // padding: 0x80 + zeros until length % 64 == 56, then 64-bit little-endian
  // bit length.
  const padded = new Uint8Array(((input.length + 8) >> 6) * 64 + 64);
  padded.set(input);
  padded[input.length] = 0x80;
  const bitLength = input.length * 8;
  for (let i = 0; i < 8; i++) {
    // Division, not `>>>`: JS shift counts wrap mod 32, so `bitLength >>> 32`
    // would silently repeat the low length word into the high bytes.
    padded[padded.length - 8 + i] = (bitLength / 2 ** (i * 8)) & 0xff;
  }
  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;
  const words = new Uint32Array(16);
  for (let chunk = 0; chunk < padded.length; chunk += 64) {
    for (let i = 0; i < 16; i++) {
      words[i] =
        (padded[chunk + i * 4] |
          (padded[chunk + i * 4 + 1] << 8) |
          (padded[chunk + i * 4 + 2] << 16) |
          (padded[chunk + i * 4 + 3] << 24)) >>>
        0;
    }
    let a = a0;
    let b = b0;
    let c = c0;
    let d = d0;
    for (let i = 0; i < 64; i++) {
      let f: number;
      let g: number;
      if (i < 16) {
        f = (b & c) | (~b & d);
        g = i;
      } else if (i < 32) {
        f = (d & b) | (~d & c);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        f = b ^ c ^ d;
        g = (3 * i + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        g = (7 * i) % 16;
      }
      const tmp = d;
      d = c;
      c = b;
      const sum = (a + f + kTable[i] + words[g]) >>> 0;
      const shifted = (sum << shifts[i]) | (sum >>> (32 - shifts[i]));
      b = (b + (shifted >>> 0)) >>> 0;
      a = tmp;
    }
    a0 = (a0 + a) >>> 0;
    b0 = (b0 + b) >>> 0;
    c0 = (c0 + c) >>> 0;
    d0 = (d0 + d) >>> 0;
  }
  const out = new Uint8Array(16);
  for (const [index, value] of [a0, b0, c0, d0].entries()) {
    out[index * 4] = value & 0xff;
    out[index * 4 + 1] = (value >>> 8) & 0xff;
    out[index * 4 + 2] = (value >>> 16) & 0xff;
    out[index * 4 + 3] = (value >>> 24) & 0xff;
  }
  return out;
}

function rc4(key: Uint8Array, data: Uint8Array): Uint8Array {
  const s = new Uint8Array(256);
  for (let i = 0; i < 256; i++) s[i] = i;
  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + s[i] + key[i % key.length]) & 0xff;
    const tmp = s[i];
    s[i] = s[j];
    s[j] = tmp;
  }
  const out = new Uint8Array(data.length);
  let i = 0;
  j = 0;
  for (let k = 0; k < data.length; k++) {
    i = (i + 1) & 0xff;
    j = (j + s[i]) & 0xff;
    const tmp = s[i];
    s[i] = s[j];
    s[j] = tmp;
    out[k] = data[k] ^ s[(s[i] + s[j]) & 0xff];
  }
  return out;
}

/** The standard security handler's 32-byte padding string (7.6.3.3). */
const PW_PAD = new Uint8Array([
  0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41, 0x64, 0x00, 0x4e, 0x56, 0xff, 0xfa, 0x01, 0x08,
  0x2e, 0x2e, 0x00, 0xb6, 0xd0, 0x68, 0x3e, 0x80, 0x2f, 0x0c, 0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a,
]);

function padPassword(pw: string): Uint8Array {
  const out = new Uint8Array(32);
  const n = Math.min(32, pw.length);
  for (let i = 0; i < n; i++) out[i] = pw.charCodeAt(i) & 0xff;
  for (let i = n; i < 32; i++) out[i] = PW_PAD[i - n];
  return out;
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

function littleEndian(value: number, bytes: number): Uint8Array {
  const out = new Uint8Array(bytes);
  for (let i = 0; i < bytes; i++) out[i] = (value >>> (i * 8)) & 0xff;
  return out;
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export interface SynthEncryptedPdfOptions {
  pages?: number;
  title?: string | null;
  author?: string | null;
  /** User password required to open the document (any non-empty string). */
  userPassword: string;
  ownerPassword?: string;
  /** "no-copy" clears the /COPY permission bit (keeps the accessibility one) —
   *  exercises D2: copying denied while screen-reader extraction stays legal. */
  permissions?: "all" | "no-copy";
  /** visible text of page i; default like the plain fixtures */
  textFor?: (i: number) => string;
}

/**
 * Build a user-password-protected PDF (Standard security handler, R2/V1,
 * 40-bit RC4 — pdf.js decrypts it with the correct user password and refuses
 * without one). Streams and strings are encrypted with per-object keys; the
 * /Encrypt dict itself never is. Fixed /ID keeps the output byte-deterministic.
 */
export function buildEncryptedPdf(options: SynthEncryptedPdfOptions): Uint8Array {
  const pages = Math.max(1, options.pages ?? 3);
  const userPw = padPassword(options.userPassword);
  const ownerPw = padPassword(options.ownerPassword ?? options.userPassword);
  // -1 grants everything; no-copy clears COPY (0x10) only — accessibility
  // (0x200) stays set, which is the realistic "no copying" producer output.
  const pValue = options.permissions === "no-copy" ? -17 : -1;
  // Deterministic file identifier (the key derivation mixes it in).
  const fileId = concatBytes(
    littleEndian(0x464f4c49, 4), // "FOLI"
    littleEndian(0x4f2d5445, 4), // "O-TE"
    littleEndian(0x53542d31, 4), // "ST-1"
    littleEndian(0x56534958, 4), // "VSIX"
  );

  // Standard-handler values (R2): O from the owner password, file key from
  // the user password + O + P + /ID, U = RC4(file key, padding).
  const oEntry = rc4(md5(ownerPw).slice(0, 5), userPw);
  const fileKey = md5(concatBytes(userPw, oEntry, littleEndian(pValue, 4), fileId)).slice(0, 5);
  const uEntry = rc4(fileKey, PW_PAD);

  const objectKey = (num: number): Uint8Array =>
    md5(concatBytes(fileKey, littleEndian(num, 3), littleEndian(0, 2))).slice(0, 10);
  const encBytes = (num: number, data: Uint8Array): Uint8Array => rc4(objectKey(num), data);
  const encString = (num: number, text: string): string => {
    const raw = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i++) raw[i] = text.charCodeAt(i) & 0xff;
    return `<${hex(encBytes(num, raw))}>`;
  };

  const chunks: (string | Uint8Array)[] = [];
  let length = 0;
  const push = (part: string | Uint8Array): void => {
    if (typeof part === "string") {
      chunks.push(part);
      length += part.length;
    } else {
      chunks.push(part);
      length += part.length;
    }
  };
  const object = (num: number, body: string): void => {
    push(`${num} 0 obj\n${body}\nendobj\n`);
  };

  const pageIdOf = (page: number): number => 5 + (page - 1) * 2;
  const infoId = 4 + pages * 2;
  const encryptId = 5 + pages * 2;

  push("%PDF-1.4\n%\u00E2\u00E3\u00CF\u00D3\n");
  object(1, `<< /Type /Catalog /Pages 2 0 R >>`);
  const kids = Array.from({ length: pages }, (_, i) => `${pageIdOf(i + 1)} 0 R`).join(" ");
  object(2, `<< /Type /Pages /Kids [${kids}] /Count ${pages} >>`);
  object(3, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  for (let i = 1; i <= pages; i++) {
    const text =
      options.textFor?.(i) ?? `${LETTER_TEXT[i % LETTER_TEXT.length]} Page ${i} of ${pages}.`;
    const content =
      text.length > 0 ? `BT /F1 12 Tf 1 0 0 1 72 720 Tm (${pdfString(text)}) Tj ET\n` : "";
    const encrypted = encBytes(
      4 + (i - 1) * 2,
      Uint8Array.from(content, (ch) => ch.charCodeAt(0) & 0xff),
    );
    push(`${4 + (i - 1) * 2} 0 obj\n<< /Length ${encrypted.length} >>\nstream\n`);
    push(encrypted);
    push("\nendstream\nendobj\n");
    object(
      pageIdOf(i),
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${4 + (i - 1) * 2} 0 R /Resources << /Font << /F1 3 0 R >> >> >>`,
    );
  }
  const infoParts: string[] = [];
  if (options.title != null) infoParts.push(`/Title ${encString(infoId, options.title)}`);
  if (options.author != null) infoParts.push(`/Author ${encString(infoId, options.author)}`);
  object(infoId, `<< ${infoParts.join(" ")} >>`);
  object(
    encryptId,
    `<< /Filter /Standard /V 1 /R 2 /Length 40 /O <${hex(oEntry)}> /U <${hex(uEntry)}> /P ${pValue} >>`,
  );

  // xref + trailer. Object offsets are recovered by scanning string chunk
  // heads (binary chunks are stream bodies, never object headers).
  const offsets: number[] = [];
  let cursor = 0;
  for (const chunk of chunks) {
    if (typeof chunk === "string") {
      const match = /^(\d+) 0 obj/.exec(chunk.slice(0, 12));
      if (match) offsets[Number(match[1])] = cursor;
    }
    cursor += chunk.length;
  }
  const xrefStart = cursor;
  const size = encryptId + 1;
  let xref = `xref\n0 ${size}\n0000000000 65535 f \n`;
  for (let i = 1; i < size; i++) {
    xref += `${String(offsets[i] ?? 0).padStart(10, "0")} 00000 n \n`;
  }
  push(xref);
  push(
    `trailer\n<< /Size ${size} /Root 1 0 R /Info ${infoId} 0 R /Encrypt ${encryptId} 0 R /ID [<${hex(fileId)}> <${hex(fileId)}>] >>\n` +
      `startxref\n${xrefStart}\n%%EOF\n`,
  );

  const out = new Uint8Array(length);
  let at = 0;
  for (const chunk of chunks) {
    if (typeof chunk === "string") {
      for (let i = 0; i < chunk.length; i++) out[at + i] = chunk.charCodeAt(i) & 0xff;
    } else {
      out.set(chunk, at);
    }
    at += chunk.length;
  }
  if (at !== length) throw new Error("encrypted fixture size drift");
  return out;
}

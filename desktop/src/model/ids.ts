// IDs + slug generation (05 §3): uuids via crypto.randomUUID; slugs from title
// lowercase + '-', collisions resolved with '-2' suffix (mobile Slugify parity).

export function newUuid(): string {
  if (typeof crypto.randomUUID !== "function") {
    // extremely defensive fallback (non-secure contexts)
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }
  return crypto.randomUUID();
}

/** Mobile Slugify behavior: lowercase, non [a-z0-9] runs → '-', trim '-'. */
export function slugify(title: string): string {
  const s = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s === "" ? "doc" : s;
}

/** Resolve a slug collision within `existing` slugs by appending -2, -3, ... */
export function resolveSlugConflict(base: string, existing: Iterable<string>): string {
  const set = new Set(existing);
  if (!set.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!set.has(candidate)) return candidate;
  }
}

/** ISO-8601 UTC with Z (05 §3). */
export function nowIso(): string {
  return new Date().toISOString();
}

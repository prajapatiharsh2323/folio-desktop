export function normalizePath(p: string): string {
  if (!p) throw new Error("empty path");
  // convert backslashes
  let s = p.replace(/\\/g, "/");
  if (!s.startsWith("/")) throw new Error("path must be absolute");
  // collapse and reject traversal
  const parts = s.split("/");
  const out: string[] = [];
  for (const part of parts) {
    if (part === "" || part === ".") continue;
    if (part === "..") throw new Error("path traversal detected");
    if (part.includes("\u0000")) throw new Error("invalid path component");
    out.push(part);
  }
  return "/" + out.join("/");
}

export function isAbsolute(p: string): boolean {
  return p.startsWith("/");
}

export function joinPath(...parts: string[]): string {
  return normalizePath(parts.join("/"));
}
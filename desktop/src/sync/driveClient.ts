// Google Drive REST client for the mirror (05 §6, 09 §2).
//
// Uses the in-memory access token and refreshes through Rust on 401. The scope
// is `drive.file`, so every query is limited to files Folio created.
import { ensureAccessToken } from "./auth";

export type SyncFailureKind = "AUTH" | "NETWORK" | "CONFLICT_FINAL" | "DISK";

export class SyncFailure extends Error {
  readonly kind: SyncFailureKind;
  readonly retryable: boolean;

  constructor(kind: SyncFailureKind, message: string) {
    super(message);
    this.name = "SyncFailure";
    this.kind = kind;
    this.retryable = kind === "NETWORK";
  }
}

/** UI copy parity with mobile's SyncFailure.kt. */
export function failureCopy(failure: SyncFailure): string {
  switch (failure.kind) {
    case "AUTH":
      return "Google Drive sign-in expired. Reconnect and try again.";
    case "NETWORK":
      return "Couldn’t reach Google Drive. Check your connection and retry.";
    case "CONFLICT_FINAL":
      return "A Drive file changed outside Folio. Nothing was deleted — retry to merge again.";
    case "DISK":
      return "Not enough space or the library is locked. Free some space and retry.";
  }
}

export interface RemoteFile {
  id: string;
  /** path relative to `Folio Library/` (POSIX). */
  path: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  md5Checksum?: string;
  size?: number;
  isFolder: boolean;
}

const API = "https://www.googleapis.com/drive/v3/files";
const UPLOAD_API = "https://www.googleapis.com/upload/drive/v3/files";
const FOLDER_MIME = "application/vnd.google-apps.folder";
const FILE_FIELDS = "id,name,mimeType,modifiedTime,md5Checksum,size";
const ROOT_NAME = "Folio Library";

interface DriveListResponse {
  files?: {
    id: string;
    name: string;
    mimeType: string;
    modifiedTime?: string;
    md5Checksum?: string;
    size?: string;
  }[];
  nextPageToken?: string;
}

function q(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

async function authHeaders(extra?: Record<string, string>): Promise<Record<string, string>> {
  return { Authorization: `Bearer ${await ensureAccessToken()}`, ...extra };
}

async function failureFromResponse(response: Response): Promise<SyncFailure> {
  let detail = "";
  try {
    const body = await response.json();
    detail = body?.error?.message ?? JSON.stringify(body);
  } catch {
    detail = response.statusText;
  }
  if (response.status === 401 || response.status === 403) {
    return new SyncFailure("AUTH", `Drive auth failed (${response.status}): ${detail}`);
  }
  if (response.status === 404 || response.status === 409) {
    return new SyncFailure("CONFLICT_FINAL", `Drive conflict (${response.status}): ${detail}`);
  }
  if (response.status === 429 || response.status >= 500) {
    return new SyncFailure("NETWORK", `Drive unavailable (${response.status}): ${detail}`);
  }
  return new SyncFailure("NETWORK", `Drive request failed (${response.status}): ${detail}`);
}

async function driveFetch(url: string, init: RequestInit = {}, retry = true): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, headers: await authHeaders(init.headers as Record<string, string>) });
  } catch (e) {
    throw new SyncFailure(
      "NETWORK",
      `Network error: ${e instanceof Error ? e.message : String(e)}`
    );
  }
  if (response.status === 401 && retry) {
    await ensureAccessToken(true);
    return driveFetch(url, init, false);
  }
  if (!response.ok) throw await failureFromResponse(response);
  return response;
}

async function listChildren(folderId: string): Promise<DriveListResponse["files"]> {
  const out: NonNullable<DriveListResponse["files"]> = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({
      q: `'${q(folderId)}' in parents and trashed = false`,
      fields: `nextPageToken,files(${FILE_FIELDS})`,
      pageSize: "1000",
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true",
    });
    if (pageToken) params.set("pageToken", pageToken);
    const response = await driveFetch(`${API}?${params}`);
    const body = (await response.json()) as DriveListResponse;
    out.push(...(body.files ?? []));
    pageToken = body.nextPageToken;
  } while (pageToken);
  return out;
}

function toRemote(file: NonNullable<DriveListResponse["files"]>[number], path: string): RemoteFile {
  return {
    id: file.id,
    path,
    name: file.name,
    mimeType: file.mimeType,
    modifiedTime: file.modifiedTime ?? new Date(0).toISOString(),
    md5Checksum: file.md5Checksum,
    size: file.size ? Number(file.size) : undefined,
    isFolder: file.mimeType === FOLDER_MIME,
  };
}

export class DriveClient {
  private folderCache = new Map<string, string>();

  async ensureRootFolder(): Promise<string> {
    const params = new URLSearchParams({
      q: `name = '${q(ROOT_NAME)}' and mimeType = '${FOLDER_MIME}' and trashed = false and 'root' in parents`,
      fields: `files(${FILE_FIELDS})`,
      pageSize: "10",
    });
    const response = await driveFetch(`${API}?${params}`);
    const body = (await response.json()) as DriveListResponse;
    const existing = body.files?.[0];
    if (existing) return existing.id;
    return this.createFolder(ROOT_NAME, "root");
  }

  private async createFolder(name: string, parentId: string): Promise<string> {
    const response = await driveFetch(`${API}?fields=${encodeURIComponent("id")}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId] }),
    });
    const body = (await response.json()) as { id: string };
    return body.id;
  }

  /** Create nested folders for path segments, caching the mapping. */
  async ensureFolderPath(rootId: string, segments: string[]): Promise<string> {
    let parent = rootId;
    for (const segment of segments) {
      if (!segment) continue;
      const cacheKey = `${parent}/${segment}`;
      const cached = this.folderCache.get(cacheKey);
      if (cached) {
        parent = cached;
        continue;
      }
      const params = new URLSearchParams({
        q: `name = '${q(segment)}' and '${q(parent)}' in parents and mimeType = '${FOLDER_MIME}' and trashed = false`,
        fields: `files(${FILE_FIELDS})`,
        pageSize: "10",
      });
      const response = await driveFetch(`${API}?${params}`);
      const body = (await response.json()) as DriveListResponse;
      const found = body.files?.[0];
      const id = found ? found.id : await this.createFolder(segment, parent);
      this.folderCache.set(cacheKey, id);
      parent = id;
    }
    return parent;
  }

  /** Full recursive listing, returned as path → file. */
  async listTree(rootId: string): Promise<Map<string, RemoteFile>> {
    const out = new Map<string, RemoteFile>();
    const walk = async (folderId: string, prefix: string, depth: number) => {
      if (depth > 24) return;
      const children = (await listChildren(folderId)) ?? [];
      for (const child of children) {
        const path = prefix ? `${prefix}/${child.name}` : child.name;
        const remote = toRemote(child, path);
        out.set(path, remote);
        // The mirror excludes the local search cache (05 §6).
        if (remote.isFolder && path !== "index") {
          await walk(child.id, path, depth + 1);
        }
      }
    };
    await walk(rootId, "", 0);
    return out;
  }

  async download(fileId: string): Promise<Uint8Array> {
    const response = await driveFetch(`${API}/${encodeURIComponent(fileId)}?alt=media`, {
      cache: "no-store",
    });
    return new Uint8Array(await response.arrayBuffer());
  }

  async upload(
    name: string,
    parentId: string,
    bytes: Uint8Array,
    existingId?: string
  ): Promise<RemoteFile> {
    const boundary = `folio-${crypto.randomUUID()}`;
    const metadata = JSON.stringify({ name, parents: existingId ? undefined : [parentId] });
    const encoder = new TextEncoder();
    const head = encoder.encode(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
        `--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`
    );
    const tail = encoder.encode(`\r\n--${boundary}--`);
    const body = new Uint8Array(head.length + bytes.length + tail.length);
    body.set(head, 0);
    body.set(bytes, head.length);
    body.set(tail, head.length + bytes.length);

    const base = existingId
      ? `${UPLOAD_API}/${encodeURIComponent(existingId)}`
      : UPLOAD_API;
    const params = new URLSearchParams({ uploadType: "multipart", fields: FILE_FIELDS });
    const response = await driveFetch(`${base}?${params}`, {
      method: existingId ? "PATCH" : "POST",
      headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
      body,
    });
    const file = (await response.json()) as NonNullable<DriveListResponse["files"]>[number];
    return toRemote(file, name);
  }
}

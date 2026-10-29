// User-JSON sync merge (05 §6): newest-wins by updatedAt, deletions never
// propagate, collections union their member ids.

// ---- User-JSON merge (05 §6.3) -------------------------------------------

interface TimedRecord {
  id?: string;
  docId?: string;
  updatedAt?: string;
  docIds?: string[];
  collectionIds?: string[];
  [key: string]: unknown;
}

function timeOf(record: TimedRecord | undefined): number {
  const t = record?.updatedAt ? Date.parse(record.updatedAt) : NaN;
  return Number.isFinite(t) ? t : 0;
}

function newer<T extends TimedRecord>(local: T | undefined, remote: T | undefined): T | undefined {
  if (!local) return remote;
  if (!remote) return local;
  // Ties keep local (the device doing the merge is authoritative for equal
  // timestamps); unknown keys already live on both records.
  return timeOf(remote) > timeOf(local) ? remote : local;
}

/** Merge an array keyed by `id` (annotations, collections). */
export function mergeArraysById<T extends TimedRecord>(local: T[], remote: T[]): T[] {
  const out = new Map<string, T>();
  for (const rec of local) if (rec?.id) out.set(rec.id, rec);
  for (const rec of remote) {
    if (!rec?.id) continue;
    const existing = out.get(rec.id);
    if (!existing) {
      out.set(rec.id, rec);
      continue;
    }
    const chosen = newer(existing, rec) ?? existing;
    // Collections: union member ids even when the winning record is newer.
    if (Array.isArray(existing.docIds) && Array.isArray(rec.docIds)) {
      const docIds = Array.from(new Set([...existing.docIds, ...rec.docIds]));
      out.set(rec.id, { ...chosen, docIds });
    } else {
      out.set(rec.id, chosen);
    }
  }
  return Array.from(out.values());
}

/** Merge a record keyed by docId (progress.json, doc-settings.json). */
export function mergeRecordByKey<T extends TimedRecord>(
  local: Record<string, T>,
  remote: Record<string, T>
): Record<string, T> {
  const out: Record<string, T> = { ...local };
  for (const [key, remoteRecord] of Object.entries(remote)) {
    out[key] = newer(out[key], remoteRecord) ?? remoteRecord;
  }
  return out;
}

function decodeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Merge the three schema-1 user list files (annotations / collections /
 * progress) plus doc-settings. Unknown paths return the remote bytes only when
 * local is unparsable, otherwise local.
 */
export function mergeUserJsonFile(
  path: string,
  localBytes: Uint8Array,
  remoteBytes: Uint8Array
): Uint8Array {
  const localText = new TextDecoder().decode(localBytes);
  const remoteText = new TextDecoder().decode(remoteBytes);
  const local = decodeJson(localText);
  const remote = decodeJson(remoteText);
  if (local === null || remote === null) return localBytes;

  let merged: unknown;
  if (path === "user/annotations.json" && Array.isArray(local) && Array.isArray(remote)) {
    merged = mergeArraysById(local as TimedRecord[], remote as TimedRecord[]);
  } else if (path === "user/collections.json" && Array.isArray(local) && Array.isArray(remote)) {
    merged = mergeArraysById(local as TimedRecord[], remote as TimedRecord[]);
  } else if (path === "user/progress.json" && isRecord(local) && isRecord(remote)) {
    merged = mergeRecordByKey(
      local as Record<string, TimedRecord>,
      remote as Record<string, TimedRecord>
    );
  } else if (path === "user/doc-settings.json" && isRecord(local) && isRecord(remote)) {
    merged = mergeRecordByKey(
      local as Record<string, TimedRecord>,
      remote as Record<string, TimedRecord>
    );
  } else {
    return localBytes;
  }

  const encoded = new TextEncoder().encode(JSON.stringify(merged));
  // Prefer local bytes when the merge is a no-op, so we don't churn mtimes.
  return localText === remoteText ? localBytes : encoded;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export const MERGEABLE_USER_FILES = new Set([
  "user/annotations.json",
  "user/collections.json",
  "user/progress.json",
  "user/doc-settings.json",
]);


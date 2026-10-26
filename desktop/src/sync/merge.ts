// Sync merge semantics (05 §6): newest-wins by updatedAt, deletions never
// propagate, docId remap on identical contentHash.
export interface SyncDoc {
  id: string;
  contentHash: string;
  updatedAt: string;
  deleted?: boolean;
}

export interface MergeResult {
  /** docs to upload (local newer or new) */
  toUpload: SyncDoc[];
  /** docs to download (remote newer or new) */
  toDownload: SyncDoc[];
  /** docs present on both sides with identical contentHash but different id → remap */
  remaps: { from: string; to: string }[];
}

export function mergeDocs(local: SyncDoc[], remote: SyncDoc[]): MergeResult {
  const byHashLocal = new Map<string, SyncDoc>();
  for (const d of local) byHashLocal.set(d.contentHash, d);
  const byHashRemote = new Map<string, SyncDoc>();
  for (const d of remote) byHashRemote.set(d.contentHash, d);

  const toUpload: SyncDoc[] = [];
  const toDownload: SyncDoc[] = [];
  const remaps: { from: string; to: string }[] = [];

  // Local docs
  for (const l of local) {
    if (l.deleted) continue; // deletions never propagate
    const r = byHashRemote.get(l.contentHash);
    if (!r) {
      toUpload.push(l);
    } else {
      if (l.id !== r.id) remaps.push({ from: r.id, to: l.id });
      const lTime = Date.parse(l.updatedAt);
      const rTime = Date.parse(r.updatedAt);
      if (lTime > rTime) toUpload.push(l);
      else if (rTime > lTime) toDownload.push(r);
    }
  }
  // Remote-only docs
  for (const r of remote) {
    if (r.deleted) continue;
    if (!byHashLocal.has(r.contentHash)) toDownload.push(r);
  }
  return { toUpload, toDownload, remaps };
}

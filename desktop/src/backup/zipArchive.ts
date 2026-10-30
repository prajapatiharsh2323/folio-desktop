// Minimal ZIP reader used by backup restore.
//
// `unzipSync` decompresses the whole archive eagerly, so a hostile or simply
// large backup can exhaust memory before any validation runs. Reading the
// central directory first lets restore apply entry/size limits before a single
// byte is expanded, and extracting one entry at a time keeps peak memory to the
// largest file rather than the whole library.

import { inflateSync, strFromU8 } from "fflate";
import { BackupError, type ArchiveLimits } from "./backupSchema";

const EOCD_SIG = 0x06054b50;
const CD_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;

export interface ZipEntry {
  /** Name exactly as stored in the archive. */
  name: string;
  compression: number;
  compressedSize: number;
  uncompressedSize: number;
  localOffset: number;
  flags: number;
}

function u16(b: Uint8Array, at: number): number {
  if (at + 2 > b.length) throw new BackupError("corrupt", "The backup ZIP is truncated.");
  return b[at] | (b[at + 1] << 8);
}

function u32(b: Uint8Array, at: number): number {
  if (at + 4 > b.length) throw new BackupError("corrupt", "The backup ZIP is truncated.");
  return (
    (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0
  );
}

function findEocd(bytes: Uint8Array): number {
  if (bytes.length < 22) {
    throw new BackupError("not-zip", "This file is not a ZIP archive.");
  }
  const stop = Math.max(0, bytes.length - 22 - 0xffff);
  for (let i = bytes.length - 22; i >= stop; i--) {
    if (u32(bytes, i) === EOCD_SIG) {
      const commentLen = u16(bytes, i + 20);
      if (i + 22 + commentLen <= bytes.length) return i;
    }
  }
  throw new BackupError("not-zip", "This file is not a ZIP archive.");
}

/** Parse and validate the archive directory without expanding any entry. */
export function readCentralDirectory(
  bytes: Uint8Array,
  limits: ArchiveLimits
): ZipEntry[] {
  if (bytes.length > limits.maxCompressedBytes) {
    throw new BackupError(
      "too-large",
      "This backup file is too large to restore safely."
    );
  }
  const eocd = findEocd(bytes);
  const disk = u16(bytes, eocd + 4);
  const cdDisk = u16(bytes, eocd + 6);
  const total = u16(bytes, eocd + 10);
  const cdSize = u32(bytes, eocd + 12);
  const cdOffset = u32(bytes, eocd + 16);

  if (disk !== 0 || cdDisk !== 0) {
    throw new BackupError("not-zip", "Multi-volume ZIP archives are not supported.");
  }
  // 0xFFFF/0xFFFFFFFF are ZIP64 sentinels; this reader intentionally rejects
  // them instead of guessing at 64-bit offsets.
  if (total === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    throw new BackupError(
      "zlib64",
      "This backup uses ZIP64, which this version of Folio cannot restore. Re-export it from a smaller library."
    );
  }
  if (total > limits.maxEntries) {
    throw new BackupError(
      "too-many-entries",
      `This backup contains ${total} entries, which is more than Folio can restore safely.`
    );
  }
  if (cdOffset + cdSize > bytes.length) {
    throw new BackupError("corrupt", "The backup ZIP directory is corrupted.");
  }

  const entries: ZipEntry[] = [];
  let offset = cdOffset;
  let declaredTotal = 0;
  for (let i = 0; i < total; i++) {
    if (u32(bytes, offset) !== CD_SIG) {
      throw new BackupError("corrupt", "The backup ZIP directory is corrupted.");
    }
    const flags = u16(bytes, offset + 8);
    const compression = u16(bytes, offset + 10);
    const compressedSize = u32(bytes, offset + 20);
    const uncompressedSize = u32(bytes, offset + 24);
    const nameLen = u16(bytes, offset + 28);
    const extraLen = u16(bytes, offset + 30);
    const commentLen = u16(bytes, offset + 32);
    const localOffset = u32(bytes, offset + 42);
    const nameStart = offset + 46;
    const nameEnd = nameStart + nameLen;
    if (nameEnd > bytes.length) {
      throw new BackupError("corrupt", "The backup ZIP directory is corrupted.");
    }
    const nameBytes = bytes.subarray(nameStart, nameEnd);
    const name = flags & 0x800 ? strFromU8(nameBytes) : strFromU8(nameBytes, true);

    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localOffset === 0xffffffff) {
      throw new BackupError(
        "zlib64",
        "This backup uses ZIP64, which this version of Folio cannot restore."
      );
    }
    if (flags & 0x1) {
      throw new BackupError("corrupt", "Encrypted ZIP archives are not supported.");
    }
    if (compression !== 0 && compression !== 8) {
      throw new BackupError(
        "corrupt",
        `Unsupported ZIP compression method ${compression}.`
      );
    }
    if (!name.endsWith("/")) {
      if (uncompressedSize > limits.maxEntryBytes) {
        throw new BackupError(
          "too-large",
          `A file inside the backup expands to ${Math.round(
            uncompressedSize / (1024 * 1024)
          )} MB, which exceeds the restore limit.`
        );
      }
      declaredTotal += uncompressedSize;
      if (declaredTotal > limits.maxTotalBytes) {
        throw new BackupError(
          "too-large",
          "The backup expands to more data than Folio can restore safely."
        );
      }
    }

    entries.push({
      name,
      compression,
      compressedSize,
      uncompressedSize,
      localOffset,
      flags,
    });
    offset = nameEnd + extraLen + commentLen;
    if (offset > bytes.length) {
      throw new BackupError("corrupt", "The backup ZIP directory is corrupted.");
    }
  }
  return entries;
}

/** Expand one entry, enforcing the per-file limit on the actual output. */
export function readEntryData(
  bytes: Uint8Array,
  entry: ZipEntry,
  limits: ArchiveLimits
): Uint8Array {
  if (u32(bytes, entry.localOffset) !== LOCAL_SIG) {
    throw new BackupError("corrupt", "The backup ZIP entry is corrupted.");
  }
  const nameLen = u16(bytes, entry.localOffset + 26);
  const extraLen = u16(bytes, entry.localOffset + 28);
  const dataStart = entry.localOffset + 30 + nameLen + extraLen;
  const dataEnd = dataStart + entry.compressedSize;
  if (dataStart > bytes.length || dataEnd > bytes.length) {
    throw new BackupError("corrupt", "The backup ZIP entry is truncated.");
  }
  const compressed = bytes.subarray(dataStart, dataEnd);
  let out: Uint8Array;
  if (entry.compression === 0) {
    out = compressed.slice();
  } else {
    try {
      out = inflateSync(compressed);
    } catch {
      throw new BackupError("corrupt", "The backup ZIP entry could not be decompressed.");
    }
  }
  if (out.length > limits.maxEntryBytes) {
    throw new BackupError(
      "too-large",
      "A file inside the backup is larger than Folio can restore safely."
    );
  }
  if (entry.uncompressedSize > 0 && out.length !== entry.uncompressedSize) {
    throw new BackupError("corrupt", "The backup ZIP entry has an unexpected size.");
  }
  return out;
}

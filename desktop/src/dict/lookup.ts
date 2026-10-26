// Dictionary lookup bridge (06 §5). The pack is read by Rust; this module
// keeps the UI free of Tauri details and degrades gracefully in browser dev.
import { invoke } from "@tauri-apps/api/core";
import { normalizeLookupTerm } from "./normalise";

export interface DictSense {
  pos: string | null;
  meaning: string;
  example: string | null;
}

export interface DictEntry {
  headword: string;
  pos: string | null;
  senses: DictSense[];
}

export type LookupStatus = "ok" | "empty" | "missing" | "error";

export interface LookupResult {
  status: LookupStatus;
  entries: DictEntry[];
  message?: string;
}

export interface DictStatus {
  installed: boolean;
  path: string;
  entries: number | null;
  sha256: string | null;
}

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function query(term: string): Promise<DictEntry[] | null> {
  try {
    return await invoke<DictEntry[]>("dict_lookup", { term });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (message.includes("DICTIONARY_MISSING")) return null;
    throw e;
  }
}

/** Look up a selection; falls back from a phrase to its first word. */
export async function lookupMeaning(rawTerm: string): Promise<LookupResult> {
  const term = normalizeLookupTerm(rawTerm);
  if (!term) return { status: "empty", entries: [] };
  if (!isTauri()) {
    return {
      status: "missing",
      entries: [],
      message: "Dictionary is available in the desktop app.",
    };
  }

  try {
    let entries = (await query(term)) ?? [];
    if (entries.length === 0 && term.includes(" ")) {
      const first = normalizeLookupTerm(term.split(/\s+/)[0] ?? "");
      if (first && first !== term) entries = (await query(first)) ?? [];
    }
    if (entries.length > 0) return { status: "ok", entries };

    // A `null` (from DICTIONARY_MISSING) and an empty result both land here;
    // distinguish them with one cheap status probe.
    const status = await dictStatus();
    if (status && !status.installed) {
      return {
        status: "missing",
        entries: [],
        message: "The offline dictionary pack is not installed.",
      };
    }
    if (status === null) {
      return {
        status: "missing",
        entries: [],
        message: "Dictionary is available in the desktop app.",
      };
    }
    return { status: "empty", entries: [] };
  } catch (e) {
    return {
      status: "error",
      entries: [],
      message: e instanceof Error ? e.message : "Dictionary lookup failed",
    };
  }
}

export async function dictStatus(): Promise<DictStatus | null> {
  if (!isTauri()) return null;
  try {
    return await invoke<DictStatus>("dict_status");
  } catch {
    return null;
  }
}

export const DICT_ATTRIBUTION =
  "Folio Dictionary (English→Hindi) — FreeDict, GPL-2.0";

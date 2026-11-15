// Engine selection seam (PDF plan §3, §8.2): the only place that decides
// Readium vs PDF. Readium creation is unchanged; the PDF branch is
// flag-gated and refuses with the rollout copy when the flag is off.
import type { ReaderEngine, CreateEngineArgs } from "./ReaderEngine";
import { createReadiumEngine } from "./readiumEngine";
import { PdfEngine } from "./pdfEngine";
import { FEATURES } from "../lib/features";

/**
 * Create the engine for a document. Synchronous and cheap: the heavy PDF
 * modules are imported inside PdfEngine.open(), so callers keep their
 * synchronous engine effect (§7.2 rule 1).
 */
export function createEngine(args: CreateEngineArgs): ReaderEngine {
  if (args.format === "pdf") {
    // Reached only when a PDF document exists in the library while the flag
    // is off (e.g. after a rollback): nothing is deleted, the reader refuses
    // with the rollout copy (§11 rollout/rollback).
    if (!FEATURES.pdf) throw new Error("PDF support is turned off");
    return new PdfEngine(args.readingBytes, args.prefs, args.initial);
  }
  return createReadiumEngine({
    epubBytes: args.readingBytes,
    prefs: args.prefs,
    initial: args.initial,
  });
}

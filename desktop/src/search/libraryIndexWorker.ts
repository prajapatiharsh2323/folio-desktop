// Library search index builder (off the main thread, R3):
// tokenizing + posting construction for a whole library is the slow part of
// the first search in a session, so it runs in a module worker. The main
// thread only reads the per-document index files (I/O) and posts the parsed
// chapters here; the finished snapshot comes back as plain data and is
// restored with MiniSearch.fromPlain() — no re-tokenization on the main
// thread.
import { MiniSearch, type MiniSearchPlain, type SearchDoc } from "./miniSearch";

export interface LibraryIndexRequest {
  kind: "build";
  id: number;
  docs: SearchDoc[];
}

export type LibraryIndexResponse =
  | { kind: "done"; id: number; index: MiniSearchPlain; docCount: number }
  | { kind: "error"; id: number; message: string };

function build(docs: SearchDoc[]): { index: MiniSearchPlain; docCount: number } {
  const idx = new MiniSearch();
  idx.addAll(docs);
  return { index: idx.serialize(), docCount: docs.length };
}

if (typeof self !== "undefined") {
  self.addEventListener("message", (event: MessageEvent<LibraryIndexRequest>) => {
    const request = event.data;
    if (request?.kind !== "build") return;
    try {
      const { index, docCount } = build(request.docs);
      const response: LibraryIndexResponse = { kind: "done", id: request.id, index, docCount };
      self.postMessage(response);
    } catch (e) {
      const response: LibraryIndexResponse = {
        kind: "error",
        id: request.id,
        message: e instanceof Error ? e.message : "index build failed",
      };
      self.postMessage(response);
    }
  });
}

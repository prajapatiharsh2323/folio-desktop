// Library search index builder (R3): the tokenize/postings work for a whole
// library runs in a module worker (libraryIndexWorker.ts); environments
// without Worker support (tests, restricted webviews) fall back to the
// synchronous build. Either way the result is a MiniSearch ready to search.
import { MiniSearch, type MiniSearchPlain, type SearchDoc } from "./miniSearch";
import type { LibraryIndexRequest, LibraryIndexResponse } from "./libraryIndexWorker";

export interface BuiltLibraryIndex {
  index: MiniSearch;
  docCount: number;
}

let worker: Worker | null = null;
let workerBroken = false;
let nextRequestId = 0;
const pending = new Map<number, (response: LibraryIndexResponse) => void>();

function getWorker(): Worker | null {
  if (workerBroken) return null;
  if (worker) return worker;
  if (typeof Worker === "undefined") return null;
  try {
    worker = new Worker(new URL("./libraryIndexWorker.ts", import.meta.url), {
      type: "module",
    });
    worker.addEventListener("message", (event: MessageEvent<LibraryIndexResponse>) => {
      const resolve = pending.get(event.data.id);
      if (resolve) {
        pending.delete(event.data.id);
        resolve(event.data);
      }
    });
    worker.addEventListener("error", () => {
      // Worker startup/runtime failure: future builds use the local path.
      workerBroken = true;
      for (const cb of pending.values()) cb({ kind: "error", id: 0, message: "worker failed" });
      pending.clear();
    });
    return worker;
  } catch {
    workerBroken = true;
    return null;
  }
}

function buildInWorker(docs: SearchDoc[]): Promise<BuiltLibraryIndex> {
  return new Promise((resolve, reject) => {
    const w = getWorker();
    if (!w) {
      reject(new Error("no worker"));
      return;
    }
    const id = ++nextRequestId;
    pending.set(id, (response) => {
      if (response.kind === "done") {
        resolve({ index: MiniSearch.fromPlain(response.index), docCount: response.docCount });
      } else {
        reject(new Error(response.message));
      }
    });
    const request: LibraryIndexRequest = { kind: "build", id, docs };
    w.postMessage(request);
  });
}

function buildLocally(docs: SearchDoc[]): BuiltLibraryIndex {
  const index = new MiniSearch();
  index.addAll(docs);
  return { index, docCount: docs.length };
}

/**
 * Build the library search index off the main thread when possible.
 * File reading stays on the main thread (Tauri IPC); only tokenization and
 * posting construction happen in the worker.
 */
export async function buildLibraryIndex(docs: SearchDoc[]): Promise<BuiltLibraryIndex> {
  if (docs.length === 0) return { index: new MiniSearch(), docCount: 0 };
  try {
    return await buildInWorker(docs);
  } catch {
    return buildLocally(docs);
  }
}

export type { MiniSearchPlain };

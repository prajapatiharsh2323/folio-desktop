// Process-wide write-batch lock (05 §4 invariant 4):
// never two concurrent manifest rewrites / write batches.

let chain: Promise<unknown> = Promise.resolve();

export function runExclusive<T>(fn: () => Promise<T>): Promise<T> {
  const result = chain.then(fn, fn);
  chain = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}

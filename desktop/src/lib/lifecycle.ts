/**
 * Run persistence + resource release before a navigation must happen. Neither
 * step may prevent the close: a failed flush is reported, a failed release is
 * ignored, and the close callback always runs exactly once.
 */
export async function flushAndClose(
  flush: () => Promise<unknown> | undefined,
  release: () => Promise<unknown> | undefined,
  close: () => void,
): Promise<{ flushFailed: boolean; releaseFailed: boolean }> {
  let flushFailed = false;
  let releaseFailed = false;

  try {
    await flush();
  } catch {
    flushFailed = true;
  }
  try {
    await release();
  } catch {
    releaseFailed = true;
  } finally {
    close();
  }

  return { flushFailed, releaseFailed };
}

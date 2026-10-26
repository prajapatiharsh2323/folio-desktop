// Per-path mutex map. Every FileStore op on the same path is serialized.
// Cross-path ops run concurrently.

interface Mutex {
  chain: Promise<void>;
}

export class PathMutex {
  private mutexes = new Map<string, Mutex>();

  private getMutex(key: string): Mutex {
    let m = this.mutexes.get(key);
    if (!m) {
      m = { chain: Promise.resolve() };
      this.mutexes.set(key, m);
    }
    return m;
  }

  async run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const m = this.getMutex(key);
    const prev = m.chain;
    let release!: () => void;
    const gate = new Promise<void>((res) => {
      release = res;
    });
    m.chain = prev.then(() => gate, () => gate);
    try {
      await prev;
      return await fn();
    } finally {
      release();
    }
  }
}

export const globalMutex = new PathMutex();

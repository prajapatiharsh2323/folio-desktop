import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getLibraryFs,
  LIBRARY_ROOT,
  useLibraryUi,
} from "../src/store/libraryUi";

let created = 0;
let revoked = 0;

function seed(slug: string, title: string, cover: Uint8Array) {
  const fs = getLibraryFs();
  const manifest = {
    schema: 1,
    app: "folio",
    libraryId: "lib-test",
    updatedAt: new Date().toISOString(),
    docs: [
      {
        id: `doc-${slug}`,
        slug,
        title,
        contentHash: `hash-${slug}`,
        updatedAt: new Date().toISOString(),
        files: [],
      },
    ],
  };
  const meta = {
    schema: 1,
    id: `doc-${slug}`,
    slug,
    title,
    author: null,
    kind: "book",
    contentHash: `hash-${slug}`,
    files: { cover: "cover.jpg" },
  };
  return Promise.all([
    fs.writeTextAtomic(`${LIBRARY_ROOT}/manifest.json`, JSON.stringify(manifest)),
    fs.writeTextAtomic(
      `${LIBRARY_ROOT}/docs/${slug}/meta.json`,
      JSON.stringify(meta)
    ),
    fs.writeBytesAtomic(`${LIBRARY_ROOT}/docs/${slug}/cover.jpg`, cover),
  ]);
}

beforeEach(() => {
  created = 0;
  revoked = 0;
  useLibraryUi.setState({ rows: [], loading: false, error: null });
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: vi.fn(() => `blob:cover-${++created}`),
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: vi.fn(() => {
      revoked += 1;
    }),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("cover cache", () => {
  it("reuses the object URL when the cover file is unchanged", async () => {
    const slug = "cache-hit";
    await seed(slug, "Cache Hit", new Uint8Array([1, 2, 3]));

    await useLibraryUi.getState().refresh();
    const first = useLibraryUi.getState().rows[0].coverUrl;

    await useLibraryUi.getState().refresh();
    const second = useLibraryUi.getState().rows[0].coverUrl;

    expect(created).toBe(1);
    expect(first).toBe(second);
    expect(first).toBe("blob:cover-1");
  });

  it("rebuilds when the cover bytes change and revokes the old URL", async () => {
    const slug = "cache-miss";
    await seed(slug, "Cache Miss", new Uint8Array([1, 2, 3]));

    await useLibraryUi.getState().refresh();
    expect(created).toBe(1);

    // Different length guarantees a different stat key even within one tick.
    await getLibraryFs().writeBytesAtomic(
      `${LIBRARY_ROOT}/docs/${slug}/cover.jpg`,
      new Uint8Array([9, 9, 9, 9])
    );
    await useLibraryUi.getState().refresh();

    expect(created).toBe(2);
    expect(revoked).toBeGreaterThanOrEqual(1);
    expect(useLibraryUi.getState().rows[0].coverUrl).toBe("blob:cover-2");
  });
});

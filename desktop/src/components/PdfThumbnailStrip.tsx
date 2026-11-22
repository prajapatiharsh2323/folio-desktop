// Page thumbnail strip for fixed-layout documents. Thumbnails are rendered
// lazily for a small window around the reading page (plus the cover), cached
// for the life of the open book, so a 500-page PDF never renders 500 canvases.
import { useEffect, useRef, useState } from "react";

interface PdfThumbnailStripProps {
  open: boolean;
  page: number;
  pageCount: number;
  onSelect: (page: number) => void;
  renderThumbnail: (page: number) => Promise<string | null>;
}

const WINDOW = 8;

export function PdfThumbnailStrip({
  open,
  page,
  pageCount,
  onSelect,
  renderThumbnail,
}: PdfThumbnailStripProps) {
  const cache = useRef(new Map<number, string | null>());
  const [images, setImages] = useState<Map<number, string | null>>(new Map());

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const pages = new Set<number>([1]);
    for (let p = Math.max(1, page - WINDOW); p <= Math.min(pageCount, page + WINDOW); p++) {
      pages.add(p);
    }
    const missing = [...pages].filter((p) => !cache.current.has(p));
    if (missing.length === 0) {
      setImages(new Map(cache.current));
      return;
    }
    void Promise.all(
      missing.map(async (p) => {
        const data = await renderThumbnail(p).catch(() => null);
        cache.current.set(p, data);
        // Bound memory on long documents: drop the oldest cached previews.
        if (cache.current.size > 60) {
          const oldest = cache.current.keys().next().value;
          if (oldest !== undefined) cache.current.delete(oldest);
        }
      }),
    ).then(() => {
      if (!cancelled) setImages(new Map(cache.current));
    });
    return () => {
      cancelled = true;
    };
  }, [open, page, pageCount, renderThumbnail]);

  if (!open) return null;
  const pages = [...images.keys()].sort((a, b) => a - b);

  return (
    <nav className="folio-pdf-thumbnails" aria-label="Page thumbnails">
      {pages.map((p) => (
        <button
          key={p}
          type="button"
          className={`folio-pdf-thumbnail${p === page ? " is-active" : ""}`}
          aria-label={`Go to page ${p}`}
          aria-current={p === page ? "page" : undefined}
          onClick={() => onSelect(p)}
        >
          {images.get(p) ? (
            <img src={images.get(p)!} alt="" />
          ) : (
            <span className="folio-pdf-thumbnail__fallback">{p}</span>
          )}
          <span className="folio-pdf-thumbnail__label">{p}</span>
        </button>
      ))}
    </nav>
  );
}

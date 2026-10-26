import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { FolioButton } from "./FolioButton";
import { FolioDialog } from "./FolioDialog";

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

interface QuoteCardProps {
  open: boolean;
  onClose: () => void;
  quote: string;
  title: string;
  author: string | null;
}

const W = 1200;
const H = 630;

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    if (ctx.measureText(test).width <= maxWidth) {
      current = test;
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/** Quote card share (04 §7 P1, 09 §10.3): canvas render → Save PNG / Copy. */
export function QuoteCard({ open, onClose, quote, title, author }: QuoteCardProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    canvas.width = W;
    canvas.height = H;

    // Charcoal plate.
    ctx.fillStyle = "#23242F";
    ctx.fillRect(0, 0, W, H);

    // Violet mark.
    ctx.fillStyle = "#715CFC";
    ctx.font = "bold 180px Georgia, serif";
    ctx.textBaseline = "top";
    ctx.fillText("\u201C", 60, 40);

    // Quote.
    ctx.fillStyle = "#F4F1EA";
    ctx.font = "italic 44px Georgia, serif";
    const lines = wrapText(ctx, quote, W - 160);
    let y = 200;
    for (const line of lines.slice(0, 6)) {
      ctx.fillText(line, 80, y);
      y += 56;
    }

    // Title / author.
    ctx.fillStyle = "#C9C3B8";
    ctx.font = "500 26px 'Segoe UI', system-ui, sans-serif";
    ctx.fillText(title, 80, H - 110);
    if (author) {
      ctx.font = "400 22px 'Segoe UI', system-ui, sans-serif";
      ctx.fillText(author, 80, H - 74);
    }
  }, [open, quote, title, author]);

  const toBlob = (): Promise<Blob> =>
    new Promise((resolve, reject) => {
      const canvas = canvasRef.current;
      if (!canvas) return reject(new Error("no canvas"));
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("encode failed"))), "image/png");
    });

  const handleSave = async () => {
    try {
      const blob = await toBlob();
      const bytes = new Uint8Array(await blob.arrayBuffer());
      if (isTauri()) {
        const path = await saveDialog({
          defaultPath: "quote.png",
          filters: [{ name: "PNG", extensions: ["png"] }],
        });
        if (!path) return;
        await invoke("fs_write_atomic", { path, data: Array.from(bytes) });
        setStatus("Saved");
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "quote.png";
        a.click();
        URL.revokeObjectURL(url);
        setStatus("Downloaded");
      }
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Save failed");
    }
  };

  const handleCopy = async () => {
    try {
      const blob = await toBlob();
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      setStatus("Copied");
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Copy failed");
    }
  };

  return (
    <FolioDialog open={open} onClose={onClose} title="Share as image">
      <div className="folio-quote-card">
        <canvas
          ref={canvasRef}
          className="folio-quote-card__canvas"
          width={W}
          height={H}
          aria-label="Quote card preview"
        />
        {status && <p className="folio-helper">{status}</p>}
        <div className="folio-quote-card__actions">
          <FolioButton variant="primary" onClick={() => void handleSave()}>
            Save PNG
          </FolioButton>
          <FolioButton variant="secondary" onClick={() => void handleCopy()}>
            Copy image
          </FolioButton>
        </div>
      </div>
    </FolioDialog>
  );
}

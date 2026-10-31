// WCAG contrast measurement (03 §7). Pure + dependency-free so the audit can
// run in Node tests over the checked-in token fixtures.

/** sRGB (#RRGGBB) hex → WCAG relative luminance. */
export function relativeLuminance(hex: string): number {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex);
  if (!m) throw new Error(`not a #rrggbb color: ${hex}`);
  const n = parseInt(m[1], 16);
  const channels = [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
  let value = 0;
  for (let i = 0; i < 3; i++) {
    const c = channels[i] / 255;
    const linear = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    value += linear * (i === 0 ? 0.2126 : i === 1 ? 0.7152 : 0.0722);
  }
  return value;
}

/** WCAG 2.1 contrast ratio of two #rrggbb colors (1..21). */
export function contrastRatio(hexA: string, hexB: string): number {
  const la = relativeLuminance(hexA);
  const lb = relativeLuminance(hexB);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/** AA threshold for normal text (03 §7: ≥ 4.5:1). */
export const AA_NORMAL = 4.5;

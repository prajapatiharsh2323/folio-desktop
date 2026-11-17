// F2 (Phase 5): pure reading-log math — day keys, window sums, streaks and
// top-books. No IO here; `ReadingLogRepo` owns the file, the Insights screen
// and the reader store import these helpers.

import type { ReadingLogFile } from "../store/repos";
import type { Progress } from "../model/types";

/** Local-day key (`YYYY-MM-DD`) — streaks are per local day, not UTC. */
export function dateKeyOf(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** The previous local day key (streak walking). */
export function previousDayKey(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  const date = new Date(y, (m ?? 1) - 1, d ?? 1);
  date.setDate(date.getDate() - 1);
  return dateKeyOf(date);
}

/** Sum of credited ms across an inclusive key range. */
export function sumRange(days: ReadingLogFile["days"], fromKey: string, toKey: string): number {
  let total = 0;
  for (const [key, day] of Object.entries(days)) {
    if (key >= fromKey && key <= toKey) total += day?.ms ?? 0;
  }
  return total;
}

/** Last N days ending `todayKey` (inclusive), e.g. 7 → today..6 days back. */
export function windowKeys(todayKey: string, n: number): { from: string; to: string } {
  const [y, m, d] = todayKey.split("-").map(Number);
  const start = new Date(y, (m ?? 1) - 1, d ?? 1);
  start.setDate(start.getDate() - (n - 1));
  return { from: dateKeyOf(start), to: todayKey };
}

/** Current streak: consecutive local days ending today (or yesterday, so an
 *  evening session isn't "lost" before midnight) with ≥ `minMs` credit. */
export function currentStreak(
  days: ReadingLogFile["days"],
  todayKey: string,
  minMs = 60_000,
): number {
  let key =
    days[todayKey] && (days[todayKey]?.ms ?? 0) >= minMs ? todayKey : previousDayKey(todayKey);
  let streak = 0;
  // Bounded by the file's own span; one pass per day is trivially cheap.
  while (days[key] && (days[key]?.ms ?? 0) >= minMs) {
    streak += 1;
    key = previousDayKey(key);
    if (streak > 3660) break; // a decade of daily reading is enough
  }
  return streak;
}

export interface TopBook {
  docId: string;
  title: string;
  /** All-time credited reading time from `progress.pace.sessionsMs`. */
  ms: number;
  percent: number | null;
}

/** Top books by all-time reading time, joined with the manifest titles. */
export function topBooks(
  progressByDoc: Record<string, Progress>,
  titleOf: (docId: string) => string,
  limit = 5,
): TopBook[] {
  const rows = Object.values(progressByDoc)
    .filter((p) => (p.pace?.sessionsMs ?? 0) > 0)
    .map((p) => ({
      docId: p.docId,
      title: titleOf(p.docId),
      ms: p.pace?.sessionsMs ?? 0,
      percent: p.percent ?? null,
    }))
    .sort((a, b) => b.ms - a.ms);
  return rows.slice(0, limit);
}

/** "1 hr 23 min"-style compact duration (minutes granularity). */
export function formatMinutes(ms: number): string {
  const totalMin = Math.floor(ms / 60_000);
  if (totalMin < 1) return "<1 min";
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h} hr`;
  return `${h} hr ${m} min`;
}

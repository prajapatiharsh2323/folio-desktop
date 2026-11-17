// F2 (Phase 5): Insights — reading statistics.
//
// Daily credited time comes from the additive `user/reading-log.json`
// (`ReadingLogRepo`, written at progress-flush cadence from the pace stats, so
// only real reading time lands here); all-time per-book totals come from the
// existing `progress.pace.sessionsMs`. Everything loads read-only; the only
// writable setting is the optional daily-goal minutes, stored app-locally
// (like appearance settings) via the storage layer.
import { useCallback, useEffect, useMemo, useState } from "react";
import { FolioEmptyState } from "../components/FolioEmptyState";
import { FolioSectionHeader } from "../components/FolioSectionHeader";
import { FolioSkeletonRows } from "../components/FolioSkeleton";
import { getLibraryManager, subscribeLibraryChanges } from "../store/libraryUi";
import type { ReadingLogFile } from "../store/repos";
import type { Progress } from "../model/types";
import { readStorage, writeStorage } from "../lib/storage";
import {
  currentStreak,
  dateKeyOf,
  formatMinutes,
  sumRange,
  topBooks,
  windowKeys,
} from "../lib/readingLog";
import { handleError } from "../lib/errorLog";

const GOAL_KEY = "folio.insights.goal";

function clampGoalMinutes(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.min(1440, Math.max(0, Math.round(v)));
}

interface StatCard {
  label: string;
  value: string;
}

export function InsightsScreen() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<ReadingLogFile>({ schema: 1, days: {} });
  const [progressByDoc, setProgressByDoc] = useState<Record<string, Progress>>({});
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [goal, setGoal] = useState<number>(() =>
    clampGoalMinutes(Number(readStorage(GOAL_KEY) ?? 0)),
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const lm = getLibraryManager();
      const manifest = await lm.load();
      setTitles(Object.fromEntries((manifest?.docs ?? []).map((d) => [d.id, d.title])));
      setProgressByDoc(await lm.progress.all());
      setLog(await lm.readingLog.all());
    } catch (e) {
      handleError(e, { context: "insights.load" });
      setError(e instanceof Error ? e.message : "Reading stats could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    // E7: re-load when the library manifest changes (import/restore/delete).
    return subscribeLibraryChanges(() => void refresh());
  }, [refresh]);

  const todayKey = useMemo(() => dateKeyOf(new Date()), []);

  const stats = useMemo<StatCard[]>(() => {
    const week = windowKeys(todayKey, 7);
    const month = windowKeys(todayKey, 30);
    return [
      { label: "Today", value: formatMinutes(log.days[todayKey]?.ms ?? 0) },
      { label: "Last 7 days", value: formatMinutes(sumRange(log.days, week.from, week.to)) },
      { label: "Last 30 days", value: formatMinutes(sumRange(log.days, month.from, month.to)) },
      {
        label: "Current streak",
        value: `${currentStreak(log.days, todayKey)} day${currentStreak(log.days, todayKey) === 1 ? "" : "s"}`,
      },
    ];
  }, [log, todayKey]);

  const books = useMemo(
    () => topBooks(progressByDoc, (docId) => titles[docId] ?? "Unknown title"),
    [progressByDoc, titles],
  );
  const maxBookMs = books[0]?.ms ?? 0;
  const todayMs = log.days[todayKey]?.ms ?? 0;
  const goalMs = goal * 60_000;
  const goalPct = goalMs > 0 ? Math.min(100, Math.round((todayMs / goalMs) * 100)) : 0;

  const onGoalChange = useCallback((raw: string) => {
    const next = clampGoalMinutes(Number(raw));
    setGoal(next);
    // 0 clears the goal entirely (no stored value).
    if (next > 0) writeStorage(GOAL_KEY, String(next));
    else writeStorage(GOAL_KEY, "0");
  }, []);

  return (
    <>
      <header className="folio-toolbar">
        <div className="folio-toolbar__titles">
          <div className="folio-toolbar__title">Insights</div>
          <div className="folio-toolbar__subtitle">Time you spent reading</div>
        </div>
      </header>
      <div className="folio-screen">
        {loading ? (
          <FolioSkeletonRows rows={4} view="list" />
        ) : error ? (
          <FolioEmptyState title="Reading stats could not be loaded" body={error} />
        ) : books.length === 0 && todayMs === 0 ? (
          <FolioEmptyState
            title="No reading time yet"
            body="Open a book and read for a bit — your daily time, streaks and top books appear here."
          />
        ) : (
          <>
            <section className="folio-insights__cards" aria-label="Reading time summary">
              {stats.map((s) => (
                <div key={s.label} className="folio-insights__card">
                  <div className="folio-insights__card-value">{s.value}</div>
                  <div className="folio-insights__card-label">{s.label}</div>
                </div>
              ))}
            </section>

            <section className="folio-insights__group" aria-label="Daily goal">
              <FolioSectionHeader>Daily goal</FolioSectionHeader>
              <div className="folio-insights__goal">
                <label className="folio-insights__goal-label" htmlFor="folio-insights-goal">
                  Minutes per day
                </label>
                <input
                  id="folio-insights-goal"
                  className="folio-insights__goal-input"
                  type="number"
                  min={0}
                  max={1440}
                  step={5}
                  value={goal}
                  onChange={(e) => onGoalChange(e.target.value)}
                />
              </div>
              {goal > 0 && (
                <div className="folio-insights__goalbar" aria-hidden="true">
                  <div className="folio-insights__goalbar-fill" style={{ width: `${goalPct}%` }} />
                </div>
              )}
              {goal > 0 && (
                <p className="folio-insights__goaltext" role="status">
                  {formatMinutes(todayMs)} today — {goalPct}% of your {goal} min goal
                </p>
              )}
            </section>

            <section className="folio-insights__group" aria-label="Top books">
              <FolioSectionHeader>Top books</FolioSectionHeader>
              {books.length === 0 ? (
                <p className="folio-insights__muted">
                  Total reading time per book shows up after your first session.
                </p>
              ) : (
                <ul className="folio-insights__books">
                  {books.map((b) => (
                    <li key={b.docId} className="folio-insights__book">
                      <div className="folio-insights__book-row">
                        <span className="folio-insights__book-title">{b.title}</span>
                        <span className="folio-insights__book-time">{formatMinutes(b.ms)}</span>
                      </div>
                      <div className="folio-insights__bookbar" aria-hidden="true">
                        <div
                          className="folio-insights__bookbar-fill"
                          style={{
                            width: `${maxBookMs > 0 ? Math.max(4, Math.round((b.ms / maxBookMs) * 100)) : 4}%`,
                          }}
                        />
                      </div>
                      {b.percent !== null && (
                        <span className="folio-insights__book-pct">{b.percent}% read</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </div>
    </>
  );
}

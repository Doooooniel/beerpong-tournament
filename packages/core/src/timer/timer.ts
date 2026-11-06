import type { Timer } from '../domain/types.js';

/** SPEC → Timer. null = ohne Zeitlimit. Kann negativ werden (abgelaufen). */
export const remainingMs = (timer: Timer, now: number): number | null => {
  if (timer.durationMs === null) return null;
  const pausedNow = timer.pausedAt === null ? 0 : now - timer.pausedAt;
  return timer.durationMs - (now - timer.startedAt - timer.pausedTotalMs - pausedNow);
};

export type TimerStage =
  | { kind: 'unlimited' }
  | { kind: 'normal' }
  | { kind: 'warning'; thresholdMs: number }
  | { kind: 'expired' };

/**
 * S03: Warnstufe = kleinste Schwelle ≥ remaining (z. B. 45 s bei [300000, 60000, 30000] → 60000);
 * remaining ≤ 0 → expired.
 */
export const timerStage = (remaining: number | null, warningsMs: readonly number[]): TimerStage => {
  if (remaining === null) return { kind: 'unlimited' };
  if (remaining <= 0) return { kind: 'expired' };
  const reached = warningsMs.filter((t) => t >= remaining);
  return reached.length === 0
    ? { kind: 'normal' }
    : { kind: 'warning', thresholdMs: Math.min(...reached) };
};

export interface TimerAlarm {
  /** Absoluter Zeitpunkt (ms). */
  at: number;
  kind: 'warning' | 'expired';
  thresholdMs?: number;
}

/**
 * Für die Timer-Planung im Server: alle noch kommenden Warnungen und der Ablauf eines laufenden
 * Timers, aufsteigend nach `at`, nur `at > now`. Pausiert oder ohne Limit → [].
 */
export const upcomingAlarms = (
  timer: Timer,
  now: number,
  warningsMs: readonly number[],
): TimerAlarm[] => {
  const remaining = remainingMs(timer, now);
  if (remaining === null || remaining <= 0 || timer.pausedAt !== null) return [];
  const warnings: TimerAlarm[] = [...new Set(warningsMs)]
    .filter((t) => t > 0 && t < remaining)
    .sort((x, y) => y - x)
    .map((t) => ({ at: now + remaining - t, kind: 'warning', thresholdMs: t }));
  return [...warnings, { at: now + remaining, kind: 'expired' }];
};

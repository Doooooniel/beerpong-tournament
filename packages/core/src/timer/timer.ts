import type { Timer } from '../domain/types.js';

/** SPEC → Timer. null = ohne Zeitlimit. Kann negativ werden (abgelaufen). */
export const remainingMs = (_timer: Timer, _now: number): number | null => {
  throw new Error('not implemented');
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
export const timerStage = (
  _remaining: number | null,
  _warningsMs: readonly number[],
): TimerStage => {
  throw new Error('not implemented');
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
  _timer: Timer,
  _now: number,
  _warningsMs: readonly number[],
): TimerAlarm[] => {
  throw new Error('not implemented');
};

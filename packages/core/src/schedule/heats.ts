import type { Heat, HeatId, KoStage, Match, Phase, TournamentState } from '../domain/types.js';

/**
 * M15: Partien (ohne Freilose, in gegebener Reihenfolge) zu Durchgängen à tableCount bündeln.
 * index 1..n; Tisch = Position in matchIds + 1.
 */
export const buildHeats = (
  _matches: readonly Match[],
  _phase: Phase,
  _round: number,
  _tableCount: number,
): Heat[] => {
  throw new Error('not implemented');
};

export type Status = 'preparing' | 'running' | 'finished';

/** M16, ADR 025: preparing ohne HeatStarted, running ab Start, finished wenn alle Partien ein Ergebnis haben. */
export const heatStatus = (_state: TournamentState, _heatId: HeatId): Status => {
  throw new Error('not implemented');
};

/** M16: Runde preparing (kein Durchgang gestartet) / finished (alle finished) / sonst running. */
export const roundStatus = (_state: TournamentState, _phase: Phase, _round: number): Status => {
  throw new Error('not implemented');
};

/** Der nächste startbare Durchgang (streng nacheinander, SPEC → Tische und Durchgänge) oder null. */
export const nextHeat = (_state: TournamentState): Heat | null => {
  throw new Error('not implemented');
};

/** Zeitlimit eines Durchgangs dieser Phase aus settings.timerByPhase (M12). */
export const durationForPhase = (
  _state: TournamentState,
  _phase: Phase | KoStage,
): number | null => {
  throw new Error('not implemented');
};

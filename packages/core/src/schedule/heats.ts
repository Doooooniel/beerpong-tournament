import type { Heat, HeatId, KoStage, Match, Phase, TournamentState } from '../domain/types.js';

/**
 * M15: Partien (ohne Freilose, in gegebener Reihenfolge) zu Durchgängen à tableCount bündeln.
 * index 1..n; Tisch = Position in matchIds + 1.
 */
export const buildHeats = (
  matches: readonly Match[],
  phase: Phase,
  round: number,
  tableCount: number,
): Heat[] => {
  const playable = matches.filter((m) => !m.bye).map((m) => m.id);
  const heats: Heat[] = [];
  for (let start = 0; start < playable.length; start += tableCount) {
    const index = heats.length + 1;
    heats.push({
      id: `${phase}-r${round}-h${index}`,
      phase,
      round,
      index,
      matchIds: playable.slice(start, start + tableCount),
    });
  }
  return heats;
};

export type Status = 'preparing' | 'running' | 'finished';

/** M16, ADR 025: preparing ohne HeatStarted, running ab Start, finished wenn alle Partien ein Ergebnis haben. */
export const heatStatus = (state: TournamentState, heatId: HeatId): Status => {
  const heat = state.heats.find((h) => h.id === heatId);
  if (!heat || !state.timers[heatId]) return 'preparing';
  const done = (id: string) =>
    state.results[id] !== undefined || state.matches.some((m) => m.id === id && m.bye);
  return heat.matchIds.every(done) ? 'finished' : 'running';
};

/** M16: Runde preparing (kein Durchgang gestartet) / finished (alle finished) / sonst running. */
export const roundStatus = (state: TournamentState, phase: Phase, round: number): Status => {
  const statuses = state.heats
    .filter((h) => h.phase === phase && h.round === round)
    .map((h) => heatStatus(state, h.id));
  if (statuses.every((s) => s === 'preparing')) return 'preparing';
  if (statuses.every((s) => s === 'finished')) return 'finished';
  return 'running';
};

/** Der nächste startbare Durchgang (streng nacheinander, SPEC → Tische und Durchgänge) oder null. */
export const nextHeat = (state: TournamentState): Heat | null => {
  for (const heat of state.heats) {
    const status = heatStatus(state, heat.id);
    if (status === 'finished') continue;
    return status === 'preparing' ? heat : null;
  }
  return null;
};

/** Zeitlimit eines Durchgangs dieser Phase aus settings.timerByPhase (M12). */
export const durationForPhase = (state: TournamentState, phase: Phase | KoStage): number | null =>
  state.settings.timerByPhase[phase];

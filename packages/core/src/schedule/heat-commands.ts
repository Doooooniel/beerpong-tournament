import type { CommandOf } from '../commands/index.js';
import type { DecideContext, TournamentState } from '../domain/types.js';
import { event, fail, started, type Decision } from '../decision.js';
import { durationForPhase, nextHeat } from './heats.js';

/** M13/M15: Durchgang starten, streng nacheinander; Dauer aus timerByPhase (M12). */
export const startHeat = (
  state: TournamentState,
  cmd: CommandOf<'startHeat'>,
  ctx: DecideContext,
): Decision => {
  const blocked = started(state);
  if (blocked) return blocked;
  const heat = state.heats.find((h) => h.id === cmd.heatId);
  if (!heat) return fail('HEAT_NOT_FOUND', 'Unknown heat.');
  if (state.timers[heat.id]) return fail('HEAT_ALREADY_STARTED', 'Heat is already running.');
  if (nextHeat(state)?.id !== heat.id)
    return fail('PREVIOUS_HEAT_NOT_FINISHED', 'Finish the previous heat first.');
  return event(ctx, 'HeatStarted', {
    heatId: heat.id,
    durationMs: durationForPhase(state, heat.phase),
  });
};

/** M15: Tische tauschen, nur vor dem Start des Durchgangs. */
export const swapTables = (
  state: TournamentState,
  cmd: CommandOf<'swapTables'>,
  ctx: DecideContext,
): Decision => {
  const blocked = started(state);
  if (blocked) return blocked;
  const heat = state.heats.find((h) => h.id === cmd.heatId);
  if (!heat) return fail('HEAT_NOT_FOUND', 'Unknown heat.');
  if (state.timers[heat.id]) return fail('HEAT_ALREADY_STARTED', 'Swap tables before the start.');
  const tables = heat.matchIds.length;
  const { tableA, tableB } = cmd;
  if (tableA === tableB || tableA > tables || tableB > tables)
    return fail('INVALID_TABLE', `Tables must be different and within 1..${tables}.`);
  return event(ctx, 'TablesSwapped', { heatId: heat.id, tableA, tableB });
};

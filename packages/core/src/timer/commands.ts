import type { CommandOf } from '../commands/index.js';
import type { DecideContext, TournamentState } from '../domain/types.js';
import { event, fail, started, type Decision } from '../decision.js';

type TimerCommand = CommandOf<'pauseTimer' | 'resumeTimer' | 'extendTimer' | 'restartTimer'>;

/** Dauer aus dem wirksamen HeatStarted (Neustart setzt darauf zurück, SPEC → Timer). */
const startDuration = (state: TournamentState, heatId: string): number | null => {
  const startedEntry = state.log.findLast(
    (l) => !l.undone && l.event.type === 'HeatStarted' && l.event.payload.heatId === heatId,
  );
  return startedEntry?.event.type === 'HeatStarted' ? startedEntry.event.payload.durationMs : null;
};

/** M13: Pause, Fortsetzen, Verlängern, Neustart. */
export const timerCommand = (
  state: TournamentState,
  cmd: TimerCommand,
  ctx: DecideContext,
): Decision => {
  const blocked = started(state);
  if (blocked) return blocked;
  const heatId = cmd.heatId;
  if (!state.heats.some((h) => h.id === heatId)) return fail('HEAT_NOT_FOUND', 'Unknown heat.');
  const timer = state.timers[heatId];
  if (!timer) return fail('TIMER_NOT_RUNNING', 'Heat has not been started.');
  if (timer.durationMs === null && cmd.type !== 'resumeTimer')
    return fail('TIMER_UNLIMITED', 'This heat has no time limit.');

  switch (cmd.type) {
    case 'pauseTimer':
      if (timer.pausedAt !== null) return fail('TIMER_ALREADY_PAUSED', 'Timer is paused.');
      return event(ctx, 'TimerPaused', { heatId });
    case 'resumeTimer':
      if (timer.pausedAt === null) return fail('TIMER_NOT_PAUSED', 'Timer is not paused.');
      return event(ctx, 'TimerResumed', { heatId });
    case 'extendTimer':
      return event(ctx, 'TimerExtended', { heatId, byMs: cmd.byMs });
    case 'restartTimer':
      return event(ctx, 'TimerRestarted', { heatId, durationMs: startDuration(state, heatId) });
  }
};

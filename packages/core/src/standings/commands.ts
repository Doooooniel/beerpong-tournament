import { teamsOf } from '../bracket/bracket.js';
import type { CommandOf } from '../commands/index.js';
import type { DecideContext, TournamentState } from '../domain/types.js';
import type { EventOf } from '../events/index.js';
import { event, fail, started, type Decision } from '../decision.js';
import { computeStandings } from './standings.js';

const sameSet = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((t) => b.includes(t));

/** M07, M14, S01, SPEC → Ergebnis-Payload. */
export const recordResult = (
  state: TournamentState,
  cmd: CommandOf<'recordResult'>,
  ctx: DecideContext,
): Decision => {
  const blocked = started(state);
  if (blocked) return blocked;
  const match = state.matches.find((m) => m.id === cmd.matchId);
  if (!match) return fail('MATCH_NOT_FOUND', 'Unknown match.');
  if (match.bye) return fail('MATCH_NOT_PLAYABLE', 'A bye has no result.');
  const [a, b] = teamsOf(state, match);
  const heat = state.heats.find((h) => h.matchIds.includes(match.id));
  if (a === null || b === null || !heat) return fail('MATCH_NOT_PLAYABLE', 'Teams not known yet.');
  if (!state.timers[heat.id]) return fail('HEAT_NOT_STARTED', 'Start the heat first.');
  if (state.results[match.id]) return fail('RESULT_ALREADY_RECORDED', 'Undo to correct it.');

  const group = match.phase === 'group';
  const { outcome, winnerTeamId, cups } = cmd;
  if (outcome === 'draw') {
    if (!group) return fail('DRAW_NOT_ALLOWED_IN_KNOCKOUT', 'Next cup wins in knockout.');
    if (winnerTeamId !== undefined) return fail('INVALID_RESULT', 'A draw has no winner.');
  } else if (winnerTeamId !== a && winnerTeamId !== b) {
    return fail('INVALID_RESULT', 'Winner must be one of the two teams.');
  }
  if (!state.settings.trackCups && cups) return fail('INVALID_RESULT', 'Cups are not tracked.');
  if (state.settings.trackCups && group && !cups)
    return fail('INVALID_RESULT', 'Cups are required in the group stage.');
  if (cups) {
    if (outcome === 'draw' && cups.a !== cups.b)
      return fail('INVALID_RESULT', 'A draw needs equal cups.');
    const [winnerCups, loserCups] = winnerTeamId === a ? [cups.a, cups.b] : [cups.b, cups.a];
    if (outcome !== 'draw' && winnerCups < loserCups)
      return fail('INVALID_RESULT', 'The winner cannot have fewer cups.');
  }

  const payload: EventOf<'ResultRecorded'>['payload'] = { matchId: match.id, outcome };
  if (winnerTeamId !== undefined) payload.winnerTeamId = winnerTeamId;
  if (cups !== undefined) payload.cups = cups;
  return event(ctx, 'ResultRecorded', payload);
};

/** M09 Stechen: nur für eine Teilmenge, die computeStandings als needsPlayoff meldet. */
export const recordPlayoff = (
  state: TournamentState,
  cmd: CommandOf<'recordPlayoff'>,
  ctx: DecideContext,
): Decision => {
  const blocked = started(state);
  if (blocked) return blocked;
  if (!state.groups.some((g) => g.id === cmd.groupId))
    return fail('GROUP_NOT_FOUND', 'Unknown group.');
  const standings = computeStandings(state, cmd.groupId);
  if (!standings.complete) return fail('GROUP_STAGE_INCOMPLETE', 'Group has open matches.');
  if (state.phase !== 'groups' || !standings.needsPlayoff.some((s) => sameSet(s, cmd.tiedTeamIds)))
    return fail('PLAYOFF_NOT_NEEDED', 'These teams do not need a playoff.');
  if (!cmd.tiedTeamIds.includes(cmd.winnerTeamId))
    return fail('INVALID_RESULT', 'Winner must be one of the tied teams.');
  return event(ctx, 'PlayoffRecorded', {
    groupId: cmd.groupId,
    tiedTeamIds: [...cmd.tiedTeamIds],
    winnerTeamId: cmd.winnerTeamId,
  });
};

import type { DecideContext, Heat, Match, Slot, TournamentState } from '../domain/types.js';
import { event, fail, started, type Decision } from '../decision.js';
import { buildHeats } from '../schedule/heats.js';
import { computeStandings } from '../standings/standings.js';
import { buildBracket, crossSeeding, drawKnockout } from './bracket.js';

/** Alle KO-Durchgänge, Stufe für Stufe in Baumreihenfolge (Platz 3 vor Finale), SPEC → KO. */
export const knockoutHeats = (matches: readonly Match[], tableCount: number): Heat[] => {
  const stages = [...new Set(matches.map((m) => m.phase))];
  return stages.flatMap((phase) =>
    buildHeats(
      matches.filter((m) => m.phase === phase),
      phase,
      1,
      tableCount,
    ),
  );
};

/** M11: Gruppenphase → KO-Baum per Über-Kreuz-Setzung (ADR 025). */
export const advancePhase = (state: TournamentState, ctx: DecideContext): Decision => {
  const blocked = started(state);
  if (blocked) return blocked;
  if (state.phase !== 'groups')
    return fail('TOURNAMENT_ALREADY_STARTED', 'Knockout already running.');
  const standings = state.groups.map((g) => computeStandings(state, g.id));
  if (standings.some((s) => !s.complete))
    return fail('GROUP_STAGE_INCOMPLETE', 'All group matches need a result.');
  if (standings.some((s) => s.needsPlayoff.length > 0))
    return fail('PLAYOFF_REQUIRED', 'Record the pending playoffs first.');
  const q = state.advancersPerGroup ?? 1;
  const teamAt = (groupId: string, rank: number): Slot => {
    const row = standings.find((s) => s.groupId === groupId)?.rows[rank - 1];
    return row ? { teamId: row.teamId } : null;
  };
  const firstRound = crossSeeding(
    state.groups.map((g) => g.id),
    q,
  ).map(([a, b]): [Slot, Slot] => [teamAt(a.groupId, a.rank), teamAt(b.groupId, b.rank)]);
  const matches = buildBracket(firstRound, state.settings.thirdPlaceMatch);
  return event(ctx, 'PhaseAdvanced', { matches, heats: knockoutHeats(matches, state.tableCount) });
};

/** M04 Nur-KO: komplette Losung, Freilose zufällig (Ergebnis im Ereignis, Regel 4). */
export const startKnockoutOnly = (state: TournamentState, ctx: DecideContext): Decision => {
  if (state.teams.length < 2) return fail('NOT_ENOUGH_TEAMS', 'At least 2 teams are needed.');
  const draw = drawKnockout(
    state.teams.map((t) => t.id),
    ctx.random,
  );
  const matches = buildBracket(draw, state.settings.thirdPlaceMatch);
  return event(ctx, 'TournamentStarted', {
    groups: [],
    advancersPerGroup: null,
    matches,
    heats: knockoutHeats(matches, state.tableCount),
  });
};

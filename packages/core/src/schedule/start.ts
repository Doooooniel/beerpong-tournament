import { groupIds } from '../domain/settings.js';
import type { DecideContext, Group, TournamentState } from '../domain/types.js';
import { event, fail, notStarted, type Decision } from '../decision.js';
import { buildGroupStage, defaultAdvancers, randomGroupAssignment } from './groups.js';

const isPowerOfTwo = (n: number): boolean => n >= 1 && (n & (n - 1)) === 0;

/** M05 „Zufällig“: alle Teams neu verteilen; Zufall aus ctx (Regel 4). */
export const randomizeGroups = (state: TournamentState, ctx: DecideContext): Decision => {
  const blocked = notStarted(state);
  if (blocked) return blocked;
  if (state.settings.mode !== 'groupsKo') return fail('GROUP_NOT_FOUND', 'No groups in koOnly.');
  const teamIds = state.teams.map((t) => t.id);
  return event(ctx, 'GroupsAssigned', {
    assignment: randomGroupAssignment(teamIds, state.settings.groupCount, ctx.random),
  });
};

/** Gruppen + KO: Gruppen prüfen, q auflösen, Spielplan erzeugen (M05, M06, M10, M15). */
const startGroups = (state: TournamentState, ctx: DecideContext): Decision => {
  if (state.teams.some((t) => state.groupAssignment[t.id] === undefined))
    return fail('TEAMS_UNASSIGNED', 'Every team needs a group.');
  const groups: Group[] = groupIds(state.settings.groupCount).map((id) => ({
    id,
    teamIds: state.teams.filter((t) => state.groupAssignment[t.id] === id).map((t) => t.id),
  }));
  const smallest = Math.min(...groups.map((g) => g.teamIds.length));
  if (smallest < 2) return fail('GROUP_TOO_SMALL', 'Every group needs at least 2 teams.');
  const q = state.settings.advancersPerGroup ?? defaultAdvancers(smallest);
  if (!isPowerOfTwo(q) || q > smallest || groups.length * q < 2)
    return fail('INVALID_ADVANCERS', 'Advancers must be a power of two ≤ smallest group.');
  const { matches, heats } = buildGroupStage(groups, state.tableCount);
  return event(ctx, 'TournamentStarted', { groups, advancersPerGroup: q, matches, heats });
};

export const startTournament = (state: TournamentState, ctx: DecideContext): Decision => {
  const blocked = notStarted(state);
  if (blocked) return blocked;
  if (state.settings.mode === 'groupsKo') return startGroups(state, ctx);
  return fail('NOT_IMPLEMENTED', 'koOnly start comes with the knockout rules.');
};

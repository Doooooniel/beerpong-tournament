import type { GroupId, Match, MatchResult, TeamId, TournamentState } from '../domain/types.js';

export type RankReason = 'points' | 'headToHead' | 'cupDiff' | 'playoff' | 'tied';

export interface StandingRow {
  teamId: TeamId;
  played: number;
  wins: number;
  winsByTime: number;
  draws: number;
  losses: number;
  points: number;
  /** Nur wenn settings.trackCups. */
  cupDiff?: number;
  /** 1-basiert; geteilte Plätze haben denselben Rang. */
  rank: number;
  rankReason: RankReason;
}

export interface GroupStandings {
  groupId: GroupId;
  /** Sortiert nach rank, bei gleichem Rang nach Reihenfolge der Gruppe. */
  rows: StandingRow[];
  /** Alle Partien der Gruppe (ohne Freilose) haben ein Ergebnis. */
  complete: boolean;
  /** Teilmengen, die ein Stechen brauchen (nur Gleichstände über die Grenze q). */
  needsPlayoff: TeamId[][];
}

/** M08: Punkte eines Teams aus einem Gruppenergebnis (3 / 2 / 1 / 0). */
export const pointsFor = (result: MatchResult, teamId: TeamId): number => {
  if (result.outcome === 'draw') return 1;
  if (result.winnerTeamId !== teamId) return 0;
  return result.outcome === 'win' ? 3 : 2;
};

interface Played {
  a: TeamId;
  b: TeamId;
  result: MatchResult;
}

/** Ein Abschnitt der Rangfolge: ein Team (getrennt) oder mehrere (unaufgelöst). */
interface Block {
  teamIds: TeamId[];
  reason: RankReason;
}

const groupBy = (teams: readonly TeamId[], score: (t: TeamId) => number): TeamId[][] => {
  const sorted = [...teams].sort((x, y) => score(y) - score(x));
  const groups: TeamId[][] = [];
  for (const t of sorted) {
    const last = groups.at(-1);
    if (last && score(last[0] as TeamId) === score(t)) last.push(t);
    else groups.push([t]);
  }
  return groups;
};

export const sameSet = (a: readonly TeamId[], b: readonly TeamId[]): boolean =>
  a.length === b.length && a.every((t) => b.includes(t));

/**
 * M09: Punkte desc → Mini-Tabelle (rekursiv) → Becherdifferenz (nur trackCups) → Stechen
 * → sonst needsPlayoff bzw. 'tied'. q = state.advancersPerGroup.
 */
export const computeStandings = (state: TournamentState, groupId: GroupId): GroupStandings => {
  const order = state.groups.find((g) => g.id === groupId)?.teamIds ?? [];
  const matches = state.matches.filter((m) => m.phase === 'group' && m.groupId === groupId);
  const pairOf = (m: Match): [TeamId, TeamId] | null =>
    m.a && 'teamId' in m.a && m.b && 'teamId' in m.b ? [m.a.teamId, m.b.teamId] : null;
  const played: Played[] = matches.flatMap((m) => {
    const pair = pairOf(m);
    const result = state.results[m.id];
    return pair && result && !m.bye ? [{ a: pair[0], b: pair[1], result }] : [];
  });
  const complete = matches.every((m) => m.bye || state.results[m.id] !== undefined);
  const trackCups = state.settings.trackCups;

  const pointsAmong = (teams: readonly TeamId[]) => (t: TeamId) =>
    played
      .filter((p) => (p.a === t || p.b === t) && teams.includes(p.a) && teams.includes(p.b))
      .reduce((sum, p) => sum + pointsFor(p.result, t), 0);
  const cupDiff = (t: TeamId): number =>
    played.reduce((sum, p) => {
      if (!p.result.cups) return sum;
      if (p.a === t) return sum + p.result.cups.a - p.result.cups.b;
      if (p.b === t) return sum + p.result.cups.b - p.result.cups.a;
      return sum;
    }, 0);
  const playoffs = state.playoffs.filter((p) => p.groupId === groupId);

  const split = (groups: TeamId[][], reason: RankReason): Block[] =>
    groups.flatMap((g) => (g.length === 1 ? [{ teamIds: g, reason }] : tiebreak(g)));

  const tiebreak = (tied: TeamId[]): Block[] => {
    const byHeadToHead = groupBy(tied, pointsAmong(tied));
    if (byHeadToHead.length > 1) return split(byHeadToHead, 'headToHead');
    if (trackCups) {
      const byCups = groupBy(tied, cupDiff);
      if (byCups.length > 1) return split(byCups, 'cupDiff');
    }
    const playoff = playoffs.find((p) => sameSet(p.tiedTeamIds, tied));
    if (playoff) {
      const rest = tied.filter((t) => t !== playoff.winnerTeamId);
      const tail =
        rest.length === 1 ? [{ teamIds: rest, reason: 'playoff' as const }] : tiebreak(rest);
      return [{ teamIds: [playoff.winnerTeamId], reason: 'playoff' }, ...tail];
    }
    return [{ teamIds: tied, reason: 'tied' }];
  };

  const blocks = split(groupBy(order, pointsAmong(order)), 'points');
  const q = state.advancersPerGroup ?? 0;
  const rows: StandingRow[] = [];
  const needsPlayoff: TeamId[][] = [];
  let next = 1;
  for (const block of blocks) {
    const teams = order.filter((t) => block.teamIds.includes(t));
    // Stechen nur, wenn der Gleichstand über die Grenze q geht (ein Teil käme weiter, ein Teil nicht).
    const crossesCut = next <= q && next + teams.length - 1 > q;
    if (teams.length > 1 && complete && crossesCut) needsPlayoff.push(teams);
    for (const teamId of teams) {
      const own = played.filter((p) => p.a === teamId || p.b === teamId);
      const wins = own.filter((p) => p.result.winnerTeamId === teamId);
      const row: StandingRow = {
        teamId,
        played: own.length,
        wins: wins.filter((p) => p.result.outcome === 'win').length,
        winsByTime: wins.filter((p) => p.result.outcome === 'winByTime').length,
        draws: own.filter((p) => p.result.outcome === 'draw').length,
        losses: own.filter((p) => p.result.outcome !== 'draw' && p.result.winnerTeamId !== teamId)
          .length,
        points: own.reduce((sum, p) => sum + pointsFor(p.result, teamId), 0),
        rank: next,
        rankReason: block.reason,
      };
      if (trackCups) row.cupDiff = cupDiff(teamId);
      rows.push(row);
    }
    next += teams.length;
  }
  return { groupId, rows, complete, needsPlayoff };
};

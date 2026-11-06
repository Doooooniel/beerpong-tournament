import type {
  GroupId,
  KoStage,
  Match,
  MatchId,
  Slot,
  TeamId,
  TournamentState,
} from '../domain/types.js';

export interface SeedRef {
  groupId: GroupId;
  /** Platz in der Gruppe, 1-basiert. */
  rank: number;
}

/**
 * M11 Setzregel: erste KO-Runde in Baumreihenfolge, z. B. 2 Gruppen, q=2 →
 * [[A1, B2], [B1, A2]]. Bei einer Gruppe: [[P1, Pq], [P2, Pq−1], …].
 */
export const crossSeeding = (_groupIds: readonly GroupId[], _q: number): [SeedRef, SeedRef][] => {
  throw new Error('not implemented');
};

/** Stufenname nach verbleibenden Teams: 64 → ko64, …, 8 → quarterfinal, 4 → semifinal, 2 → final. */
export const koStageFor = (_teamsRemaining: number): KoStage => {
  throw new Error('not implemented');
};

/**
 * M11/M04 Nur-KO: Teams zufällig auf 2^k Plätze losen; Lücken = Freilos (null), nie zwei
 * Freilose in einer Partie. Liefert die Paarungen der ersten Runde in Baumreihenfolge.
 */
export const drawKnockout = (
  _teamIds: readonly TeamId[],
  _random: () => number,
): [Slot, Slot][] => {
  throw new Error('not implemented');
};

/**
 * Vollständiger Baum aller Stufen (ADR 025): erste Runde aus `firstRound`, spätere Partien mit
 * `winnerOf`, optional Platz 3 mit `loserOf` der Halbfinals (S04). KO-Partien haben round 1,
 * position = Platz im Baum; Partie mit leerem Slot hat `bye: true`. IDs deterministisch.
 */
export const buildBracket = (
  _firstRound: readonly [Slot, Slot][],
  _thirdPlace: boolean,
): Match[] => {
  throw new Error('not implemented');
};

/** Team in einem Slot, sobald feststeht (Team, Sieger/Verlierer mit Ergebnis, Freilos-Sieger). */
export const resolveSlot = (state: TournamentState, slot: Slot): TeamId | null => {
  if (slot === null) return null;
  if ('teamId' in slot) return slot.teamId;
  if ('winnerOf' in slot) return winnerOf(state, slot.winnerOf);
  return loserOf(state, slot.loserOf);
};

/** Beide Teams einer Partie, sobald feststehend (Freilos-Seite = null). */
export const teamsOf = (state: TournamentState, match: Match): [TeamId | null, TeamId | null] => [
  resolveSlot(state, match.a),
  resolveSlot(state, match.b),
];

/** Sieger einer Partie: aus Ergebnis oder sofort bei Freilos (M14: kein draw im KO). */
export const winnerOf = (state: TournamentState, matchId: MatchId): TeamId | null => {
  const match = state.matches.find((m) => m.id === matchId);
  if (!match) return null;
  if (match.bye) {
    const [a, b] = teamsOf(state, match);
    return a ?? b;
  }
  return state.results[matchId]?.winnerTeamId ?? null;
};

/** Verlierer einer gespielten Partie (Spiel um Platz 3). */
export const loserOf = (state: TournamentState, matchId: MatchId): TeamId | null => {
  const match = state.matches.find((m) => m.id === matchId);
  const winner = winnerOf(state, matchId);
  if (!match || match.bye || winner === null) return null;
  const [a, b] = teamsOf(state, match);
  return winner === a ? b : a;
};

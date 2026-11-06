import type { GroupId, MatchResult, TeamId, TournamentState } from '../domain/types.js';

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
  /** Teilmengen, die ein Stechen brauchen (nur Gleichstände, die einen Platz ≤ q berühren). */
  needsPlayoff: TeamId[][];
}

/** M08: Punkte eines Teams aus einem Gruppenergebnis (3 / 2 / 1 / 0). */
export const pointsFor = (_result: MatchResult, _teamId: TeamId): number => {
  throw new Error('not implemented');
};

/**
 * M09: Tabelle einer Gruppe. Punkte desc → Mini-Tabelle (rekursiv) → Becherdifferenz
 * (nur trackCups) → Stechen (PlayoffRecorded) → sonst needsPlayoff bzw. 'tied'.
 * q = state.advancersPerGroup.
 */
export const computeStandings = (_state: TournamentState, _groupId: GroupId): GroupStandings => {
  throw new Error('not implemented');
};

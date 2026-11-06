import type { Group, GroupId, Heat, Match, TeamId } from '../domain/types.js';

/**
 * M05 „Zufällig“: Teams zufällig auf groupCount Gruppen ('A', 'B', …) verteilen;
 * Gruppengrößen unterscheiden sich um höchstens 1. `random` liefert Werte in [0, 1).
 * Gleiche Eingabe + gleiche Zufallsfolge → gleiche Zuteilung.
 */
export const randomGroupAssignment = (
  _teamIds: readonly TeamId[],
  _groupCount: number,
  _random: () => number,
): Record<TeamId, GroupId> => {
  throw new Error('not implemented');
};

/**
 * M10: Standard für Weiterkommende = größte Zweierpotenz ≤ ⌊kleinste Gruppengröße / 2⌋, mind. 1.
 */
export const defaultAdvancers = (_smallestGroupSize: number): number => {
  throw new Error('not implemented');
};

/**
 * M06 + M15: Spielplan der Gruppenphase. Partien je Gruppe per roundRobin; Freilose als
 * Partie mit `bye: true` (b = null). Spieltag r = Runde r aller Gruppen. Durchgänge je Runde
 * à tableCount Partien (ohne Freilose), Reihenfolge Gruppe A, B, … und darin `position`.
 * IDs sind deterministisch.
 */
export const buildGroupStage = (
  _groups: readonly Group[],
  _tableCount: number,
): { matches: Match[]; heats: Heat[] } => {
  throw new Error('not implemented');
};

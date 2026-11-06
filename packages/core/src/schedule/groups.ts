import { groupIds } from '../domain/settings.js';
import type { Group, GroupId, Heat, Match, TeamId } from '../domain/types.js';
import { buildHeats } from './heats.js';
import { roundRobin } from './round-robin.js';

/**
 * M05 „Zufällig“: Teams zufällig auf groupCount Gruppen ('A', 'B', …) verteilen;
 * Gruppengrößen unterscheiden sich um höchstens 1. `random` liefert Werte in [0, 1).
 * Gleiche Eingabe + gleiche Zufallsfolge → gleiche Zuteilung.
 */
export const randomGroupAssignment = (
  teamIds: readonly TeamId[],
  groupCount: number,
  random: () => number,
): Record<TeamId, GroupId> => {
  const shuffled = [...teamIds];
  // Fisher-Yates
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.min(i, Math.floor(random() * (i + 1)));
    [shuffled[i], shuffled[j]] = [shuffled[j] as TeamId, shuffled[i] as TeamId];
  }
  const ids = groupIds(groupCount);
  return Object.fromEntries(shuffled.map((t, i) => [t, ids[i % groupCount] as GroupId]));
};

/**
 * M10: Standard für Weiterkommende = größte Zweierpotenz ≤ ⌊kleinste Gruppengröße / 2⌋, mind. 1.
 */
export const defaultAdvancers = (smallestGroupSize: number): number => {
  const half = Math.floor(smallestGroupSize / 2);
  let q = 1;
  while (q * 2 <= half) q *= 2;
  return q;
};

/**
 * M06 + M15: Spielplan der Gruppenphase. Partien je Gruppe per roundRobin; Freilose als
 * Partie mit `bye: true` (b = null). Spieltag r = Runde r aller Gruppen. Durchgänge je Runde
 * à tableCount Partien (ohne Freilose), Reihenfolge Gruppe A, B, … und darin `position`.
 * IDs sind deterministisch.
 */
export const buildGroupStage = (
  groups: readonly Group[],
  tableCount: number,
): { matches: Match[]; heats: Heat[] } => {
  const byRound = new Map<number, Match[]>();
  for (const group of groups) {
    roundRobin(group.teamIds).forEach((day, i) => {
      const round = i + 1;
      const games: Match[] = day.pairs.map(([a, b], p) => ({
        id: `${group.id}-r${round}-m${p + 1}`,
        phase: 'group',
        round,
        position: p + 1,
        groupId: group.id,
        a: { teamId: a },
        b: { teamId: b },
        bye: false,
      }));
      if (day.bye !== null) {
        const position = games.length + 1;
        games.push({
          id: `${group.id}-r${round}-m${position}`,
          phase: 'group',
          round,
          position,
          groupId: group.id,
          a: { teamId: day.bye },
          b: null,
          bye: true,
        });
      }
      byRound.set(round, [...(byRound.get(round) ?? []), ...games]);
    });
  }
  const rounds = [...byRound.keys()].sort((x, y) => x - y);
  const matches = rounds.flatMap((r) => byRound.get(r) ?? []);
  const heats = rounds.flatMap((r) => buildHeats(byRound.get(r) ?? [], 'group', r, tableCount));
  return { matches, heats };
};

import type {
  GroupId,
  KoStage,
  Match,
  MatchId,
  Slot,
  TeamId,
  TournamentState,
} from '../domain/types.js';
import { shuffle } from '../domain/shuffle.js';

export interface SeedRef {
  groupId: GroupId;
  /** Platz in der Gruppe, 1-basiert. */
  rank: number;
}

/** Übliche Setzliste: [1, 2] → [1, 4, 2, 3] → [1, 8, 4, 5, 2, 7, 3, 6] … */
const seedOrder = (size: number): number[] => {
  let order = [1];
  while (order.length < size) {
    const n = order.length * 2;
    order = order.flatMap((s) => [s, n + 1 - s]);
  }
  return order;
};

/**
 * M11 Setzregel: erste KO-Runde in Baumreihenfolge, z. B. 2 Gruppen, q=2 →
 * [[A1, B2], [B1, A2]]. Eine Gruppe: Setzliste [[P1, Pq], [Pq/2, Pq/2+1], …].
 * Gruppenpaare (A,B), (C,D), …: Xk – Y(q+1−k); obere Hälfte ungerade k, untere gespiegelt;
 * die Paare werden partieweise verzahnt, damit Teams einer Gruppe möglichst spät aufeinandertreffen.
 */
export const crossSeeding = (groupIds: readonly GroupId[], q: number): [SeedRef, SeedRef][] => {
  const ref = (groupId: GroupId, rank: number): SeedRef => ({ groupId, rank });
  if (groupIds.length === 1) {
    const g = groupIds[0] as GroupId;
    const order = seedOrder(q);
    return Array.from({ length: q / 2 }, (_, i) => [
      ref(g, order[2 * i] as number),
      ref(g, order[2 * i + 1] as number),
    ]);
  }
  const perPair: [SeedRef, SeedRef][][] = [];
  for (let p = 0; p < groupIds.length; p += 2) {
    const x = groupIds[p] as GroupId;
    const y = groupIds[p + 1] as GroupId;
    if (q === 1) {
      perPair.push([[ref(x, 1), ref(y, 1)]]);
      continue;
    }
    const top = seedOrder(q / 2).map((i): [SeedRef, SeedRef] => {
      const k = 2 * i - 1;
      return [ref(x, k), ref(y, q + 1 - k)];
    });
    const bottom = top.map(([a, b]): [SeedRef, SeedRef] => [ref(y, a.rank), ref(x, b.rank)]);
    perPair.push([...top, ...bottom]);
  }
  const perPairLength = perPair[0]?.length ?? 0;
  return Array.from({ length: perPairLength }, (_, j) =>
    perPair.map((matches) => matches[j] as [SeedRef, SeedRef]),
  ).flat();
};

const STAGES: Record<number, KoStage> = {
  64: 'ko64',
  32: 'ko32',
  16: 'ko16',
  8: 'quarterfinal',
  4: 'semifinal',
  2: 'final',
};

/** Stufenname nach verbleibenden Teams: 64 → ko64, …, 8 → quarterfinal, 4 → semifinal, 2 → final. */
export const koStageFor = (teamsRemaining: number): KoStage => {
  const stage = STAGES[teamsRemaining];
  if (!stage) throw new Error(`No knockout stage for ${teamsRemaining} teams.`);
  return stage;
};

/**
 * M11/M04 Nur-KO: Teams zufällig auf 2^k Plätze losen; Lücken = Freilos (null), nie zwei
 * Freilose in einer Partie. Liefert die Paarungen der ersten Runde in Baumreihenfolge.
 */
export const drawKnockout = (teamIds: readonly TeamId[], random: () => number): [Slot, Slot][] => {
  let size = 2;
  while (size < teamIds.length) size *= 2;
  const matchCount = size / 2;
  const teams = shuffle(teamIds, random);
  const byeMatches = new Set(
    shuffle(
      Array.from({ length: matchCount }, (_, i) => i),
      random,
    ).slice(0, size - teamIds.length),
  );
  const slot = (): Slot => {
    const t = teams.shift();
    return t === undefined ? null : { teamId: t };
  };
  return Array.from({ length: matchCount }, (_, i): [Slot, Slot] =>
    byeMatches.has(i) ? [slot(), null] : [slot(), slot()],
  );
};

/**
 * Vollständiger Baum aller Stufen (ADR 025): erste Runde aus `firstRound`, spätere Partien mit
 * `winnerOf`, optional Platz 3 mit `loserOf` der Halbfinals (S04; nur bei zwei echten
 * Halbfinals). KO-Partien haben round 1, position = Platz im Baum; Partie mit leerem Slot hat
 * `bye: true`. IDs deterministisch.
 */
export const buildBracket = (firstRound: readonly [Slot, Slot][], thirdPlace: boolean): Match[] => {
  const all: Match[] = [];
  let current: Match[] = firstRound.map(([a, b], i) => {
    const phase = koStageFor(firstRound.length * 2);
    return {
      id: `${phase}-${i + 1}`,
      phase,
      round: 1,
      position: i + 1,
      groupId: null,
      a,
      b,
      bye: a === null || b === null,
    };
  });
  while (current.length > 0) {
    const stage = current;
    all.push(...stage);
    if (stage.length === 1) break;
    const phase = koStageFor(stage.length);
    const next: Match[] = Array.from({ length: stage.length / 2 }, (_, i) => ({
      id: `${phase}-${i + 1}`,
      phase,
      round: 1,
      position: i + 1,
      groupId: null,
      a: { winnerOf: (stage[2 * i] as Match).id },
      b: { winnerOf: (stage[2 * i + 1] as Match).id },
      bye: false,
    }));
    const [sf1, sf2] = stage;
    if (thirdPlace && stage.length === 2 && sf1 && sf2 && !sf1.bye && !sf2.bye) {
      all.push({
        id: 'thirdPlace-1',
        phase: 'thirdPlace',
        round: 1,
        position: 1,
        groupId: null,
        a: { loserOf: sf1.id },
        b: { loserOf: sf2.id },
        bye: false,
      });
    }
    current = next;
  }
  return all;
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

import type { TeamId } from '../domain/types.js';

export interface RoundRobinRound {
  /** Paarungen des Spieltags in fester Reihenfolge. */
  pairs: [TeamId, TeamId][];
  /** Team mit Freilos in diesem Spieltag (ungerade Gruppengröße), sonst null. */
  bye: TeamId | null;
}

/**
 * M06: jeder gegen jeden, einfach, Circle-Methode; bei ungerader Größe Dummy = Freilos.
 * n gerade → n−1 Spieltage, n ungerade → n Spieltage. Deterministisch für dieselbe Eingabe.
 */
export const roundRobin = (teamIds: readonly TeamId[]): RoundRobinRound[] => {
  if (teamIds.length < 2) return [];
  const circle: (TeamId | null)[] = teamIds.length % 2 === 0 ? [...teamIds] : [...teamIds, null];
  const n = circle.length;
  const rounds: RoundRobinRound[] = [];
  for (let r = 0; r < n - 1; r++) {
    const round: RoundRobinRound = { pairs: [], bye: null };
    for (let i = 0; i < n / 2; i++) {
      const a = circle[i] ?? null;
      const b = circle[n - 1 - i] ?? null;
      if (a === null) round.bye = b;
      else if (b === null) round.bye = a;
      else round.pairs.push([a, b]);
    }
    rounds.push(round);
    // Erster Platz bleibt fest, der letzte rückt an Position 2.
    circle.splice(1, 0, circle.pop() ?? null);
  }
  return rounds;
};

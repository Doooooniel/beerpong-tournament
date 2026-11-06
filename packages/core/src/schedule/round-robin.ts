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
export const roundRobin = (_teamIds: readonly TeamId[]): RoundRobinRound[] => {
  throw new Error('not implemented');
};

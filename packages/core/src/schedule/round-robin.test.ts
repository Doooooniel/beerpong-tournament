import { describe, expect, it } from 'vitest';
import { roundRobin } from './round-robin.js';
import type { RoundRobinRound } from './round-robin.js';

// ---------------------------------------------------------------------------
// Testhilfen
// ---------------------------------------------------------------------------

const teams = (n: number): string[] => Array.from({ length: n }, (_, i) => `team-${i + 1}`);

const pairKey = (x: string, y: string): string => (x < y ? `${x}|${y}` : `${y}|${x}`);

/** Alle Teams eines Spieltags (Paarungen + Freilos) in Auftrittsreihenfolge. */
const appearances = (round: RoundRobinRound): string[] => {
  const ids = round.pairs.flatMap(([x, y]) => [x, y]);
  if (round.bye !== null) ids.push(round.bye);
  return ids;
};

const SIZES = [2, 3, 4, 5, 6, 7, 8] as const;
const sizeCases = SIZES.map((n) => ({ n, parity: n % 2 === 0 ? 'gerade' : 'ungerade' }));

// ---------------------------------------------------------------------------
// M06: jeder gegen jeden, einfach; Circle-Methode; Freilos bei ungerader Größe
// ---------------------------------------------------------------------------

describe('roundRobin (M06, SPEC → Gruppen)', () => {
  it.each(sizeCases)(
    'M06: $n Teams ($parity) → n gerade: n−1 Spieltage, n ungerade: n Spieltage',
    ({ n }) => {
      const rounds = roundRobin(teams(n));
      expect(rounds).toHaveLength(n % 2 === 0 ? n - 1 : n);
    },
  );

  it.each(sizeCases)('M06: $n Teams → jedes Paar genau einmal', ({ n }) => {
    const ids = teams(n);
    const rounds = roundRobin(ids);
    const keys = rounds.flatMap((r) => r.pairs.map(([x, y]) => pairKey(x, y)));
    expect(keys).toHaveLength((n * (n - 1)) / 2);
    expect(new Set(keys).size).toBe(keys.length);
    for (let i = 0; i < n; i += 1) {
      for (let j = i + 1; j < n; j += 1) {
        expect(keys).toContain(pairKey(ids[i] ?? '', ids[j] ?? ''));
      }
    }
  });

  it.each(sizeCases)(
    'M06: $n Teams → keine Partie gegen sich selbst, nur bekannte Teams',
    ({ n }) => {
      const ids = teams(n);
      for (const round of roundRobin(ids)) {
        for (const [x, y] of round.pairs) {
          expect(x).not.toBe(y);
          expect(ids).toContain(x);
          expect(ids).toContain(y);
        }
        if (round.bye !== null) expect(ids).toContain(round.bye);
      }
    },
  );

  it.each(sizeCases)(
    'M06: $n Teams → jedes Team höchstens einmal je Spieltag, ⌊n/2⌋ Partien je Spieltag',
    ({ n }) => {
      for (const round of roundRobin(teams(n))) {
        const seen = appearances(round);
        expect(new Set(seen).size).toBe(seen.length);
        expect(round.pairs).toHaveLength(Math.floor(n / 2));
      }
    },
  );

  it.each(sizeCases.filter(({ n }) => n % 2 === 0))(
    'M06: $n Teams (gerade) → kein Freilos, jedes Team spielt an jedem Spieltag',
    ({ n }) => {
      const ids = teams(n);
      for (const round of roundRobin(ids)) {
        expect(round.bye).toBeNull();
        expect([...appearances(round)].sort()).toEqual([...ids].sort());
      }
    },
  );

  it.each(sizeCases.filter(({ n }) => n % 2 === 1))(
    'M06: $n Teams (ungerade) → genau ein Freilos je Spieltag, alle übrigen spielen',
    ({ n }) => {
      const ids = teams(n);
      for (const round of roundRobin(ids)) {
        expect(round.bye).not.toBeNull();
        expect([...appearances(round)].sort()).toEqual([...ids].sort());
      }
    },
  );

  it.each(sizeCases.filter(({ n }) => n % 2 === 1))(
    'M06: $n Teams (ungerade) → jedes Team hat insgesamt genau ein Freilos',
    ({ n }) => {
      const ids = teams(n);
      const byes = roundRobin(ids).map((r) => r.bye);
      expect([...byes].sort()).toEqual([...ids].sort());
    },
  );

  it.each(sizeCases)('M06: $n Teams → deterministisch für dieselbe Eingabe', ({ n }) => {
    expect(roundRobin(teams(n))).toEqual(roundRobin(teams(n)));
  });

  it('M06: Eingabe wird nicht verändert (eingefrorenes Array)', () => {
    const ids = Object.freeze(teams(5));
    const copy = [...ids];
    roundRobin(ids);
    expect([...ids]).toEqual(copy);
  });

  it('M06: Grenzfall 2 Teams → genau ein Spieltag mit einer Partie, kein Freilos', () => {
    const rounds = roundRobin(['x', 'y']);
    expect(rounds).toHaveLength(1);
    expect(rounds[0]?.bye).toBeNull();
    expect(rounds[0]?.pairs.map(([p, q]) => pairKey(p, q))).toEqual([pairKey('x', 'y')]);
  });

  it('M06: Grenzfall 3 Teams → drei Spieltage mit je einer Partie und einem Freilos', () => {
    const rounds = roundRobin(['x', 'y', 'z']);
    expect(rounds).toHaveLength(3);
    for (const round of rounds) {
      expect(round.pairs).toHaveLength(1);
      expect(round.bye).not.toBeNull();
    }
  });

  it('M06: beliebige Team-IDs (keine Annahme über das Format)', () => {
    const ids = ['ü-1', 'Zeta', '42', 'a b'];
    const rounds = roundRobin(ids);
    expect(rounds).toHaveLength(3);
    const keys = rounds.flatMap((r) => r.pairs.map(([x, y]) => pairKey(x, y)));
    expect(new Set(keys).size).toBe(6);
  });
});

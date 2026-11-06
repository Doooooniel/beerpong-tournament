import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Group, Heat, Match } from '../domain/types.js';
import { buildGroupStage, defaultAdvancers, randomGroupAssignment } from './groups.js';
import { roundRobin } from './round-robin.js';

// ---------------------------------------------------------------------------
// Testhilfen
// ---------------------------------------------------------------------------

/** Kleiner LCG mit festem Seed, Werte in [0, 1). Kein Math.random. */
const lcg = (seed: number): (() => number) => {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
};

/** Zählt die Aufrufe einer Zufallsquelle. */
const counting = (random: () => number): { random: () => number; calls: () => number } => {
  let n = 0;
  return {
    random: () => {
      n += 1;
      return random();
    },
    calls: () => n,
  };
};

/** Zufallsfolge aus einem Array, zyklisch. */
const sequence = (values: number[]): (() => number) => {
  let i = 0;
  return () => {
    const v = values[i % values.length] ?? 0;
    i += 1;
    return v;
  };
};

const teams = (n: number, prefix = 't'): string[] =>
  Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`);

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

/** Gruppen mit den gegebenen Größen, IDs 'A', 'B', …, Team-IDs eindeutig. */
const makeGroups = (sizes: number[]): Group[] =>
  sizes.map((size, g) => ({
    id: LETTERS[g] ?? `G${g}`,
    teamIds: teams(size, `${LETTERS[g] ?? g}-`),
  }));

const sizesOf = (assignment: Record<string, string>): Map<string, number> => {
  const sizes = new Map<string, number>();
  for (const groupId of Object.values(assignment)) {
    sizes.set(groupId, (sizes.get(groupId) ?? 0) + 1);
  }
  return sizes;
};

const pairKey = (x: string, y: string): string => (x < y ? `${x}|${y}` : `${y}|${x}`);

const teamOf = (slot: Match['a']): string => {
  if (slot === null || !('teamId' in slot))
    throw new Error(`expected team slot, got ${JSON.stringify(slot)}`);
  return slot.teamId;
};

const byPosition = (x: Match, y: Match): number => x.position - y.position;

const chunk = <T>(items: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

/** Erwartete Durchgänge laut SPEC → Tische und Durchgänge, ohne IDs. */
const expectedHeats = (
  groups: readonly Group[],
  matches: Match[],
  tableCount: number,
): Omit<Heat, 'id'>[] => {
  const maxRound = Math.max(0, ...matches.map((m) => m.round));
  const heats: Omit<Heat, 'id'>[] = [];
  for (let round = 1; round <= maxRound; round += 1) {
    const ordered = groups.flatMap((g) =>
      matches
        .filter((m) => m.groupId === g.id && m.round === round && !m.bye)
        .sort(byPosition)
        .map((m) => m.id),
    );
    chunk(ordered, tableCount).forEach((matchIds, i) => {
      heats.push({ phase: 'group', round, index: i + 1, matchIds });
    });
  }
  return heats;
};

const sortHeats = (heats: Heat[]): Heat[] =>
  [...heats].sort((x, y) => x.round - y.round || x.index - y.index);

/**
 * Prüft alle Regeln aus M06/M15 für einen Spielplan, ohne konkrete Paarungsreihenfolge
 * oder ID-Formate festzuschreiben (Bezug ist roundRobin je Gruppe).
 */
const checkGroupStage = (
  groups: Group[],
  tableCount: number,
  result: { matches: Match[]; heats: Heat[] },
): void => {
  const { matches, heats } = result;

  // IDs eindeutig
  expect(new Set(matches.map((m) => m.id)).size).toBe(matches.length);
  expect(new Set(heats.map((h) => h.id)).size).toBe(heats.length);

  for (const m of matches) {
    expect(m.phase).toBe('group');
    expect(m.round).toBeGreaterThanOrEqual(1);
  }

  for (const group of groups) {
    const rr = roundRobin(group.teamIds);
    const own = matches.filter((m) => m.groupId === group.id);
    const rounds = new Set(own.map((m) => m.round));
    expect([...rounds].sort((x, y) => x - y)).toEqual(rr.map((_, i) => i + 1));

    rr.forEach((rrRound, i) => {
      const round = i + 1;
      const inRound = own.filter((m) => m.round === round);
      // position: 1..m innerhalb von Gruppe und Spieltag, eindeutig
      expect(inRound.map((m) => m.position).sort((x, y) => x - y)).toEqual(
        inRound.map((_, k) => k + 1),
      );

      const played = inRound.filter((m) => !m.bye).sort(byPosition);
      expect(played.map((m) => pairKey(teamOf(m.a), teamOf(m.b)))).toEqual(
        rrRound.pairs.map(([x, y]) => pairKey(x, y)),
      );

      const byes = inRound.filter((m) => m.bye);
      if (rrRound.bye === null) {
        expect(byes).toHaveLength(0);
      } else {
        expect(byes).toHaveLength(1);
        expect(byes[0]?.a).toEqual({ teamId: rrRound.bye });
        expect(byes[0]?.b).toBeNull();
      }
    });
  }

  // Jede Partie gehört zu einer Gruppe des Eingangs
  const groupIdSet = new Set(groups.map((g) => g.id));
  for (const m of matches) expect(groupIdSet.has(m.groupId ?? '')).toBe(true);

  // Durchgänge
  for (const h of heats) {
    expect(h.phase).toBe('group');
    expect(h.matchIds.length).toBeGreaterThanOrEqual(1);
    expect(h.matchIds.length).toBeLessThanOrEqual(tableCount);
  }
  const heatMatchIds = heats.flatMap((h) => h.matchIds);
  const playedIds = matches.filter((m) => !m.bye).map((m) => m.id);
  expect([...heatMatchIds].sort()).toEqual([...playedIds].sort());

  const actual = sortHeats(heats).map(({ phase, round, index, matchIds }) => ({
    phase,
    round,
    index,
    matchIds,
  }));
  expect(actual).toEqual(expectedHeats(groups, matches, tableCount));

  // Spieltag des Durchgangs = Spieltag seiner Partien
  const byId = new Map(matches.map((m) => [m.id, m]));
  for (const h of heats) {
    for (const id of h.matchIds) expect(byId.get(id)?.round).toBe(h.round);
  }
};

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// randomGroupAssignment (M05 „Zufällig“)
// ---------------------------------------------------------------------------

describe('randomGroupAssignment (M05, SPEC → Gruppen)', () => {
  const cases = [
    { n: 4, groupCount: 1 },
    { n: 4, groupCount: 2 },
    { n: 5, groupCount: 2 },
    { n: 7, groupCount: 2 },
    { n: 8, groupCount: 4 },
    { n: 10, groupCount: 4 },
    { n: 13, groupCount: 4 },
    { n: 17, groupCount: 8 },
    { n: 64, groupCount: 16 },
  ];

  it.each(cases)(
    'M05: $n Teams auf $groupCount Gruppen → jedes Team genau einmal, Gruppen A…, Größen ±1',
    ({ n, groupCount }) => {
      const ids = teams(n);
      const assignment = randomGroupAssignment(ids, groupCount, lcg(7));
      expect(Object.keys(assignment).sort()).toEqual([...ids].sort());

      const expectedIds = Array.from({ length: groupCount }, (_, i) => String.fromCharCode(65 + i));
      for (const groupId of Object.values(assignment)) expect(expectedIds).toContain(groupId);

      const sizes = sizesOf(assignment);
      // n ≥ groupCount → jede Gruppe bekommt mindestens ein Team
      expect([...sizes.keys()].sort()).toEqual(expectedIds);
      const values = [...sizes.values()];
      expect(Math.max(...values) - Math.min(...values)).toBeLessThanOrEqual(1);
      expect(values.reduce((s, v) => s + v, 0)).toBe(n);
    },
  );

  it('M05: 5 Teams auf 2 Gruppen → Größen genau 3 und 2', () => {
    const sizes = sizesOf(randomGroupAssignment(teams(5), 2, lcg(1)));
    expect([...sizes.values()].sort()).toEqual([2, 3]);
  });

  it('M05: 10 Teams auf 4 Gruppen → Größen genau 3, 3, 2, 2', () => {
    const sizes = sizesOf(randomGroupAssignment(teams(10), 4, lcg(2)));
    expect([...sizes.values()].sort()).toEqual([2, 2, 3, 3]);
  });

  it('M05: eine Gruppe → alle Teams in A', () => {
    const assignment = randomGroupAssignment(teams(6), 1, lcg(3));
    expect(new Set(Object.values(assignment))).toEqual(new Set(['A']));
  });

  it('M05: gleiche Zufallsfolge → gleiche Zuteilung (fester Seed)', () => {
    const ids = teams(12);
    expect(randomGroupAssignment(ids, 4, lcg(42))).toEqual(randomGroupAssignment(ids, 4, lcg(42)));
  });

  it('M05: gleiche Zufallsfolge aus einem Array → gleiche Zuteilung', () => {
    const values = [0.13, 0.87, 0.42, 0.05, 0.99, 0.5, 0.31, 0.76];
    const ids = teams(8);
    expect(randomGroupAssignment(ids, 2, sequence(values))).toEqual(
      randomGroupAssignment(ids, 2, sequence(values)),
    );
  });

  it('M05: andere Zufallsfolgen können andere Zuteilungen liefern', () => {
    const ids = teams(8);
    const results = new Set(
      Array.from({ length: 12 }, (_, seed) =>
        JSON.stringify(
          Object.entries(randomGroupAssignment(ids, 2, lcg(seed + 1))).sort(([x], [y]) =>
            x < y ? -1 : 1,
          ),
        ),
      ),
    );
    expect(results.size).toBeGreaterThan(1);
  });

  it('M05/Arch. Regel 4: nutzt den übergebenen random (mindestens ein Aufruf)', () => {
    const source = counting(lcg(5));
    randomGroupAssignment(teams(8), 2, source.random);
    expect(source.calls()).toBeGreaterThan(0);
  });

  it('M05/Arch. Regel 4: kein eigener Zufall (Math.random wird nie aufgerufen)', () => {
    const spy = vi.spyOn(Math, 'random').mockImplementation(() => {
      throw new Error('Math.random must not be used in core');
    });
    expect(() => randomGroupAssignment(teams(9), 4, lcg(11))).not.toThrow();
    expect(spy).not.toHaveBeenCalled();
  });

  it.each([
    { label: 'immer 0', random: () => 0 },
    { label: 'knapp unter 1', random: () => 0.999_999_999 },
  ])('M05: Grenzwerte der Zufallsquelle ($label) → gültige Zuteilung', ({ random }) => {
    const ids = teams(9);
    const assignment = randomGroupAssignment(ids, 4, random);
    expect(Object.keys(assignment).sort()).toEqual([...ids].sort());
    const values = [...sizesOf(assignment).values()];
    expect(values).toHaveLength(4);
    expect(Math.max(...values) - Math.min(...values)).toBeLessThanOrEqual(1);
  });

  it('M05: Eingabe wird nicht verändert', () => {
    const ids = Object.freeze(teams(6));
    const copy = [...ids];
    randomGroupAssignment(ids, 2, lcg(9));
    expect([...ids]).toEqual(copy);
  });

  it('M05: keine Teams → leere Zuteilung', () => {
    expect(randomGroupAssignment([], 2, lcg(1))).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// defaultAdvancers (M10)
// ---------------------------------------------------------------------------

describe('defaultAdvancers (M10, SPEC → Gruppen)', () => {
  it.each([
    { size: 2, q: 1 },
    { size: 3, q: 1 },
    { size: 4, q: 2 },
    { size: 5, q: 2 },
    { size: 6, q: 2 },
    { size: 7, q: 2 },
    { size: 8, q: 4 },
    { size: 9, q: 4 },
    { size: 15, q: 4 },
    { size: 16, q: 8 },
  ])('M10: kleinste Gruppe $size Teams → Standard q = $q', ({ size, q }) => {
    expect(defaultAdvancers(size)).toBe(q);
  });

  it('M10: Grenzfall kleinste Gruppe 1 Team → mindestens 1', () => {
    expect(defaultAdvancers(1)).toBe(1);
  });

  it.each([2, 3, 4, 5, 6, 7, 8, 9, 12, 16, 31, 32])(
    'M10: Größe %i → Ergebnis ist Zweierpotenz und ≤ Gruppengröße',
    (size) => {
      const q = defaultAdvancers(size);
      expect(Number.isInteger(Math.log2(q))).toBe(true);
      expect(q).toBeLessThanOrEqual(size);
      expect(q).toBeGreaterThanOrEqual(1);
    },
  );
});

// ---------------------------------------------------------------------------
// buildGroupStage (M06 + M15)
// ---------------------------------------------------------------------------

describe('buildGroupStage (M06/M15, SPEC → Gruppen, Tische und Durchgänge)', () => {
  it.each([
    { sizes: [2], tableCount: 1 },
    { sizes: [3], tableCount: 1 },
    { sizes: [4], tableCount: 2 },
    { sizes: [5], tableCount: 2 },
    { sizes: [2, 2], tableCount: 2 },
    { sizes: [3, 3], tableCount: 2 },
    { sizes: [4, 4], tableCount: 2 },
    { sizes: [4, 4], tableCount: 3 },
    { sizes: [5, 5], tableCount: 4 },
    { sizes: [3, 2], tableCount: 4 },
    { sizes: [5, 4], tableCount: 3 },
    { sizes: [4, 4, 4, 4], tableCount: 4 },
    { sizes: [3, 3, 2, 2], tableCount: 3 },
    { sizes: [5, 5, 4, 4], tableCount: 2 },
    { sizes: [8, 8, 8, 8, 8, 8, 8, 8], tableCount: 16 },
  ])(
    'M06/M15: Gruppengrößen $sizes, $tableCount Tische → alle Regeln erfüllt',
    ({ sizes, tableCount }) => {
      const groups = makeGroups(sizes);
      checkGroupStage(groups, tableCount, buildGroupStage(groups, tableCount));
    },
  );

  it.each([
    { size: 2, played: 1, byes: 0 },
    { size: 3, played: 3, byes: 3 },
    { size: 4, played: 6, byes: 0 },
    { size: 5, played: 10, byes: 5 },
  ])(
    'M06: eine Gruppe mit $size Teams → $played Partien, $byes Freilose',
    ({ size, played, byes }) => {
      const { matches } = buildGroupStage(makeGroups([size]), 2);
      expect(matches.filter((m) => !m.bye)).toHaveLength(played);
      expect(matches.filter((m) => m.bye)).toHaveLength(byes);
    },
  );

  it('M06: Partie hat groupId, a/b = { teamId }, bye false', () => {
    const groups = makeGroups([4]);
    const { matches } = buildGroupStage(groups, 2);
    for (const m of matches) {
      expect(m.groupId).toBe('A');
      expect(m.bye).toBe(false);
      expect(m.a).toEqual({ teamId: expect.any(String) });
      expect(m.b).toEqual({ teamId: expect.any(String) });
    }
  });

  it('M06: Freilos = Partie mit bye true, b null, a = Team mit Freilos, nicht in Durchgängen', () => {
    const groups = makeGroups([3]);
    const { matches, heats } = buildGroupStage(groups, 4);
    const byes = matches.filter((m) => m.bye);
    expect(byes).toHaveLength(3);
    for (const m of byes) {
      expect(m.b).toBeNull();
      expect(m.groupId).toBe('A');
      expect(m.phase).toBe('group');
      expect(groups[0]?.teamIds).toContain(teamOf(m.a));
    }
    // jedes Team genau ein Freilos
    expect(byes.map((m) => teamOf(m.a)).sort()).toEqual([...(groups[0]?.teamIds ?? [])].sort());
    const inHeats = new Set(heats.flatMap((h) => h.matchIds));
    for (const m of byes) expect(inHeats.has(m.id)).toBe(false);
  });

  it('M06: ungleiche Gruppengrößen (3 und 2) → Spieltag 1 beider Gruppen in Runde 1, Runden 2–3 nur A', () => {
    const groups = makeGroups([3, 2]);
    const { matches, heats } = buildGroupStage(groups, 4);
    const b = matches.filter((m) => m.groupId === 'B');
    expect(b).toHaveLength(1);
    expect(b[0]?.round).toBe(1);
    expect(
      matches
        .filter((m) => m.groupId === 'A')
        .map((m) => m.round)
        .sort(),
    ).toEqual([1, 1, 2, 2, 3, 3]);
    const sorted = sortHeats(heats);
    expect(sorted.map((h) => [h.round, h.index, h.matchIds.length])).toEqual([
      [1, 1, 2],
      [2, 1, 1],
      [3, 1, 1],
    ]);
    // Runde 1: erst Gruppe A, dann B
    const round1 = sorted[0]?.matchIds ?? [];
    const groupOf = (id: string) => matches.find((m) => m.id === id)?.groupId;
    expect(round1.map(groupOf)).toEqual(['A', 'B']);
  });

  it('M15: mehr Partien als Tische → mehrere Durchgänge je Runde (2 Gruppen à 4, 3 Tische → 3 + 1)', () => {
    const groups = makeGroups([4, 4]);
    const { matches, heats } = buildGroupStage(groups, 3);
    const sorted = sortHeats(heats);
    expect(sorted.map((h) => [h.round, h.index, h.matchIds.length])).toEqual([
      [1, 1, 3],
      [1, 2, 1],
      [2, 1, 3],
      [2, 2, 1],
      [3, 1, 3],
      [3, 2, 1],
    ]);
    const groupOf = (id: string) => matches.find((m) => m.id === id)?.groupId;
    for (const round of [1, 2, 3]) {
      const ids = sorted.filter((h) => h.round === round).flatMap((h) => h.matchIds);
      expect(ids.map(groupOf)).toEqual(['A', 'A', 'B', 'B']);
    }
  });

  it('M15: 1 Tisch → jeder Durchgang hat genau eine Partie', () => {
    const groups = makeGroups([4, 3]);
    const { matches, heats } = buildGroupStage(groups, 1);
    expect(heats).toHaveLength(matches.filter((m) => !m.bye).length);
    for (const h of heats) expect(h.matchIds).toHaveLength(1);
  });

  it('M15: genug Tische → genau ein Durchgang je Runde', () => {
    const groups = makeGroups([5, 5]);
    const { heats } = buildGroupStage(groups, 10);
    expect(sortHeats(heats).map((h) => [h.round, h.index, h.matchIds.length])).toEqual([
      [1, 1, 4],
      [2, 1, 4],
      [3, 1, 4],
      [4, 1, 4],
      [5, 1, 4],
    ]);
  });

  it('M15: Partien genau so viele wie Tische → ein voller Durchgang', () => {
    const { heats } = buildGroupStage(makeGroups([4, 4]), 4);
    expect(sortHeats(heats).map((h) => h.matchIds.length)).toEqual([4, 4, 4]);
  });

  it('M15: Durchgänge innerhalb einer Runde folgen Gruppe A, B, … und darin position', () => {
    const groups = makeGroups([4, 4, 4, 4]);
    const { matches, heats } = buildGroupStage(groups, 3);
    const byId = new Map(matches.map((m) => [m.id, m]));
    for (const round of [1, 2, 3]) {
      const ids = sortHeats(heats)
        .filter((h) => h.round === round)
        .flatMap((h) => h.matchIds);
      const keys = ids.map((id) => {
        const m = byId.get(id);
        return `${m?.groupId}:${m?.position}`;
      });
      expect(keys).toEqual(['A:1', 'A:2', 'B:1', 'B:2', 'C:1', 'C:2', 'D:1', 'D:2']);
    }
  });

  it('M06/M15: IDs eindeutig über alle Partien und alle Durchgänge', () => {
    const { matches, heats } = buildGroupStage(makeGroups([5, 5, 4, 4]), 3);
    const matchIds = matches.map((m) => m.id);
    const heatIds = heats.map((h) => h.id);
    expect(new Set(matchIds).size).toBe(matchIds.length);
    expect(new Set(heatIds).size).toBe(heatIds.length);
  });

  it('M06/M15: deterministisch für dieselbe Eingabe (inkl. IDs)', () => {
    const groups = makeGroups([5, 4]);
    expect(buildGroupStage(groups, 2)).toEqual(buildGroupStage(makeGroups([5, 4]), 2));
  });

  it('M06/M15: kein Zufall (Math.random wird nie aufgerufen)', () => {
    const spy = vi.spyOn(Math, 'random').mockImplementation(() => {
      throw new Error('Math.random must not be used in core');
    });
    expect(() => buildGroupStage(makeGroups([3, 3]), 2)).not.toThrow();
    expect(spy).not.toHaveBeenCalled();
  });

  it('M06: Eingabe wird nicht verändert', () => {
    const groups = makeGroups([3, 4]);
    const copy: Group[] = groups.map((g) => ({ id: g.id, teamIds: [...g.teamIds] }));
    buildGroupStage(groups, 2);
    expect(groups).toEqual(copy);
  });
});

// Regeltests aus SPEC → KO (M11, M04 Nur-KO, S04) und SPEC → Einstellungen (Stufennamen).
// Geschrieben nur aus SPEC und den Festlegungen des Nutzers, ohne Kenntnis der Implementierung.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MatchSchema, buildBracket, crossSeeding, drawKnockout, koStageFor } from '../index.js';
import type { KoStage, Match, SeedRef, Slot } from '../index.js';

// ---------------------------------------------------------------------------
// Testhilfen (lokal)
// ---------------------------------------------------------------------------

/** Kleiner LCG mit festem Seed, Werte in [0, 1). Kein Math.random. */
const lcg = (seed: number): (() => number) => {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
};

const GROUPS = 'ABCDEFGHIJKLMNOP'.split('');
const gids = (n: number): string[] => GROUPS.slice(0, n);

/** 'A1' → { groupId: 'A', rank: 1 } */
const ref = (s: string): SeedRef => ({ groupId: s.slice(0, 1), rank: Number(s.slice(1)) });
const pairs = (...ps: [string, string][]): [SeedRef, SeedRef][] =>
  ps.map(([x, y]) => [ref(x), ref(y)]);
const label = (r: SeedRef): string => `${r.groupId}${r.rank}`;

const log2 = (n: number): number => Math.round(Math.log2(n));
const nextPow2 = (n: number): number => 2 ** Math.ceil(Math.log2(n));

/**
 * Runde, in der sich zwei Baumplätze (0-basiert, Platz = 2·Partie + Seite) frühestens treffen:
 * 1 = erste Runde (gleiche Partie), K = Finale bei 2^K Plätzen.
 */
const meetLevel = (x: number, y: number): number => Math.floor(Math.log2(x ^ y)) + 1;

const teamIds = (n: number): string[] =>
  Array.from({ length: n }, (_, i) => `t${String(i + 1).padStart(2, '0')}`);

const team = (id: string): Slot => ({ teamId: id });

const flatSlots = (round: readonly [Slot, Slot][]): Slot[] => round.flatMap(([a, b]) => [a, b]);

const STAGE_ORDER: KoStage[] = [
  'ko64',
  'ko32',
  'ko16',
  'quarterfinal',
  'semifinal',
  'thirdPlace',
  'final',
];

const byStage = (matches: readonly Match[], phase: KoStage): Match[] =>
  matches.filter((m) => m.phase === phase).sort((x, y) => x.position - y.position);

const at = <T>(xs: readonly T[], i: number): T => {
  const x = xs[i];
  if (x === undefined) throw new Error(`Index ${i} fehlt`);
  return x;
};

/** Erste Runde mit n Teams ohne Freilose: (t1,t2), (t3,t4), … */
const plainRound = (n: number): [Slot, Slot][] => {
  const ids = teamIds(n);
  return Array.from({ length: n / 2 }, (_, i) => [team(at(ids, 2 * i)), team(at(ids, 2 * i + 1))]);
};

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// koStageFor
// ---------------------------------------------------------------------------

describe('koStageFor – Stufenname nach verbleibenden Teams (SPEC → Einstellungen, M12)', () => {
  it.each<[number, KoStage]>([
    [64, 'ko64'],
    [32, 'ko32'],
    [16, 'ko16'],
    [8, 'quarterfinal'],
    [4, 'semifinal'],
    [2, 'final'],
  ])('SPEC Einstellungen: %i Teams → %s', (n, stage) => {
    expect(koStageFor(n)).toBe(stage);
  });
});

// ---------------------------------------------------------------------------
// crossSeeding – verbindliche Beispiele
// ---------------------------------------------------------------------------

describe('crossSeeding – verbindliche Beispiele (M11, SPEC → KO Setzregel)', () => {
  it.each<[string, number, number, [SeedRef, SeedRef][]]>([
    ['2 Gruppen, q=1', 2, 1, pairs(['A1', 'B1'])],
    ['2 Gruppen, q=2', 2, 2, pairs(['A1', 'B2'], ['B1', 'A2'])],
    ['2 Gruppen, q=4', 2, 4, pairs(['A1', 'B4'], ['A3', 'B2'], ['B1', 'A4'], ['B3', 'A2'])],
    ['4 Gruppen, q=1', 4, 1, pairs(['A1', 'B1'], ['C1', 'D1'])],
    ['4 Gruppen, q=2', 4, 2, pairs(['A1', 'B2'], ['C1', 'D2'], ['B1', 'A2'], ['D1', 'C2'])],
    ['8 Gruppen, q=1', 8, 1, pairs(['A1', 'B1'], ['C1', 'D1'], ['E1', 'F1'], ['G1', 'H1'])],
  ])('M11: %s → exakt die SPEC-Paarungen in Baumreihenfolge', (_name, g, q, expected) => {
    expect(crossSeeding(gids(g), q)).toEqual(expected);
  });

  it.each<[string, number, [SeedRef, SeedRef][]]>([
    ['1 Gruppe, q=2', 2, [[ref('A1'), ref('A2')]]],
    [
      '1 Gruppe, q=4',
      4,
      [
        [ref('A1'), ref('A4')],
        [ref('A2'), ref('A3')],
      ],
    ],
  ])('M11: %s → Pk – P(q+1−k) (SPEC-Beispiel P1–P4, P2–P3)', (_name, q, expected) => {
    expect(crossSeeding(['A'], q)).toEqual(expected);
  });

  it('M11: 1 Gruppe, q=8 → Paarungen P1–P8, P2–P7, P3–P6, P4–P5; P1 und P2 in gegenüberliegenden Hälften', () => {
    const result = crossSeeding(['A'], 8);
    expect(result).toHaveLength(4);
    const asLabels = result.map(([x, y]) => `${label(x)}-${label(y)}`).sort();
    expect(asLabels).toEqual(['A1-A8', 'A2-A7', 'A3-A6', 'A4-A5']);
    for (const [x] of result) expect(x.groupId).toBe('A');
    const pos = (rank: number) => result.findIndex(([x, y]) => x.rank === rank || y.rank === rank);
    // 4 Partien → Hälften {0,1} und {2,3}
    expect(Math.floor(pos(1) / 2)).not.toBe(Math.floor(pos(2) / 2));
  });

  it('M11: Gruppen-IDs werden übernommen, nicht neu benannt (Reihenfolge der Eingabe zählt)', () => {
    expect(crossSeeding(['X', 'Y'], 2)).toEqual([
      [
        { groupId: 'X', rank: 1 },
        { groupId: 'Y', rank: 2 },
      ],
      [
        { groupId: 'Y', rank: 1 },
        { groupId: 'X', rank: 2 },
      ],
    ]);
  });

  it('M11: deterministisch – gleiche Eingabe liefert gleiche Setzung', () => {
    expect(crossSeeding(gids(4), 2)).toEqual(crossSeeding(gids(4), 2));
  });

  it('M11: 4 Gruppen, q=2 – A1 und A2 können sich erst im Finale treffen (alle Gruppen)', () => {
    const slots = crossSeeding(gids(4), 2).flatMap(([a, b]) => [label(a), label(b)]);
    for (const g of gids(4)) {
      expect(meetLevel(slots.indexOf(`${g}1`), slots.indexOf(`${g}2`))).toBe(3);
    }
  });

  it('M11: 2 Gruppen, q=2 – A1 und A2 erst im Finale', () => {
    const slots = crossSeeding(gids(2), 2).flatMap(([a, b]) => [label(a), label(b)]);
    expect(meetLevel(slots.indexOf('A1'), slots.indexOf('A2'))).toBe(2);
    expect(meetLevel(slots.indexOf('B1'), slots.indexOf('B2'))).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// crossSeeding – Eigenschaften für alle zulässigen Kombinationen
// ---------------------------------------------------------------------------

/** Alle (Gruppen, q) mit Gruppen ≥ 2, q Zweierpotenz und Gruppen × q ≤ 64. */
const MULTI_GROUP_CASES: [number, number][] = [];
for (const g of [2, 4, 8, 16]) {
  for (let q = 1; g * q <= 64; q *= 2) MULTI_GROUP_CASES.push([g, q]);
}

describe('crossSeeding – Eigenschaften (M11, SPEC → KO Setzregel 1–3)', () => {
  it.each(MULTI_GROUP_CASES)(
    'M11: %i Gruppen, q=%i → jeder Platz 1..q jeder Gruppe genau einmal, G·q/2 Partien',
    (g, q) => {
      const result = crossSeeding(gids(g), q);
      expect(result).toHaveLength((g * q) / 2);
      const seen = result.flatMap(([a, b]) => [label(a), label(b)]).sort();
      const expected = gids(g)
        .flatMap((id) => Array.from({ length: q }, (_, k) => `${id}${k + 1}`))
        .sort();
      expect(seen).toEqual(expected);
    },
  );

  it.each(MULTI_GROUP_CASES)(
    'M11 Regel 1+2: %i Gruppen, q=%i → jede Partie Xk – Y(q+1−k) innerhalb eines Gruppenpaares (A,B), (C,D), …',
    (g, q) => {
      for (const [a, b] of crossSeeding(gids(g), q)) {
        const ia = GROUPS.indexOf(a.groupId);
        const ib = GROUPS.indexOf(b.groupId);
        expect(ia).not.toBe(ib);
        expect(Math.floor(ia / 2)).toBe(Math.floor(ib / 2));
        expect(a.rank + b.rank).toBe(q + 1);
      }
    },
  );

  it.each(MULTI_GROUP_CASES.filter(([, q]) => q >= 2))(
    'M11 Regel 3: %i Gruppen, q=%i → Platz 1 und 2 derselben Gruppe in gegenüberliegenden Baumhälften',
    (g, q) => {
      const slots = crossSeeding(gids(g), q).flatMap(([a, b]) => [label(a), label(b)]);
      const k = log2(slots.length);
      for (const id of gids(g)) {
        expect(meetLevel(slots.indexOf(`${id}1`), slots.indexOf(`${id}2`))).toBe(k);
      }
    },
  );

  it.each(MULTI_GROUP_CASES.filter(([, q]) => q >= 2))(
    'M11 Regel 3: %i Gruppen, q=%i → Teams derselben Gruppe treffen frühestens so spät wie möglich',
    (g, q) => {
      const slots = crossSeeding(gids(g), q).flatMap(([a, b]) => [label(a), label(b)]);
      const k = log2(slots.length);
      // q Teams einer Gruppe auf 2^k Plätzen: bestenfalls in getrennten Teilbäumen der Größe 2^k/q.
      const optimum = k - log2(q) + 1;
      for (const id of gids(g)) {
        const idx = slots.flatMap((s, i) => (s[0] === id ? [i] : []));
        expect(idx).toHaveLength(q);
        let earliest = Infinity;
        for (let i = 0; i < idx.length; i++) {
          for (let j = i + 1; j < idx.length; j++) {
            earliest = Math.min(earliest, meetLevel(at(idx, i), at(idx, j)));
          }
        }
        expect(earliest).toBe(optimum);
      }
    },
  );

  it.each([2, 4, 8, 16, 32, 64])(
    'M11: 1 Gruppe, q=%i → q/2 Partien Pk – P(q+1−k), jeder Platz genau einmal',
    (q) => {
      const result = crossSeeding(['A'], q);
      expect(result).toHaveLength(q / 2);
      for (const [a, b] of result) {
        expect(a.groupId).toBe('A');
        expect(b.groupId).toBe('A');
        expect(a.rank + b.rank).toBe(q + 1);
        expect(a.rank).toBeLessThan(b.rank);
      }
      const ranks = result.flatMap(([a, b]) => [a.rank, b.rank]).sort((x, y) => x - y);
      expect(ranks).toEqual(Array.from({ length: q }, (_, i) => i + 1));
    },
  );

  it.each([4, 8, 16, 32, 64])(
    'M11 Regel 3: 1 Gruppe, q=%i → P1 und P2 in gegenüberliegenden Baumhälften',
    (q) => {
      const slots = crossSeeding(['A'], q).flatMap(([a, b]) => [a.rank, b.rank]);
      expect(meetLevel(slots.indexOf(1), slots.indexOf(2))).toBe(log2(q));
    },
  );
});

// ---------------------------------------------------------------------------
// drawKnockout – Nur-KO-Losung
// ---------------------------------------------------------------------------

const DRAW_SIZES = [2, 3, 4, 5, 6, 7, 8, 9, 12, 15, 16, 17, 24, 31, 32, 33, 48, 63, 64];

describe('drawKnockout – Losung auf 2^k Plätze (M04 Nur-KO, M11 Freilose zufällig)', () => {
  it.each(DRAW_SIZES)(
    'M04/M11: %i Teams → 2^k Plätze (k minimal), jedes Team genau einmal, Lücken = Freilos (null)',
    (n) => {
      const ids = teamIds(n);
      const round = drawKnockout(ids, lcg(n));
      const size = nextPow2(n);
      expect(round).toHaveLength(size / 2);
      const slots = flatSlots(round);
      const placed = slots.flatMap((s) => (s !== null && 'teamId' in s ? [s.teamId] : []));
      expect([...placed].sort()).toEqual([...ids].sort());
      expect(slots.filter((s) => s === null)).toHaveLength(size - n);
      // nur Teams oder Freilose, keine Verweise auf andere Partien
      for (const s of slots) {
        if (s !== null) expect(Object.keys(s)).toEqual(['teamId']);
      }
    },
  );

  it.each(DRAW_SIZES)('M04: %i Teams → nie zwei Freilose in einer Partie', (n) => {
    for (let seed = 1; seed <= 25; seed++) {
      for (const [a, b] of drawKnockout(teamIds(n), lcg(seed * 7919 + n))) {
        expect(a === null && b === null).toBe(false);
      }
    }
  });

  it('M04: 6 Teams → 8 Plätze, genau 2 Freilose in zwei verschiedenen Partien', () => {
    const round = drawKnockout(teamIds(6), lcg(42));
    expect(round).toHaveLength(4);
    const byePairs = round.filter(([a, b]) => a === null || b === null);
    expect(byePairs).toHaveLength(2);
  });

  it.each([2, 4, 8, 16, 32, 64])('M04: %i Teams (2^k) → keine Freilose', (n) => {
    expect(flatSlots(drawKnockout(teamIds(n), lcg(3))).every((s) => s !== null)).toBe(true);
  });

  it('Arch. Regel 4: gleiche Zufallsfolge → gleiche Losung', () => {
    expect(drawKnockout(teamIds(13), lcg(2024))).toEqual(drawKnockout(teamIds(13), lcg(2024)));
  });

  it('Arch. Regel 4: Zufall nur aus dem übergebenen random (aufgerufen), nie Math.random', () => {
    const spy = vi.spyOn(Math, 'random');
    const base = lcg(5);
    let calls = 0;
    const random = () => {
      calls += 1;
      return base();
    };
    drawKnockout(teamIds(6), random);
    expect(calls).toBeGreaterThan(0);
    expect(spy).not.toHaveBeenCalled();
  });

  it.each<[string, () => number]>([
    ['immer 0', () => 0],
    ['immer knapp unter 1', () => 0.999_999_999],
    ['immer 0.5', () => 0.5],
  ])('M04: Randwerte von random (%s) liefern eine gültige Losung', (_name, random) => {
    for (const n of [3, 6, 7, 64]) {
      const round = drawKnockout(teamIds(n), random);
      const slots = flatSlots(round);
      expect(round).toHaveLength(nextPow2(n) / 2);
      const placed = slots.flatMap((s) => (s !== null && 'teamId' in s ? [s.teamId] : []));
      expect(new Set(placed).size).toBe(n);
      for (const [a, b] of round) expect(a === null && b === null).toBe(false);
    }
  });

  it('M04: komplett zufällig – verschiedene Seeds liefern verschiedene Losungen (Teams und Freilos-Plätze)', () => {
    const draws = Array.from({ length: 30 }, (_, i) => drawKnockout(teamIds(6), lcg(i + 1)));
    expect(new Set(draws.map((d) => JSON.stringify(d))).size).toBeGreaterThan(1);
    const byePositions = draws.map((d) =>
      JSON.stringify(flatSlots(d).flatMap((s, i) => (s === null ? [i] : []))),
    );
    expect(new Set(byePositions).size).toBeGreaterThan(1);
    const firstSlot = draws.map((d) => JSON.stringify(at(flatSlots(d), 0)));
    expect(new Set(firstSlot).size).toBeGreaterThan(1);
  });

  it('M11: Freilose immer zufällig – über viele Seeds erhält jedes der 6 Teams mindestens einmal ein Freilos', () => {
    const withBye = new Set<string>();
    for (let seed = 1; seed <= 300; seed++) {
      for (const [a, b] of drawKnockout(teamIds(6), lcg(seed))) {
        if (a === null && b !== null && 'teamId' in b) withBye.add(b.teamId);
        if (b === null && a !== null && 'teamId' in a) withBye.add(a.teamId);
      }
    }
    expect([...withBye].sort()).toEqual(teamIds(6));
  });

  it('M04: Eingabe wird nicht verändert', () => {
    const ids = teamIds(7);
    const copy = [...ids];
    drawKnockout(ids, lcg(9));
    expect(ids).toEqual(copy);
  });
});

// ---------------------------------------------------------------------------
// buildBracket – vollständiger Baum (ADR 025)
// ---------------------------------------------------------------------------

/** Prüft die Struktur aller Stufen ab der ersten Runde. */
const expectTreeStructure = (matches: readonly Match[], firstRound: readonly [Slot, Slot][]) => {
  const teams = firstRound.length * 2;
  let prev: Match[] = [];
  for (let k = teams; k >= 2; k /= 2) {
    const stage = koStageFor(k);
    const ms = byStage(matches, stage);
    expect(ms).toHaveLength(k / 2);
    ms.forEach((m, i) => {
      expect(m.position).toBe(i + 1);
      expect(m.round).toBe(1);
      expect(m.groupId).toBeNull();
      if (k === teams) {
        const [a, b] = at(firstRound, i);
        expect(m.a).toEqual(a);
        expect(m.b).toEqual(b);
        expect(m.bye).toBe(a === null || b === null);
      } else {
        expect(m.a).toEqual({ winnerOf: at(prev, 2 * i).id });
        expect(m.b).toEqual({ winnerOf: at(prev, 2 * i + 1).id });
        expect(m.bye).toBe(false);
      }
    });
    prev = ms;
  }
};

describe('buildBracket – Struktur aller Stufen (M11, ADR 025)', () => {
  it('M11: 4 Teams ohne Platz 3 → Halbfinale 1/2 + Finale aus den Siegern', () => {
    const first = plainRound(4);
    const matches = buildBracket(first, false);
    expect(matches).toHaveLength(3);
    const [sf1, sf2] = byStage(matches, 'semifinal') as [Match, Match];
    const [fin] = byStage(matches, 'final') as [Match];
    expect(sf1).toMatchObject({
      phase: 'semifinal',
      round: 1,
      position: 1,
      groupId: null,
      bye: false,
    });
    expect(sf1.a).toEqual({ teamId: 't01' });
    expect(sf1.b).toEqual({ teamId: 't02' });
    expect(sf2).toMatchObject({ position: 2, a: { teamId: 't03' }, b: { teamId: 't04' } });
    expect(fin).toMatchObject({ phase: 'final', round: 1, position: 1, groupId: null, bye: false });
    expect(fin.a).toEqual({ winnerOf: sf1.id });
    expect(fin.b).toEqual({ winnerOf: sf2.id });
    expect(byStage(matches, 'thirdPlace')).toHaveLength(0);
  });

  it('S04: 4 Teams mit Platz 3 → zusätzlich Partie thirdPlace mit loserOf Halbfinale 1/2', () => {
    const matches = buildBracket(plainRound(4), true);
    expect(matches).toHaveLength(4);
    const [sf1, sf2] = byStage(matches, 'semifinal') as [Match, Match];
    const p3 = byStage(matches, 'thirdPlace');
    expect(p3).toHaveLength(1);
    expect(p3[0]).toMatchObject({ phase: 'thirdPlace', round: 1, groupId: null, bye: false });
    expect(p3[0]?.position).toBe(1);
    expect(p3[0]?.a).toEqual({ loserOf: sf1.id });
    expect(p3[0]?.b).toEqual({ loserOf: sf2.id });
  });

  it.each([4, 8, 16, 32, 64])(
    'S04: %i Teams – Platz 3 an/aus ändert nur die Platz-3-Partie',
    (n) => {
      const without = buildBracket(plainRound(n), false);
      const withP3 = buildBracket(plainRound(n), true);
      expect(withP3).toHaveLength(without.length + 1);
      const rest = withP3.filter((m) => m.phase !== 'thirdPlace');
      expect(rest).toHaveLength(without.length);
      expect(rest).toEqual(expect.arrayContaining(without));
      expect(byStage(withP3, 'thirdPlace')).toHaveLength(1);
    },
  );

  it('M11/S04: 2 Teams → nur das Finale; ohne Halbfinale gibt es auch mit thirdPlace kein Spiel um Platz 3', () => {
    for (const thirdPlace of [false, true]) {
      const matches = buildBracket(plainRound(2), thirdPlace);
      expect(matches).toHaveLength(1);
      expect(matches[0]).toMatchObject({
        phase: 'final',
        round: 1,
        position: 1,
        a: { teamId: 't01' },
        b: { teamId: 't02' },
        bye: false,
      });
    }
  });

  it.each([2, 4, 8, 16, 32, 64])(
    'M11: %i Teams → alle Stufen; Partie i der Folgestufe = Sieger von 2i−1 und 2i',
    (n) => {
      const first = plainRound(n);
      const matches = buildBracket(first, false);
      expect(matches).toHaveLength(n - 1);
      expectTreeStructure(matches, first);
    },
  );

  it('M11: 64 Teams mit Platz 3 → Anzahl je Stufe 32/16/8/4/2/1 + 1', () => {
    const matches = buildBracket(plainRound(64), true);
    const counts = Object.fromEntries(
      STAGE_ORDER.map((s) => [s, matches.filter((m) => m.phase === s).length]),
    );
    expect(counts).toEqual({
      ko64: 32,
      ko32: 16,
      ko16: 8,
      quarterfinal: 4,
      semifinal: 2,
      thirdPlace: 1,
      final: 1,
    });
  });

  it.each([3, 5, 6, 7, 12, 33])(
    'M11/M04: %i Teams aus drawKnockout → Freilos-Partien bye: true, alle anderen bye: false',
    (n) => {
      const first = drawKnockout(teamIds(n), lcg(n * 13));
      const matches = buildBracket(first, true);
      expectTreeStructure(matches, first);
      const firstStage = koStageFor(nextPow2(n));
      const byes = matches.filter((m) => m.bye);
      expect(byes).toHaveLength(nextPow2(n) - n);
      for (const m of byes) {
        expect(m.phase).toBe(firstStage);
        expect(m.a === null || m.b === null).toBe(true);
      }
      for (const m of matches.filter((x) => x.phase !== firstStage)) expect(m.bye).toBe(false);
    },
  );

  it('M04: 6 Teams mit Freilosen (Pflichtfall) → 4 Viertelfinals (2 Freilos), 2 Halbfinals, Finale', () => {
    const first: [Slot, Slot][] = [
      [team('t1'), null],
      [team('t2'), team('t3')],
      [team('t4'), team('t5')],
      [null, team('t6')],
    ];
    const matches = buildBracket(first, false);
    const qf = byStage(matches, 'quarterfinal');
    expect(qf.map((m) => m.bye)).toEqual([true, false, false, true]);
    expect(byStage(matches, 'semifinal')).toHaveLength(2);
    expect(byStage(matches, 'final')).toHaveLength(1);
    expect(matches).toHaveLength(7);
  });

  it.each([2, 4, 8, 64])('ADR 025: %i Teams → IDs eindeutig und deterministisch', (n) => {
    const a = buildBracket(plainRound(n), true);
    const b = buildBracket(plainRound(n), true);
    expect(new Set(a.map((m) => m.id)).size).toBe(a.length);
    expect(a).toEqual(b);
  });

  it('ADR 025: alle Verweise (winnerOf/loserOf) zeigen auf Partien desselben Baums', () => {
    const matches = buildBracket(drawKnockout(teamIds(11), lcg(77)), true);
    const idSet = new Set(matches.map((m) => m.id));
    for (const m of matches) {
      for (const s of [m.a, m.b]) {
        if (s !== null && 'winnerOf' in s) expect(idSet.has(s.winnerOf)).toBe(true);
        if (s !== null && 'loserOf' in s) expect(idSet.has(s.loserOf)).toBe(true);
      }
    }
  });

  it('ADR 025: jede Partie erfüllt das Match-Schema', () => {
    for (const m of buildBracket(drawKnockout(teamIds(20), lcg(4)), true)) {
      expect(MatchSchema.safeParse(m).success).toBe(true);
    }
  });

  it('M11: Eingabe wird nicht verändert', () => {
    const first = plainRound(8);
    const copy = JSON.parse(JSON.stringify(first)) as unknown;
    buildBracket(first, true);
    expect(first).toEqual(copy);
  });
});

// Regeltests aus SPEC „Ergebnis → Punkte“, „Tabelle“, „Stechen“ (M07, M08, M09, S01).
// Fixtures werden als Ereignisse (TournamentStarted, HeatStarted, ResultRecorded, PlayoffRecorded,
// Undone) direkt gebaut und per apply eingespielt; geprüft wird nur computeStandings / pointsFor.
import { describe, expect, it } from 'vitest';
import {
  DomainEventSchema,
  apply,
  computeStandings,
  decide,
  initialState,
  pointsFor,
} from '../index.js';
import type {
  Command,
  Cups,
  DecideContext,
  DomainEvent,
  DomainEventType,
  EventOf,
  GroupStandings,
  Heat,
  Match,
  MatchResult,
  NewEvent,
  Outcome,
  RankReason,
  TournamentState,
} from '../index.js';

// ---------------------------------------------------------------------------
// Testhilfen (lokal)
// ---------------------------------------------------------------------------

const T0 = 1_767_225_600_000; // 2026-01-01T00:00:00Z, feste Zeit

interface GroupSpec {
  id: string;
  teams: string[];
}

class Fixture {
  state: TournamentState = initialState();
  private seq = 0;
  private clock = T0;
  private nextId = 0;
  readonly matches: Match[] = [];
  readonly heats: Heat[] = [];
  private readonly started = new Set<string>();

  ctx(): DecideContext {
    this.clock += 1_000;
    return { now: this.clock, random: () => 0.5, newId: () => `id-${++this.nextId}` };
  }

  run(command: Command): void {
    const r = decide(this.state, command, this.ctx());
    if (!r.ok) throw new Error(`${command.type}: ${r.error.code} – ${r.error.message}`);
    for (const e of r.value) this.append(e);
  }

  append(e: NewEvent): DomainEvent {
    this.seq += 1;
    const event = DomainEventSchema.parse({ ...e, seq: this.seq });
    this.state = apply(this.state, event);
    return event;
  }

  push<T extends Exclude<DomainEventType, 'Undone'>>(
    type: T,
    payload: EventOf<T>['payload'],
  ): EventOf<T> {
    const ctx = this.ctx();
    const raw = { id: `e-${this.seq + 1}`, type, v: 1, at: ctx.now, payload };
    return this.append(raw as unknown as NewEvent) as EventOf<T>;
  }

  pushUndone(undoes: string, cascade: string[] = []): EventOf<'Undone'> {
    const ctx = this.ctx();
    const raw = {
      id: `e-${this.seq + 1}`,
      type: 'Undone',
      v: 1,
      at: ctx.now,
      undoes,
      payload: { cascade },
    };
    return this.append(raw as unknown as NewEvent) as EventOf<'Undone'>;
  }

  matchBetween(x: string, y: string): Match {
    const m = this.matches.find(
      (mm) =>
        !mm.bye &&
        mm.a !== null &&
        mm.b !== null &&
        'teamId' in mm.a &&
        'teamId' in mm.b &&
        ((mm.a.teamId === x && mm.b.teamId === y) || (mm.a.teamId === y && mm.b.teamId === x)),
    );
    if (!m) throw new Error(`keine Partie ${x}–${y}`);
    return m;
  }

  private ensureHeatStarted(matchId: string): void {
    const heat = this.heats.find((h) => h.matchIds.includes(matchId));
    if (!heat) throw new Error(`kein Durchgang für ${matchId}`);
    if (this.started.has(heat.id)) return;
    this.started.add(heat.id);
    this.push('HeatStarted', { heatId: heat.id, durationMs: 900_000 });
  }

  /**
   * Ergebnis aus Sicht von x gegen y. `cups` = [Becher von x, Becher von y];
   * wird auf die Slots a/b der Partie abgebildet.
   */
  result(
    x: string,
    y: string,
    outcome: Outcome,
    winner?: string,
    cups?: [number, number],
  ): EventOf<'ResultRecorded'> {
    const m = this.matchBetween(x, y);
    this.ensureHeatStarted(m.id);
    const aIsX = m.a !== null && 'teamId' in m.a && m.a.teamId === x;
    const payload: EventOf<'ResultRecorded'>['payload'] = { matchId: m.id, outcome };
    if (winner !== undefined) payload.winnerTeamId = winner;
    if (cups) payload.cups = aIsX ? { a: cups[0], b: cups[1] } : { a: cups[1], b: cups[0] };
    return this.push('ResultRecorded', payload);
  }

  /** Ergebnis mit Becherwerten direkt in Slot-Sicht (cups.a gehört zu Slot a). */
  rawResult(matchId: string, outcome: Outcome, winner: string | undefined, cups?: Cups) {
    this.ensureHeatStarted(matchId);
    const payload: EventOf<'ResultRecorded'>['payload'] = { matchId, outcome };
    if (winner !== undefined) payload.winnerTeamId = winner;
    if (cups) payload.cups = cups;
    return this.push('ResultRecorded', payload);
  }

  playoff(groupId: string, tiedTeamIds: string[], winnerTeamId: string) {
    return this.push('PlayoffRecorded', { groupId, tiedTeamIds, winnerTeamId });
  }

  standings(groupId: string): GroupStandings {
    return computeStandings(this.state, groupId);
  }
}

/**
 * Gestartetes Turnier: jede Gruppe jeder gegen jeden (Slot a = früheres Team in der Liste),
 * bei ungerader Größe ein Freilos je Team. Jede echte Partie liegt in einem eigenen Durchgang.
 */
function started(groups: GroupSpec[], q: number, trackCups = false): Fixture {
  const f = new Fixture();
  f.run({
    type: 'createTournament',
    name: 'Tabellentest',
    settings: { trackCups, groupCount: groups.length as 1 | 2 | 4 | 8 | 16 },
  });
  f.run({ type: 'setTableCount', tableCount: 1 });
  for (const g of groups) {
    for (const t of g.teams) {
      f.push('TeamAdded', { teamId: t, name: `Team ${t}`, players: [`Spieler ${t}`] });
    }
  }
  for (const g of groups) {
    for (const t of g.teams) f.push('TeamAssignedToGroup', { teamId: t, groupId: g.id });
  }
  groups.forEach((g, gi) => {
    let round = 0;
    for (let i = 0; i < g.teams.length; i++) {
      for (let j = i + 1; j < g.teams.length; j++) {
        round += 1;
        const id = `${g.id}-${g.teams[i]}-${g.teams[j]}`;
        f.matches.push({
          id,
          phase: 'group',
          round,
          position: 1,
          groupId: g.id,
          a: { teamId: g.teams[i] as string },
          b: { teamId: g.teams[j] as string },
          bye: false,
        });
        f.heats.push({ id: `H-${id}`, phase: 'group', round, index: gi + 1, matchIds: [id] });
      }
    }
    if (g.teams.length % 2 === 1) {
      g.teams.forEach((t, k) => {
        f.matches.push({
          id: `${g.id}-bye-${t}`,
          phase: 'group',
          round: round + k + 1,
          position: 1,
          groupId: g.id,
          a: { teamId: t },
          b: null,
          bye: true,
        });
      });
    }
  });
  f.push('TournamentStarted', {
    groups: groups.map((g) => ({ id: g.id, teamIds: [...g.teams] })),
    advancersPerGroup: q,
    matches: f.matches,
    heats: f.heats,
  });
  return f;
}

type RankLine = [teamId: string, rank: number, reason: RankReason];

const ranking = (s: GroupStandings): RankLine[] =>
  s.rows.map((r) => [r.teamId, r.rank, r.rankReason]);

const points = (s: GroupStandings): Record<string, number> =>
  Object.fromEntries(s.rows.map((r) => [r.teamId, r.points]));

/** needsPlayoff als Menge von Mengen vergleichen. */
const playoffSets = (s: GroupStandings): string[][] =>
  s.needsPlayoff.map((set) => [...set].sort()).sort((x, y) => x.join().localeCompare(y.join()));

const row = (s: GroupStandings, teamId: string) => {
  const r = s.rows.find((rr) => rr.teamId === teamId);
  if (!r) throw new Error(`keine Zeile für ${teamId}`);
  return r;
};

const G4 = (q = 2) => started([{ id: 'A', teams: ['T1', 'T2', 'T3', 'T4'] }], q);
const G4cups = (q = 2) => started([{ id: 'A', teams: ['T1', 'T2', 'T3', 'T4'] }], q, true);

// ---------------------------------------------------------------------------
// M08: pointsFor
// ---------------------------------------------------------------------------

describe('M08: Punkte je Ergebnis (SPEC Ergebnis → Punkte)', () => {
  it.each<[string, MatchResult, number, number]>([
    ['win → 3 / 0', { outcome: 'win', winnerTeamId: 'T1' }, 3, 0],
    ['winByTime → 2 / 0', { outcome: 'winByTime', winnerTeamId: 'T1' }, 2, 0],
    ['draw → 1 / 1', { outcome: 'draw' }, 1, 1],
    [
      'win mit Bechern → 3 / 0',
      { outcome: 'win', winnerTeamId: 'T1', cups: { a: 10, b: 4 } },
      3,
      0,
    ],
    ['draw mit Bechern → 1 / 1', { outcome: 'draw', cups: { a: 5, b: 5 } }, 1, 1],
  ])('M08: %s (Sieger T1, Gegner T2)', (_name, result, forT1, forT2) => {
    expect(pointsFor(result, 'T1')).toBe(forT1);
    expect(pointsFor(result, 'T2')).toBe(forT2);
  });

  it('M08: Sieger in Slot b – winByTime für T2 → T2 2, T1 0', () => {
    const r: MatchResult = { outcome: 'winByTime', winnerTeamId: 'T2' };
    expect(pointsFor(r, 'T2')).toBe(2);
    expect(pointsFor(r, 'T1')).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Tabelle: Grundwerte
// ---------------------------------------------------------------------------

describe('M07/M08: Tabellenzeile (SPEC Tabelle)', () => {
  /** T1 6, T4 4, T2 3, T3 1 – alle durch Punkte getrennt. */
  const distinct = () => {
    const f = G4();
    f.result('T1', 'T2', 'win', 'T1');
    f.result('T1', 'T3', 'winByTime', 'T1');
    f.result('T1', 'T4', 'draw');
    f.result('T2', 'T3', 'win', 'T2');
    f.result('T2', 'T4', 'winByTime', 'T4');
    f.result('T3', 'T4', 'draw');
    return f;
  };

  it('M08: Gesamtpunktzahl 3/2/1/0 und Sortierung nach Punkten, rankReason points', () => {
    const s = distinct().standings('A');
    expect(s.groupId).toBe('A');
    expect(points(s)).toEqual({ T1: 6, T2: 3, T3: 1, T4: 4 });
    expect(ranking(s)).toEqual([
      ['T1', 1, 'points'],
      ['T4', 2, 'points'],
      ['T2', 3, 'points'],
      ['T3', 4, 'points'],
    ]);
    expect(s.complete).toBe(true);
    expect(s.needsPlayoff).toEqual([]);
  });

  it('M07: played/wins/winsByTime/draws/losses je Ergebnisart; Niederlage nach Zeit zählt als loss', () => {
    const s = distinct().standings('A');
    expect(row(s, 'T1')).toMatchObject({ played: 3, wins: 1, winsByTime: 1, draws: 1, losses: 0 });
    expect(row(s, 'T4')).toMatchObject({ played: 3, wins: 0, winsByTime: 1, draws: 2, losses: 0 });
    expect(row(s, 'T2')).toMatchObject({ played: 3, wins: 1, winsByTime: 0, draws: 0, losses: 2 });
    expect(row(s, 'T3')).toMatchObject({ played: 3, wins: 0, winsByTime: 0, draws: 1, losses: 2 });
  });

  it('S01: ohne trackCups fehlt das Feld cupDiff in jeder Zeile', () => {
    const s = distinct().standings('A');
    for (const r of s.rows) expect('cupDiff' in r).toBe(false);
  });

  it('M08: Sieg durch Zeit zählt weniger als Sieg – 2× winByTime (4) vor 1× win + 0 (3)', () => {
    const f = started([{ id: 'A', teams: ['T1', 'T2', 'T3'] }], 1);
    f.result('T1', 'T2', 'winByTime', 'T1');
    f.result('T1', 'T3', 'winByTime', 'T1');
    f.result('T2', 'T3', 'win', 'T2');
    const s = f.standings('A');
    expect(points(s)).toEqual({ T1: 4, T2: 3, T3: 0 });
    expect(ranking(s).map(([t]) => t)).toEqual(['T1', 'T2', 'T3']);
  });

  it('M09: unvollständige Gruppe → Tabelle aus vorhandenen Ergebnissen, complete = false', () => {
    const f = G4();
    f.result('T1', 'T2', 'win', 'T1');
    f.result('T3', 'T4', 'winByTime', 'T4');
    const s = f.standings('A');
    expect(s.complete).toBe(false);
    expect(s.rows).toHaveLength(4);
    expect(points(s)).toEqual({ T1: 3, T2: 0, T3: 0, T4: 2 });
    expect(row(s, 'T1')).toMatchObject({ played: 1, wins: 1, rank: 1 });
    expect(row(s, 'T4')).toMatchObject({ played: 1, winsByTime: 1, rank: 2 });
    expect(row(s, 'T2').played).toBe(1);
  });

  it('M09: ohne jedes Ergebnis → alle Zeilen mit 0, complete = false', () => {
    const s = G4().standings('A');
    expect(s.complete).toBe(false);
    expect(s.rows.map((r) => r.teamId).sort()).toEqual(['T1', 'T2', 'T3', 'T4']);
    for (const r of s.rows) {
      expect(r).toMatchObject({
        played: 0,
        wins: 0,
        winsByTime: 0,
        draws: 0,
        losses: 0,
        points: 0,
      });
    }
  });
});

// ---------------------------------------------------------------------------
// Freilose, Gruppengrößen
// ---------------------------------------------------------------------------

describe('M06/M08: Freilose und Gruppengrößen', () => {
  it('M08: Freilos zählt 0 Punkte und nicht als played (3er-Gruppe)', () => {
    const f = started([{ id: 'A', teams: ['T1', 'T2', 'T3'] }], 1);
    f.result('T1', 'T2', 'win', 'T1');
    f.result('T1', 'T3', 'win', 'T1');
    f.result('T2', 'T3', 'win', 'T2');
    const s = f.standings('A');
    expect(points(s)).toEqual({ T1: 6, T2: 3, T3: 0 });
    for (const r of s.rows) {
      expect(r.played).toBe(2);
      expect(r.wins + r.winsByTime + r.draws + r.losses).toBe(2);
    }
    expect(ranking(s)).toEqual([
      ['T1', 1, 'points'],
      ['T2', 2, 'points'],
      ['T3', 3, 'points'],
    ]);
  });

  it('M06: Freilos-Partien zählen nicht für complete (3er-Gruppe, alle echten Partien gespielt)', () => {
    const f = started([{ id: 'A', teams: ['T1', 'T2', 'T3'] }], 1);
    f.result('T1', 'T2', 'win', 'T1');
    f.result('T1', 'T3', 'win', 'T1');
    expect(f.standings('A').complete).toBe(false);
    f.result('T2', 'T3', 'win', 'T2');
    expect(f.standings('A').complete).toBe(true);
  });

  it.each([2, 3, 4, 5])('M06/M08: Gruppe mit %i Teams – alle Zeilen, played = n − 1', (n) => {
    const teams = Array.from({ length: n }, (_, i) => `T${i + 1}`);
    const f = started([{ id: 'A', teams }], 1);
    // Team mit kleinerem Index gewinnt immer → Punkte 3·(n−1−i), strikt fallend
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++)
        f.result(teams[i] as string, teams[j] as string, 'win', teams[i]);
    }
    const s = f.standings('A');
    expect(s.complete).toBe(true);
    expect(s.rows.map((r) => r.teamId)).toEqual(teams);
    s.rows.forEach((r, i) => {
      expect(r.played).toBe(n - 1);
      expect(r.points).toBe(3 * (n - 1 - i));
      expect(r.rank).toBe(i + 1);
      expect(r.rankReason).toBe('points');
    });
    expect(s.needsPlayoff).toEqual([]);
  });

  it('M06: ungleiche Gruppengrößen – Ergebnisse anderer Gruppen fließen nicht ein', () => {
    const f = started(
      [
        { id: 'A', teams: ['A1', 'A2', 'A3'] },
        { id: 'B', teams: ['B1', 'B2'] },
      ],
      1,
    );
    f.result('A1', 'A2', 'win', 'A2');
    f.result('A1', 'A3', 'win', 'A1');
    f.result('A2', 'A3', 'win', 'A2');
    f.result('B1', 'B2', 'winByTime', 'B1');
    const a = f.standings('A');
    const b = f.standings('B');
    expect(a.rows.map((r) => r.teamId)).toEqual(['A2', 'A1', 'A3']);
    expect(b.rows.map((r) => r.teamId)).toEqual(['B1', 'B2']);
    expect(points(b)).toEqual({ B1: 2, B2: 0 });
    expect(row(b, 'B1').played).toBe(1);
    expect(a.complete && b.complete).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// M09: direkter Vergleich
// ---------------------------------------------------------------------------

describe('M09: direkter Vergleich (Mini-Tabelle)', () => {
  /** T1 6, T2 6, T3 3, T4 3; T1 schlägt T2, T4 schlägt T3. */
  const twoPairs = (cups: boolean) => {
    const f = cups ? G4cups() : G4();
    const c = (x: number, y: number): [number, number] | undefined => (cups ? [x, y] : undefined);
    f.result('T1', 'T2', 'win', 'T1', c(10, 9));
    f.result('T2', 'T3', 'win', 'T2', c(10, 0));
    f.result('T2', 'T4', 'win', 'T2', c(10, 0));
    f.result('T1', 'T3', 'win', 'T3', c(9, 10));
    f.result('T1', 'T4', 'win', 'T1', c(10, 9));
    f.result('T3', 'T4', 'win', 'T4', c(9, 10));
    return f;
  };

  it('M09: Punktgleichheit zweier Teams – direkter Vergleich entscheidet (zwei Paare)', () => {
    const s = twoPairs(false).standings('A');
    expect(points(s)).toEqual({ T1: 6, T2: 6, T3: 3, T4: 3 });
    expect(ranking(s)).toEqual([
      ['T1', 1, 'headToHead'],
      ['T2', 2, 'headToHead'],
      ['T4', 3, 'headToHead'],
      ['T3', 4, 'headToHead'],
    ]);
    expect(s.needsPlayoff).toEqual([]);
  });

  it('M09: direkter Vergleich geht vor Becherdifferenz (T1 schlechtere cupDiff, gewinnt aber direkt)', () => {
    const s = twoPairs(true).standings('A');
    expect(row(s, 'T1').cupDiff).toBe(1);
    expect(row(s, 'T2').cupDiff).toBe(19);
    expect(ranking(s).slice(0, 2)).toEqual([
      ['T1', 1, 'headToHead'],
      ['T2', 2, 'headToHead'],
    ]);
  });

  it('M09: Teilauflösung – 4 Teams punktgleich, Mini-Tabelle trennt T1 ab, Rest rekursiv nur unter sich', () => {
    // 5er-Gruppe (mit Freilosen). T1..T4 je 4 Punkte, T5 6 Punkte.
    // Mini-Tabelle T1..T4: T1 4, T2/T3/T4 je 3 → T1 vorn.
    // Mini-Tabelle nur T2/T3/T4: T2 3, T3 2, T4 1 → vollständig getrennt.
    const f = started([{ id: 'A', teams: ['T1', 'T2', 'T3', 'T4', 'T5'] }], 2);
    f.result('T1', 'T2', 'win', 'T1');
    f.result('T1', 'T3', 'draw');
    f.result('T1', 'T4', 'winByTime', 'T4');
    f.result('T1', 'T5', 'win', 'T5');
    f.result('T2', 'T3', 'draw');
    f.result('T2', 'T4', 'winByTime', 'T2');
    f.result('T2', 'T5', 'draw');
    f.result('T3', 'T4', 'draw');
    f.result('T3', 'T5', 'draw');
    f.result('T4', 'T5', 'draw');
    const s = f.standings('A');
    expect(points(s)).toEqual({ T1: 4, T2: 4, T3: 4, T4: 4, T5: 6 });
    expect(ranking(s)).toEqual([
      ['T5', 1, 'points'],
      ['T1', 2, 'headToHead'],
      ['T2', 3, 'headToHead'],
      ['T3', 4, 'headToHead'],
      ['T4', 5, 'headToHead'],
    ]);
    expect(s.needsPlayoff).toEqual([]);
    for (const r of s.rows) expect(r.played).toBe(4);
  });

  /** T1/T2 7 Punkte, direkter Vergleich unentschieden; T3 3, T4 0. */
  const topDraw = (q: number) => {
    const f = G4(q);
    f.result('T1', 'T2', 'draw');
    f.result('T1', 'T3', 'win', 'T1');
    f.result('T1', 'T4', 'win', 'T1');
    f.result('T2', 'T3', 'win', 'T2');
    f.result('T2', 'T4', 'win', 'T2');
    f.result('T3', 'T4', 'win', 'T3');
    return f;
  };

  it('M09: Gleichstand ganz innerhalb der Weiterkommenden (Platz 1–2, q = 2) → tied, geteilter Rang, kein needsPlayoff', () => {
    const s = topDraw(2).standings('A');
    expect(ranking(s)).toEqual([
      ['T1', 1, 'tied'],
      ['T2', 1, 'tied'],
      ['T3', 3, 'points'],
      ['T4', 4, 'points'],
    ]);
    expect(s.needsPlayoff).toEqual([]);
    expect(s.complete).toBe(true);
  });

  it('M09: Kreis aller drei auf Platz 1–3 bei q = 4 (alle kommen weiter) → tied, kein needsPlayoff', () => {
    const f = G4(4);
    f.result('T1', 'T2', 'win', 'T1');
    f.result('T2', 'T3', 'win', 'T2');
    f.result('T3', 'T1', 'win', 'T3');
    f.result('T1', 'T4', 'win', 'T1');
    f.result('T2', 'T4', 'win', 'T2');
    f.result('T3', 'T4', 'win', 'T3');
    const s = f.standings('A');
    expect(ranking(s)).toEqual([
      ['T1', 1, 'tied'],
      ['T2', 1, 'tied'],
      ['T3', 1, 'tied'],
      ['T4', 4, 'points'],
    ]);
    expect(s.needsPlayoff).toEqual([]);
  });

  it('M09: Unentschieden im direkten Vergleich ohne Becher über die q-Grenze (Platz 1–2, q = 1) → needsPlayoff, geteilter Platz tied', () => {
    const s = topDraw(1).standings('A');
    expect(points(s)).toEqual({ T1: 7, T2: 7, T3: 3, T4: 0 });
    expect(ranking(s)).toEqual([
      ['T1', 1, 'tied'],
      ['T2', 1, 'tied'],
      ['T3', 3, 'points'],
      ['T4', 4, 'points'],
    ]);
    expect(playoffSets(s)).toEqual([['T1', 'T2']]);
    expect(s.complete).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// M09 / S01: Becherdifferenz
// ---------------------------------------------------------------------------

describe('M09/S01: Becherdifferenz', () => {
  it('S01: cupDiff = Summe getroffen − kassiert; cups.a gehört zu Slot a', () => {
    const f = started([{ id: 'A', teams: ['T1', 'T2'] }], 1, true);
    // Partie A-T1-T2: Slot a = T1, Slot b = T2. T2 gewinnt 10:3.
    f.rawResult('A-T1-T2', 'win', 'T2', { a: 3, b: 10 });
    const s = f.standings('A');
    expect(row(s, 'T1').cupDiff).toBe(-7);
    expect(row(s, 'T2').cupDiff).toBe(7);
    expect(ranking(s)).toEqual([
      ['T2', 1, 'points'],
      ['T1', 2, 'points'],
    ]);
  });

  it('S01: cupDiff summiert über alle Gruppenpartien, Summe der Gruppe = 0', () => {
    const f = G4cups();
    f.result('T1', 'T2', 'draw', undefined, [4, 4]);
    f.result('T1', 'T3', 'win', 'T1', [10, 3]);
    f.result('T1', 'T4', 'win', 'T1', [10, 5]);
    f.result('T2', 'T3', 'win', 'T2', [10, 2]);
    f.result('T2', 'T4', 'win', 'T2', [10, 1]);
    f.result('T3', 'T4', 'win', 'T3', [10, 8]);
    const s = f.standings('A');
    expect(Object.fromEntries(s.rows.map((r) => [r.teamId, r.cupDiff]))).toEqual({
      T1: 12,
      T2: 17,
      T3: -13,
      T4: -16,
    });
    // Unentschieden im direkten Vergleich, dann Becherdifferenz
    expect(ranking(s)).toEqual([
      ['T2', 1, 'cupDiff'],
      ['T1', 2, 'cupDiff'],
      ['T3', 3, 'points'],
      ['T4', 4, 'points'],
    ]);
    expect(s.needsPlayoff).toEqual([]);
  });

  it('S01: unvollständige Gruppe – cupDiff nur aus erfassten Partien, unbespielte Teams 0', () => {
    const f = G4cups();
    f.result('T1', 'T2', 'win', 'T1', [10, 6]);
    const s = f.standings('A');
    expect(row(s, 'T1').cupDiff).toBe(4);
    expect(row(s, 'T2').cupDiff).toBe(-4);
    expect(row(s, 'T3').cupDiff).toBe(0);
    expect(row(s, 'T4').cupDiff).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// M09: Dreiervergleich im Kreis
// ---------------------------------------------------------------------------

describe('M09: Dreiervergleich im Kreis (T1 > T2, T2 > T3, T3 > T1; alle schlagen T4)', () => {
  type C = [number, number] | undefined;
  const circle = (cups: { x12: C; x23: C; x31: C; x14: C; x24: C; x34: C } | null, q = 2) => {
    const f = cups ? G4cups(q) : G4(q);
    f.result('T1', 'T2', 'win', 'T1', cups?.x12);
    f.result('T2', 'T3', 'win', 'T2', cups?.x23);
    f.result('T3', 'T1', 'win', 'T3', cups?.x31);
    f.result('T1', 'T4', 'win', 'T1', cups?.x14);
    f.result('T2', 'T4', 'win', 'T2', cups?.x24);
    f.result('T3', 'T4', 'win', 'T3', cups?.x34);
    return f;
  };

  it('M09: ohne Becherdifferenz → needsPlayoff [T1,T2,T3], alle Rang 1 tied', () => {
    const s = circle(null).standings('A');
    expect(points(s)).toEqual({ T1: 6, T2: 6, T3: 6, T4: 0 });
    expect(ranking(s)).toEqual([
      ['T1', 1, 'tied'],
      ['T2', 1, 'tied'],
      ['T3', 1, 'tied'],
      ['T4', 4, 'points'],
    ]);
    expect(playoffSets(s)).toEqual([['T1', 'T2', 'T3']]);
    expect(s.complete).toBe(true);
  });

  it('M09/S01: mit Becherdifferenz → vollständig per cupDiff getrennt', () => {
    const s = circle({
      x12: [10, 2],
      x23: [10, 5],
      x31: [10, 7],
      x14: [10, 0],
      x24: [10, 0],
      x34: [10, 0],
    }).standings('A');
    expect(Object.fromEntries(s.rows.map((r) => [r.teamId, r.cupDiff]))).toEqual({
      T1: 15,
      T2: 7,
      T3: 8,
      T4: -30,
    });
    expect(ranking(s)).toEqual([
      ['T1', 1, 'cupDiff'],
      ['T3', 2, 'cupDiff'],
      ['T2', 3, 'cupDiff'],
      ['T4', 4, 'points'],
    ]);
    expect(s.needsPlayoff).toEqual([]);
  });

  it('M09/S01: Becherdifferenz trennt nur T1 ab, Rest T2/T3 erneut ab Mini-Tabelle → headToHead', () => {
    const s = circle({
      x12: [10, 8],
      x23: [10, 8],
      x31: [10, 8],
      x14: [10, 0],
      x24: [10, 5],
      x34: [10, 5],
    }).standings('A');
    expect(Object.fromEntries(s.rows.map((r) => [r.teamId, r.cupDiff]))).toEqual({
      T1: 10,
      T2: 5,
      T3: 5,
      T4: -20,
    });
    expect(ranking(s)).toEqual([
      ['T1', 1, 'cupDiff'],
      ['T2', 2, 'headToHead'],
      ['T3', 3, 'headToHead'],
      ['T4', 4, 'points'],
    ]);
    expect(s.needsPlayoff).toEqual([]);
  });

  it('M09/S01: gleiche Becherdifferenz im Kreis → needsPlayoff trotz trackCups', () => {
    const s = circle({
      x12: [10, 8],
      x23: [10, 8],
      x31: [10, 8],
      x14: [10, 0],
      x24: [10, 0],
      x34: [10, 0],
    }).standings('A');
    for (const t of ['T1', 'T2', 'T3'])
      expect(row(s, t)).toMatchObject({ rank: 1, rankReason: 'tied', cupDiff: 10 });
    expect(playoffSets(s)).toEqual([['T1', 'T2', 'T3']]);
  });

  it('M09/Stechen: Sieger T2 → Platz 1 playoff; T1/T3 erneut ab Mini-Tabelle (T3 schlug T1)', () => {
    const f = circle(null);
    f.playoff('A', ['T1', 'T2', 'T3'], 'T2');
    const s = f.standings('A');
    expect(ranking(s)).toEqual([
      ['T2', 1, 'playoff'],
      ['T3', 2, 'headToHead'],
      ['T1', 3, 'headToHead'],
      ['T4', 4, 'points'],
    ]);
    expect(s.needsPlayoff).toEqual([]);
  });

  it('M09/Stechen: tiedTeamIds in anderer Reihenfolge wirkt gleich', () => {
    const f = circle(null);
    f.playoff('A', ['T3', 'T1', 'T2'], 'T2');
    const s = f.standings('A');
    expect(row(s, 'T2')).toMatchObject({ rank: 1, rankReason: 'playoff' });
    expect(s.needsPlayoff).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// M09: Stechen nacheinander, q-Grenze
// ---------------------------------------------------------------------------

describe('M09: Stechen und q-Grenze', () => {
  /** T1/T2/T3 untereinander nur Unentschieden (je 5 Punkte), alle schlagen T4. */
  const allDraws = (q: number) => {
    const f = G4(q);
    f.result('T1', 'T2', 'draw');
    f.result('T2', 'T3', 'draw');
    f.result('T1', 'T3', 'draw');
    f.result('T1', 'T4', 'win', 'T1');
    f.result('T2', 'T4', 'win', 'T2');
    f.result('T3', 'T4', 'win', 'T3');
    return f;
  };

  it('M09/Stechen: mehrere Stechen nacheinander – 3er-Gleichstand → Stechen → verbleibende 2 erneut Stechen', () => {
    const f = allDraws(2);
    let s = f.standings('A');
    expect(points(s)).toEqual({ T1: 5, T2: 5, T3: 5, T4: 0 });
    expect(playoffSets(s)).toEqual([['T1', 'T2', 'T3']]);

    f.playoff('A', ['T1', 'T2', 'T3'], 'T2');
    s = f.standings('A');
    expect(ranking(s)).toEqual([
      ['T2', 1, 'playoff'],
      ['T1', 2, 'tied'],
      ['T3', 2, 'tied'],
      ['T4', 4, 'points'],
    ]);
    expect(playoffSets(s)).toEqual([['T1', 'T3']]);

    f.playoff('A', ['T1', 'T3'], 'T3');
    s = f.standings('A');
    expect(ranking(s).slice(0, 3)).toEqual([
      ['T2', 1, 'playoff'],
      ['T3', 2, 'playoff'],
      ['T1', 3, expect.any(String) as unknown as RankReason],
    ]);
    expect(s.needsPlayoff).toEqual([]);
  });

  it('M09/Stechen: q = 1 – nach erstem Stechen liegen T1/T3 hinter q → tied, kein weiteres Stechen', () => {
    const f = allDraws(1);
    expect(playoffSets(f.standings('A'))).toEqual([['T1', 'T2', 'T3']]);
    f.playoff('A', ['T1', 'T2', 'T3'], 'T1');
    const s = f.standings('A');
    expect(ranking(s)).toEqual([
      ['T1', 1, 'playoff'],
      ['T2', 2, 'tied'],
      ['T3', 2, 'tied'],
      ['T4', 4, 'points'],
    ]);
    expect(s.needsPlayoff).toEqual([]);
  });

  it('M09: Gleichstand nur hinter q → geteilter Platz tied, kein needsPlayoff', () => {
    const f = G4(2);
    f.result('T1', 'T2', 'win', 'T1');
    f.result('T1', 'T3', 'win', 'T1');
    f.result('T1', 'T4', 'win', 'T1');
    f.result('T2', 'T3', 'win', 'T2');
    f.result('T2', 'T4', 'win', 'T2');
    f.result('T3', 'T4', 'draw');
    const s = f.standings('A');
    expect(ranking(s)).toEqual([
      ['T1', 1, 'points'],
      ['T2', 2, 'points'],
      ['T3', 3, 'tied'],
      ['T4', 3, 'tied'],
    ]);
    expect(s.needsPlayoff).toEqual([]);
    expect(s.complete).toBe(true);
  });

  /** T1 9 Punkte; T2 > T3, T3 > T4, T4 > T2 → je 3 Punkte auf Platz 2–4. */
  const crossing = (q: number) => {
    const f = G4(q);
    f.result('T1', 'T2', 'win', 'T1');
    f.result('T1', 'T3', 'win', 'T1');
    f.result('T1', 'T4', 'win', 'T1');
    f.result('T2', 'T3', 'win', 'T2');
    f.result('T3', 'T4', 'win', 'T3');
    f.result('T2', 'T4', 'win', 'T4');
    return f;
  };

  it('M09: Gleichstand über die q-Grenze (Plätze 2–4, q = 2) → needsPlayoff', () => {
    const s = crossing(2).standings('A');
    expect(ranking(s)).toEqual([
      ['T1', 1, 'points'],
      ['T2', 2, 'tied'],
      ['T3', 2, 'tied'],
      ['T4', 2, 'tied'],
    ]);
    expect(playoffSets(s)).toEqual([['T2', 'T3', 'T4']]);
  });

  it('M09: derselbe Gleichstand mit q = 1 liegt ganz hinter q → tied ohne needsPlayoff', () => {
    const s = crossing(1).standings('A');
    expect(ranking(s).slice(1)).toEqual([
      ['T2', 2, 'tied'],
      ['T3', 2, 'tied'],
      ['T4', 2, 'tied'],
    ]);
    expect(s.needsPlayoff).toEqual([]);
  });

  it('M09/Stechen: Gleichstand über q-Grenze, Sieger T3 → Platz 2; T2/T4 per Mini-Tabelle (T4 schlug T2)', () => {
    const f = crossing(2);
    f.playoff('A', ['T2', 'T3', 'T4'], 'T3');
    const s = f.standings('A');
    expect(ranking(s)).toEqual([
      ['T1', 1, 'points'],
      ['T3', 2, 'playoff'],
      ['T4', 3, 'headToHead'],
      ['T2', 4, 'headToHead'],
    ]);
    expect(s.needsPlayoff).toEqual([]);
  });

  it('M09: zwei getrennte Gleichstände, nur der vordere berührt q → nur er in needsPlayoff', () => {
    const f = G4(1);
    f.result('T1', 'T2', 'draw');
    f.result('T3', 'T4', 'draw');
    f.result('T1', 'T3', 'win', 'T1');
    f.result('T1', 'T4', 'win', 'T1');
    f.result('T2', 'T3', 'win', 'T2');
    f.result('T2', 'T4', 'win', 'T2');
    const s = f.standings('A');
    expect(ranking(s)).toEqual([
      ['T1', 1, 'tied'],
      ['T2', 1, 'tied'],
      ['T3', 3, 'tied'],
      ['T4', 3, 'tied'],
    ]);
    expect(playoffSets(s)).toEqual([['T1', 'T2']]);
  });

  it('M09: Gleichstand in Gruppe A erzeugt kein needsPlayoff in Gruppe B', () => {
    const f = started(
      [
        { id: 'A', teams: ['A1', 'A2', 'A3'] },
        { id: 'B', teams: ['B1', 'B2', 'B3'] },
      ],
      1,
    );
    f.result('A1', 'A2', 'win', 'A1');
    f.result('A2', 'A3', 'win', 'A2');
    f.result('A3', 'A1', 'win', 'A3');
    f.result('B1', 'B2', 'win', 'B1');
    f.result('B1', 'B3', 'win', 'B1');
    f.result('B2', 'B3', 'win', 'B2');
    expect(playoffSets(f.standings('A'))).toEqual([['A1', 'A2', 'A3']]);
    expect(f.standings('B').needsPlayoff).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// M19: Undo / Redo wirkt auf die Tabelle
// ---------------------------------------------------------------------------

describe('M19: aufgehobene Ereignisse wirken nicht auf die Tabelle', () => {
  it('M19/M09: aufgehobenes Ergebnis fehlt in der Tabelle; Redo stellt es wieder her', () => {
    const f = G4();
    const r = f.result('T1', 'T2', 'win', 'T1');
    expect(points(f.standings('A')).T1).toBe(3);
    const u = f.pushUndone(r.id);
    let s = f.standings('A');
    expect(row(s, 'T1')).toMatchObject({ points: 0, played: 0 });
    expect(row(s, 'T2').played).toBe(0);
    f.pushUndone(u.id);
    s = f.standings('A');
    expect(row(s, 'T1')).toMatchObject({ points: 3, played: 1, wins: 1 });
  });

  it('M19/Stechen: aufgehobenes Stechen → needsPlayoff wieder offen', () => {
    const f = G4();
    f.result('T1', 'T2', 'win', 'T1');
    f.result('T2', 'T3', 'win', 'T2');
    f.result('T3', 'T1', 'win', 'T3');
    f.result('T1', 'T4', 'win', 'T1');
    f.result('T2', 'T4', 'win', 'T2');
    f.result('T3', 'T4', 'win', 'T3');
    const po = f.playoff('A', ['T1', 'T2', 'T3'], 'T1');
    expect(f.standings('A').needsPlayoff).toEqual([]);
    f.pushUndone(po.id);
    const s = f.standings('A');
    expect(playoffSets(s)).toEqual([['T1', 'T2', 'T3']]);
    expect(row(s, 'T1')).toMatchObject({ rank: 1, rankReason: 'tied' });
  });
});

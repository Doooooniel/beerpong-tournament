// Regeltests aus SPEC „Tische und Durchgänge“ (M15, M16), „Einstellungen“ und M12 (Dauer je Phase).
// Reine Funktionen: buildHeats, heatStatus, roundStatus, nextHeat, durationForPhase.
// Zustände werden aus per Hand gebauten Ereignissen per apply aufgebaut (kein startTournament).
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  DomainEventSchema,
  apply,
  buildHeats,
  durationForPhase,
  heatStatus,
  initialState,
  nextHeat,
  roundStatus,
} from '../index.js';
import type {
  DomainEvent,
  DomainEventType,
  EventOf,
  Heat,
  KoStage,
  Match,
  Phase,
  Settings,
  TournamentState,
} from '../index.js';

// ---------------------------------------------------------------------------
// Testhilfen (lokal)
// ---------------------------------------------------------------------------

const T0 = 1_767_225_600_000; // 2026-01-01T00:00:00Z
/** Tiefe Kopie (core hat keine DOM-/Node-Typen, daher kein structuredClone). */
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const GROUP_MS = 900_000;

/** Ereignisfolge mit lückenlosem seq und festen Zeiten; Zustand schrittweise per apply. */
class Log {
  state: TournamentState = initialState();
  private seq = 0;

  add<T extends Exclude<DomainEventType, 'Undone'>>(
    type: T,
    payload: EventOf<T>['payload'],
  ): EventOf<T> {
    return this.push({ id: `e${this.seq + 1}`, type, v: 1, payload }) as EventOf<T>;
  }

  undo(target: { id: string }, cascade: string[] = []): EventOf<'Undone'> {
    return this.push({
      id: `u${this.seq + 1}`,
      type: 'Undone',
      v: 1,
      undoes: target.id,
      payload: { cascade },
    }) as EventOf<'Undone'>;
  }

  private push(partial: Record<string, unknown>): DomainEvent {
    this.seq += 1;
    const event = DomainEventSchema.parse({ at: T0 + this.seq * 1_000, ...partial, seq: this.seq });
    this.state = apply(this.state, event);
    return event;
  }
}

const match = (id: string, over: Partial<Match> = {}): Match => ({
  id,
  phase: 'group',
  round: 1,
  position: 1,
  groupId: 'A',
  a: { teamId: `${id}-a` },
  b: { teamId: `${id}-b` },
  bye: false,
  ...over,
});

const byeMatch = (id: string, over: Partial<Match> = {}): Match =>
  match(id, { b: null, bye: true, ...over });

const numbered = (n: number, phase: Phase = 'group', round = 1): Match[] =>
  Array.from({ length: n }, (_, i) =>
    match(`m${i + 1}`, { phase, round, position: i + 1, groupId: phase === 'group' ? 'A' : null }),
  );

const sizes = (heats: readonly Heat[]) => heats.map((h) => h.matchIds.length);
const matchIdsOf = (heats: readonly Heat[]) => heats.map((h) => h.matchIds);

const created = (log: Log, settings: Settings = DEFAULT_SETTINGS) =>
  log.add('TournamentCreated', { name: 'Sommerturnier', settings });

// ---------------------------------------------------------------------------
// Fixture Gruppenphase: A = 4 Teams, B = 3 Teams (ungleiche Größe, Freilos in B), 2 Tische.
// Runde r: A-r-1, A-r-2, B-r-1 + Freilos B-r-bye → Durchgang g<r>-1 = [A-r-1, A-r-2], g<r>-2 = [B-r-1].
// KO (q = 1): nur Finale A1–B1 in Durchgang ko-f-1.
// ---------------------------------------------------------------------------

const A = ['a1', 'a2', 'a3', 'a4'];
const B = ['b1', 'b2', 'b3'];
const A_PAIRS: [number, number][][] = [
  [
    [0, 3],
    [1, 2],
  ],
  [
    [0, 2],
    [3, 1],
  ],
  [
    [0, 1],
    [2, 3],
  ],
];
/** Paarung + spielfreies Team je Runde (Circle-Methode, 3 Teams). */
const B_ROUNDS: [[number, number], number][] = [
  [[0, 1], 2],
  [[1, 2], 0],
  [[2, 0], 1],
];
const GROUP_HEATS = ['g1-1', 'g1-2', 'g2-1', 'g2-2', 'g3-1', 'g3-2'];
const FINAL_HEAT = 'ko-f-1';

const team = (ids: string[], i: number) => ids[i] as string;

function groupStage() {
  const log = new Log();
  created(log);
  for (const t of [...A, ...B]) {
    log.add('TeamAdded', { teamId: t, name: `Team ${t}`, players: [`Spieler ${t}`] });
  }
  log.add('TableCountSet', { tableCount: 2 });
  const matches: Match[] = [];
  const heats: Heat[] = [];
  for (let r = 1; r <= 3; r++) {
    const aIds = (A_PAIRS[r - 1] ?? []).map(([x, y], k) => {
      const id = `A-${r}-${k + 1}`;
      matches.push(
        match(id, {
          round: r,
          position: k + 1,
          groupId: 'A',
          a: { teamId: team(A, x) },
          b: { teamId: team(A, y) },
        }),
      );
      return id;
    });
    const [[x, y], free] = B_ROUNDS[r - 1] as [[number, number], number];
    const bId = `B-${r}-1`;
    matches.push(
      match(bId, {
        round: r,
        position: 1,
        groupId: 'B',
        a: { teamId: team(B, x) },
        b: { teamId: team(B, y) },
      }),
    );
    matches.push(
      byeMatch(`B-${r}-bye`, { round: r, position: 2, groupId: 'B', a: { teamId: team(B, free) } }),
    );
    heats.push({ id: `g${r}-1`, phase: 'group', round: r, index: 1, matchIds: aIds });
    heats.push({ id: `g${r}-2`, phase: 'group', round: r, index: 2, matchIds: [bId] });
  }
  log.add('TournamentStarted', {
    groups: [
      { id: 'A', teamIds: A },
      { id: 'B', teamIds: B },
    ],
    advancersPerGroup: 1,
    matches,
    heats,
  });
  return log;
}

const heatOf = (state: TournamentState, heatId: string): Heat => {
  const heat = state.heats.find((h) => h.id === heatId);
  if (!heat) throw new Error(`Durchgang ${heatId} fehlt`);
  return heat;
};

const startHeat = (log: Log, heatId: string, durationMs: number | null = GROUP_MS) =>
  log.add('HeatStarted', { heatId, durationMs });

/** Ergebnis (Sieg Slot a) für eine Partie; Slot a muss ein Team sein. */
const recordWin = (log: Log, matchId: string) => {
  const m = log.state.matches.find((x) => x.id === matchId);
  if (!m || !m.a || !('teamId' in m.a)) throw new Error(`Partie ${matchId} ohne Team in Slot a`);
  return log.add('ResultRecorded', { matchId, outcome: 'win', winnerTeamId: m.a.teamId });
};

const finishHeat = (log: Log, heatId: string) =>
  heatOf(log.state, heatId).matchIds.map((m) => recordWin(log, m));

const playHeat = (log: Log, heatId: string) => {
  startHeat(log, heatId);
  finishHeat(log, heatId);
};

const advanceToFinal = (log: Log) =>
  log.add('PhaseAdvanced', {
    matches: [
      match('FINAL', {
        phase: 'final',
        groupId: null,
        a: { teamId: team(A, 0) },
        b: { teamId: team(B, 0) },
      }),
    ],
    heats: [{ id: FINAL_HEAT, phase: 'final', round: 1, index: 1, matchIds: ['FINAL'] }],
  });

// ---------------------------------------------------------------------------
// buildHeats (M15)
// ---------------------------------------------------------------------------

describe('buildHeats – Partien auf Durchgänge à tableCount verteilen (M15)', () => {
  it.each([
    [1, 1, [1]],
    [2, 2, [2]],
    [4, 8, [4]],
    [3, 2, [2, 1]],
    [4, 2, [2, 2]],
    [5, 2, [2, 2, 1]],
    [3, 1, [1, 1, 1]],
    [6, 4, [4, 2]],
    [12, 5, [5, 5, 2]],
    [32, 16, [16, 16]],
    [33, 16, [16, 16, 1]],
  ])('M15: %i Partien, %i Tische → Durchgangsgrößen %j', (count, tables, expected) => {
    const matches = numbered(count);
    const heats = buildHeats(matches, 'group', 1, tables);
    expect(sizes(heats)).toEqual(expected);
    expect(heats.map((h) => h.index)).toEqual(expected.map((_, i) => i + 1));
    expect(heats.flatMap((h) => h.matchIds)).toEqual(matches.map((m) => m.id));
  });

  it('M15: mehr Partien als Tische → mehrere Durchgänge, jeder mit phase und round der Runde', () => {
    const heats = buildHeats(numbered(5, 'group', 3), 'group', 3, 2);
    expect(heats).toHaveLength(3);
    for (const h of heats) {
      expect(h.phase).toBe('group');
      expect(h.round).toBe(3);
    }
    expect(matchIdsOf(heats)).toEqual([['m1', 'm2'], ['m3', 'm4'], ['m5']]);
  });

  it('M15: Partien bleiben in Eingabereihenfolge (nicht nach id oder position sortiert)', () => {
    const input = [
      match('z', { position: 2 }),
      match('a', { position: 3 }),
      match('m', { position: 1 }),
    ];
    expect(matchIdsOf(buildHeats(input, 'group', 1, 2))).toEqual([['z', 'a'], ['m']]);
  });

  it('SPEC Tische und Durchgänge: Reihenfolge Gruppe A, B, … – Gruppe A an den ersten Tischen', () => {
    const input = [
      match('A1', { groupId: 'A', position: 1 }),
      match('A2', { groupId: 'A', position: 2 }),
      match('B1', { groupId: 'B', position: 1 }),
      match('B2', { groupId: 'B', position: 2 }),
    ];
    expect(matchIdsOf(buildHeats(input, 'group', 1, 3))).toEqual([['A1', 'A2', 'B1'], ['B2']]);
  });

  it('M15/M06: Freilos-Partien (bye: true) belegen keinen Tisch und erscheinen in keinem Durchgang', () => {
    const input = [
      match('m1'),
      byeMatch('bye1'),
      match('m2', { position: 2 }),
      match('m3', { position: 3 }),
      byeMatch('bye2', { position: 4 }),
    ];
    expect(matchIdsOf(buildHeats(input, 'group', 1, 2))).toEqual([['m1', 'm2'], ['m3']]);
  });

  it('M06: Gruppen mit 3 und 5 Teams (je ein Freilos je Runde) → nur echte Partien verteilt', () => {
    const input = [
      match('A1', { groupId: 'A' }),
      byeMatch('A-bye', { groupId: 'A', position: 2 }),
      match('B1', { groupId: 'B' }),
      match('B2', { groupId: 'B', position: 2 }),
      byeMatch('B-bye', { groupId: 'B', position: 3 }),
    ];
    expect(matchIdsOf(buildHeats(input, 'group', 1, 2))).toEqual([['A1', 'B1'], ['B2']]);
  });

  it('M06: Gruppen mit 2 und 4 Teams, 1 Tisch → je Partie ein Durchgang', () => {
    const input = [
      match('A1', { groupId: 'A' }),
      match('B1', { groupId: 'B' }),
      match('B2', { groupId: 'B', position: 2 }),
    ];
    expect(matchIdsOf(buildHeats(input, 'group', 1, 1))).toEqual([['A1'], ['B1'], ['B2']]);
  });

  it('M15: 0 Partien → []', () => {
    expect(buildHeats([], 'group', 1, 4)).toEqual([]);
  });

  it('M15: nur Freilose → [] (kein leerer Durchgang)', () => {
    expect(buildHeats([byeMatch('x'), byeMatch('y')], 'quarterfinal', 1, 2)).toEqual([]);
  });

  it('M15: KO-Stufe → Durchgänge tragen die Stufe als phase', () => {
    const heats = buildHeats(numbered(4, 'quarterfinal'), 'quarterfinal', 1, 2);
    expect(heats.map((h) => [h.phase, h.round, h.index])).toEqual([
      ['quarterfinal', 1, 1],
      ['quarterfinal', 1, 2],
    ]);
  });

  it('M15: Nur-KO mit 6 Teams (2 Freilose) → nur die 2 echten Viertelfinals auf Tischen', () => {
    const input = [
      match('QF1', { phase: 'quarterfinal', groupId: null, position: 1 }),
      byeMatch('QF2', { phase: 'quarterfinal', groupId: null, position: 2 }),
      match('QF3', { phase: 'quarterfinal', groupId: null, position: 3 }),
      byeMatch('QF4', { phase: 'quarterfinal', groupId: null, position: 4 }),
    ];
    expect(matchIdsOf(buildHeats(input, 'quarterfinal', 1, 4))).toEqual([['QF1', 'QF3']]);
  });

  it('M15: Durchgangs-IDs sind nicht leer und eindeutig, auch über Runden und Phasen hinweg', () => {
    const all = [
      ...buildHeats(numbered(5, 'group', 1), 'group', 1, 2),
      ...buildHeats(numbered(5, 'group', 2), 'group', 2, 2),
      ...buildHeats(numbered(4, 'quarterfinal'), 'quarterfinal', 1, 2),
      ...buildHeats(numbered(2, 'semifinal'), 'semifinal', 1, 2),
    ];
    const heatIds = all.map((h) => h.id);
    for (const id of heatIds) expect(id.length).toBeGreaterThan(0);
    expect(new Set(heatIds).size).toBe(heatIds.length);
  });

  it('Architekturregel 4: deterministisch und ohne Veränderung der Eingabe', () => {
    const input = numbered(5);
    const copy = clone(input);
    const first = buildHeats(input, 'group', 1, 2);
    const second = buildHeats(input, 'group', 1, 2);
    expect(second).toEqual(first);
    expect(input).toEqual(copy);
  });
});

// ---------------------------------------------------------------------------
// durationForPhase (M12, SPEC Einstellungen)
// ---------------------------------------------------------------------------

describe('durationForPhase – Zeitlimit je Phase aus settings.timerByPhase (M12)', () => {
  const custom: Settings['timerByPhase'] = {
    group: 840_000,
    ko64: 720_000,
    ko32: 660_000,
    ko16: 540_000,
    quarterfinal: 480_000,
    semifinal: null,
    thirdPlace: null,
    final: null,
  };
  const withTimers = (timerByPhase: Settings['timerByPhase']) => {
    const log = new Log();
    created(log, { ...DEFAULT_SETTINGS, timerByPhase });
    return log.state;
  };

  it.each<[Phase | KoStage, number | null]>([
    ['group', 840_000],
    ['ko64', 720_000],
    ['ko32', 660_000],
    ['ko16', 540_000],
    ['quarterfinal', 480_000],
    ['semifinal', null],
    ['thirdPlace', null],
    ['final', null],
  ])('M12: %s → %s', (phase, expected) => {
    expect(durationForPhase(withTimers(custom), phase)).toBe(expected);
  });

  it.each<[Phase | KoStage, number | null]>([
    ['group', 900_000],
    ['ko64', 600_000],
    ['ko32', 600_000],
    ['ko16', 600_000],
    ['quarterfinal', 600_000],
    ['semifinal', null],
    ['thirdPlace', null],
    ['final', null],
  ])('SPEC Einstellungen: Standardwert %s → %s', (phase, expected) => {
    expect(durationForPhase(withTimers(DEFAULT_SETTINGS.timerByPhase), phase)).toBe(expected);
  });

  it('M12: group = null (ohne Zeitlimit eingestellt) → null', () => {
    expect(durationForPhase(withTimers({ ...custom, group: null }), 'group')).toBeNull();
  });

  it('M12: SettingsUpdated { timerByPhase } wirkt auf den Wert, andere Phasen unverändert', () => {
    const log = new Log();
    created(log);
    log.add('SettingsUpdated', { settings: { timerByPhase: { group: 300_000 } } });
    expect(durationForPhase(log.state, 'group')).toBe(300_000);
    expect(durationForPhase(log.state, 'quarterfinal')).toBe(600_000);
  });
});

// ---------------------------------------------------------------------------
// heatStatus (M16, ADR 025)
// ---------------------------------------------------------------------------

describe('heatStatus – preparing → running → finished (M16, ADR 025)', () => {
  it('M16: ohne HeatStarted sind alle Durchgänge preparing', () => {
    const log = groupStage();
    for (const h of GROUP_HEATS) expect(heatStatus(log.state, h)).toBe('preparing');
  });

  it('M16: ab HeatStarted running; andere Durchgänge bleiben preparing', () => {
    const log = groupStage();
    startHeat(log, 'g1-1');
    expect(heatStatus(log.state, 'g1-1')).toBe('running');
    expect(heatStatus(log.state, 'g1-2')).toBe('preparing');
  });

  it('M16: ein Teil der Ergebnisse erfasst → weiterhin running', () => {
    const log = groupStage();
    startHeat(log, 'g1-1');
    recordWin(log, 'A-1-1');
    expect(heatStatus(log.state, 'g1-1')).toBe('running');
  });

  it('M16: alle Partien des Durchgangs mit Ergebnis → finished', () => {
    const log = groupStage();
    playHeat(log, 'g1-1');
    expect(heatStatus(log.state, 'g1-1')).toBe('finished');
    expect(heatStatus(log.state, 'g1-2')).toBe('preparing');
  });

  it('M16: Durchgang mit einer Partie → finished nach deren Ergebnis (Freilos B-1-bye nicht im Durchgang)', () => {
    const log = groupStage();
    playHeat(log, 'g1-1');
    playHeat(log, 'g1-2');
    expect(heatStatus(log.state, 'g1-2')).toBe('finished');
  });

  it('M16: abgelaufener Timer ändert nichts – Durchgang bleibt running', () => {
    const log = groupStage();
    startHeat(log, 'g1-1', 1_000);
    // spätere Ereignisse liegen weit nach dem Ablauf (je 1 s Abstand, plus Beamer-Umschaltungen)
    for (let i = 0; i < 5; i++) log.add('BeamerViewSet', { view: i % 2 ? 'timer' : 'standings' });
    recordWin(log, 'A-1-1');
    expect(heatStatus(log.state, 'g1-1')).toBe('running');
  });

  it('M16: pausierter Timer → weiterhin running', () => {
    const log = groupStage();
    startHeat(log, 'g1-1');
    log.add('TimerPaused', { heatId: 'g1-1' });
    expect(heatStatus(log.state, 'g1-1')).toBe('running');
  });

  it('M12/M16: Durchgang ohne Zeitlimit (durationMs null) → running bis alle Ergebnisse da sind', () => {
    const log = groupStage();
    startHeat(log, 'g1-1', null);
    expect(heatStatus(log.state, 'g1-1')).toBe('running');
    finishHeat(log, 'g1-1');
    expect(heatStatus(log.state, 'g1-1')).toBe('finished');
  });

  it('M16/M19: aufgehobenes HeatStarted → wieder preparing', () => {
    const log = groupStage();
    const hs = startHeat(log, 'g1-1');
    log.undo(hs);
    expect(heatStatus(log.state, 'g1-1')).toBe('preparing');
  });

  it('M16/M19: aufgehobenes Ergebnis eines fertigen Durchgangs → wieder running', () => {
    const log = groupStage();
    startHeat(log, 'g1-1');
    const [first] = finishHeat(log, 'g1-1');
    if (!first) throw new Error('kein Ergebnis');
    expect(heatStatus(log.state, 'g1-1')).toBe('finished');
    log.undo(first);
    expect(heatStatus(log.state, 'g1-1')).toBe('running');
  });

  it('M16: Freilose im Durchgang zählen als erledigt (SPEC Status)', () => {
    const log = new Log();
    created(log);
    for (const t of ['t1', 't2', 't3']) {
      log.add('TeamAdded', { teamId: t, name: `Team ${t}`, players: ['P'] });
    }
    log.add('TournamentStarted', {
      groups: [{ id: 'A', teamIds: ['t1', 't2', 't3'] }],
      advancersPerGroup: 1,
      matches: [
        match('m1', { a: { teamId: 't1' }, b: { teamId: 't2' } }),
        byeMatch('m2', { position: 2, a: { teamId: 't3' } }),
      ],
      heats: [{ id: 'h1', phase: 'group', round: 1, index: 1, matchIds: ['m1', 'm2'] }],
    });
    startHeat(log, 'h1');
    expect(heatStatus(log.state, 'h1')).toBe('running');
    recordWin(log, 'm1');
    expect(heatStatus(log.state, 'h1')).toBe('finished');
  });

  it('M16: KO-Durchgang ohne Zeitlimit: preparing → running → finished', () => {
    const log = groupStage();
    for (const h of GROUP_HEATS) playHeat(log, h);
    advanceToFinal(log);
    expect(heatStatus(log.state, FINAL_HEAT)).toBe('preparing');
    startHeat(log, FINAL_HEAT, null);
    expect(heatStatus(log.state, FINAL_HEAT)).toBe('running');
    recordWin(log, 'FINAL');
    expect(heatStatus(log.state, FINAL_HEAT)).toBe('finished');
  });
});

// ---------------------------------------------------------------------------
// roundStatus (M16)
// ---------------------------------------------------------------------------

describe('roundStatus – Runde preparing / running / finished (M16)', () => {
  it('M16: kein Durchgang gestartet → preparing (alle Runden)', () => {
    const log = groupStage();
    for (const r of [1, 2, 3]) expect(roundStatus(log.state, 'group', r)).toBe('preparing');
  });

  it('M16: erster Durchgang läuft → Runde running, Folgerunde preparing', () => {
    const log = groupStage();
    startHeat(log, 'g1-1');
    expect(roundStatus(log.state, 'group', 1)).toBe('running');
    expect(roundStatus(log.state, 'group', 2)).toBe('preparing');
  });

  it('M16: erster Durchgang finished, zweiter noch preparing → Runde running (nicht preparing)', () => {
    const log = groupStage();
    playHeat(log, 'g1-1');
    expect(roundStatus(log.state, 'group', 1)).toBe('running');
  });

  it('M16: zweiter Durchgang läuft → Runde running', () => {
    const log = groupStage();
    playHeat(log, 'g1-1');
    startHeat(log, 'g1-2');
    expect(roundStatus(log.state, 'group', 1)).toBe('running');
  });

  it('M16: alle Durchgänge der Runde finished → finished; Freilos der Runde zählt nicht als offen', () => {
    const log = groupStage();
    playHeat(log, 'g1-1');
    playHeat(log, 'g1-2');
    expect(roundStatus(log.state, 'group', 1)).toBe('finished');
    expect(roundStatus(log.state, 'group', 2)).toBe('preparing');
  });

  it('M16/M19: Ergebnis im letzten Durchgang aufgehoben → Runde wieder running', () => {
    const log = groupStage();
    playHeat(log, 'g1-1');
    startHeat(log, 'g1-2');
    const [r] = finishHeat(log, 'g1-2');
    if (!r) throw new Error('kein Ergebnis');
    log.undo(r);
    expect(roundStatus(log.state, 'group', 1)).toBe('running');
  });

  it('M16: KO-Stufe als Runde (phase = Stufe, round = 1)', () => {
    const log = groupStage();
    for (const h of GROUP_HEATS) playHeat(log, h);
    expect(roundStatus(log.state, 'group', 3)).toBe('finished');
    advanceToFinal(log);
    expect(roundStatus(log.state, 'final', 1)).toBe('preparing');
    startHeat(log, FINAL_HEAT, null);
    expect(roundStatus(log.state, 'final', 1)).toBe('running');
    recordWin(log, 'FINAL');
    expect(roundStatus(log.state, 'final', 1)).toBe('finished');
  });
});

// ---------------------------------------------------------------------------
// nextHeat (SPEC: Durchgänge streng nacheinander, auch über Runden- und Phasengrenzen)
// ---------------------------------------------------------------------------

describe('nextHeat – nächster startbarer Durchgang (SPEC Tische und Durchgänge)', () => {
  const nextId = (log: Log) => nextHeat(log.state)?.id ?? null;

  it('SPEC Durchgänge: vor dem Start (keine Durchgänge) → null', () => {
    const log = new Log();
    created(log);
    expect(nextHeat(log.state)).toBeNull();
  });

  it('SPEC Durchgänge: nach dem Start → erster Durchgang, vollständig', () => {
    const log = groupStage();
    expect(nextHeat(log.state)).toEqual(heatOf(log.state, 'g1-1'));
  });

  it('SPEC Durchgänge: Durchgang läuft (auch mit Teilergebnissen) → null', () => {
    const log = groupStage();
    startHeat(log, 'g1-1');
    expect(nextHeat(log.state)).toBeNull();
    recordWin(log, 'A-1-1');
    expect(nextHeat(log.state)).toBeNull();
  });

  it('SPEC Durchgänge: ganzer Ablauf über Runden- und Phasengrenze', () => {
    const log = groupStage();
    const seen: (string | null)[] = [];
    for (const h of GROUP_HEATS) {
      seen.push(nextId(log));
      startHeat(log, h);
      seen.push(nextId(log));
      finishHeat(log, h);
    }
    // alle Gruppendurchgänge fertig, KO-Baum noch nicht erzeugt → nichts startbar
    seen.push(nextId(log));
    advanceToFinal(log);
    seen.push(nextId(log));
    startHeat(log, FINAL_HEAT, null);
    seen.push(nextId(log));
    recordWin(log, 'FINAL');
    seen.push(nextId(log));
    expect(seen).toEqual([
      'g1-1',
      null,
      'g1-2',
      null,
      'g2-1',
      null,
      'g2-2',
      null,
      'g3-1',
      null,
      'g3-2',
      null,
      null,
      FINAL_HEAT,
      null,
      null,
    ]);
  });

  it('M15: nach TablesSwapped liefert nextHeat die getauschte Tischfolge', () => {
    const log = groupStage();
    log.add('TablesSwapped', { heatId: 'g1-1', tableA: 1, tableB: 2 });
    expect(nextHeat(log.state)?.matchIds).toEqual(['A-1-2', 'A-1-1']);
  });

  it('M19: aufgehobenes HeatStarted → derselbe Durchgang ist wieder der nächste', () => {
    const log = groupStage();
    playHeat(log, 'g1-1');
    const hs = startHeat(log, 'g1-2');
    expect(nextId(log)).toBeNull();
    log.undo(hs);
    expect(nextId(log)).toBe('g1-2');
  });

  it('M19: aufgehobenes Ergebnis im Vorgänger → Folgedurchgang nicht mehr startbar', () => {
    const log = groupStage();
    startHeat(log, 'g1-1');
    const [r] = finishHeat(log, 'g1-1');
    if (!r) throw new Error('kein Ergebnis');
    expect(nextId(log)).toBe('g1-2');
    log.undo(r);
    expect(nextId(log)).toBeNull();
  });
});

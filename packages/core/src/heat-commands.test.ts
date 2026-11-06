// Regeltests aus SPEC „Tische und Durchgänge“ (M15, M16), M12 (Dauer je Phase) und M19 (Undo):
// decide startHeat, swapTables und recordResult (nur Bezug zu Durchgängen).
// Fixtures: TournamentStarted/PhaseAdvanced per Hand gebaut und per apply eingespielt.
import { describe, expect, it } from 'vitest';
import {
  CommandSchema,
  DEFAULT_SETTINGS,
  DomainEventSchema,
  apply,
  decide,
  initialState,
} from './index.js';
import type {
  Command,
  DecideContext,
  DomainError,
  DomainErrorCode,
  DomainEvent,
  DomainEventType,
  EventOf,
  Heat,
  KoStage,
  Match,
  NewEvent,
  Result,
  Settings,
  Slot,
  TournamentState,
} from './index.js';

// ---------------------------------------------------------------------------
// Testhilfen (lokal)
// ---------------------------------------------------------------------------

const T0 = 1_767_225_600_000; // 2026-01-01T00:00:00Z
/** Tiefe Kopie (core hat keine DOM-/Node-Typen, daher kein structuredClone). */
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const GROUP_MS = 900_000;

const ctx = (now: number): DecideContext => {
  let n = 0;
  return {
    now,
    random: () => 0.5,
    newId: () => {
      n += 1;
      return `cmd-${now}-${n}`;
    },
  };
};

class Fixture {
  state: TournamentState = initialState();
  private seq = 0;
  private clock = T0;

  tick(): number {
    this.clock += 1_000;
    return this.clock;
  }

  add<T extends Exclude<DomainEventType, 'Undone'>>(
    type: T,
    payload: EventOf<T>['payload'],
  ): EventOf<T> {
    return this.append({
      id: `e${this.seq + 1}`,
      type,
      v: 1,
      at: this.tick(),
      payload,
    } as unknown as NewEvent) as EventOf<T>;
  }

  undo(target: { id: string }, cascade: string[] = []): EventOf<'Undone'> {
    return this.append({
      id: `u${this.seq + 1}`,
      type: 'Undone',
      v: 1,
      at: this.tick(),
      undoes: target.id,
      payload: { cascade },
    } as unknown as NewEvent) as EventOf<'Undone'>;
  }

  decide(command: Command, now = this.tick()): Result<NewEvent[], DomainError> {
    return decide(this.state, command, ctx(now));
  }

  /** decide → seq → apply; scheitert der Befehl, scheitert der Test. */
  run(command: Command, now = this.tick()): DomainEvent[] {
    const r = this.decide(command, now);
    if (!r.ok) throw new Error(`${command.type}: ${r.error.code} – ${r.error.message}`);
    return r.value.map((e) => this.append(e));
  }

  /** Erwarteter Fehler; decide darf den Zustand nicht verändern. */
  expectError(command: Command, code: DomainErrorCode): DomainError {
    const before = clone(this.state);
    const r = this.decide(command);
    if (r.ok)
      throw new Error(`erwartet ${code}, erhalten ${r.value.map((e) => e.type).join(', ')}`);
    expect(r.error.code).toBe(code);
    expect(this.state).toEqual(before);
    return r.error;
  }

  heat(heatId: string): Heat {
    const h = this.state.heats.find((x) => x.id === heatId);
    if (!h) throw new Error(`Durchgang ${heatId} fehlt`);
    return h;
  }

  private append(e: NewEvent): DomainEvent {
    this.seq += 1;
    const event = DomainEventSchema.parse({ ...e, seq: this.seq });
    this.state = apply(this.state, event);
    return event;
  }
}

const single = <T extends DomainEventType>(events: DomainEvent[], type: T): EventOf<T> => {
  expect(events).toHaveLength(1);
  const [e] = events;
  if (!e || e.type !== type) throw new Error(`erwartet ${type}, erhalten ${e?.type}`);
  return e as EventOf<T>;
};

const startHeat = (heatId: string): Command => ({ type: 'startHeat', heatId });
const swap = (heatId: string, tableA: number, tableB: number): Command => ({
  type: 'swapTables',
  heatId,
  tableA,
  tableB,
});

const slotTeam = (slot: Slot): string => {
  if (!slot || !('teamId' in slot)) throw new Error('Slot ohne Team');
  return slot.teamId;
};

/** Ergebnis-Befehl: Sieg für Slot a (Partie muss feste Teams haben). */
const winCommand = (f: Fixture, matchId: string): Command => {
  const m = f.state.matches.find((x) => x.id === matchId);
  if (!m) throw new Error(`Partie ${matchId} fehlt`);
  return { type: 'recordResult', matchId, outcome: 'win', winnerTeamId: slotTeam(m.a) };
};

/** Direkt eingespieltes Ergebnis (unabhängig von decide recordResult). */
const recordWin = (f: Fixture, matchId: string, winnerTeamId?: string) => {
  const m = f.state.matches.find((x) => x.id === matchId);
  if (!m) throw new Error(`Partie ${matchId} fehlt`);
  return f.add('ResultRecorded', {
    matchId,
    outcome: 'win',
    winnerTeamId: winnerTeamId ?? slotTeam(m.a),
  });
};

const startDirect = (f: Fixture, heatId: string, durationMs: number | null = GROUP_MS) =>
  f.add('HeatStarted', { heatId, durationMs });

const finishDirect = (f: Fixture, heatId: string) =>
  f.heat(heatId).matchIds.map((m) => recordWin(f, m));

const playDirect = (f: Fixture, heatId: string) => {
  startDirect(f, heatId);
  finishDirect(f, heatId);
};

// ---------------------------------------------------------------------------
// Fixture Gruppen + KO: A und B je 4 Teams, 3 Tische.
// Runde r: A-r-1, A-r-2, B-r-1, B-r-2 → g<r>-1 = [A-r-1, A-r-2, B-r-1], g<r>-2 = [B-r-2].
// ---------------------------------------------------------------------------

const A = ['a1', 'a2', 'a3', 'a4'];
const B = ['b1', 'b2', 'b3', 'b4'];
const PAIRS: [number, number][][] = [
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
const GROUP_HEATS = ['g1-1', 'g1-2', 'g2-1', 'g2-2', 'g3-1', 'g3-2'];
const at = (ids: string[], i: number) => ids[i] as string;

function created(settings: Partial<Settings> = {}, teams: string[] = [...A, ...B]) {
  const f = new Fixture();
  f.add('TournamentCreated', {
    name: 'Sommerturnier',
    settings: { ...DEFAULT_SETTINGS, ...settings },
  });
  for (const t of teams)
    f.add('TeamAdded', { teamId: t, name: `Team ${t}`, players: [`Spieler ${t}`] });
  return f;
}

function groupStage(settings: Partial<Settings> = {}) {
  const f = created(settings);
  f.add('TableCountSet', { tableCount: 3 });
  const matches: Match[] = [];
  const heats: Heat[] = [];
  PAIRS.forEach((pairs, i) => {
    const round = i + 1;
    const ids: string[] = [];
    for (const [g, teams] of [
      ['A', A],
      ['B', B],
    ] as const) {
      pairs.forEach(([x, y], k) => {
        const id = `${g}-${round}-${k + 1}`;
        matches.push({
          id,
          phase: 'group',
          round,
          position: k + 1,
          groupId: g,
          a: { teamId: at(teams, x) },
          b: { teamId: at(teams, y) },
          bye: false,
        });
        ids.push(id);
      });
    }
    heats.push({ id: `g${round}-1`, phase: 'group', round, index: 1, matchIds: ids.slice(0, 3) });
    heats.push({ id: `g${round}-2`, phase: 'group', round, index: 2, matchIds: ids.slice(3) });
  });
  f.add('TournamentStarted', {
    groups: [
      { id: 'A', teamIds: A },
      { id: 'B', teamIds: B },
    ],
    advancersPerGroup: 2,
    matches,
    heats,
  });
  return f;
}

/** Nach vollständiger Gruppenphase: Halbfinale A1–B2, B1–A2 (ein Durchgang), Finale. */
function advanced() {
  const f = groupStage();
  for (const h of GROUP_HEATS) playDirect(f, h);
  const ko = (id: string, phase: Match['phase'], position: number, a: Slot, b: Slot): Match => ({
    id,
    phase,
    round: 1,
    position,
    groupId: null,
    a,
    b,
    bye: false,
  });
  f.add('PhaseAdvanced', {
    matches: [
      ko('SF1', 'semifinal', 1, { teamId: at(A, 0) }, { teamId: at(B, 1) }),
      ko('SF2', 'semifinal', 2, { teamId: at(B, 0) }, { teamId: at(A, 1) }),
      ko('FINAL', 'final', 1, { winnerOf: 'SF1' }, { winnerOf: 'SF2' }),
    ],
    heats: [
      { id: 'H-sf-1', phase: 'semifinal', round: 1, index: 1, matchIds: ['SF1', 'SF2'] },
      { id: 'H-final-1', phase: 'final', round: 1, index: 1, matchIds: ['FINAL'] },
    ],
  });
  return f;
}

// ---------------------------------------------------------------------------
// Fixture Nur-KO: n Teams (2^k), vollständiger Baum, Durchgänge je Stufe à tableCount.
// ---------------------------------------------------------------------------

const STAGE_BY_TEAMS: Record<number, KoStage> = {
  64: 'ko64',
  32: 'ko32',
  16: 'ko16',
  8: 'quarterfinal',
  4: 'semifinal',
  2: 'final',
};

const CUSTOM_TIMERS: Settings['timerByPhase'] = {
  group: 840_000,
  ko64: 720_000,
  ko32: 660_000,
  ko16: 540_000,
  quarterfinal: 480_000,
  semifinal: null,
  thirdPlace: null,
  final: null,
};

function koOnly(n: number, tableCount: number) {
  const teams = Array.from({ length: n }, (_, i) => `t${i + 1}`);
  const f = created({ mode: 'koOnly', timerByPhase: CUSTOM_TIMERS }, teams);
  f.add('TableCountSet', { tableCount });
  const matches: Match[] = [];
  const heats: Heat[] = [];
  let prev: string[] = [];
  for (let k = n; k >= 2; k /= 2) {
    const stage = STAGE_BY_TEAMS[k];
    if (!stage) throw new Error(`keine Stufe für ${k}`);
    const ids: string[] = [];
    for (let i = 0; i < k / 2; i++) {
      const id = `${stage}-${i + 1}`;
      const first = k === n;
      matches.push({
        id,
        phase: stage,
        round: 1,
        position: i + 1,
        groupId: null,
        a: first ? { teamId: at(teams, 2 * i) } : { winnerOf: at(prev, 2 * i) },
        b: first ? { teamId: at(teams, 2 * i + 1) } : { winnerOf: at(prev, 2 * i + 1) },
        bye: false,
      });
      ids.push(id);
    }
    for (let j = 0; j * tableCount < ids.length; j++) {
      heats.push({
        id: `H-${stage}-${j + 1}`,
        phase: stage,
        round: 1,
        index: j + 1,
        matchIds: ids.slice(j * tableCount, (j + 1) * tableCount),
      });
    }
    prev = ids;
  }
  f.add('TournamentStarted', { groups: [], advancersPerGroup: null, matches, heats });
  return f;
}

// ---------------------------------------------------------------------------
// startHeat
// ---------------------------------------------------------------------------

describe('startHeat – Vorbedingungen (SPEC Tische und Durchgänge, M16)', () => {
  it('M16: vor dem Start (Phase setup) → TOURNAMENT_NOT_STARTED', () => {
    const f = created();
    f.add('TableCountSet', { tableCount: 3 });
    f.expectError(startHeat('g1-1'), 'TOURNAMENT_NOT_STARTED');
  });

  it('M16: unbekannter Durchgang → HEAT_NOT_FOUND', () => {
    groupStage().expectError(startHeat('gibt-es-nicht'), 'HEAT_NOT_FOUND');
  });

  it('M16: Durchgang läuft bereits → HEAT_ALREADY_STARTED', () => {
    const f = groupStage();
    f.run(startHeat('g1-1'));
    f.expectError(startHeat('g1-1'), 'HEAT_ALREADY_STARTED');
  });

  it('M16: Durchgang bereits finished → HEAT_ALREADY_STARTED', () => {
    const f = groupStage();
    playDirect(f, 'g1-1');
    f.expectError(startHeat('g1-1'), 'HEAT_ALREADY_STARTED');
  });

  it('SPEC streng nacheinander: Vorgänger noch preparing → PREVIOUS_HEAT_NOT_FINISHED', () => {
    groupStage().expectError(startHeat('g1-2'), 'PREVIOUS_HEAT_NOT_FINISHED');
  });

  it('SPEC streng nacheinander: Vorgänger running mit Teilergebnissen → PREVIOUS_HEAT_NOT_FINISHED', () => {
    const f = groupStage();
    startDirect(f, 'g1-1');
    recordWin(f, 'A-1-1');
    recordWin(f, 'A-1-2');
    f.expectError(startHeat('g1-2'), 'PREVIOUS_HEAT_NOT_FINISHED');
  });

  it('SPEC streng nacheinander: über die Rundengrenze – letzter Durchgang der Vorrunde läuft', () => {
    const f = groupStage();
    playDirect(f, 'g1-1');
    startDirect(f, 'g1-2');
    f.expectError(startHeat('g2-1'), 'PREVIOUS_HEAT_NOT_FINISHED');
  });

  it('SPEC streng nacheinander: Durchgang aus späterer Runde, Vorrunde gar nicht begonnen', () => {
    groupStage().expectError(startHeat('g3-1'), 'PREVIOUS_HEAT_NOT_FINISHED');
  });

  it('SPEC streng nacheinander: über die Phasengrenze (Nur-KO, Viertelfinale → Halbfinale)', () => {
    const f = koOnly(8, 2);
    playDirect(f, 'H-quarterfinal-1');
    startDirect(f, 'H-quarterfinal-2', CUSTOM_TIMERS.quarterfinal);
    recordWin(f, 'quarterfinal-3');
    f.expectError(startHeat('H-semifinal-1'), 'PREVIOUS_HEAT_NOT_FINISHED');
  });

  it('M19: Ergebnis im Vorgänger aufgehoben → Folgedurchgang wieder gesperrt', () => {
    const f = groupStage();
    startDirect(f, 'g1-1');
    const [r] = finishDirect(f, 'g1-1');
    if (!r) throw new Error('kein Ergebnis');
    f.undo(r);
    f.expectError(startHeat('g1-2'), 'PREVIOUS_HEAT_NOT_FINISHED');
  });
});

describe('startHeat – Erfolg: HeatStarted { heatId, durationMs } (M12, M16, Architekturregel 4/6)', () => {
  it('M12: erster Gruppendurchgang → HeatStarted mit durationMs = timerByPhase.group, at = ctx.now, v 1', () => {
    const f = groupStage();
    const now = T0 + 3_600_000;
    const hs = single(f.run(startHeat('g1-1'), now), 'HeatStarted');
    expect(hs.v).toBe(1);
    expect(hs.at).toBe(now);
    expect(hs.payload).toEqual({ heatId: 'g1-1', durationMs: GROUP_MS });
  });

  it('Architekturregel 6: danach timers[heatId] = { durationMs, startedAt = now, pausedAt null, pausedTotalMs 0 }', () => {
    const f = groupStage();
    const now = T0 + 3_600_000;
    f.run(startHeat('g1-1'), now);
    expect(f.state.timers['g1-1']).toEqual({
      durationMs: GROUP_MS,
      startedAt: now,
      pausedAt: null,
      pausedTotalMs: 0,
    });
    expect(f.state.timers['g1-2']).toBeUndefined();
  });

  it('SPEC streng nacheinander: Vorgänger finished → nächster Durchgang startbar, auch über Rundengrenze', () => {
    const f = groupStage();
    playDirect(f, 'g1-1');
    expect(single(f.run(startHeat('g1-2')), 'HeatStarted').payload.heatId).toBe('g1-2');
    finishDirect(f, 'g1-2');
    expect(single(f.run(startHeat('g2-1')), 'HeatStarted').payload.heatId).toBe('g2-1');
  });

  it('M12: Dauer kommt aus den aktuellen Einstellungen (SettingsUpdated nach dem Start)', () => {
    const f = groupStage();
    f.add('SettingsUpdated', { settings: { timerByPhase: { group: 600_000 } } });
    expect(single(f.run(startHeat('g1-1')), 'HeatStarted').payload.durationMs).toBe(600_000);
  });

  it('M12: timerByPhase.group = null → HeatStarted mit durationMs null', () => {
    const f = groupStage({ timerByPhase: { ...DEFAULT_SETTINGS.timerByPhase, group: null } });
    const hs = single(f.run(startHeat('g1-1')), 'HeatStarted');
    expect(hs.payload.durationMs).toBeNull();
    expect(f.state.timers['g1-1']?.durationMs).toBeNull();
  });

  it.each<[number, number, string, number | null]>([
    [64, 16, 'H-ko64-1', 720_000],
    [32, 16, 'H-ko32-1', 660_000],
    [16, 8, 'H-ko16-1', 540_000],
    [8, 4, 'H-quarterfinal-1', 480_000],
    [4, 2, 'H-semifinal-1', null],
    [2, 1, 'H-final-1', null],
  ])(
    'M12: Nur-KO mit %i Teams, %i Tischen → %s startet mit durationMs %s',
    (n, tables, heatId, ms) => {
      const f = koOnly(n, tables);
      const hs = single(f.run(startHeat(heatId)), 'HeatStarted');
      expect(hs.payload).toEqual({ heatId, durationMs: ms });
    },
  );

  it('M12: Halbfinale nach der Gruppenphase → durationMs null (Phasengrenze überschritten)', () => {
    const f = advanced();
    const hs = single(f.run(startHeat('H-sf-1')), 'HeatStarted');
    expect(hs.payload).toEqual({ heatId: 'H-sf-1', durationMs: null });
  });

  it('M12: Finale nach fertigem Halbfinale → durationMs null', () => {
    const f = advanced();
    startDirect(f, 'H-sf-1', null);
    finishDirect(f, 'H-sf-1');
    const hs = single(f.run(startHeat('H-final-1')), 'HeatStarted');
    expect(hs.payload).toEqual({ heatId: 'H-final-1', durationMs: null });
  });

  it('M12/S04: Platz 3 → durationMs null', () => {
    const f = created({ mode: 'koOnly', thirdPlaceMatch: true }, ['t1', 't2', 't3', 't4']);
    f.add('TableCountSet', { tableCount: 2 });
    const ko = (id: string, phase: Match['phase'], position: number, a: Slot, b: Slot): Match => ({
      id,
      phase,
      round: 1,
      position,
      groupId: null,
      a,
      b,
      bye: false,
    });
    f.add('TournamentStarted', {
      groups: [],
      advancersPerGroup: null,
      matches: [
        ko('SF1', 'semifinal', 1, { teamId: 't1' }, { teamId: 't4' }),
        ko('SF2', 'semifinal', 2, { teamId: 't2' }, { teamId: 't3' }),
        ko('P3', 'thirdPlace', 1, { loserOf: 'SF1' }, { loserOf: 'SF2' }),
        ko('FINAL', 'final', 1, { winnerOf: 'SF1' }, { winnerOf: 'SF2' }),
      ],
      heats: [
        { id: 'H-sf', phase: 'semifinal', round: 1, index: 1, matchIds: ['SF1', 'SF2'] },
        { id: 'H-p3', phase: 'thirdPlace', round: 1, index: 1, matchIds: ['P3'] },
        { id: 'H-f', phase: 'final', round: 1, index: 1, matchIds: ['FINAL'] },
      ],
    });
    startDirect(f, 'H-sf', null);
    finishDirect(f, 'H-sf');
    expect(single(f.run(startHeat('H-p3')), 'HeatStarted').payload.durationMs).toBeNull();
  });

  it('M11/M15: Nur-KO mit Freilos – Halbfinal-Durchgang nur mit der echten Partie, danach Finale startbar', () => {
    const f = created({ mode: 'koOnly' }, ['t1', 't2', 't3']);
    f.add('TableCountSet', { tableCount: 2 });
    f.add('TournamentStarted', {
      groups: [],
      advancersPerGroup: null,
      matches: [
        {
          id: 'SF1',
          phase: 'semifinal',
          round: 1,
          position: 1,
          groupId: null,
          a: { teamId: 't1' },
          b: null,
          bye: true,
        },
        {
          id: 'SF2',
          phase: 'semifinal',
          round: 1,
          position: 2,
          groupId: null,
          a: { teamId: 't2' },
          b: { teamId: 't3' },
          bye: false,
        },
        {
          id: 'FINAL',
          phase: 'final',
          round: 1,
          position: 1,
          groupId: null,
          a: { winnerOf: 'SF1' },
          b: { winnerOf: 'SF2' },
          bye: false,
        },
      ],
      heats: [
        { id: 'H-sf', phase: 'semifinal', round: 1, index: 1, matchIds: ['SF2'] },
        { id: 'H-f', phase: 'final', round: 1, index: 1, matchIds: ['FINAL'] },
      ],
    });
    f.expectError(startHeat('H-f'), 'PREVIOUS_HEAT_NOT_FINISHED');
    startDirect(f, 'H-sf', null);
    recordWin(f, 'SF2');
    expect(single(f.run(startHeat('H-f')), 'HeatStarted').payload).toEqual({
      heatId: 'H-f',
      durationMs: null,
    });
  });

  it('M19: aufgehobenes HeatStarted → erneut startbar, neuer Timer ab dem neuen now', () => {
    const f = groupStage();
    const [first] = f.run(startHeat('g1-1'), T0 + 3_600_000);
    if (!first) throw new Error('kein Ereignis');
    f.undo(first);
    expect(f.state.timers['g1-1']).toBeUndefined();
    const later = T0 + 7_200_000;
    f.run(startHeat('g1-1'), later);
    expect(f.state.timers['g1-1']).toMatchObject({ startedAt: later, pausedTotalMs: 0 });
  });

  it('M19: aufgehobenes HeatStarted des Vorgängers → Folgedurchgang gesperrt', () => {
    const f = groupStage();
    const hs = startDirect(f, 'g1-1');
    f.undo(hs);
    f.expectError(startHeat('g1-2'), 'PREVIOUS_HEAT_NOT_FINISHED');
  });
});

// ---------------------------------------------------------------------------
// swapTables
// ---------------------------------------------------------------------------

describe('swapTables – Tische vor dem Start tauschen (M15, SPEC Tische und Durchgänge)', () => {
  it('M15: unbekannter Durchgang → HEAT_NOT_FOUND', () => {
    groupStage().expectError(swap('gibt-es-nicht', 1, 2), 'HEAT_NOT_FOUND');
  });

  it('M15: Durchgang läuft → HEAT_ALREADY_STARTED (nur vor Start erlaubt)', () => {
    const f = groupStage();
    startDirect(f, 'g1-1');
    f.expectError(swap('g1-1', 1, 2), 'HEAT_ALREADY_STARTED');
  });

  it('M15: Durchgang finished → HEAT_ALREADY_STARTED', () => {
    const f = groupStage();
    playDirect(f, 'g1-1');
    f.expectError(swap('g1-1', 1, 3), 'HEAT_ALREADY_STARTED');
  });

  it.each<[string, string, number, number]>([
    ['tableA = tableB', 'g1-1', 2, 2],
    ['tableB > Anzahl Partien', 'g1-1', 1, 4],
    ['tableA > Anzahl Partien', 'g1-1', 4, 1],
    ['beide außerhalb', 'g1-1', 4, 5],
    ['Durchgang mit 1 Partie, Tisch 2 existiert dort nicht (obwohl 3 Tische)', 'g1-2', 1, 2],
    ['Durchgang mit 1 Partie, 1 ↔ 1', 'g1-2', 1, 1],
  ])('M15: %s → INVALID_TABLE', (_label, heatId, tableA, tableB) => {
    groupStage().expectError(swap(heatId, tableA, tableB), 'INVALID_TABLE');
  });

  it('M15: Tisch 0 wird schon vom Befehlsschema abgelehnt', () => {
    expect(CommandSchema.safeParse(swap('g1-1', 0, 1)).success).toBe(false);
  });

  it('M15: Erfolg → TablesSwapped { heatId, tableA, tableB } mit at = ctx.now', () => {
    const f = groupStage();
    const now = T0 + 1_800_000;
    const e = single(f.run(swap('g1-1', 1, 3), now), 'TablesSwapped');
    expect(e.v).toBe(1);
    expect(e.at).toBe(now);
    expect(e.payload).toEqual({ heatId: 'g1-1', tableA: 1, tableB: 3 });
  });

  it.each<[number, number, string[]]>([
    [1, 3, ['B-1-1', 'A-1-2', 'A-1-1']],
    [3, 1, ['B-1-1', 'A-1-2', 'A-1-1']],
    [1, 2, ['A-1-2', 'A-1-1', 'B-1-1']],
    [2, 3, ['A-1-1', 'B-1-1', 'A-1-2']],
  ])('M15: Tisch %i ↔ %i → matchIds %j; anderer Durchgang unverändert', (a, b, expected) => {
    const f = groupStage();
    f.run(swap('g1-1', a, b));
    expect(f.heat('g1-1').matchIds).toEqual(expected);
    expect(f.heat('g1-2').matchIds).toEqual(['B-1-2']);
  });

  it('M15: zweimal derselbe Tausch → ursprüngliche Reihenfolge', () => {
    const f = groupStage();
    f.run(swap('g1-1', 1, 3));
    f.run(swap('g1-1', 1, 3));
    expect(f.heat('g1-1').matchIds).toEqual(['A-1-1', 'A-1-2', 'B-1-1']);
  });

  it('M15: Tausch ändert keine Partie (Teams, Gruppe, position bleiben)', () => {
    const f = groupStage();
    const before = clone(f.state.matches);
    f.run(swap('g1-1', 1, 3));
    expect(f.state.matches).toEqual(before);
  });

  it('M15: späterer Durchgang darf getauscht werden, während ein früherer läuft', () => {
    const f = groupStage();
    startDirect(f, 'g1-1');
    f.run(swap('g2-1', 1, 2));
    expect(f.heat('g2-1').matchIds).toEqual(['A-2-2', 'A-2-1', 'B-2-1']);
  });

  it('M15: getauschter Durchgang lässt sich starten; danach kein Tausch mehr', () => {
    const f = groupStage();
    f.run(swap('g1-1', 1, 2));
    single(f.run(startHeat('g1-1')), 'HeatStarted');
    f.expectError(swap('g1-1', 1, 2), 'HEAT_ALREADY_STARTED');
  });

  it('M15/M19: nach aufgehobenem HeatStarted ist Tauschen wieder erlaubt', () => {
    const f = groupStage();
    const hs = startDirect(f, 'g1-1');
    f.undo(hs);
    single(f.run(swap('g1-1', 1, 2)), 'TablesSwapped');
  });

  it('M15/ADR 025: KO-Durchgang vor dem Start tauschbar', () => {
    const f = advanced();
    f.run(swap('H-sf-1', 1, 2));
    expect(f.heat('H-sf-1').matchIds).toEqual(['SF2', 'SF1']);
  });
});

// ---------------------------------------------------------------------------
// recordResult – nur Bezug zu Durchgängen (Details der Ergebnisprüfung: result-commands.test.ts)
// ---------------------------------------------------------------------------

describe('recordResult – nur Partien gestarteter Durchgänge (SPEC Tische und Durchgänge)', () => {
  it('SPEC: Partie des nächsten Durchgangs, während der aktuelle läuft → HEAT_NOT_STARTED', () => {
    const f = groupStage();
    startDirect(f, 'g1-1');
    f.expectError(winCommand(f, 'B-1-2'), 'HEAT_NOT_STARTED');
  });

  it('SPEC: Partie einer späteren Runde → HEAT_NOT_STARTED', () => {
    const f = groupStage();
    startDirect(f, 'g1-1');
    f.expectError(winCommand(f, 'A-2-1'), 'HEAT_NOT_STARTED');
  });

  it('SPEC: Partie eines gestarteten Durchgangs → ResultRecorded (Gegenprobe)', () => {
    const f = groupStage();
    startDirect(f, 'g1-1');
    single(f.run(winCommand(f, 'B-1-1')), 'ResultRecorded');
  });

  it('SPEC/M19: aufgehobenes HeatStarted → Ergebnis wieder HEAT_NOT_STARTED', () => {
    const f = groupStage();
    const hs = startDirect(f, 'g1-1');
    f.undo(hs);
    f.expectError(winCommand(f, 'A-1-1'), 'HEAT_NOT_STARTED');
  });

  it('SPEC Ergebnis-Payload: Korrektur im fertigen Durchgang (undo + neues Ergebnis) bleibt möglich', () => {
    const f = groupStage();
    startDirect(f, 'g1-1');
    const [r] = finishDirect(f, 'g1-1');
    if (!r) throw new Error('kein Ergebnis');
    f.undo(r);
    single(f.run(winCommand(f, r.payload.matchId)), 'ResultRecorded');
  });

  it('SPEC: Partie eines KO-Durchgangs nach Phasenwechsel, Durchgang nicht gestartet → HEAT_NOT_STARTED', () => {
    const f = advanced();
    f.expectError(winCommand(f, 'SF1'), 'HEAT_NOT_STARTED');
  });
});

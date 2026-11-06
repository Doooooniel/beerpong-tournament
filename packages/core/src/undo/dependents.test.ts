// Regeltests aus SPEC M19 („Warnung bei abhängigen späteren Ereignissen“) und ADR 026-2:
// Abhängigkeitsregeln a–i (Festlegung Hauptagent/Nutzer), transitiv, nur spätere wirksame Ereignisse.
// Ereignisse aus M3 (Start, Timer, Ergebnisse, KO) werden direkt gebaut und per apply eingespielt.
import { describe, expect, it } from 'vitest';
import {
  DomainEventSchema,
  apply,
  decide,
  findDependents,
  initialState,
  replay,
} from '../index.js';
import type {
  Command,
  DecideContext,
  DomainError,
  DomainErrorCode,
  DomainEvent,
  DomainEventType,
  EventOf,
  Heat,
  Match,
  NewEvent,
  Result,
  SettingsPatch,
  TournamentState,
} from '../index.js';

const T0 = 1_767_225_600_000; // feste Zeit, 2026-01-01T00:00:00Z
const GROUP_MS = 900_000;

/** Testsitzung: decide → seq vergeben → apply, wie der Server (ohne I/O). */
class Session {
  state: TournamentState = initialState();
  readonly events: DomainEvent[] = [];
  private nextId = 0;
  private clock = T0;

  ctx(): DecideContext {
    this.clock += 1_000;
    return { now: this.clock, random: () => 0.5, newId: () => `id-${++this.nextId}` };
  }

  decide(command: Command): Result<NewEvent[], DomainError> {
    return decide(this.state, command, this.ctx());
  }

  one<T extends DomainEventType>(command: Command, type: T): EventOf<T> {
    const r = this.decide(command);
    if (!r.ok) throw new Error(`${command.type}: ${r.error.code} – ${r.error.message}`);
    expect(r.value).toHaveLength(1);
    const [e] = r.value;
    if (!e || e.type !== type) throw new Error(`erwartet ${type}, erhalten ${e?.type}`);
    return this.append(e) as EventOf<T>;
  }

  append(e: NewEvent): DomainEvent {
    const event = DomainEventSchema.parse({ ...e, seq: this.events.length + 1 });
    this.events.push(event);
    this.state = apply(this.state, event);
    return event;
  }

  /** Ereignis direkt einspielen (für Befehle, die erst in M3 kommen). */
  push<T extends Exclude<DomainEventType, 'Undone'>>(
    type: T,
    payload: EventOf<T>['payload'],
  ): EventOf<T> {
    const ctx = this.ctx();
    const raw = { id: ctx.newId(), type, v: 1, at: ctx.now, payload };
    return this.append(raw as unknown as NewEvent) as EventOf<T>;
  }

  pushUndone(undoes: string, cascade: string[] = []): EventOf<'Undone'> {
    const ctx = this.ctx();
    const raw = {
      id: ctx.newId(),
      type: 'Undone',
      v: 1,
      at: ctx.now,
      undoes,
      payload: { cascade },
    };
    return this.append(raw as unknown as NewEvent) as EventOf<'Undone'>;
  }

  /** Übernimmt ein erfolgreiches Undo-Ergebnis (genau ein Undone). */
  commit(r: Result<NewEvent[], DomainError>): EventOf<'Undone'> {
    return this.append(expectSingleUndone(r)) as EventOf<'Undone'>;
  }

  deps(target: { id: string }): string[] {
    return findDependents(this.state, target.id);
  }

  isUndone(id: string): boolean {
    const entry = this.state.log.find((e) => e.event.id === id);
    if (!entry) throw new Error(`Protokolleintrag ${id} fehlt`);
    return entry.undone;
  }

  // Bequeme Ereignis-Bausteine
  heatStarted(heatId: string, durationMs: number | null = GROUP_MS) {
    return this.push('HeatStarted', { heatId, durationMs });
  }
  result(matchId: string, winnerTeamId: string) {
    return this.push('ResultRecorded', { matchId, outcome: 'win', winnerTeamId });
  }
  settings(settings: SettingsPatch) {
    return this.push('SettingsUpdated', { settings });
  }
}

const ids = (...events: { id: string }[]) => events.map((e) => e.id);

function expectError(r: Result<NewEvent[], DomainError>, code: DomainErrorCode): DomainError {
  if (r.ok) throw new Error(`erwartet Fehler ${code}, erhalten ${r.value.length} Ereignis(se)`);
  expect(r.error.code).toBe(code);
  return r.error;
}

function expectSingleUndone(r: Result<NewEvent[], DomainError>) {
  if (!r.ok) throw new Error(`erwartet ok, erhalten ${r.error.code}: ${r.error.message}`);
  expect(r.value).toHaveLength(1);
  const [e] = r.value;
  if (!e || e.type !== 'Undone') throw new Error(`erwartet Undone, erhalten ${e?.type}`);
  return e;
}

// ---------------------------------------------------------------------------
// Fixture: 8 Teams, Gruppen A/B à 4, 2 Tische, q = 2 → Halbfinale, Finale, opt. Platz 3.
// Runde r je Gruppe 2 Partien; Durchgang (group, r, 1) = Gruppe A, (group, r, 2) = Gruppe B.
// ---------------------------------------------------------------------------

const ROUND_PAIRS: [number, number][][] = [
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

const groupMatchId = (g: string, round: number, k: number) => `${g}-r${round}-${k}`;
const groupHeatId = (round: number, index: number) => `H-g-r${round}-${index}`;
const KO_HEAT = 'H-ko-sf-1';
const FINAL_HEAT = 'H-ko-f-1';
const P3_HEAT = 'H-ko-p3-1';

function startedSession(beforeStart?: (s: Session) => void) {
  const s = new Session();
  s.one({ type: 'createTournament', name: 'Sommerturnier' }, 'TournamentCreated');
  s.one({ type: 'setTableCount', tableCount: 2 }, 'TableCountSet');
  const team = (name: string) =>
    s.one({ type: 'addTeam', name, players: [`${name} Spieler`] }, 'TeamAdded').payload.teamId;
  const A = ['A1', 'A2', 'A3', 'A4'].map((n) => team(`Team ${n}`));
  const B = ['B1', 'B2', 'B3', 'B4'].map((n) => team(`Team ${n}`));
  for (const t of A) s.push('TeamAssignedToGroup', { teamId: t, groupId: 'A' });
  for (const t of B) s.push('TeamAssignedToGroup', { teamId: t, groupId: 'B' });
  beforeStart?.(s);

  const matches: Match[] = [];
  const heats: Heat[] = [];
  /** matchId → Sieger (immer Slot a), damit Ergebnisse deterministisch sind. */
  const winnerOf: Record<string, string> = {};
  ROUND_PAIRS.forEach((pairs, i) => {
    const round = i + 1;
    (
      [
        ['A', A],
        ['B', B],
      ] as const
    ).forEach(([g, teams], gi) => {
      const matchIds = pairs.map(([x, y], k) => {
        const id = groupMatchId(g, round, k + 1);
        const a = teams[x] as string;
        const b = teams[y] as string;
        matches.push({
          id,
          phase: 'group',
          round,
          position: k + 1,
          groupId: g,
          a: { teamId: a },
          b: { teamId: b },
          bye: false,
        });
        winnerOf[id] = a;
        return id;
      });
      heats.push({
        id: groupHeatId(round, gi + 1),
        phase: 'group',
        round,
        index: gi + 1,
        matchIds,
      });
    });
  });

  const started = s.push('TournamentStarted', {
    groups: [
      { id: 'A', teamIds: A },
      { id: 'B', teamIds: B },
    ],
    advancersPerGroup: 2,
    matches,
    heats,
  });

  /**
   * Spielt die ganze Gruppenphase durch: je Durchgang (in Reihenfolge) erst HeatStarted,
   * dann die Ergebnisse seiner Partien (Regel i: kein Ergebnis ohne gestarteten Durchgang).
   */
  const recordGroup = () => {
    const events: { id: string }[] = [];
    const heatStarts: Record<string, EventOf<'HeatStarted'>> = {};
    const results: Record<string, EventOf<'ResultRecorded'>> = {};
    for (const heat of heats) {
      const hs = s.heatStarted(heat.id);
      heatStarts[heat.id] = hs;
      events.push(hs);
      for (const m of heat.matchIds) {
        const r = s.result(m, winnerOf[m] as string);
        results[m] = r;
        events.push(r);
      }
    }
    const result = (matchId: string) => {
      const r = results[matchId];
      if (!r) throw new Error(`kein Ergebnis für ${matchId}`);
      return r;
    };
    const heatStart = (heatId: string) => {
      const h = heatStarts[heatId];
      if (!h) throw new Error(`kein HeatStarted für ${heatId}`);
      return h;
    };
    return { events, results: Object.values(results), result, heatStart };
  };

  /**
   * KO-Baum: SF1 = A1–B2, SF2 = B1–A2, Finale, optional Platz 3 (SPEC → KO, Über-Kreuz).
   * Alle Partien, deren Ergebnisse die Tests brauchen, liegen in Heats aus PhaseAdvanced.
   */
  const advance = (thirdPlace: boolean) => {
    const [a1, a2] = A as [string, string];
    const [b1, b2] = B as [string, string];
    const ko: Match[] = [
      {
        id: 'SF1',
        phase: 'semifinal',
        round: 1,
        position: 1,
        groupId: null,
        a: { teamId: a1 },
        b: { teamId: b2 },
        bye: false,
      },
      {
        id: 'SF2',
        phase: 'semifinal',
        round: 1,
        position: 2,
        groupId: null,
        a: { teamId: b1 },
        b: { teamId: a2 },
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
    ];
    // state.heats-Reihenfolge = Spielreihenfolge (Regel e): HF, ggf. Platz 3, dann Finale.
    const koHeats: Heat[] = [
      { id: KO_HEAT, phase: 'semifinal', round: 1, index: 1, matchIds: ['SF1', 'SF2'] },
    ];
    const finalHeat: Heat = {
      id: FINAL_HEAT,
      phase: 'final',
      round: 1,
      index: 1,
      matchIds: ['FINAL'],
    };
    if (thirdPlace) {
      ko.push({
        id: 'P3',
        phase: 'thirdPlace',
        round: 1,
        position: 1,
        groupId: null,
        a: { loserOf: 'SF1' },
        b: { loserOf: 'SF2' },
        bye: false,
      });
      koHeats.push({ id: P3_HEAT, phase: 'thirdPlace', round: 1, index: 1, matchIds: ['P3'] });
    }
    koHeats.push(finalHeat);
    return s.push('PhaseAdvanced', { matches: ko, heats: koHeats });
  };

  return { s, A, B, started, recordGroup, advance };
}

/** Gruppenphase + KO mit Platz 3 komplett: HF-Durchgang, dann Platz 3, dann Finale. */
function knockoutPlayed() {
  const { s, A, B, started, recordGroup, advance } = startedSession((pre) => {
    pre.settings({ thirdPlaceMatch: true });
  });
  const group = recordGroup();
  const pa = advance(true);
  const view = s.push('BeamerViewSet', { view: 'bracket' });
  const hs = s.heatStarted(KO_HEAT, null);
  const tp = s.push('TimerPaused', { heatId: KO_HEAT });
  const undoneTp = s.pushUndone(tp.id);
  const sf1 = s.result('SF1', A[0] as string); // Verlierer B2
  const sf2 = s.result('SF2', B[0] as string); // Verlierer A2
  const hsP3 = s.heatStarted(P3_HEAT, null);
  const p3 = s.result('P3', A[1] as string);
  const hsF = s.heatStarted(FINAL_HEAT, null);
  const fin = s.result('FINAL', A[0] as string);
  return { s, started, group, pa, view, hs, tp, undoneTp, sf1, sf2, hsP3, p3, hsF, fin };
}

// ---------------------------------------------------------------------------

describe('Regel a: Team-Ereignisse hängen vom TeamAdded ab (M19, ADR 026-2)', () => {
  const setup = () => {
    const s = new Session();
    s.one({ type: 'createTournament', name: 'Sommerturnier' }, 'TournamentCreated');
    const x = s.one({ type: 'addTeam', name: 'X', players: ['Ana'] }, 'TeamAdded');
    const y = s.one({ type: 'addTeam', name: 'Y', players: ['Ben'] }, 'TeamAdded');
    const tx = x.payload.teamId;
    const ty = y.payload.teamId;
    const rx = s.one({ type: 'renameTeam', teamId: tx, name: 'X2' }, 'TeamRenamed');
    const view = s.one({ type: 'setBeamerView', view: 'standings' }, 'BeamerViewSet');
    const ry = s.one({ type: 'renameTeam', teamId: ty, name: 'Y2' }, 'TeamRenamed');
    const px = s.one({ type: 'setPlayers', teamId: tx, players: ['Ana', 'Cem'] }, 'PlayersSet');
    const ax = s.push('TeamAssignedToGroup', { teamId: tx, groupId: 'A' });
    const ga1 = s.push('GroupsAssigned', { assignment: { [tx]: 'A', [ty]: 'B' } });
    const ga2 = s.push('GroupsAssigned', { assignment: { [ty]: 'A' } });
    const remove = s.one({ type: 'removeTeam', teamId: tx }, 'TeamRemoved');
    return { s, x, y, rx, view, ry, px, ax, ga1, ga2, remove };
  };

  it('M19/a: TeamRenamed, PlayersSet, TeamAssignedToGroup, GroupsAssigned (mit t), TeamRemoved von t', () => {
    const { s, x, rx, px, ax, ga1, remove } = setup();
    expect(s.deps(x)).toEqual(ids(rx, px, ax, ga1, remove));
  });

  it('M19/a: Ereignisse anderer Teams und GroupsAssigned ohne t hängen nicht ab', () => {
    const { s, y, ry, ga1, ga2 } = setup();
    expect(s.deps(y)).toEqual(ids(ry, ga1, ga2));
  });

  it('M19/a: Beamer-Ereignisse sind nie abhängig', () => {
    const { s, x, view } = setup();
    expect(s.deps(x)).not.toContain(view.id);
    expect(s.deps(view)).toEqual([]);
  });

  it('M19/a: decide undoEvent meldet dieselben Abhängigen wie findDependents', () => {
    const { s, x } = setup();
    const error = expectError(
      s.decide({ type: 'undoEvent', eventId: x.id }),
      'UNDO_HAS_DEPENDENTS',
    );
    expect(error.dependents).toEqual(s.deps(x));
  });
});

describe('findDependents – Randfälle (Nutzerentscheidung zu ADR 026)', () => {
  it('ADR026-2: unbekannte Ereignis-ID → []', () => {
    const { s } = startedSession();
    expect(findDependents(s.state, 'gibt-es-nicht')).toEqual([]);
  });

  it('ADR026-2: bereits aufgehobenes Ziel → [] (auch wenn spätere Ereignisse sonst abhingen)', () => {
    const { s, A } = startedSession();
    s.heatStarted(groupHeatId(1, 1));
    const r = s.result(groupMatchId('A', 1, 1), A[0] as string);
    s.push('PlayoffRecorded', {
      groupId: 'A',
      tiedTeamIds: [A[0] as string, A[1] as string],
      winnerTeamId: A[0] as string,
    });
    s.pushUndone(r.id);
    expect(s.deps(r)).toEqual([]);
  });
});

describe('Regel b: TournamentStarted hängt von strukturellen Setup-Ereignissen ab (M19)', () => {
  type Case = [
    label: string,
    produce: (s: Session, teamId: string) => { id: string },
    dependent: boolean,
  ];
  const cases: Case[] = [
    [
      'TeamAdded',
      (s) => s.one({ type: 'addTeam', name: 'Fünf', players: ['Eva'] }, 'TeamAdded'),
      true,
    ],
    [
      'TeamRemoved',
      (s) => {
        const t = s.one({ type: 'addTeam', name: 'Fünf', players: ['Eva'] }, 'TeamAdded').payload
          .teamId;
        return s.one({ type: 'removeTeam', teamId: t }, 'TeamRemoved');
      },
      true,
    ],
    [
      'TableCountSet',
      (s) => s.one({ type: 'setTableCount', tableCount: 3 }, 'TableCountSet'),
      true,
    ],
    [
      'TeamAssignedToGroup',
      (s, t) => s.push('TeamAssignedToGroup', { teamId: t, groupId: 'B' }),
      true,
    ],
    ['GroupsAssigned', (s, t) => s.push('GroupsAssigned', { assignment: { [t]: 'A' } }), true],
    ['SettingsUpdated { mode }', (s) => s.settings({ mode: 'groupsKo' }), true],
    ['SettingsUpdated { groupCount }', (s) => s.settings({ groupCount: 2 }), true],
    ['SettingsUpdated { advancersPerGroup }', (s) => s.settings({ advancersPerGroup: 1 }), true],
    ['SettingsUpdated { trackCups }', (s) => s.settings({ trackCups: true }), true],
    [
      'SettingsUpdated { trackCups, soundEnabled } (gemischt)',
      (s) => s.settings({ trackCups: true, soundEnabled: false }),
      true,
    ],
    [
      'TeamRenamed',
      (s, t) => s.one({ type: 'renameTeam', teamId: t, name: 'Anders' }, 'TeamRenamed'),
      false,
    ],
    [
      'PlayersSet',
      (s, t) => s.one({ type: 'setPlayers', teamId: t, players: ['Neu'] }, 'PlayersSet'),
      false,
    ],
    ['SettingsUpdated { soundEnabled }', (s) => s.settings({ soundEnabled: false }), false],
    ['SettingsUpdated { thirdPlaceMatch }', (s) => s.settings({ thirdPlaceMatch: true }), false],
    [
      'SettingsUpdated { rotationIntervalMs }',
      (s) => s.settings({ rotationIntervalMs: 20_000 }),
      false,
    ],
    [
      'SettingsUpdated { timerByPhase }',
      (s) => s.settings({ timerByPhase: { group: 600_000 } }),
      false,
    ],
    [
      'SettingsUpdated { timerWarningsMs }',
      (s) => s.settings({ timerWarningsMs: [60_000] }),
      false,
    ],
    [
      'SettingsUpdated { showUpcomingOnlyInPreparing }',
      (s) => s.settings({ showUpcomingOnlyInPreparing: true }),
      false,
    ],
    [
      'BeamerModeSet',
      (s) => s.one({ type: 'setBeamerMode', mode: 'fixed' }, 'BeamerModeSet'),
      false,
    ],
  ];

  it.each(cases)('M19/b: %s → TournamentStarted abhängig: %s', (_label, produce, dependent) => {
    const s = new Session();
    s.one({ type: 'createTournament', name: 'Sommerturnier' }, 'TournamentCreated');
    const teams = ['T1', 'T2', 'T3', 'T4'].map(
      (name) => s.one({ type: 'addTeam', name, players: ['P'] }, 'TeamAdded').payload.teamId,
    );
    const target = produce(s, teams[0] as string);
    const started = s.push('TournamentStarted', {
      groups: [
        { id: 'A', teamIds: teams.slice(0, 2) },
        { id: 'B', teamIds: teams.slice(2) },
      ],
      advancersPerGroup: 1,
      matches: [],
      heats: [],
    });
    expect(s.deps(target)).toEqual(dependent ? [started.id] : []);
  });

  it('M19/b: TeamAdded eines gestarteten Teams → TeamAssignedToGroup und TournamentStarted (transitiv)', () => {
    const { s, A, started } = startedSession();
    const teamAdded = s.events.find((e) => e.type === 'TeamAdded' && e.payload.teamId === A[0]);
    const assigned = s.events.find(
      (e) => e.type === 'TeamAssignedToGroup' && e.payload.teamId === A[0],
    );
    if (!teamAdded || !assigned) throw new Error('Fixture unvollständig');
    expect(s.deps(teamAdded)).toEqual(ids(assigned, started));
  });
});

describe('Regel c: Durchgänge, Partien, Gruppen hängen vom erzeugenden Ereignis ab (M19)', () => {
  it('M19/c: TablesSwapped, HeatStarted, Timer*, ResultRecorded, PlayoffRecorded hängen von TournamentStarted ab', () => {
    const { s, A, started } = startedSession();
    const hs = s.heatStarted(groupHeatId(1, 1));
    const sw = s.push('TablesSwapped', { heatId: groupHeatId(1, 2), tableA: 1, tableB: 2 });
    const tp = s.push('TimerPaused', { heatId: groupHeatId(1, 1) });
    const rr = s.result(groupMatchId('A', 1, 1), A[0] as string);
    const po = s.push('PlayoffRecorded', {
      groupId: 'A',
      tiedTeamIds: [A[0] as string, A[1] as string],
      winnerTeamId: A[0] as string,
    });
    // nicht abhängig: späte Einstellungen, Umbenennung, Beamer
    s.settings({ soundEnabled: false });
    s.push('TeamRenamed', { teamId: A[2] as string, name: 'Spät umbenannt' });
    s.push('BeamerViewSet', { view: 'timer' });
    expect(s.deps(started)).toEqual(ids(hs, sw, tp, rr, po));
  });

  it('M19/c: KO-Durchgänge und KO-Ergebnisse hängen von PhaseAdvanced ab, PhaseAdvanced von TournamentStarted', () => {
    const { s, A, B, started, recordGroup, advance } = startedSession();
    const group = recordGroup();
    const pa = advance(false);
    const sw = s.push('TablesSwapped', { heatId: KO_HEAT, tableA: 1, tableB: 2 });
    const hs = s.heatStarted(KO_HEAT, null);
    const sf1 = s.result('SF1', A[0] as string);
    const sf2 = s.result('SF2', B[0] as string);
    const hsF = s.heatStarted(FINAL_HEAT, null);
    const fin = s.result('FINAL', A[0] as string);
    expect(s.deps(pa)).toEqual(ids(sw, hs, sf1, sf2, hsF, fin));
    expect(s.deps(started)).toEqual(ids(...group.events, pa, sw, hs, sf1, sf2, hsF, fin));
  });

  it('M19/c: TablesSwapped hat keine Abhängigen und hängt nicht von HeatStarted ab', () => {
    const { s } = startedSession();
    const hs = s.heatStarted(groupHeatId(1, 1));
    const sw = s.push('TablesSwapped', { heatId: groupHeatId(1, 1), tableA: 1, tableB: 2 });
    expect(s.deps(hs)).toEqual([]);
    expect(s.deps(sw)).toEqual([]);
  });
});

describe('Regel d: Timer-Kette eines Durchgangs (M13, M19)', () => {
  const setup = () => {
    const { s } = startedSession();
    const h1 = groupHeatId(1, 1);
    const h2 = groupHeatId(2, 1);
    const hs1 = s.heatStarted(h1);
    const tp1 = s.push('TimerPaused', { heatId: h1 });
    const hs2 = s.heatStarted(h2);
    const tp2 = s.push('TimerPaused', { heatId: h2 });
    const sw1 = s.push('TablesSwapped', { heatId: h1, tableA: 1, tableB: 2 });
    const tr1 = s.push('TimerResumed', { heatId: h1 });
    const te1 = s.push('TimerExtended', { heatId: h1, byMs: 60_000 });
    const trs1 = s.push('TimerRestarted', { heatId: h1, durationMs: GROUP_MS });
    const tp1b = s.push('TimerPaused', { heatId: h1 });
    return { s, hs1, tp1, hs2, tp2, sw1, tr1, te1, trs1, tp1b };
  };

  type Key = Exclude<keyof ReturnType<typeof setup>, 's'>;
  type Row = [label: string, target: Key, expected: Key[]];
  const rows: Row[] = [
    ['HeatStarted h1', 'hs1', ['tp1', 'tr1', 'te1', 'trs1', 'tp1b']],
    ['TimerPaused h1', 'tp1', ['tr1', 'te1', 'trs1', 'tp1b']],
    ['TimerResumed h1', 'tr1', ['te1', 'trs1', 'tp1b']],
    ['TimerExtended h1', 'te1', ['trs1', 'tp1b']],
    ['TimerRestarted h1', 'trs1', ['tp1b']],
    ['letztes TimerPaused h1', 'tp1b', []],
    ['HeatStarted h2 (anderer Durchgang)', 'hs2', ['tp2']],
    ['TablesSwapped h1 (kein Timer-Ereignis)', 'sw1', []],
  ];

  it.each(rows)('M19/d: %s', (_label, target, expected) => {
    const fixture = setup();
    const ev = (k: Key): { id: string } => fixture[k];
    expect(fixture.s.deps(ev(target))).toEqual(expected.map((k) => ev(k).id));
  });

  it('M19/d: aufgehobenes Timer-Ereignis ist kein Abhängiger', () => {
    const { s, hs1, tp1, tr1, te1, trs1, tp1b } = setup();
    s.pushUndone(te1.id);
    expect(s.deps(hs1)).toEqual(ids(tp1, tr1, trs1, tp1b));
  });
});

describe('Regeln e und i: Durchgänge und ihre Ergebnisse (SPEC Tische und Durchgänge, M19)', () => {
  const setup = () => {
    const { s, A, B } = startedSession();
    const hs11 = s.heatStarted(groupHeatId(1, 1));
    const rA1 = s.result(groupMatchId('A', 1, 1), A[0] as string);
    const rA2 = s.result(groupMatchId('A', 1, 2), A[1] as string);
    const hs12 = s.heatStarted(groupHeatId(1, 2));
    const tp12 = s.push('TimerPaused', { heatId: groupHeatId(1, 2) });
    const rB1 = s.result(groupMatchId('B', 1, 1), B[0] as string);
    const rB2 = s.result(groupMatchId('B', 1, 2), B[1] as string);
    const hs21 = s.heatStarted(groupHeatId(2, 1));
    return { s, hs11, rA1, rA2, hs12, tp12, rB1, rB2, hs21 };
  };

  it('M19/e: Ergebnis aus Durchgang (r1, 1) → HeatStarted (r1, 2), transitiv dessen Timer, Ergebnisse und (r2, 1)', () => {
    const { s, rA1, rA2, hs12, tp12, rB1, rB2, hs21 } = setup();
    expect(s.deps(rA1)).toEqual(ids(hs12, tp12, rB1, rB2, hs21));
    expect(s.deps(rA2)).toEqual(ids(hs12, tp12, rB1, rB2, hs21));
  });

  it('M19/e: erster Durchgang einer neuen Runde hängt vom letzten Durchgang der Vorrunde ab (streng nacheinander)', () => {
    const { s, rB1, rB2, hs21 } = setup();
    expect(s.deps(rB1)).toEqual([hs21.id]);
    expect(s.deps(rB2)).toEqual([hs21.id]);
  });

  it('M19/e: nur der unmittelbar vorherige Durchgang zählt, nicht ältere', () => {
    const { s, rA1, hs12, tp12, rB1, rB2, hs21 } = setup();
    // (r2, 1) hängt direkt nur von (r1, 2) ab; von (r1, 1) nur transitiv über HeatStarted (r1, 2)
    expect(s.deps(rA1)).toEqual(ids(hs12, tp12, rB1, rB2, hs21));
    s.pushUndone(hs12.id, ids(tp12, rB1, rB2, hs21));
    expect(s.deps(rA1)).toEqual([]);
  });

  it('M19/i: Ergebnisse hängen vom HeatStarted ihres Durchgangs ab (transitiv bis Runde 2)', () => {
    const { s, hs11, rA1, rA2, hs12, tp12, rB1, rB2, hs21 } = setup();
    expect(s.deps(hs11)).toEqual(ids(rA1, rA2, hs12, tp12, rB1, rB2, hs21));
    expect(s.deps(hs12)).toEqual(ids(tp12, rB1, rB2, hs21));
    expect(s.deps(hs21)).toEqual([]);
  });

  it('M19/i: maßgeblich ist das wirksame HeatStarted (nach Aufheben neu gestartet)', () => {
    const { s, A } = startedSession();
    const old = s.heatStarted(groupHeatId(1, 1));
    s.pushUndone(old.id);
    const fresh = s.heatStarted(groupHeatId(1, 1));
    const r = s.result(groupMatchId('A', 1, 1), A[0] as string);
    expect(s.deps(fresh)).toEqual([r.id]);
    expect(s.deps(old)).toEqual([]);
  });

  it('M19/i: undoEvent auf HeatStarted ohne confirm → UNDO_HAS_DEPENDENTS mit Ergebnissen des Durchgangs', () => {
    const { s, hs11, rA1, rA2, hs12, tp12, rB1, rB2, hs21 } = setup();
    const error = expectError(
      s.decide({ type: 'undoEvent', eventId: hs11.id }),
      'UNDO_HAS_DEPENDENTS',
    );
    expect(error.dependents).toEqual(ids(rA1, rA2, hs12, tp12, rB1, rB2, hs21));
  });

  it('M19/e: undoEvent auf das Ergebnis ohne confirm → UNDO_HAS_DEPENDENTS; mit confirm → Kaskade', () => {
    const { s, rA1, rA2, hs12, tp12, rB1, rB2, hs21 } = setup();
    const chain = ids(hs12, tp12, rB1, rB2, hs21);
    const error = expectError(
      s.decide({ type: 'undoEvent', eventId: rA1.id }),
      'UNDO_HAS_DEPENDENTS',
    );
    expect(error.dependents).toEqual(chain);
    const u = expectSingleUndone(s.decide({ type: 'undoEvent', eventId: rA1.id, confirm: true }));
    expect(u.undoes).toBe(rA1.id);
    expect(u.payload.cascade).toEqual(chain);
    s.append(u);
    expect(s.state.results[groupMatchId('A', 1, 1)]).toBeUndefined();
    expect(s.state.results[groupMatchId('A', 1, 2)]).toBeDefined();
    expect(s.state.results[groupMatchId('B', 1, 1)]).toBeUndefined();
    expect(s.state.results[groupMatchId('B', 1, 2)]).toBeUndefined();
    expect(s.state.timers[groupHeatId(1, 2)]).toBeUndefined();
    expect(s.state.timers[groupHeatId(2, 1)]).toBeUndefined();
    expect(s.state.timers[groupHeatId(1, 1)]).toBeDefined();
    expect(s.isUndone(rA2.id)).toBe(false);
  });
});

describe('Regel f: PhaseAdvanced hängt von Gruppenergebnissen, Stechen und thirdPlaceMatch ab (M19)', () => {
  it('M19/f: alle Gruppenergebnisse, Stechen und SettingsUpdated { thirdPlaceMatch } → PhaseAdvanced', () => {
    const { s, A, recordGroup, advance } = startedSession();
    const group = recordGroup();
    const tpm = s.settings({ thirdPlaceMatch: true });
    const sound = s.settings({ soundEnabled: false });
    const po = s.push('PlayoffRecorded', {
      groupId: 'A',
      tiedTeamIds: [A[2] as string, A[3] as string],
      winnerTeamId: A[2] as string,
    });
    const pa = advance(true);
    for (const r of group.results) expect(s.deps(r)).toContain(pa.id);
    expect(s.deps(tpm)).toEqual([pa.id]);
    expect(s.deps(sound)).toEqual([]);
    expect(s.deps(po)).toEqual([pa.id]);
    expect(s.deps(group.result(groupMatchId('A', 1, 1)))).toContain(po.id);
    // Letzter Gruppendurchgang (r3, 2): kein gestarteter Nachfolger-Durchgang, kein Stechen von B
    expect(s.deps(group.result(groupMatchId('B', 3, 1)))).toEqual([pa.id]);
    // Regel e über Rundengrenzen: (r1, 2) → HeatStarted (r2, 1) → … bis Runde 3, Stechen A, PhaseAdvanced
    const fromR21 = group.events.indexOf(group.heatStart(groupHeatId(2, 1)));
    expect(s.deps(group.result(groupMatchId('B', 1, 1)))).toEqual([
      ...ids(...group.events.slice(fromR21)),
      po.id,
      pa.id,
    ]);
  });

  it('M19/f: SettingsUpdated { thirdPlaceMatch } vor dem Start → nur PhaseAdvanced, nicht TournamentStarted', () => {
    let tpm: { id: string } | undefined;
    const { s, recordGroup, advance } = startedSession((pre) => {
      tpm = pre.settings({ thirdPlaceMatch: true });
    });
    recordGroup();
    const pa = advance(true);
    if (!tpm) throw new Error('kein SettingsUpdated');
    expect(s.deps(tpm)).toEqual([pa.id]);
  });

  it('M19/i+f: HeatStarted eines Gruppendurchgangs → dessen Ergebnisse → PhaseAdvanced', () => {
    const { s, recordGroup, advance } = startedSession();
    const group = recordGroup();
    const pa = advance(false);
    const last = group.heatStart(groupHeatId(3, 2));
    expect(s.deps(last)).toEqual(
      ids(group.result(groupMatchId('B', 3, 1)), group.result(groupMatchId('B', 3, 2)), pa),
    );
  });
});

describe('Regel g: Stechen hängt von den Ergebnissen der Gruppe und früheren Stechen ab (SPEC Stechen, M19)', () => {
  const setup = () => {
    const { s, A, B, recordGroup } = startedSession();
    const group = recordGroup();
    const ra = group.results.filter((r) => r.payload.matchId.startsWith('A-'));
    const rb = group.results.filter((r) => r.payload.matchId.startsWith('B-'));
    const [a1, a2, a3] = A as [string, string, string];
    const [b1, b2] = B as [string, string];
    const pa1 = s.push('PlayoffRecorded', {
      groupId: 'A',
      tiedTeamIds: [a1, a2, a3],
      winnerTeamId: a1,
    });
    const pb = s.push('PlayoffRecorded', { groupId: 'B', tiedTeamIds: [b1, b2], winnerTeamId: b1 });
    const pa2 = s.push('PlayoffRecorded', {
      groupId: 'A',
      tiedTeamIds: [a2, a3],
      winnerTeamId: a2,
    });
    return { s, group, ra, rb, pa1, pb, pa2 };
  };

  it('M19/g: jedes Ergebnis der Gruppe A → beide Stechen der Gruppe A', () => {
    const { s, ra, pa1, pa2 } = setup();
    for (const r of ra) {
      expect(s.deps(r)).toContain(pa1.id);
      expect(s.deps(r)).toContain(pa2.id);
    }
  });

  it('M19/g: Ergebnis der Gruppe B im letzten Durchgang → nur Stechen der Gruppe B, keins von A', () => {
    const { s, rb, pb } = setup();
    for (const r of rb) expect(s.deps(r)).toContain(pb.id);
    const lastRound = rb.filter((r) => r.payload.matchId.startsWith('B-r3-'));
    expect(lastRound).toHaveLength(2);
    for (const r of lastRound) expect(s.deps(r)).toEqual([pb.id]);
  });

  it('M19/e+g: Ergebnis der Gruppe B aus Runde 1 → über die Durchgangskette auch Stechen von A', () => {
    const { s, group, pa1, pb, pa2 } = setup();
    const deps = s.deps(group.result(groupMatchId('B', 1, 1)));
    expect(deps).toContain(group.heatStart(groupHeatId(2, 1)).id);
    expect(deps.slice(-3)).toEqual(ids(pa1, pb, pa2));
  });

  it('M19/e+i+g: Ergebnis A der Runde 3 → Durchgang B der Runde 3 → dessen Ergebnisse → Stechen', () => {
    const { s, group, pa1, pb, pa2 } = setup();
    expect(s.deps(group.result(groupMatchId('A', 3, 1)))).toEqual(
      ids(
        group.heatStart(groupHeatId(3, 2)),
        group.result(groupMatchId('B', 3, 1)),
        group.result(groupMatchId('B', 3, 2)),
        pa1,
        pb,
        pa2,
      ),
    );
  });

  it('M19/g: späteres Stechen derselben Gruppe hängt vom früheren ab (Warnung laut SPEC Stechen)', () => {
    const { s, pa1, pb, pa2 } = setup();
    expect(s.deps(pa1)).toEqual([pa2.id]);
    expect(s.deps(pb)).toEqual([]);
    expect(s.deps(pa2)).toEqual([]);
    const error = expectError(
      s.decide({ type: 'undoEvent', eventId: pa1.id }),
      'UNDO_HAS_DEPENDENTS',
    );
    expect(error.dependents).toEqual([pa2.id]);
  });
});

describe('Regel h: KO-Ergebnis hängt von den Ergebnissen seiner Quellen ab (M14, M19)', () => {
  it('M19/h+e: Halbfinal-Ergebnisse → Platz 3 (loserOf), Finale (winnerOf) und Platz-3-Durchgang (Regel e)', () => {
    const { s, sf1, sf2, hsP3, p3, hsF, fin } = knockoutPlayed();
    expect(s.deps(sf1)).toEqual(ids(hsP3, p3, hsF, fin));
    expect(s.deps(sf2)).toEqual(ids(hsP3, p3, hsF, fin));
  });

  it('M19/h+e: Finale hängt nur über die Durchgangsfolge (Regel e) vom Platz-3-Ergebnis ab', () => {
    const { s, p3, hsF, fin } = knockoutPlayed();
    expect(s.deps(p3)).toEqual(ids(hsF, fin));
    expect(s.deps(fin)).toEqual([]);
  });

  it('M19/i: KO-Ergebnisse hängen vom HeatStarted ihres Durchgangs aus PhaseAdvanced ab', () => {
    const { s, hs, sf1, sf2, hsP3, p3, hsF, fin } = knockoutPlayed();
    expect(s.deps(hs)).toEqual(ids(sf1, sf2, hsP3, p3, hsF, fin));
    expect(s.deps(hsP3)).toEqual(ids(p3, hsF, fin));
    expect(s.deps(hsF)).toEqual([fin.id]);
  });

  it('M19/e+f: erster KO-Durchgang hängt von den Ergebnissen des letzten Gruppendurchgangs ab', () => {
    // Regel e (Vorgänger = Durchgang (r3, 2)) und transitiv über PhaseAdvanced (Regel f → c)
    const { s, group, pa, hs } = knockoutPlayed();
    for (const k of [1, 2]) {
      const deps = s.deps(group.result(groupMatchId('B', 3, k)));
      expect(deps).toContain(pa.id);
      expect(deps).toContain(hs.id);
    }
  });

  it('M19/c: PhaseAdvanced → KO-Durchgänge und alle KO-Ergebnisse; Beamer, aufgehobene und Undone nicht', () => {
    const { s, pa, hs, sf1, sf2, hsP3, p3, hsF, fin, view, tp, undoneTp } = knockoutPlayed();
    const deps = s.deps(pa);
    expect(deps).toEqual(ids(hs, sf1, sf2, hsP3, p3, hsF, fin));
    expect(deps).not.toContain(view.id);
    expect(deps).not.toContain(tp.id);
    expect(deps).not.toContain(undoneTp.id);
  });
});

describe('Transitive Kette: Gruppenergebnis → PhaseAdvanced → KO-Ergebnisse (M19, SPEC Admin & Protokoll)', () => {
  const setup = () => {
    const ko = knockoutPlayed();
    const { s, group, pa, hs, sf1, sf2, hsP3, p3, hsF, fin } = ko;
    const view = s.push('BeamerViewSet', { view: 'podium' });
    const target = group.result(groupMatchId('A', 1, 1));
    // Regel e über alle Runden: ab HeatStarted (r1, 2) hängt jeder spätere Gruppendurchgang
    // samt Ergebnissen (Regel i) ab; Ergebnis A-r1-2 (gleicher Durchgang) nicht.
    const fromR12 = group.events.indexOf(group.heatStart(groupHeatId(1, 2)));
    const chain = ids(
      ...group.events.slice(fromR12),
      pa, // Regel f
      hs, // Regel c
      sf1,
      sf2,
      hsP3,
      p3,
      hsF,
      fin,
    );
    return { s, target, view, chain };
  };

  it('M19: findDependents(Gruppenergebnis) liefert die ganze Kette in seq-Reihenfolge', () => {
    const { s, target, chain } = setup();
    expect(s.deps(target)).toEqual(chain);
  });

  it('M19: undoEvent ohne confirm → UNDO_HAS_DEPENDENTS mit der Kette', () => {
    const { s, target, chain } = setup();
    const error = expectError(
      s.decide({ type: 'undoEvent', eventId: target.id }),
      'UNDO_HAS_DEPENDENTS',
    );
    expect(error.dependents).toEqual(chain);
  });

  it('M19: mit confirm → ein Undone; Zustand zurück in der Gruppenphase', () => {
    const { s, target, chain, view } = setup();
    const u = expectSingleUndone(
      s.decide({ type: 'undoEvent', eventId: target.id, confirm: true }),
    );
    expect(u.undoes).toBe(target.id);
    expect(u.payload.cascade).toEqual(chain);
    s.append(u);
    expect(s.state.phase).toBe('groups');
    expect(s.state.results[target.payload.matchId]).toBeUndefined();
    expect(s.state.results[groupMatchId('B', 1, 1)]).toBeUndefined();
    expect(s.state.timers[groupHeatId(1, 2)]).toBeUndefined();
    for (const m of ['SF1', 'SF2', 'P3', 'FINAL']) {
      expect(s.state.results[m]).toBeUndefined();
      expect(s.state.matches.some((x) => x.id === m)).toBe(false);
    }
    for (const h of [KO_HEAT, P3_HEAT, FINAL_HEAT]) {
      expect(s.state.heats.some((x) => x.id === h)).toBe(false);
    }
    for (const id of [target.id, ...chain]) expect(s.isUndone(id)).toBe(true);
    expect(s.isUndone(view.id)).toBe(false);
    expect(s.state.beamer.view).toBe('podium');
    expect(replay(s.events)).toEqual(s.state);
  });

  it('M19: Redo stellt Ergebnis und Kette gemeinsam wieder her', () => {
    const { s, target, chain } = setup();
    const before = s.state;
    const u1 = s.commit(s.decide({ type: 'undoEvent', eventId: target.id, confirm: true }));
    const redo = expectSingleUndone(s.decide({ type: 'undoEvent', eventId: u1.id }));
    expect(redo.payload.cascade).toEqual([]);
    s.append(redo);
    expect(s.state.phase).toBe('knockout');
    for (const id of [target.id, ...chain]) expect(s.isUndone(id)).toBe(false);
    expect({ ...s.state, version: 0, log: [] }).toEqual({ ...before, version: 0, log: [] });
  });

  it('SPEC Ergebnis-Payload: Korrektur nach Kaskade (neues Ergebnis) → Redo REDO_NOT_POSSIBLE', () => {
    const { s, target } = setup();
    const u1 = s.commit(s.decide({ type: 'undoEvent', eventId: target.id, confirm: true }));
    // Durchgang (r1, 1) ist weiterhin gestartet → neues Ergebnis zulässig (Regel i)
    s.push('ResultRecorded', { matchId: target.payload.matchId, outcome: 'draw' });
    expectError(s.decide({ type: 'undoEvent', eventId: u1.id }), 'REDO_NOT_POSSIBLE');
  });
});

describe('Redo bei weiterhin aufgehobener Grundlage (ADR 026-5 erweitert, Nutzerentscheidung)', () => {
  const setup = () => {
    const { s, A, recordGroup, advance } = startedSession();
    recordGroup();
    const pa = advance(false);
    const hs = s.heatStarted(KO_HEAT, null);
    const sf1 = s.result('SF1', A[0] as string);
    const u1 = s.commit(s.decide({ type: 'undo' }));
    const u2 = s.commit(s.decide({ type: 'undoEvent', eventId: pa.id, confirm: true }));
    return { s, pa, hs, sf1, u1, u2 };
  };

  it('ADR026-5: Ausgangslage – U1 hebt das KO-Ergebnis auf, U2 PhaseAdvanced mit Kaskade [HeatStarted]', () => {
    const { u1, u2, sf1, pa, hs } = setup();
    expect(u1.undoes).toBe(sf1.id);
    expect(u1.payload.cascade).toEqual([]);
    expect(u2.undoes).toBe(pa.id);
    expect(u2.payload.cascade).toEqual([hs.id]);
  });

  it('ADR026-5: Redo U1, während PhaseAdvanced aufgehoben ist → REDO_NOT_POSSIBLE', () => {
    const { s, u1 } = setup();
    expectError(s.decide({ type: 'undoEvent', eventId: u1.id }), 'REDO_NOT_POSSIBLE');
    expectError(
      s.decide({ type: 'undoEvent', eventId: u1.id, confirm: true }),
      'REDO_NOT_POSSIBLE',
    );
  });

  it('ADR026-5: erst Redo U2, dann Redo U1 → erlaubt, KO-Ergebnis wieder wirksam', () => {
    const { s, u1, u2, pa, hs, sf1 } = setup();
    s.commit(s.decide({ type: 'undoEvent', eventId: u2.id }));
    expect(s.isUndone(pa.id)).toBe(false);
    expect(s.isUndone(hs.id)).toBe(false);
    expect(s.isUndone(sf1.id)).toBe(true);
    s.commit(s.decide({ type: 'undoEvent', eventId: u1.id }));
    expect(s.isUndone(sf1.id)).toBe(false);
    expect(s.state.phase).toBe('knockout');
    expect(s.state.results['SF1']).toBeDefined();
  });
});

describe('Regel b erweitert: Nur-KO-Start hängt von thirdPlaceMatch ab (M04, S04, M19, Review)', () => {
  const setup = (patch: SettingsPatch) => {
    const s = new Session();
    s.one({ type: 'createTournament', name: 'Sommerturnier' }, 'TournamentCreated');
    s.settings({ mode: 'koOnly' });
    const [t1, t2, t3, t4] = ['T1', 'T2', 'T3', 'T4'].map(
      (name) => s.one({ type: 'addTeam', name, players: ['P'] }, 'TeamAdded').payload.teamId,
    ) as [string, string, string, string];
    const target = s.settings(patch);
    const ko = (id: string, phase: Match['phase'], a: Match['a'], b: Match['b']): Match => ({
      id,
      phase,
      round: 1,
      position: 1,
      groupId: null,
      a,
      b,
      bye: false,
    });
    const started = s.push('TournamentStarted', {
      groups: [],
      advancersPerGroup: null,
      matches: [
        ko('SF1', 'semifinal', { teamId: t1 }, { teamId: t4 }),
        { ...ko('SF2', 'semifinal', { teamId: t2 }, { teamId: t3 }), position: 2 },
        ko('FINAL', 'final', { winnerOf: 'SF1' }, { winnerOf: 'SF2' }),
        ko('P3', 'thirdPlace', { loserOf: 'SF1' }, { loserOf: 'SF2' }),
      ],
      heats: [{ id: 'H-ko-sf-1', phase: 'semifinal', round: 1, index: 1, matchIds: ['SF1'] }],
    });
    return { s, target, started };
  };

  it('M19/b: koOnly – SettingsUpdated { thirdPlaceMatch } → TournamentStarted mit KO-Baum abhängig', () => {
    const { s, target, started } = setup({ thirdPlaceMatch: true });
    expect(s.deps(target)).toContain(started.id);
  });

  it('M19/b: koOnly – undoEvent auf thirdPlaceMatch ohne confirm → UNDO_HAS_DEPENDENTS', () => {
    const { s, target, started } = setup({ thirdPlaceMatch: true });
    const error = expectError(
      s.decide({ type: 'undoEvent', eventId: target.id }),
      'UNDO_HAS_DEPENDENTS',
    );
    expect(error.dependents).toContain(started.id);
  });

  it('M19/b: koOnly – SettingsUpdated { soundEnabled } bleibt unabhängig', () => {
    const { s, target } = setup({ soundEnabled: false });
    expect(s.deps(target)).toEqual([]);
  });
});

import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  DomainEventSchema,
  apply,
  decide,
  initialState,
  replay,
} from './index.js';
import type {
  Command,
  DecideContext,
  DomainError,
  DomainErrorCode,
  DomainEvent,
  DomainEventType,
  EventOf,
  Group,
  Heat,
  Match,
  NewEvent,
  SettingsPatch,
  TournamentState,
} from './index.js';

// ---------------------------------------------------------------------------
// Testhilfen (lokal, weil packages/core/tsconfig.json rootDir = src hat)
// ---------------------------------------------------------------------------

const T0 = 1_700_000_000_000;

let idCounter = 0;
let issuedIds: string[] = [];

beforeEach(() => {
  idCounter = 0;
  issuedIds = [];
});

/** Fester Kontext: feste Zeit, fester Zufall, fortlaufende IDs. */
const ctx = (now: number = T0): DecideContext => ({
  now,
  random: () => 0.5,
  newId: () => {
    idCounter += 1;
    const id = `id-${idCounter}`;
    issuedIds.push(id);
    return id;
  },
});

const withSeq = (event: NewEvent, seq: number): DomainEvent => ({ ...event, seq }) as DomainEvent;

interface Step {
  state: TournamentState;
  events: DomainEvent[];
}

/** decide → seq fortlaufend vergeben → apply. Scheitert der Befehl, scheitert der Test. */
const run = (state: TournamentState, command: Command, now: number = T0): Step => {
  const result = decide(state, command, ctx(now));
  if (!result.ok) {
    throw new Error(`decide(${command.type}) failed: ${result.error.code} ${result.error.message}`);
  }
  let next = state;
  const events = result.value.map((event, i) => withSeq(event, state.version + 1 + i));
  for (const event of events) {
    next = apply(next, event);
  }
  return { state: next, events };
};

/** decide muss mit einem Fehler antworten. */
const fail = (state: TournamentState, command: Command): DomainError => {
  const result = decide(state, command, ctx());
  if (result.ok) {
    throw new Error(`expected error for ${command.type}, got ${JSON.stringify(result.value)}`);
  }
  return result.error;
};

const expectError = (state: TournamentState, command: Command, code: DomainErrorCode): void => {
  const error = fail(state, command);
  expect(error.code).toBe(code);
  expect(typeof error.message).toBe('string');
  expect(error.message.length).toBeGreaterThan(0);
};

/** Genau ein Ereignis des erwarteten Typs. */
const single = <T extends DomainEventType>(events: DomainEvent[], type: T): EventOf<T> => {
  expect(events).toHaveLength(1);
  const event = events[0];
  expect(event?.type).toBe(type);
  return event as EventOf<T>;
};

const create = (settings?: SettingsPatch): TournamentState =>
  run(
    initialState(),
    settings
      ? { type: 'createTournament', name: 'Sommerturnier', settings }
      : { type: 'createTournament', name: 'Sommerturnier' },
  ).state;

const addTeam = (
  state: TournamentState,
  name: string,
  players: string[] = [`${name} 1`],
): { state: TournamentState; teamId: string } => {
  const step = run(state, { type: 'addTeam', name, players });
  const event = single(step.events, 'TeamAdded');
  return { state: step.state, teamId: event.payload.teamId };
};

const addTeams = (
  state: TournamentState,
  names: string[],
): { state: TournamentState; ids: string[] } => {
  let current = state;
  const ids: string[] = [];
  for (const name of names) {
    const added = addTeam(current, name);
    current = added.state;
    ids.push(added.teamId);
  }
  return { state: current, ids };
};

const eventAt = <T extends DomainEventType>(
  state: TournamentState,
  type: T,
  payload: EventOf<T>['payload'],
): DomainEvent =>
  DomainEventSchema.parse({
    id: `hand-${type}-${state.version + 1}`,
    seq: state.version + 1,
    type,
    v: 1,
    at: T0,
    payload,
  });

const groupMatch = (
  id: string,
  groupId: string,
  a: string,
  b: string,
  position: number,
  round = 1,
): Match => ({
  id,
  phase: 'group',
  round,
  position,
  groupId,
  a: { teamId: a },
  b: { teamId: b },
  bye: false,
});

/** Handgebautes TournamentStarted (Befehl startTournament kommt erst in M3). */
const startedPayload = (ids: string[]) => {
  const [a1, a2, b1, b2] = ids as [string, string, string, string];
  const groups: Group[] = [
    { id: 'A', teamIds: [a1, a2] },
    { id: 'B', teamIds: [b1, b2] },
  ];
  const matches: Match[] = [groupMatch('gm-1', 'A', a1, a2, 1), groupMatch('gm-2', 'B', b1, b2, 2)];
  const heats: Heat[] = [
    { id: 'gh-1', phase: 'group', round: 1, index: 1, matchIds: ['gm-1', 'gm-2'] },
  ];
  return { groups, advancersPerGroup: 1, matches, heats };
};

const koPayload = (ids: string[]) => {
  const [a1, , b1] = ids as [string, string, string, string];
  const matches: Match[] = [
    {
      id: 'ko-final',
      phase: 'final',
      round: 1,
      position: 1,
      groupId: null,
      a: { teamId: a1 },
      b: { teamId: b1 },
      bye: false,
    },
  ];
  const heats: Heat[] = [
    { id: 'ko-h1', phase: 'final', round: 1, index: 1, matchIds: ['ko-final'] },
  ];
  return { matches, heats };
};

interface Fixture {
  state: TournamentState;
  ids: string[];
}

/** Turnier mit 4 Teams, A/B zugeteilt, noch in setup. */
const setupFixture = (): Fixture => {
  const { state, ids } = addTeams(create(), ['Alpha', 'Bravo', 'Charlie', 'Delta']);
  let current = state;
  ids.forEach((teamId, i) => {
    current = run(current, { type: 'assignTeamToGroup', teamId, groupId: i < 2 ? 'A' : 'B' }).state;
  });
  return { state: current, ids };
};

const groupsFixture = (): Fixture => {
  const { state, ids } = setupFixture();
  return { state: apply(state, eventAt(state, 'TournamentStarted', startedPayload(ids))), ids };
};

const knockoutFixture = (): Fixture => {
  const { state, ids } = groupsFixture();
  return { state: apply(state, eventAt(state, 'PhaseAdvanced', koPayload(ids))), ids };
};

const teamById = (state: TournamentState, id: string) => state.teams.find((t) => t.id === id);

// ---------------------------------------------------------------------------
// initialState
// ---------------------------------------------------------------------------

describe('initialState (ADR 026, Festlegung 1)', () => {
  it('M01: leerer Zustand vor TournamentCreated', () => {
    expect(initialState()).toEqual({
      version: 0,
      name: '',
      createdAt: null,
      settings: DEFAULT_SETTINGS,
      tableCount: 1,
      phase: 'setup',
      teams: [],
      groupAssignment: {},
      groups: [],
      advancersPerGroup: null,
      matches: [],
      heats: [],
      timers: {},
      results: {},
      playoffs: [],
      beamer: { mode: 'rotation', view: 'timer' },
      log: [],
    });
  });

  it('M01: initialState liefert bei jedem Aufruf einen unabhängigen Zustand', () => {
    const a = initialState();
    a.teams.push({ id: 'x', name: 'X', players: ['x'] });
    expect(initialState().teams).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Vor dem Anlegen
// ---------------------------------------------------------------------------

describe('Befehle vor TournamentCreated (Festlegung 2)', () => {
  it.each<{ command: Command }>([
    { command: { type: 'updateSettings', settings: { trackCups: true } } },
    { command: { type: 'addTeam', name: 'Alpha', players: ['Anna'] } },
    { command: { type: 'renameTeam', teamId: 't1', name: 'Beta' } },
    { command: { type: 'setPlayers', teamId: 't1', players: ['Ben'] } },
    { command: { type: 'removeTeam', teamId: 't1' } },
    { command: { type: 'setTableCount', tableCount: 2 } },
    { command: { type: 'assignTeamToGroup', teamId: 't1', groupId: 'A' } },
    { command: { type: 'setBeamerMode', mode: 'fixed' } },
    { command: { type: 'setBeamerView', view: 'standings' } },
  ])('M01: $command.type → TOURNAMENT_NOT_CREATED', ({ command }) => {
    expectError(initialState(), command, 'TOURNAMENT_NOT_CREATED');
  });
});

// ---------------------------------------------------------------------------
// createTournament
// ---------------------------------------------------------------------------

describe('createTournament (M01, Festlegung 3)', () => {
  it('M01: erzeugt genau ein TournamentCreated mit vollständigen Standard-Settings', () => {
    const result = decide(
      initialState(),
      { type: 'createTournament', name: 'Sommerturnier' },
      ctx(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(1);
    const event = result.value[0];
    expect(event).toMatchObject({
      type: 'TournamentCreated',
      v: 1,
      at: T0,
      payload: { name: 'Sommerturnier', settings: DEFAULT_SETTINGS },
    });
    expect(event).not.toHaveProperty('seq');
    expect(issuedIds).toContain(event?.id);
  });

  it('M01: Ereignis besteht DomainEventSchema (nach Vergabe von seq)', () => {
    const { events } = run(initialState(), { type: 'createTournament', name: 'X' });
    expect(DomainEventSchema.safeParse(events[0]).success).toBe(true);
  });

  it('M04/S01: Settings-Patch wird über DEFAULT_SETTINGS gemischt', () => {
    const { events } = run(initialState(), {
      type: 'createTournament',
      name: 'X',
      settings: { mode: 'koOnly', trackCups: true },
    });
    const event = single(events, 'TournamentCreated');
    expect(event.payload.settings).toEqual({
      ...DEFAULT_SETTINGS,
      mode: 'koOnly',
      trackCups: true,
    });
  });

  it('M12: timerByPhase-Patch wird feldweise gemischt', () => {
    const { events } = run(initialState(), {
      type: 'createTournament',
      name: 'X',
      settings: { timerByPhase: { group: 1_200_000 } },
    });
    const event = single(events, 'TournamentCreated');
    expect(event.payload.settings.timerByPhase).toEqual({
      ...DEFAULT_SETTINGS.timerByPhase,
      group: 1_200_000,
    });
  });

  it('M01: apply setzt name, createdAt = at (erstellt ⇔ createdAt ≠ null), settings, version', () => {
    const { state, events } = run(
      initialState(),
      { type: 'createTournament', name: 'Sommerturnier', settings: { groupCount: 4 } },
      T0 + 42,
    );
    expect(state).toMatchObject({
      version: 1,
      name: 'Sommerturnier',
      createdAt: T0 + 42,
      settings: { ...DEFAULT_SETTINGS, groupCount: 4 },
      phase: 'setup',
      tableCount: 1,
      teams: [],
    });
    expect(state.log).toEqual([{ event: events[0], undone: false }]);
  });

  it('M01: zweites createTournament → TOURNAMENT_ALREADY_CREATED', () => {
    expectError(
      create(),
      { type: 'createTournament', name: 'Nochmal' },
      'TOURNAMENT_ALREADY_CREATED',
    );
  });
});

// ---------------------------------------------------------------------------
// updateSettings
// ---------------------------------------------------------------------------

describe('updateSettings (ADR 026, Festlegung 4)', () => {
  it('Einstellungen: SettingsUpdated enthält nur den Patch', () => {
    const { events } = run(create(), {
      type: 'updateSettings',
      settings: { trackCups: true, rotationIntervalMs: 20_000 },
    });
    const event = single(events, 'SettingsUpdated');
    expect(event.payload.settings).toEqual({ trackCups: true, rotationIntervalMs: 20_000 });
  });

  it('Einstellungen: apply mischt den Patch, übrige Settings bleiben', () => {
    const { state } = run(create(), {
      type: 'updateSettings',
      settings: { thirdPlaceMatch: true, groupCount: 4 },
    });
    expect(state.settings).toEqual({ ...DEFAULT_SETTINGS, thirdPlaceMatch: true, groupCount: 4 });
  });

  it('M12: timerByPhase wird feldweise gemischt', () => {
    const { state } = run(create(), {
      type: 'updateSettings',
      settings: { timerByPhase: { group: 1_200_000, ko16: null } },
    });
    expect(state.settings.timerByPhase).toEqual({
      ...DEFAULT_SETTINGS.timerByPhase,
      group: 1_200_000,
      ko16: null,
    });
  });

  it('Einstellungen: mehrere Updates wirken kumulativ', () => {
    let state = create();
    state = run(state, {
      type: 'updateSettings',
      settings: { timerByPhase: { group: 600_000 } },
    }).state;
    state = run(state, {
      type: 'updateSettings',
      settings: { timerByPhase: { quarterfinal: 300_000 } },
    }).state;
    state = run(state, { type: 'updateSettings', settings: { soundEnabled: false } }).state;
    expect(state.settings).toEqual({
      ...DEFAULT_SETTINGS,
      soundEnabled: false,
      timerByPhase: { ...DEFAULT_SETTINGS.timerByPhase, group: 600_000, quarterfinal: 300_000 },
    });
  });

  it.each<{ settings: SettingsPatch }>([
    { settings: { mode: 'koOnly' } },
    { settings: { groupCount: 4 } },
    { settings: { advancersPerGroup: 2 } },
    { settings: { trackCups: true } },
  ])('M04/M05/M10/S01: nach Start ist $settings gesperrt → SETTING_LOCKED', ({ settings }) => {
    expectError(groupsFixture().state, { type: 'updateSettings', settings }, 'SETTING_LOCKED');
  });

  it('M04/M05: gemischter Patch mit gesperrtem Schlüssel wird ganz abgelehnt', () => {
    expectError(
      groupsFixture().state,
      { type: 'updateSettings', settings: { soundEnabled: false, groupCount: 4 } },
      'SETTING_LOCKED',
    );
  });

  it.each<{ settings: SettingsPatch }>([
    { settings: { thirdPlaceMatch: true } },
    { settings: { timerByPhase: { group: 600_000 } } },
    { settings: { timerWarningsMs: [60_000] } },
    { settings: { soundEnabled: false } },
    { settings: { showUpcomingOnlyInPreparing: true } },
    { settings: { rotationIntervalMs: 30_000 } },
  ])('S02/S03/S04/S06/M12: in Gruppenphase bleibt $settings änderbar', ({ settings }) => {
    const { state, events } = run(groupsFixture().state, { type: 'updateSettings', settings });
    expect(single(events, 'SettingsUpdated').payload.settings).toEqual(settings);
    expect(state.settings).toMatchObject(settings);
  });

  it('S04: thirdPlaceMatch ist in der KO-Phase gesperrt → SETTING_LOCKED', () => {
    expectError(
      knockoutFixture().state,
      { type: 'updateSettings', settings: { thirdPlaceMatch: true } },
      'SETTING_LOCKED',
    );
  });

  it.each<{ settings: SettingsPatch }>([
    { settings: { mode: 'koOnly' } },
    { settings: { trackCups: true } },
  ])('M04/S01: in der KO-Phase ist $settings weiterhin gesperrt', ({ settings }) => {
    expectError(knockoutFixture().state, { type: 'updateSettings', settings }, 'SETTING_LOCKED');
  });

  it.each<{ settings: SettingsPatch }>([
    { settings: { timerByPhase: { quarterfinal: 900_000 } } },
    { settings: { soundEnabled: false } },
    { settings: { rotationIntervalMs: 5_000 } },
  ])('S03/S06/M12: in der KO-Phase bleibt $settings änderbar', ({ settings }) => {
    const { state } = run(knockoutFixture().state, { type: 'updateSettings', settings });
    expect(state.settings).toMatchObject(settings);
  });

  it('M05: Verkleinern von groupCount entfernt Zuteilungen zu weggefallenen Gruppen', () => {
    let state = run(create(), { type: 'updateSettings', settings: { groupCount: 4 } }).state;
    const added = addTeams(state, ['Alpha', 'Bravo', 'Charlie', 'Delta']);
    state = added.state;
    const groups = ['A', 'B', 'C', 'D'];
    added.ids.forEach((teamId, i) => {
      state = run(state, { type: 'assignTeamToGroup', teamId, groupId: groups[i] ?? null }).state;
    });
    state = run(state, { type: 'updateSettings', settings: { groupCount: 2 } }).state;
    const [a, b, c, d] = added.ids as [string, string, string, string];
    expect(state.groupAssignment).toEqual({ [a]: 'A', [b]: 'B' });
    expect(state.groupAssignment).not.toHaveProperty(c);
    expect(state.groupAssignment).not.toHaveProperty(d);
  });

  it('M05: Vergrößern von groupCount behält bestehende Zuteilungen', () => {
    const { state: before, ids } = setupFixture();
    const { state } = run(before, { type: 'updateSettings', settings: { groupCount: 8 } });
    expect(state.groupAssignment).toEqual(before.groupAssignment);
    expect(Object.keys(state.groupAssignment)).toHaveLength(ids.length);
  });

  it.each<{ phase: string; fixture: () => Fixture; settings: SettingsPatch }>([
    { phase: 'setup', fixture: setupFixture, settings: {} },
    { phase: 'setup', fixture: setupFixture, settings: { timerByPhase: {} } },
    { phase: 'groups', fixture: groupsFixture, settings: {} },
    { phase: 'groups', fixture: groupsFixture, settings: { timerByPhase: {} } },
    { phase: 'knockout', fixture: knockoutFixture, settings: {} },
    { phase: 'knockout', fixture: knockoutFixture, settings: { timerByPhase: {} } },
  ])(
    'M20: leerer Patch $settings in Phase $phase erzeugt kein Ereignis, Zustand unverändert',
    ({ fixture, settings }) => {
      const { state } = fixture();
      const before = JSON.stringify(state);
      const result = decide(state, { type: 'updateSettings', settings }, ctx());
      expect(result).toEqual({ ok: true, value: [] });
      expect(JSON.stringify(state)).toBe(before);
    },
  );

  it.each([
    { phase: 'setup', fixture: setupFixture },
    { phase: 'groups', fixture: groupsFixture },
    { phase: 'knockout', fixture: knockoutFixture },
  ])(
    'M20/M12: nicht leerer timerByPhase-Patch in Phase $phase → genau ein SettingsUpdated',
    ({ fixture }) => {
      const { state: before } = fixture();
      const settings: SettingsPatch = { timerByPhase: { group: 600_000 } };
      const { state, events } = run(before, { type: 'updateSettings', settings });
      expect(single(events, 'SettingsUpdated').payload.settings).toEqual(settings);
      expect(state.version).toBe(before.version + 1);
      expect(state.log).toHaveLength(before.log.length + 1);
      expect(state.settings.timerByPhase.group).toBe(600_000);
    },
  );
});

// ---------------------------------------------------------------------------
// setTableCount
// ---------------------------------------------------------------------------

describe('setTableCount (M02)', () => {
  it('M02: TableCountSet setzt die Tischanzahl', () => {
    const { state, events } = run(create(), { type: 'setTableCount', tableCount: 4 });
    expect(single(events, 'TableCountSet').payload).toEqual({ tableCount: 4 });
    expect(state.tableCount).toBe(4);
  });

  it('M02: erneutes Setzen überschreibt', () => {
    let state = run(create(), { type: 'setTableCount', tableCount: 4 }).state;
    state = run(state, { type: 'setTableCount', tableCount: 1 }).state;
    expect(state.tableCount).toBe(1);
  });

  it.each([
    { phase: 'groups', fixture: groupsFixture },
    { phase: 'knockout', fixture: knockoutFixture },
  ])('M02/M15: nach Start ($phase) → TOURNAMENT_ALREADY_STARTED', ({ fixture }) => {
    expectError(
      fixture().state,
      { type: 'setTableCount', tableCount: 3 },
      'TOURNAMENT_ALREADY_STARTED',
    );
  });
});

// ---------------------------------------------------------------------------
// Teams
// ---------------------------------------------------------------------------

describe('addTeam (M03, Festlegung 5/6)', () => {
  it('M03: TeamAdded mit teamId, Name und Spielern; apply hängt Team an', () => {
    const { state, events } = run(create(), {
      type: 'addTeam',
      name: 'Alpha',
      players: ['Anna', 'Arne'],
    });
    const event = single(events, 'TeamAdded');
    expect(event.payload).toMatchObject({ name: 'Alpha', players: ['Anna', 'Arne'] });
    expect(event.payload.teamId.length).toBeGreaterThan(0);
    expect(issuedIds).toContain(event.id);
    expect(state.teams).toEqual([
      { id: event.payload.teamId, name: 'Alpha', players: ['Anna', 'Arne'] },
    ]);
  });

  it.each([1, 2, 6])('M03: flexible Spielerzahl (%i Spieler)', (count) => {
    const players = Array.from({ length: count }, (_, i) => `Spieler ${i + 1}`);
    const { state } = run(create(), { type: 'addTeam', name: 'Alpha', players });
    expect(state.teams[0]?.players).toEqual(players);
  });

  it('M03: Teams in Reihenfolge des Hinzufügens, IDs eindeutig', () => {
    const { state, ids } = addTeams(create(), ['Alpha', 'Bravo', 'Charlie']);
    expect(state.teams.map((t) => t.name)).toEqual(['Alpha', 'Bravo', 'Charlie']);
    expect(state.teams.map((t) => t.id)).toEqual(ids);
    expect(new Set(ids).size).toBe(3);
  });

  it.each(['Alpha', 'alpha', 'ALPHA', ' Alpha ', 'aLpHa  '])(
    'M03: Name "%s" bereits vergeben → TEAM_NAME_TAKEN',
    (name) => {
      const { state } = addTeam(create(), 'Alpha');
      expectError(state, { type: 'addTeam', name, players: ['X'] }, 'TEAM_NAME_TAKEN');
    },
  );

  it('M03: ähnlicher, aber verschiedener Name ist erlaubt', () => {
    const { state } = addTeam(create(), 'Alpha');
    const next = run(state, { type: 'addTeam', name: 'Alpha 2', players: ['X'] }).state;
    expect(next.teams).toHaveLength(2);
  });

  it('M03: Name eines entfernten Teams ist wieder frei', () => {
    const { state, teamId } = addTeam(create(), 'Alpha');
    const removed = run(state, { type: 'removeTeam', teamId }).state;
    const next = run(removed, { type: 'addTeam', name: 'alpha', players: ['X'] }).state;
    expect(next.teams.map((t) => t.name)).toEqual(['alpha']);
  });

  it.each([
    { phase: 'groups', fixture: groupsFixture },
    { phase: 'knockout', fixture: knockoutFixture },
  ])('M03: nach Start ($phase) → TOURNAMENT_ALREADY_STARTED', ({ fixture }) => {
    expectError(
      fixture().state,
      { type: 'addTeam', name: 'Nachzügler', players: ['N'] },
      'TOURNAMENT_ALREADY_STARTED',
    );
  });
});

describe('renameTeam (M03, Festlegung 5/6)', () => {
  it('M03: TeamRenamed ändert nur den Namen', () => {
    const { state: before, ids } = addTeams(create(), ['Alpha', 'Bravo']);
    const [alpha] = ids as [string, string];
    const { state, events } = run(before, { type: 'renameTeam', teamId: alpha, name: 'Adler' });
    expect(single(events, 'TeamRenamed').payload).toEqual({ teamId: alpha, name: 'Adler' });
    expect(state.teams.map((t) => t.name)).toEqual(['Adler', 'Bravo']);
    expect(teamById(state, alpha)?.players).toEqual(teamById(before, alpha)?.players);
  });

  it.each(['Alpha', 'ALPHA'])(
    'M03: Umbenennen auf den eigenen Namen ("%s") ist erlaubt',
    (name) => {
      const { state: before, teamId } = addTeam(create(), 'Alpha');
      const { state } = run(before, { type: 'renameTeam', teamId, name });
      expect(teamById(state, teamId)?.name).toBe(name);
    },
  );

  it.each(['Bravo', 'bravo', ' BRAVO '])(
    'M03: Name eines anderen Teams ("%s") → TEAM_NAME_TAKEN',
    (name) => {
      const { state, ids } = addTeams(create(), ['Alpha', 'Bravo']);
      expectError(state, { type: 'renameTeam', teamId: ids[0] ?? '', name }, 'TEAM_NAME_TAKEN');
    },
  );

  it('M03: unbekannte teamId → TEAM_NOT_FOUND', () => {
    const { state } = addTeam(create(), 'Alpha');
    expectError(state, { type: 'renameTeam', teamId: 'unknown', name: 'X' }, 'TEAM_NOT_FOUND');
  });

  it('M03: entferntes Team → TEAM_NOT_FOUND', () => {
    const { state, teamId } = addTeam(create(), 'Alpha');
    const removed = run(state, { type: 'removeTeam', teamId }).state;
    expectError(removed, { type: 'renameTeam', teamId, name: 'X' }, 'TEAM_NOT_FOUND');
  });

  it.each([
    { phase: 'groups', fixture: groupsFixture },
    { phase: 'knockout', fixture: knockoutFixture },
  ])('M03: nach Start ($phase) bleibt Umbenennen erlaubt', ({ fixture }) => {
    const { state: before, ids } = fixture();
    const teamId = ids[0] ?? '';
    const { state } = run(before, { type: 'renameTeam', teamId, name: 'Neuer Name' });
    expect(teamById(state, teamId)?.name).toBe('Neuer Name');
    expect(state.phase).toBe(before.phase);
  });

  it('M03: nach Start gilt die Namenseindeutigkeit weiterhin', () => {
    const { state, ids } = groupsFixture();
    expectError(
      state,
      { type: 'renameTeam', teamId: ids[0] ?? '', name: 'bravo' },
      'TEAM_NAME_TAKEN',
    );
  });
});

describe('setPlayers (M03, Festlegung 6)', () => {
  it('M03: PlayersSet ersetzt die Spielerliste', () => {
    const { state: before, teamId } = addTeam(create(), 'Alpha', ['Anna']);
    const { state, events } = run(before, {
      type: 'setPlayers',
      teamId,
      players: ['Bea', 'Carl', 'Dora'],
    });
    expect(single(events, 'PlayersSet').payload).toEqual({
      teamId,
      players: ['Bea', 'Carl', 'Dora'],
    });
    expect(teamById(state, teamId)).toEqual({
      id: teamId,
      name: 'Alpha',
      players: ['Bea', 'Carl', 'Dora'],
    });
  });

  it('M03: unbekannte teamId → TEAM_NOT_FOUND', () => {
    expectError(
      create(),
      { type: 'setPlayers', teamId: 'unknown', players: ['X'] },
      'TEAM_NOT_FOUND',
    );
  });

  it.each([
    { phase: 'groups', fixture: groupsFixture },
    { phase: 'knockout', fixture: knockoutFixture },
  ])('M03: nach Start ($phase) bleibt Spieler ändern erlaubt', ({ fixture }) => {
    const { state: before, ids } = fixture();
    const teamId = ids[1] ?? '';
    const { state } = run(before, { type: 'setPlayers', teamId, players: ['Ersatz'] });
    expect(teamById(state, teamId)?.players).toEqual(['Ersatz']);
  });
});

describe('removeTeam (M03, Festlegung 6/7)', () => {
  it('M03: TeamRemoved entfernt das Team, Reihenfolge der übrigen bleibt', () => {
    const { state: before, ids } = addTeams(create(), ['Alpha', 'Bravo', 'Charlie']);
    const [, bravo] = ids as [string, string, string];
    const { state, events } = run(before, { type: 'removeTeam', teamId: bravo });
    expect(single(events, 'TeamRemoved').payload).toEqual({ teamId: bravo });
    expect(state.teams.map((t) => t.name)).toEqual(['Alpha', 'Charlie']);
  });

  it('M05: removeTeam entfernt auch die Gruppenzuteilung', () => {
    const { state: before, ids } = setupFixture();
    const teamId = ids[0] ?? '';
    const { state } = run(before, { type: 'removeTeam', teamId });
    expect(state.groupAssignment).not.toHaveProperty(teamId);
    expect(Object.keys(state.groupAssignment)).toHaveLength(3);
  });

  it('M03: unbekannte teamId → TEAM_NOT_FOUND', () => {
    expectError(create(), { type: 'removeTeam', teamId: 'unknown' }, 'TEAM_NOT_FOUND');
  });

  it('M03: zweimal entfernen → TEAM_NOT_FOUND', () => {
    const { state, teamId } = addTeam(create(), 'Alpha');
    const removed = run(state, { type: 'removeTeam', teamId }).state;
    expectError(removed, { type: 'removeTeam', teamId }, 'TEAM_NOT_FOUND');
  });

  it.each([
    { phase: 'groups', fixture: groupsFixture },
    { phase: 'knockout', fixture: knockoutFixture },
  ])('M03: nach Start ($phase) → TOURNAMENT_ALREADY_STARTED', ({ fixture }) => {
    const { state, ids } = fixture();
    expectError(state, { type: 'removeTeam', teamId: ids[0] ?? '' }, 'TOURNAMENT_ALREADY_STARTED');
  });
});

// ---------------------------------------------------------------------------
// Gruppenzuteilung
// ---------------------------------------------------------------------------

describe('assignTeamToGroup (M05, Festlegung 7)', () => {
  it('M05: TeamAssignedToGroup setzt die Zuteilung', () => {
    const { state: before, teamId } = addTeam(create(), 'Alpha');
    const { state, events } = run(before, { type: 'assignTeamToGroup', teamId, groupId: 'B' });
    expect(single(events, 'TeamAssignedToGroup').payload).toEqual({ teamId, groupId: 'B' });
    expect(state.groupAssignment).toEqual({ [teamId]: 'B' });
  });

  it('M05: erneute Zuteilung überschreibt (Drag-and-drop in andere Gruppe)', () => {
    const { state: before, teamId } = addTeam(create(), 'Alpha');
    let state = run(before, { type: 'assignTeamToGroup', teamId, groupId: 'A' }).state;
    state = run(state, { type: 'assignTeamToGroup', teamId, groupId: 'B' }).state;
    expect(state.groupAssignment).toEqual({ [teamId]: 'B' });
  });

  it('M05: groupId null entfernt die Zuteilung', () => {
    const { state: before, ids } = setupFixture();
    const teamId = ids[0] ?? '';
    const { state, events } = run(before, { type: 'assignTeamToGroup', teamId, groupId: null });
    expect(single(events, 'TeamAssignedToGroup').payload).toEqual({ teamId, groupId: null });
    expect(state.groupAssignment).not.toHaveProperty(teamId);
    expect(Object.keys(state.groupAssignment)).toHaveLength(3);
  });

  it.each([
    { groupCount: 1 as const, valid: ['A'], invalid: ['B'] },
    { groupCount: 2 as const, valid: ['A', 'B'], invalid: ['C', 'a', 'Z'] },
    { groupCount: 4 as const, valid: ['A', 'B', 'C', 'D'], invalid: ['E'] },
    { groupCount: 8 as const, valid: ['H'], invalid: ['I'] },
  ])(
    'M05: groupCount $groupCount → gültig $valid, ungültig $invalid',
    ({ groupCount, valid, invalid }) => {
      const { state, teamId } = addTeam(create({ groupCount }), 'Alpha');
      for (const groupId of valid) {
        expect(
          run(state, { type: 'assignTeamToGroup', teamId, groupId }).state.groupAssignment,
        ).toEqual({
          [teamId]: groupId,
        });
      }
      for (const groupId of invalid) {
        expectError(state, { type: 'assignTeamToGroup', teamId, groupId }, 'GROUP_NOT_FOUND');
      }
    },
  );

  it('M04/M05: Modus koOnly kennt keine Gruppen → GROUP_NOT_FOUND', () => {
    const { state, teamId } = addTeam(create({ mode: 'koOnly' }), 'Alpha');
    expectError(state, { type: 'assignTeamToGroup', teamId, groupId: 'A' }, 'GROUP_NOT_FOUND');
  });

  it('M05: unbekannte teamId → TEAM_NOT_FOUND', () => {
    expectError(
      create(),
      { type: 'assignTeamToGroup', teamId: 'unknown', groupId: 'A' },
      'TEAM_NOT_FOUND',
    );
  });

  it.each([
    { phase: 'groups', fixture: groupsFixture },
    { phase: 'knockout', fixture: knockoutFixture },
  ])('M03/M05: nach Start ($phase) → TOURNAMENT_ALREADY_STARTED', ({ fixture }) => {
    const { state, ids } = fixture();
    expectError(
      state,
      { type: 'assignTeamToGroup', teamId: ids[0] ?? '', groupId: 'B' },
      'TOURNAMENT_ALREADY_STARTED',
    );
  });
});

// ---------------------------------------------------------------------------
// Beamer
// ---------------------------------------------------------------------------

describe('setBeamerMode / setBeamerView (S06, Festlegung 8)', () => {
  it('S06: BeamerModeSet schaltet auf fixed und zurück', () => {
    const fixed = run(create(), { type: 'setBeamerMode', mode: 'fixed' });
    expect(single(fixed.events, 'BeamerModeSet').payload).toEqual({ mode: 'fixed' });
    expect(fixed.state.beamer.mode).toBe('fixed');
    const rotation = run(fixed.state, { type: 'setBeamerMode', mode: 'rotation' });
    expect(rotation.state.beamer.mode).toBe('rotation');
  });

  it.each(['timer', 'standings', 'bracket', 'upcoming', 'podium'] as const)(
    'S06: BeamerViewSet wählt Ansicht %s',
    (view) => {
      const { state, events } = run(create(), { type: 'setBeamerView', view });
      expect(single(events, 'BeamerViewSet').payload).toEqual({ view });
      expect(state.beamer.view).toBe(view);
    },
  );

  it.each([
    { phase: 'setup', fixture: setupFixture },
    { phase: 'groups', fixture: groupsFixture },
    { phase: 'knockout', fixture: knockoutFixture },
  ])('S06: Beamer-Steuerung in Phase $phase erlaubt', ({ fixture }) => {
    let { state } = fixture();
    state = run(state, { type: 'setBeamerMode', mode: 'fixed' }).state;
    state = run(state, { type: 'setBeamerView', view: 'bracket' }).state;
    expect(state.beamer).toEqual({ mode: 'fixed', view: 'bracket' });
  });
});

// ---------------------------------------------------------------------------
// apply: TournamentStarted / PhaseAdvanced (Festlegung 10/11)
// ---------------------------------------------------------------------------

describe('apply TournamentStarted / PhaseAdvanced (Festlegung 10/11)', () => {
  it('M06/M15: TournamentStarted → Phase groups, Payload unverändert übernommen', () => {
    const { state: before, ids } = setupFixture();
    const payload = startedPayload(ids);
    const event = eventAt(before, 'TournamentStarted', payload);
    const state = apply(before, event);
    expect(state.phase).toBe('groups');
    expect(state.groups).toEqual(payload.groups);
    expect(state.advancersPerGroup).toBe(1);
    expect(state.matches).toEqual(payload.matches);
    expect(state.heats).toEqual(payload.heats);
    expect(state.version).toBe(event.seq);
    expect(state.log.at(-1)).toEqual({ event, undone: false });
  });

  it('M03: TournamentStarted lässt Teams unverändert', () => {
    const { state: before, ids } = setupFixture();
    const state = apply(before, eventAt(before, 'TournamentStarted', startedPayload(ids)));
    expect(state.teams).toEqual(before.teams);
  });

  it('M04: bei Modus koOnly führt TournamentStarted direkt in die Phase knockout', () => {
    const { state: before, ids } = addTeams(create({ mode: 'koOnly' }), ['Alpha', 'Bravo']);
    const [a, b] = ids as [string, string];
    const matches: Match[] = [
      {
        id: 'f',
        phase: 'final',
        round: 1,
        position: 1,
        groupId: null,
        a: { teamId: a },
        b: { teamId: b },
        bye: false,
      },
    ];
    const heats: Heat[] = [{ id: 'fh', phase: 'final', round: 1, index: 1, matchIds: ['f'] }];
    const state = apply(
      before,
      eventAt(before, 'TournamentStarted', { groups: [], advancersPerGroup: null, matches, heats }),
    );
    expect(state.phase).toBe('knockout');
    expect(state.groups).toEqual([]);
    expect(state.advancersPerGroup).toBeNull();
    expect(state.matches).toEqual(matches);
    expect(state.heats).toEqual(heats);
  });

  it('M11: PhaseAdvanced → Phase knockout, KO-Partien und -Durchgänge werden angehängt', () => {
    const { state: before, ids } = groupsFixture();
    const payload = koPayload(ids);
    const state = apply(before, eventAt(before, 'PhaseAdvanced', payload));
    expect(state.phase).toBe('knockout');
    expect(state.matches).toEqual([...before.matches, ...payload.matches]);
    expect(state.heats).toEqual([...before.heats, ...payload.heats]);
    expect(state.groups).toEqual(before.groups);
  });
});

// ---------------------------------------------------------------------------
// version, log, Reinheit, replay
// ---------------------------------------------------------------------------

describe('version und Protokoll (M20, ADR 026, Festlegung 9)', () => {
  it('M20: version = seq des letzten Ereignisses, log in seq-Reihenfolge mit undone false', () => {
    const steps: Command[] = [
      { type: 'createTournament', name: 'Sommerturnier' },
      { type: 'setTableCount', tableCount: 2 },
      { type: 'addTeam', name: 'Alpha', players: ['Anna'] },
      { type: 'setBeamerView', view: 'standings' },
      { type: 'updateSettings', settings: { trackCups: true } },
    ];
    let state = initialState();
    const all: DomainEvent[] = [];
    steps.forEach((command, i) => {
      const step = run(state, command, T0 + i * 1000);
      state = step.state;
      all.push(...step.events);
    });
    expect(all.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5]);
    expect(all.map((e) => e.at)).toEqual([T0, T0 + 1000, T0 + 2000, T0 + 3000, T0 + 4000]);
    expect(state.version).toBe(5);
    expect(state.log).toEqual(all.map((event) => ({ event, undone: false })));
  });

  it('M20: jedes erzeugte Ereignis hat eine eindeutige id aus ctx.newId', () => {
    let state = create();
    const ids: string[] = [state.log[0]?.event.id ?? ''];
    for (const name of ['Alpha', 'Bravo', 'Charlie']) {
      const step = run(state, { type: 'addTeam', name, players: ['x'] });
      state = step.state;
      ids.push(...step.events.map((e) => e.id));
    }
    expect(new Set(ids).size).toBe(4);
    for (const id of ids) expect(issuedIds).toContain(id);
  });

  it('M20: abgelehnter Befehl ändert weder version noch log', () => {
    const state = create();
    const before = JSON.stringify(state);
    fail(state, { type: 'removeTeam', teamId: 'unknown' });
    expect(JSON.stringify(state)).toBe(before);
  });
});

describe('Reinheit und Determinismus (Architekturregel 4)', () => {
  it('decide verändert den Zustand nicht', () => {
    const { state } = setupFixture();
    const before = JSON.stringify(state);
    decide(state, { type: 'addTeam', name: 'Echo', players: ['E'] }, ctx());
    decide(state, { type: 'updateSettings', settings: { groupCount: 1 } }, ctx());
    expect(JSON.stringify(state)).toBe(before);
  });

  it('apply verändert den Eingangszustand nicht', () => {
    const { state } = setupFixture();
    const before = JSON.stringify(state);
    const result = decide(state, { type: 'removeTeam', teamId: state.teams[0]?.id ?? '' }, ctx());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const event of result.value) apply(state, withSeq(event, state.version + 1));
    expect(JSON.stringify(state)).toBe(before);
  });

  it('decide mit gleichem Zustand und gleichem ctx liefert gleiche Ereignisse', () => {
    const { state } = setupFixture();
    const command: Command = { type: 'addTeam', name: 'Echo', players: ['E'] };
    const fixedCtx = (): DecideContext => {
      let n = 0;
      return { now: T0, random: () => 0.25, newId: () => `fixed-${(n += 1)}` };
    };
    expect(decide(state, command, fixedCtx())).toEqual(decide(state, command, fixedCtx()));
  });
});

describe('replay (M01: Turnier wieder öffnen, N03)', () => {
  it('M01: replay([]) = initialState()', () => {
    expect(replay([])).toEqual(initialState());
  });

  it('M01/N03: replay aller Ereignisse ergibt denselben Zustand wie schrittweises apply', () => {
    const commands: Command[] = [
      { type: 'createTournament', name: 'Sommerturnier', settings: { groupCount: 4 } },
      { type: 'setTableCount', tableCount: 3 },
      { type: 'addTeam', name: 'Alpha', players: ['Anna'] },
      { type: 'addTeam', name: 'Bravo', players: ['Ben', 'Bea'] },
      { type: 'updateSettings', settings: { timerByPhase: { group: 600_000 } } },
      { type: 'setBeamerMode', mode: 'fixed' },
    ];
    let state = initialState();
    const events: DomainEvent[] = [];
    for (const command of commands) {
      const step = run(state, command);
      state = step.state;
      events.push(...step.events);
    }
    const alpha = state.teams[0]?.id ?? '';
    for (const command of [
      { type: 'renameTeam', teamId: alpha, name: 'Adler' },
      { type: 'assignTeamToGroup', teamId: alpha, groupId: 'D' },
    ] satisfies Command[]) {
      const step = run(state, command);
      state = step.state;
      events.push(...step.events);
    }
    expect(replay(events)).toEqual(state);
  });

  it('M01/N03: replay inklusive handgebautem TournamentStarted und PhaseAdvanced', () => {
    const { state } = knockoutFixture();
    const events = state.log.map((entry) => entry.event);
    expect(replay(events)).toEqual(state);
  });
});

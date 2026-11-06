import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  apply,
  buildGroupStage,
  decide,
  defaultAdvancers,
  groupIds,
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
  Group,
  NewEvent,
  SettingsPatch,
  TournamentState,
} from './index.js';

// ---------------------------------------------------------------------------
// Testhilfen (lokal, weil packages/core/tsconfig.json rootDir = src hat)
// ---------------------------------------------------------------------------

const T0 = 1_700_000_000_000;

/** Kleiner LCG mit festem Seed, Werte in [0, 1). Kein Math.random. */
const lcg = (seed: number): (() => number) => {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
};

let idCounter = 0;

const makeCtx = (random: () => number = lcg(1), now: number = T0): DecideContext => ({
  now,
  random,
  newId: () => {
    idCounter += 1;
    return `id-${idCounter}`;
  },
});

const withSeq = (event: NewEvent, seq: number): DomainEvent => ({ ...event, seq }) as DomainEvent;

interface Step {
  state: TournamentState;
  events: DomainEvent[];
}

/** decide → seq fortlaufend vergeben → apply. Scheitert der Befehl, scheitert der Test. */
const run = (
  state: TournamentState,
  command: Command,
  random: () => number = lcg(1),
  now: number = T0,
): Step => {
  const result = decide(state, command, makeCtx(random, now));
  if (!result.ok) {
    throw new Error(`decide(${command.type}) failed: ${result.error.code} ${result.error.message}`);
  }
  let next = state;
  const events = result.value.map((event, i) => withSeq(event, state.version + 1 + i));
  for (const event of events) next = apply(next, event);
  return { state: next, events };
};

const fail = (state: TournamentState, command: Command): DomainError => {
  const result = decide(state, command, makeCtx());
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

const NAMES = Array.from({ length: 32 }, (_, i) => `Team ${String(i + 1).padStart(2, '0')}`);

const withTeams = (
  n: number,
  settings?: SettingsPatch,
): { state: TournamentState; ids: string[] } => {
  let state = create(settings);
  const ids: string[] = [];
  for (const name of NAMES.slice(0, n)) {
    const step = run(state, { type: 'addTeam', name, players: [`${name} Spieler`] });
    state = step.state;
    ids.push(single(step.events, 'TeamAdded').payload.teamId);
  }
  return { state, ids };
};

const assign = (state: TournamentState, teamId: string, groupId: string | null): TournamentState =>
  run(state, { type: 'assignTeamToGroup', teamId, groupId }).state;

/** Teams mit Gruppenbuchstaben zuteilen, z. B. 'AABBB' (Reihenfolge = ids). '-' = nicht zuteilen. */
const assignByPattern = (
  state: TournamentState,
  ids: string[],
  pattern: string,
): TournamentState => {
  let current = state;
  [...pattern].forEach((g, i) => {
    const teamId = ids[i];
    if (teamId !== undefined && g !== '-') current = assign(current, teamId, g);
  });
  return current;
};

const setup = (
  pattern: string,
  settings?: SettingsPatch,
): { state: TournamentState; ids: string[] } => {
  const { state, ids } = withTeams(pattern.length, settings);
  return { state: assignByPattern(state, ids, pattern), ids };
};

const sizesOf = (assignment: Record<string, string>): number[] => {
  const sizes = new Map<string, number>();
  for (const g of Object.values(assignment)) sizes.set(g, (sizes.get(g) ?? 0) + 1);
  return [...sizes.values()].sort((x, y) => x - y);
};

/** Erwartete Gruppen: IDs A…, teamIds in Reihenfolge des Hinzufügens. */
const expectedGroups = (ids: string[], pattern: string, groupCount: number): Group[] =>
  groupIds(groupCount).map((id) => ({
    id,
    teamIds: ids.filter((_, i) => pattern[i] === id),
  }));

const start = (state: TournamentState): Step => run(state, { type: 'startTournament' });

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// randomizeGroups (M05 „Zufällig“)
// ---------------------------------------------------------------------------

describe('decide randomizeGroups (M05, SPEC → Gruppen)', () => {
  it.each([
    { n: 4, groupCount: 1 as const, sizes: [4] },
    { n: 4, groupCount: 2 as const, sizes: [2, 2] },
    { n: 5, groupCount: 2 as const, sizes: [2, 3] },
    { n: 8, groupCount: 4 as const, sizes: [2, 2, 2, 2] },
    { n: 10, groupCount: 4 as const, sizes: [2, 2, 3, 3] },
    { n: 17, groupCount: 8 as const, sizes: [2, 2, 2, 2, 2, 2, 2, 3] },
  ])(
    'M05: $n Teams, groupCount $groupCount → ein GroupsAssigned, alle Teams, Gruppen A…, Größen $sizes',
    ({ n, groupCount, sizes }) => {
      const { state, ids } = withTeams(n, { groupCount });
      const step = run(state, { type: 'randomizeGroups' }, lcg(3));
      const event = single(step.events, 'GroupsAssigned');
      const { assignment } = event.payload;
      expect(Object.keys(assignment).sort()).toEqual([...ids].sort());
      for (const g of Object.values(assignment)) expect(groupIds(groupCount)).toContain(g);
      expect(sizesOf(assignment)).toEqual(sizes);
    },
  );

  it('M05: danach ist state.groupAssignment genau die Zuteilung aus dem Ereignis', () => {
    const { state } = withTeams(6);
    const step = run(state, { type: 'randomizeGroups' }, lcg(4));
    const event = single(step.events, 'GroupsAssigned');
    expect(step.state.groupAssignment).toEqual(event.payload.assignment);
    expect(step.state.phase).toBe('setup');
  });

  it('M05: überschreibt vorherige manuelle Zuteilungen vollständig', () => {
    const { state, ids } = withTeams(6);
    let current = assign(state, ids[0] ?? '', 'A');
    current = assign(current, ids[1] ?? '', 'A');
    current = assign(current, ids[2] ?? '', 'A');
    current = assign(current, ids[3] ?? '', 'A');
    const step = run(current, { type: 'randomizeGroups' }, lcg(5));
    const event = single(step.events, 'GroupsAssigned');
    expect(Object.keys(event.payload.assignment).sort()).toEqual([...ids].sort());
    expect(step.state.groupAssignment).toEqual(event.payload.assignment);
    expect(sizesOf(step.state.groupAssignment)).toEqual([3, 3]);
  });

  it('M05: berücksichtigt nur aktuelle Teams (entferntes Team fehlt)', () => {
    const { state, ids } = withTeams(5);
    const removedId = ids[2] ?? '';
    const removed = run(state, { type: 'removeTeam', teamId: removedId }).state;
    const event = single(
      run(removed, { type: 'randomizeGroups' }, lcg(6)).events,
      'GroupsAssigned',
    );
    expect(Object.keys(event.payload.assignment).sort()).toEqual(
      ids.filter((id) => id !== removedId).sort(),
    );
    expect(sizesOf(event.payload.assignment)).toEqual([2, 2]);
  });

  it('M05/Arch. Regel 4: gleiche ctx.random-Folge → gleiche Zuteilung', () => {
    const { state } = withTeams(12, { groupCount: 4 });
    const first = single(run(state, { type: 'randomizeGroups' }, lcg(77)).events, 'GroupsAssigned');
    const second = single(
      run(state, { type: 'randomizeGroups' }, lcg(77)).events,
      'GroupsAssigned',
    );
    expect(first.payload).toEqual(second.payload);
  });

  it('M05/Arch. Regel 4: andere ctx.random-Folgen können andere Zuteilungen liefern', () => {
    const { state } = withTeams(8);
    const seen = new Set(
      Array.from({ length: 12 }, (_, seed) => {
        const event = single(
          run(state, { type: 'randomizeGroups' }, lcg(seed + 10)).events,
          'GroupsAssigned',
        );
        return JSON.stringify(
          Object.entries(event.payload.assignment).sort(([x], [y]) => (x < y ? -1 : 1)),
        );
      }),
    );
    expect(seen.size).toBeGreaterThan(1);
  });

  it('M05/Arch. Regel 4: Zufall nur aus ctx.random (aufgerufen), nie Math.random', () => {
    const spy = vi.spyOn(Math, 'random').mockImplementation(() => {
      throw new Error('Math.random must not be used in core');
    });
    const { state } = withTeams(8);
    let calls = 0;
    const source = lcg(8);
    run(state, { type: 'randomizeGroups' }, () => {
      calls += 1;
      return source();
    });
    expect(calls).toBeGreaterThan(0);
    expect(spy).not.toHaveBeenCalled();
  });

  it('M05: Modus koOnly kennt keine Gruppen → GROUP_NOT_FOUND', () => {
    const { state } = withTeams(4, { mode: 'koOnly' });
    expectError(state, { type: 'randomizeGroups' }, 'GROUP_NOT_FOUND');
  });

  it('M05: nach dem Start → TOURNAMENT_ALREADY_STARTED', () => {
    const { state } = setup('AABB');
    const started = start(state).state;
    expectError(started, { type: 'randomizeGroups' }, 'TOURNAMENT_ALREADY_STARTED');
  });

  it('M05/M19: undo von GroupsAssigned stellt die vorherige Zuteilung wieder her', () => {
    const { state, ids } = withTeams(4);
    const before = assign(state, ids[0] ?? '', 'B');
    const randomized = run(before, { type: 'randomizeGroups' }, lcg(9)).state;
    const undone = run(randomized, { type: 'undo' }).state;
    expect(undone.groupAssignment).toEqual(before.groupAssignment);
  });

  it('M05: zufällige Zuteilung ist direkt startbar', () => {
    const { state } = withTeams(8);
    const randomized = run(state, { type: 'randomizeGroups' }, lcg(12)).state;
    const event = single(start(randomized).events, 'TournamentStarted');
    expect(event.payload.groups.map((g) => g.teamIds.length)).toEqual([4, 4]);
  });
});

// ---------------------------------------------------------------------------
// startTournament (Modus groupsKo): Validierung
// ---------------------------------------------------------------------------

describe('decide startTournament – Fehlerfälle (M05, M06, M10, SPEC → Gruppen)', () => {
  it('M05: ein Team ohne Gruppe → TEAMS_UNASSIGNED', () => {
    const { state } = setup('AAB-');
    expectError(state, { type: 'startTournament' }, 'TEAMS_UNASSIGNED');
  });

  it('M05: Zuteilung wieder aufgehoben (groupId null) → TEAMS_UNASSIGNED', () => {
    const { state, ids } = setup('AABB');
    const cleared = assign(state, ids[3] ?? '', null);
    expectError(cleared, { type: 'startTournament' }, 'TEAMS_UNASSIGNED');
  });

  it.each([
    { label: 'Gruppe B mit 1 Team', pattern: 'AAB', groupCount: 2 as const },
    { label: 'Gruppe B leer', pattern: 'AAAA', groupCount: 2 as const },
    { label: '4 Gruppen, D leer', pattern: 'AABBCC', groupCount: 4 as const },
    { label: '4 Gruppen, C mit 1 Team', pattern: 'AABBCDD', groupCount: 4 as const },
  ])('M05: $label → GROUP_TOO_SMALL', ({ pattern, groupCount }) => {
    const { state } = setup(pattern, { groupCount });
    expectError(state, { type: 'startTournament' }, 'GROUP_TOO_SMALL');
  });

  it.each([
    {
      label: 'q = 3 keine Zweierpotenz (2 Gruppen à 4)',
      pattern: 'AAAABBBB',
      settings: { groupCount: 2, advancersPerGroup: 3 } satisfies SettingsPatch,
    },
    {
      label: 'q = 4 > kleinste Gruppe 3',
      pattern: 'AAAABBB',
      settings: { groupCount: 2, advancersPerGroup: 4 } satisfies SettingsPatch,
    },
    {
      label: 'q = 4 > Gruppengröße 2',
      pattern: 'AABB',
      settings: { groupCount: 2, advancersPerGroup: 4 } satisfies SettingsPatch,
    },
    {
      label: 'q = 6 keine Zweierpotenz (2 Gruppen à 8)',
      pattern: 'AAAAAAAABBBBBBBB',
      settings: { groupCount: 2, advancersPerGroup: 6 } satisfies SettingsPatch,
    },
    {
      label: '1 Gruppe × q = 1 < 2',
      pattern: 'AAAA',
      settings: { groupCount: 1, advancersPerGroup: 1 } satisfies SettingsPatch,
    },
    {
      label: '1 Gruppe à 2 Teams, Standard q = 1 → 1 × 1 < 2',
      pattern: 'AA',
      settings: { groupCount: 1 } satisfies SettingsPatch,
    },
    {
      label: '1 Gruppe à 3 Teams, Standard q = 1 → 1 × 1 < 2',
      pattern: 'AAA',
      settings: { groupCount: 1 } satisfies SettingsPatch,
    },
  ])('M10: $label → INVALID_ADVANCERS', ({ pattern, settings }) => {
    const { state } = setup(pattern, settings);
    expectError(state, { type: 'startTournament' }, 'INVALID_ADVANCERS');
  });

  it('M10: advancersPerGroup per updateSettings nachträglich ungültig → INVALID_ADVANCERS', () => {
    const { state } = setup('AAAABBBB');
    const updated = run(state, {
      type: 'updateSettings',
      settings: { advancersPerGroup: 3 },
    }).state;
    expectError(updated, { type: 'startTournament' }, 'INVALID_ADVANCERS');
  });

  it('M05: zweiter Start → TOURNAMENT_ALREADY_STARTED', () => {
    const { state } = setup('AABB');
    const started = start(state).state;
    expectError(started, { type: 'startTournament' }, 'TOURNAMENT_ALREADY_STARTED');
  });
});

// ---------------------------------------------------------------------------
// startTournament (Modus groupsKo): Erfolg
// ---------------------------------------------------------------------------

describe('decide startTournament – Erfolg (M05, M06, M10, M15)', () => {
  it.each([
    { pattern: 'AABB', groupCount: 2 as const, tableCount: 1 },
    { pattern: 'AAABB', groupCount: 2 as const, tableCount: 2 },
    { pattern: 'AAAABBBB', groupCount: 2 as const, tableCount: 2 },
    { pattern: 'AAAABBBB', groupCount: 2 as const, tableCount: 3 },
    { pattern: 'AAAAABBBBB', groupCount: 2 as const, tableCount: 4 },
    { pattern: 'AAAA', groupCount: 1 as const, tableCount: 2 },
    { pattern: 'AAAAA', groupCount: 1 as const, tableCount: 2 },
    { pattern: 'AABBCCDD', groupCount: 4 as const, tableCount: 2 },
    { pattern: 'AAABBBCCDD', groupCount: 4 as const, tableCount: 3 },
    { pattern: 'AAAAABBBBBCCCCDDDD', groupCount: 4 as const, tableCount: 4 },
  ])(
    'M06/M15: Zuteilung $pattern, $tableCount Tische → genau ein TournamentStarted wie buildGroupStage',
    ({ pattern, groupCount, tableCount }) => {
      const { state: base, ids } = setup(pattern, { groupCount });
      const state = run(base, { type: 'setTableCount', tableCount }).state;
      const step = start(state);
      const event = single(step.events, 'TournamentStarted');
      const groups = expectedGroups(ids, pattern, groupCount);
      const smallest = Math.min(...groups.map((g) => g.teamIds.length));
      const stage = buildGroupStage(groups, tableCount);

      expect(event.payload.groups).toEqual(groups);
      expect(event.payload.advancersPerGroup).toBe(defaultAdvancers(smallest));
      expect(event.payload.matches).toEqual(stage.matches);
      expect(event.payload.heats).toEqual(stage.heats);

      expect(step.state.phase).toBe('groups');
      expect(step.state.groups).toEqual(groups);
      expect(step.state.advancersPerGroup).toBe(defaultAdvancers(smallest));
      expect(step.state.matches).toEqual(stage.matches);
      expect(step.state.heats).toEqual(stage.heats);
    },
  );

  it('M05: Gruppen-teamIds in Reihenfolge des Hinzufügens, nicht der Zuteilung', () => {
    const { state, ids } = withTeams(6);
    // Zuteilung in umgekehrter Reihenfolge
    let current = state;
    for (const [i, id] of [...ids.entries()].reverse())
      current = assign(current, id, i % 2 === 0 ? 'A' : 'B');
    const event = single(start(current).events, 'TournamentStarted');
    expect(event.payload.groups).toEqual([
      { id: 'A', teamIds: [ids[0], ids[2], ids[4]] },
      { id: 'B', teamIds: [ids[1], ids[3], ids[5]] },
    ]);
  });

  it('M05: mehrfach umgeteiltes Team zählt nur in seiner letzten Gruppe', () => {
    const { state, ids } = setup('AABB');
    let current = assign(state, ids[0] ?? '', 'B');
    current = assign(current, ids[2] ?? '', 'A');
    const event = single(start(current).events, 'TournamentStarted');
    expect(event.payload.groups).toEqual([
      { id: 'A', teamIds: [ids[1], ids[2]] },
      { id: 'B', teamIds: [ids[0], ids[3]] },
    ]);
  });

  it.each([
    { size: 2, pattern: 'AABB', q: 1 },
    { size: 3, pattern: 'AAABBB', q: 1 },
    { size: 4, pattern: 'AAAABBBB', q: 2 },
    { size: 5, pattern: 'AAAAABBBBB', q: 2 },
    { size: 6, pattern: 'AAAAAABBBBBB', q: 2 },
    { size: 8, pattern: 'AAAAAAAABBBBBBBB', q: 4 },
  ])(
    'M10: advancersPerGroup null, Gruppen à $size → aufgelöstes q = $q im Ereignis',
    ({ pattern, q }) => {
      const { state } = setup(pattern);
      const event = single(start(state).events, 'TournamentStarted');
      expect(event.payload.advancersPerGroup).toBe(q);
      expect(typeof event.payload.advancersPerGroup).toBe('number');
    },
  );

  it('M10: Standard-q richtet sich nach der kleinsten Gruppe (5 und 4 → 2; 5 und 3 → 1)', () => {
    const big = setup('AAAAABBBB').state;
    expect(single(start(big).events, 'TournamentStarted').payload.advancersPerGroup).toBe(2);
    const small = setup('AAAAABBB').state;
    expect(single(start(small).events, 'TournamentStarted').payload.advancersPerGroup).toBe(1);
  });

  it.each([
    { label: 'q = 1 bei Gruppen à 4', pattern: 'AAAABBBB', q: 1 },
    { label: 'q = 4 bei Gruppen à 4 (alle weiter)', pattern: 'AAAABBBB', q: 4 },
    { label: 'q = Gruppengröße 2', pattern: 'AABB', q: 2 },
    { label: 'q = 2 bei kleinster Gruppe 2 (Größen 3 und 2)', pattern: 'AAABB', q: 2 },
  ])('M10: explizit gesetztes $label → gültig, im Ereignis übernommen', ({ pattern, q }) => {
    const { state } = setup(pattern, { advancersPerGroup: q });
    const step = start(state);
    expect(single(step.events, 'TournamentStarted').payload.advancersPerGroup).toBe(q);
    expect(step.state.advancersPerGroup).toBe(q);
  });

  it('M10: 1 Gruppe mit q = 2 → 1 × 2 = 2, gültig', () => {
    const { state } = setup('AAAA', { groupCount: 1, advancersPerGroup: 2 });
    expect(single(start(state).events, 'TournamentStarted').payload.advancersPerGroup).toBe(2);
  });

  it('M10: 1 Gruppe à 4 Teams mit Standard q = 2 → gültig', () => {
    const { state } = setup('AAAA', { groupCount: 1 });
    expect(single(start(state).events, 'TournamentStarted').payload.advancersPerGroup).toBe(2);
  });

  it('M06: ungleiche Größen (5 Teams in 2 Gruppen) → Freilose nur in der ungeraden Gruppe', () => {
    const { state, ids } = setup('AAABB');
    const event = single(start(state).events, 'TournamentStarted');
    const byes = event.payload.matches.filter((m) => m.bye);
    expect(byes).toHaveLength(3);
    for (const m of byes) {
      expect(m.groupId).toBe('A');
      expect(m.b).toBeNull();
    }
    expect(byes.map((m) => (m.a !== null && 'teamId' in m.a ? m.a.teamId : '')).sort()).toEqual(
      [ids[0], ids[1], ids[2]].sort(),
    );
    const played = event.payload.matches.filter((m) => !m.bye);
    expect(played).toHaveLength(3 + 1);
    const inHeats = new Set(event.payload.heats.flatMap((h) => h.matchIds));
    for (const m of byes) expect(inHeats.has(m.id)).toBe(false);
  });

  it('M15: mehr Partien als Tische → mehrere Durchgänge je Runde', () => {
    const { state: base } = setup('AAAABBBB');
    const state = run(base, { type: 'setTableCount', tableCount: 1 }).state;
    const event = single(start(state).events, 'TournamentStarted');
    // 3 Runden × 4 Partien, 1 Tisch → 12 Durchgänge
    expect(event.payload.heats).toHaveLength(12);
    for (const h of event.payload.heats) expect(h.matchIds).toHaveLength(1);
  });

  it('M15: tableCount wird zum Startzeitpunkt verwendet (spätere Änderung vor Start wirkt)', () => {
    const { state: base, ids } = setup('AAAABBBB');
    let state = run(base, { type: 'setTableCount', tableCount: 1 }).state;
    state = run(state, { type: 'setTableCount', tableCount: 4 }).state;
    const event = single(start(state).events, 'TournamentStarted');
    expect(event.payload.heats).toEqual(
      buildGroupStage(expectedGroups(ids, 'AAAABBBB', 2), 4).heats,
    );
  });

  it('M06: Start ist deterministisch (gleicher Zustand → gleiches Ereignis-Payload)', () => {
    const { state } = setup('AAABBB');
    const first = single(start(state).events, 'TournamentStarted');
    const second = single(
      run(state, { type: 'startTournament' }, lcg(999)).events,
      'TournamentStarted',
    );
    expect(second.payload).toEqual(first.payload);
  });

  it('M05/M19: undo des Starts → Phase setup, Zuteilung erhalten, erneuter Start liefert dasselbe', () => {
    const { state } = setup('AAABB');
    const startedStep = start(state);
    const firstPayload = single(startedStep.events, 'TournamentStarted').payload;
    const undone = run(startedStep.state, { type: 'undo' }).state;
    expect(undone.phase).toBe('setup');
    expect(undone.matches).toEqual([]);
    expect(undone.heats).toEqual([]);
    expect(undone.groupAssignment).toEqual(state.groupAssignment);
    const again = single(start(undone).events, 'TournamentStarted');
    expect(again.payload).toEqual(firstPayload);
  });

  it('M03: nach dem Start sind Teams unverändert und addTeam ist gesperrt', () => {
    const { state } = setup('AABB');
    const started = start(state).state;
    expect(started.teams).toEqual(state.teams);
    expectError(
      started,
      { type: 'addTeam', name: 'Nachzügler', players: ['N'] },
      'TOURNAMENT_ALREADY_STARTED',
    );
  });

  it('M05: Start mit großem Feld (32 Teams, 8 Gruppen à 4, 16 Tische) entspricht buildGroupStage', () => {
    const pattern = 'AAAABBBBCCCCDDDDEEEEFFFFGGGGHHHH';
    const { state: base, ids } = setup(pattern, { groupCount: 8 });
    const state = run(base, { type: 'setTableCount', tableCount: 16 }).state;
    const event = single(start(state).events, 'TournamentStarted');
    const groups = expectedGroups(ids, pattern, 8);
    expect(event.payload.groups).toEqual(groups);
    expect(event.payload.advancersPerGroup).toBe(2);
    expect({ matches: event.payload.matches, heats: event.payload.heats }).toEqual(
      buildGroupStage(groups, 16),
    );
  });
});

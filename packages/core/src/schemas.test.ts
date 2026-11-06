import { describe, expect, it } from 'vitest';
import { CommandSchema, DEFAULT_SETTINGS, DomainEventSchema, MatchSchema } from './index.js';

const parses = (value: unknown): boolean => CommandSchema.safeParse(value).success;
const parsesEvent = (value: unknown): boolean => DomainEventSchema.safeParse(value).success;

describe('CommandSchema – gültige Befehle', () => {
  it.each([
    { type: 'createTournament', name: 'Sommerturnier' },
    { type: 'createTournament', name: 'Sommerturnier', settings: { mode: 'koOnly' } },
    {
      type: 'createTournament',
      name: 'X',
      settings: { trackCups: true, timerByPhase: { group: 600_000 } },
    },
    { type: 'updateSettings', settings: {} },
    { type: 'updateSettings', settings: { groupCount: 4, advancersPerGroup: null } },
    { type: 'setTableCount', tableCount: 1 },
    { type: 'setTableCount', tableCount: 16 },
    { type: 'addTeam', name: 'Alpha', players: ['Anna'] },
    { type: 'addTeam', name: 'Alpha', players: ['A', 'B', 'C', 'D', 'E', 'F'] },
    { type: 'renameTeam', teamId: 't1', name: 'Beta' },
    { type: 'setPlayers', teamId: 't1', players: ['Ben'] },
    { type: 'removeTeam', teamId: 't1' },
    { type: 'assignTeamToGroup', teamId: 't1', groupId: 'A' },
    { type: 'assignTeamToGroup', teamId: 't1', groupId: null },
    { type: 'randomizeGroups' },
    { type: 'startTournament' },
    { type: 'advancePhase' },
    { type: 'setBeamerMode', mode: 'rotation' },
    { type: 'setBeamerMode', mode: 'fixed' },
    { type: 'setBeamerView', view: 'podium' },
    { type: 'recordResult', matchId: 'm1', outcome: 'draw', cups: { a: 3, b: 3 } },
    { type: 'recordPlayoff', groupId: 'A', tiedTeamIds: ['t1', 't2'], winnerTeamId: 't1' },
  ])('M01–M05/S06: $type wird akzeptiert (%#)', (command) => {
    expect(parses(command)).toBe(true);
  });

  it.each(['timer', 'standings', 'bracket', 'upcoming', 'podium'])(
    'S06: Beamer-Ansicht %s wird akzeptiert',
    (view) => {
      expect(parses({ type: 'setBeamerView', view })).toBe(true);
    },
  );

  it('M03: Namen werden getrimmt', () => {
    const parsed = CommandSchema.parse({ type: 'addTeam', name: '  Alpha  ', players: [' Anna '] });
    expect(parsed).toEqual({ type: 'addTeam', name: 'Alpha', players: ['Anna'] });
  });
});

describe('CommandSchema – abgelehnte Befehle', () => {
  it.each([
    { case: 'unbekannter Typ', command: { type: 'deleteTournament' } },
    { case: 'ohne Typ', command: { name: 'X' } },
    { case: 'unbekanntes Feld', command: { type: 'addTeam', name: 'A', players: ['a'], x: 1 } },
    { case: 'unbekanntes Feld (leerer Befehl)', command: { type: 'startTournament', force: true } },
    { case: 'Pflichtfeld fehlt', command: { type: 'renameTeam', teamId: 't1' } },
    { case: 'leere teamId', command: { type: 'removeTeam', teamId: '' } },
  ])('Befehle: $case wird abgelehnt', ({ command }) => {
    expect(parses(command)).toBe(false);
  });

  it.each(['', '   ', '\t'])('M01: leerer Turniername "%s" wird abgelehnt', (name) => {
    expect(parses({ type: 'createTournament', name })).toBe(false);
  });

  it.each(['', '   '])('M03: leerer Teamname "%s" wird abgelehnt (addTeam, renameTeam)', (name) => {
    expect(parses({ type: 'addTeam', name, players: ['Anna'] })).toBe(false);
    expect(parses({ type: 'renameTeam', teamId: 't1', name })).toBe(false);
  });

  it('M03: leere Spielerliste wird abgelehnt (addTeam, setPlayers)', () => {
    expect(parses({ type: 'addTeam', name: 'Alpha', players: [] })).toBe(false);
    expect(parses({ type: 'setPlayers', teamId: 't1', players: [] })).toBe(false);
  });

  it('M03: leerer Spielername wird abgelehnt', () => {
    expect(parses({ type: 'addTeam', name: 'Alpha', players: ['Anna', ' '] })).toBe(false);
  });

  it.each([0, -1, 1.5])('M02: Tischanzahl %s wird abgelehnt', (tableCount) => {
    expect(parses({ type: 'setTableCount', tableCount })).toBe(false);
  });

  it.each(['semifinal', 'thirdPlace', 'final'])(
    'M12: createTournament mit timerByPhase.%s ≠ null wird abgelehnt',
    (stage) => {
      expect(
        parses({ type: 'createTournament', name: 'X', settings: { timerByPhase: { [stage]: 1 } } }),
      ).toBe(false);
    },
  );

  it('M05: updateSettings mit groupCount 3 wird abgelehnt', () => {
    expect(parses({ type: 'updateSettings', settings: { groupCount: 3 } })).toBe(false);
  });

  it('Einstellungen: updateSettings mit unbekanntem Schlüssel wird abgelehnt', () => {
    expect(parses({ type: 'updateSettings', settings: { password: 'x' } })).toBe(false);
  });

  it('S06: unbekannter Beamer-Modus/-Ansicht wird abgelehnt', () => {
    expect(parses({ type: 'setBeamerMode', mode: 'auto' })).toBe(false);
    expect(parses({ type: 'setBeamerView', view: 'scores' })).toBe(false);
  });

  it.each([
    { case: 'outcome bye', command: { type: 'recordResult', matchId: 'm1', outcome: 'bye' } },
    {
      case: 'negative Becher',
      command: { type: 'recordResult', matchId: 'm1', outcome: 'draw', cups: { a: -1, b: -1 } },
    },
    {
      case: 'gebrochene Becher',
      command: { type: 'recordResult', matchId: 'm1', outcome: 'draw', cups: { a: 1.5, b: 1.5 } },
    },
  ])('M07: recordResult mit $case wird abgelehnt', ({ command }) => {
    expect(parses(command)).toBe(false);
  });

  it('M09: recordPlayoff mit nur einem Team wird abgelehnt', () => {
    expect(
      parses({ type: 'recordPlayoff', groupId: 'A', tiedTeamIds: ['t1'], winnerTeamId: 't1' }),
    ).toBe(false);
  });
});

describe('DomainEventSchema (ARCHITECTURE → Ereignisse)', () => {
  const created = {
    id: 'e1',
    seq: 1,
    type: 'TournamentCreated',
    v: 1,
    at: 1_700_000_000_000,
    payload: { name: 'Sommerturnier', settings: DEFAULT_SETTINGS },
  };

  it('M01: TournamentCreated mit vollständigen Settings wird akzeptiert', () => {
    expect(parsesEvent(created)).toBe(true);
  });

  it('M01: TournamentCreated mit unvollständigen Settings wird abgelehnt', () => {
    expect(
      parsesEvent({ ...created, payload: { name: 'X', settings: { mode: 'groupsKo' } } }),
    ).toBe(false);
  });

  it.each([
    { case: 'ohne v', event: { ...created, v: undefined } },
    { case: 'falsche v-Nummer', event: { ...created, v: 2 } },
    { case: 'seq 0', event: { ...created, seq: 0 } },
    { case: 'leere id', event: { ...created, id: '' } },
    { case: 'negative Zeit', event: { ...created, at: -1 } },
    { case: 'unbekanntes Feld', event: { ...created, extra: true } },
    { case: 'unbekannter Typ', event: { ...created, type: 'TournamentDeleted' } },
  ])('Ereignisse: $case wird abgelehnt', ({ event }) => {
    expect(parsesEvent(event)).toBe(false);
  });

  it('ADR 026: SettingsUpdated enthält nur den Patch', () => {
    expect(
      parsesEvent({
        id: 'e2',
        seq: 2,
        type: 'SettingsUpdated',
        v: 1,
        at: 0,
        payload: { settings: { trackCups: true } },
      }),
    ).toBe(true);
  });

  it('M03: TeamAdded ohne Spieler wird abgelehnt', () => {
    expect(
      parsesEvent({
        id: 'e3',
        seq: 3,
        type: 'TeamAdded',
        v: 1,
        at: 0,
        payload: { teamId: 't1', name: 'Alpha', players: [] },
      }),
    ).toBe(false);
  });

  it('M19: Undone ohne undoes wird abgelehnt, mit undoes akzeptiert', () => {
    const undone = { id: 'e9', seq: 9, type: 'Undone', v: 1, at: 0, payload: { cascade: [] } };
    expect(parsesEvent(undone)).toBe(false);
    expect(parsesEvent({ ...undone, undoes: 'e3' })).toBe(true);
  });

  it('M19: undoes ist nur bei Undone erlaubt', () => {
    expect(parsesEvent({ ...created, undoes: 'e0' })).toBe(false);
  });

  it('M12/Architekturregel 6: HeatStarted mit zusätzlichem startedAt wird abgelehnt (Zeit = at)', () => {
    const heatStarted = {
      id: 'e10',
      seq: 10,
      type: 'HeatStarted',
      v: 1,
      at: 1_700_000_000_000,
      payload: { heatId: 'h1', durationMs: 900_000 },
    };
    expect(parsesEvent(heatStarted)).toBe(true);
    expect(parsesEvent({ ...heatStarted, payload: { ...heatStarted.payload, startedAt: 1 } })).toBe(
      false,
    );
  });
});

describe('MatchSchema (M06/M11)', () => {
  const match = {
    id: 'm1',
    phase: 'group',
    round: 1,
    position: 1,
    groupId: 'A',
    a: { teamId: 't1' },
    b: { teamId: 't2' },
    bye: false,
  };

  it('M06: Partie mit position wird akzeptiert', () => {
    expect(MatchSchema.safeParse(match).success).toBe(true);
  });

  it('M06/M11: Partie ohne position wird abgelehnt', () => {
    const { position: _position, ...withoutPosition } = match;
    expect(_position).toBe(1);
    expect(MatchSchema.safeParse(withoutPosition).success).toBe(false);
  });
});

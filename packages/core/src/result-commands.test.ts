// Regeltests aus SPEC „Ergebnis-Payload“, „Stechen“, „Tische und Durchgänge“ (M07, M09, M14, S01):
// decide(recordResult) und decide(recordPlayoff). Fixture-Ereignisse werden direkt eingespielt.
import { describe, expect, it } from 'vitest';
import { DomainEventSchema, apply, computeStandings, decide, initialState } from './index.js';
import type {
  Command,
  CommandOf,
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
  TournamentState,
} from './index.js';

// ---------------------------------------------------------------------------
// Testhilfen (lokal)
// ---------------------------------------------------------------------------

const T0 = 1_767_225_600_000; // 2026-01-01T00:00:00Z

class Session {
  state: TournamentState = initialState();
  private seq = 0;
  private clock = T0;
  private nextId = 0;

  ctx(): DecideContext {
    this.clock += 1_000;
    return { now: this.clock, random: () => 0.5, newId: () => `id-${++this.nextId}` };
  }

  decide(command: Command): Result<NewEvent[], DomainError> {
    return decide(this.state, command, this.ctx());
  }

  run(command: Command): DomainEvent[] {
    const r = this.decide(command);
    if (!r.ok) throw new Error(`${command.type}: ${r.error.code} – ${r.error.message}`);
    return r.value.map((e) => this.append(e));
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
}

function expectError(r: Result<NewEvent[], DomainError>, code: DomainErrorCode): void {
  if (r.ok) throw new Error(`erwartet ${code}, erhalten ${JSON.stringify(r.value)}`);
  expect(r.error.code).toBe(code);
}

function expectSingle<T extends DomainEventType>(
  r: Result<NewEvent[], DomainError>,
  type: T,
): Extract<NewEvent, { type: T }> {
  if (!r.ok) throw new Error(`erwartet ${type}, erhalten ${r.error.code}: ${r.error.message}`);
  expect(r.value).toHaveLength(1);
  const [e] = r.value;
  if (!e || e.type !== type) throw new Error(`erwartet ${type}, erhalten ${e?.type}`);
  return e as Extract<NewEvent, { type: T }>;
}

type RR = CommandOf<'recordResult'>;
type RP = CommandOf<'recordPlayoff'>;
const rr = (c: Omit<RR, 'type'>): RR => ({ type: 'recordResult', ...c });
const rp = (c: Omit<RP, 'type'>): RP => ({ type: 'recordPlayoff', ...c });

// ---------------------------------------------------------------------------
// Fixture: Gruppe A = T1, T2, T3 (mit Freilosen), Gruppe B = T4, T5; 2 Tische.
//   Runde 1: A-r1 (T1–T2), B-r1 (T4–T5) → Durchgang H-r1 · Freilos A-r1-bye (T3)
//   Runde 2: A-r2 (T1–T3)              → Durchgang H-r2 · Freilos A-r2-bye (T2)
//   Runde 3: A-r3 (T2–T3)              → Durchgang H-r3 · Freilos A-r3-bye (T1)
// KO (q = 1): FINAL = A1 – B1, Durchgang H-final ohne Zeitlimit.
// ---------------------------------------------------------------------------

const groupMatch = (
  id: string,
  round: number,
  groupId: string,
  a: string,
  b: string | null,
): Match => ({
  id,
  phase: 'group',
  round,
  position: b === null ? 2 : 1,
  groupId,
  a: { teamId: a },
  b: b === null ? null : { teamId: b },
  bye: b === null,
});

const MATCHES: Match[] = [
  groupMatch('A-r1', 1, 'A', 'T1', 'T2'),
  groupMatch('A-r1-bye', 1, 'A', 'T3', null),
  groupMatch('B-r1', 1, 'B', 'T4', 'T5'),
  groupMatch('A-r2', 2, 'A', 'T1', 'T3'),
  groupMatch('A-r2-bye', 2, 'A', 'T2', null),
  groupMatch('A-r3', 3, 'A', 'T2', 'T3'),
  groupMatch('A-r3-bye', 3, 'A', 'T1', null),
];

const HEATS: Heat[] = [
  { id: 'H-r1', phase: 'group', round: 1, index: 1, matchIds: ['A-r1', 'B-r1'] },
  { id: 'H-r2', phase: 'group', round: 2, index: 1, matchIds: ['A-r2'] },
  { id: 'H-r3', phase: 'group', round: 3, index: 1, matchIds: ['A-r3'] },
];

interface Opts {
  trackCups?: boolean;
  q?: number;
}

function startedSession({ trackCups = false, q = 1 }: Opts = {}) {
  const s = new Session();
  s.run({
    type: 'createTournament',
    name: 'Ergebnistest',
    settings: { trackCups, groupCount: 2 },
  });
  s.run({ type: 'setTableCount', tableCount: 2 });
  for (const t of ['T1', 'T2', 'T3', 'T4', 'T5']) {
    s.push('TeamAdded', { teamId: t, name: `Team ${t}`, players: [`Spieler ${t}`] });
  }
  for (const t of ['T1', 'T2', 'T3']) s.push('TeamAssignedToGroup', { teamId: t, groupId: 'A' });
  for (const t of ['T4', 'T5']) s.push('TeamAssignedToGroup', { teamId: t, groupId: 'B' });
  s.push('TournamentStarted', {
    groups: [
      { id: 'A', teamIds: ['T1', 'T2', 'T3'] },
      { id: 'B', teamIds: ['T4', 'T5'] },
    ],
    advancersPerGroup: q,
    matches: MATCHES,
    heats: HEATS,
  });
  return s;
}

/** Wie startedSession, Durchgang 1 läuft. */
function heat1Running(opts: Opts = {}) {
  const s = startedSession(opts);
  s.push('HeatStarted', { heatId: 'H-r1', durationMs: 900_000 });
  return s;
}

type Res = EventOf<'ResultRecorded'>['payload'];

/**
 * Spielt die ganze Gruppenphase per Ereignis ein. Gruppe A nach `a`:
 * 'circle' = T1>T2, T3>T1, T2>T3 (Kreis, je 3 Punkte) · 'draws' = alles Unentschieden ·
 * 'clear' = T1 gewinnt alles, T2 schlägt T3 · 'topTie' = T1–T2 unentschieden, beide schlagen T3
 * (T1/T2 je 4 Punkte auf Platz 1–2). Gruppe B: T4 schlägt T5.
 */
function groupStageDone(a: 'circle' | 'draws' | 'clear' | 'topTie', opts: Opts = {}) {
  const s = startedSession(opts);
  const cups = opts.trackCups === true;
  const win = (matchId: string, winner: string, winnerIsA: boolean): Res =>
    cups
      ? {
          matchId,
          outcome: 'win',
          winnerTeamId: winner,
          cups: winnerIsA ? { a: 10, b: 8 } : { a: 8, b: 10 },
        }
      : { matchId, outcome: 'win', winnerTeamId: winner };
  const draw = (matchId: string): Res =>
    cups ? { matchId, outcome: 'draw', cups: { a: 5, b: 5 } } : { matchId, outcome: 'draw' };
  const resA: Record<string, Res> = {
    circle: win('A-r1', 'T1', true),
    draws: draw('A-r1'),
    clear: win('A-r1', 'T1', true),
    topTie: draw('A-r1'),
  };
  const resA2: Record<string, Res> = {
    circle: win('A-r2', 'T3', false),
    draws: draw('A-r2'),
    clear: win('A-r2', 'T1', true),
    topTie: win('A-r2', 'T1', true),
  };
  const resA3: Record<string, Res> = {
    circle: win('A-r3', 'T2', true),
    draws: draw('A-r3'),
    clear: win('A-r3', 'T2', true),
    topTie: win('A-r3', 'T2', true),
  };
  s.push('HeatStarted', { heatId: 'H-r1', durationMs: 900_000 });
  s.push('ResultRecorded', resA[a] as Res);
  s.push('ResultRecorded', win('B-r1', 'T4', true));
  s.push('HeatStarted', { heatId: 'H-r2', durationMs: 900_000 });
  s.push('ResultRecorded', resA2[a] as Res);
  s.push('HeatStarted', { heatId: 'H-r3', durationMs: 900_000 });
  const last = s.push('ResultRecorded', resA3[a] as Res);
  return { s, last };
}

/** Gruppenphase fertig (A klar: T1 Erster), KO-Finale T1 – T4 aus PhaseAdvanced. */
function finalReady(opts: Opts = {}, startHeat = true) {
  const { s } = groupStageDone('clear', opts);
  s.push('PhaseAdvanced', {
    matches: [
      {
        id: 'FINAL',
        phase: 'final',
        round: 1,
        position: 1,
        groupId: null,
        a: { teamId: 'T1' },
        b: { teamId: 'T4' },
        bye: false,
      },
    ],
    heats: [{ id: 'H-final', phase: 'final', round: 1, index: 1, matchIds: ['FINAL'] }],
  });
  if (startHeat) s.push('HeatStarted', { heatId: 'H-final', durationMs: null });
  return s;
}

// ---------------------------------------------------------------------------
// recordResult – Erfolg
// ---------------------------------------------------------------------------

describe('M07: recordResult erzeugt ResultRecorded mit genau dem Payload', () => {
  it.each<[string, Omit<RR, 'type'>]>([
    ['Sieg A', { matchId: 'A-r1', outcome: 'win', winnerTeamId: 'T1' }],
    ['Sieg B', { matchId: 'A-r1', outcome: 'win', winnerTeamId: 'T2' }],
    ['Sieg durch Zeit A', { matchId: 'A-r1', outcome: 'winByTime', winnerTeamId: 'T1' }],
    ['Sieg durch Zeit B', { matchId: 'A-r1', outcome: 'winByTime', winnerTeamId: 'T2' }],
    ['Unentschieden', { matchId: 'A-r1', outcome: 'draw' }],
    [
      'Partie in Gruppe B desselben Durchgangs',
      { matchId: 'B-r1', outcome: 'win', winnerTeamId: 'T5' },
    ],
  ])('M07: %s (trackCups aus)', (_name, payload) => {
    const s = heat1Running();
    const e = expectSingle(s.decide(rr(payload)), 'ResultRecorded');
    expect(e.payload).toStrictEqual(payload);
    expect(e.v).toBe(1);
  });

  it.each<[string, Omit<RR, 'type'>]>([
    ['Sieg A 10:7', { matchId: 'A-r1', outcome: 'win', winnerTeamId: 'T1', cups: { a: 10, b: 7 } }],
    ['Sieg B 3:10', { matchId: 'A-r1', outcome: 'win', winnerTeamId: 'T2', cups: { a: 3, b: 10 } }],
    [
      'Sieg durch Zeit B 2:6',
      { matchId: 'A-r1', outcome: 'winByTime', winnerTeamId: 'T2', cups: { a: 2, b: 6 } },
    ],
    [
      'Sieg durch Zeit A bei gleichen Bechern 4:4',
      { matchId: 'A-r1', outcome: 'winByTime', winnerTeamId: 'T1', cups: { a: 4, b: 4 } },
    ],
    ['Unentschieden 5:5', { matchId: 'A-r1', outcome: 'draw', cups: { a: 5, b: 5 } }],
    ['Unentschieden 0:0', { matchId: 'A-r1', outcome: 'draw', cups: { a: 0, b: 0 } }],
  ])('S01: %s (trackCups an)', (_name, payload) => {
    const s = heat1Running({ trackCups: true });
    const e = expectSingle(s.decide(rr(payload)), 'ResultRecorded');
    expect(e.payload).toStrictEqual(payload);
  });

  it('M07: nach apply steht das Ergebnis in state.results und fließt in die Tabelle', () => {
    const s = heat1Running();
    s.run(rr({ matchId: 'A-r1', outcome: 'winByTime', winnerTeamId: 'T2' }));
    expect(s.state.results['A-r1']).toEqual({ outcome: 'winByTime', winnerTeamId: 'T2' });
    const t2 = computeStandings(s.state, 'A').rows.find((r) => r.teamId === 'T2');
    expect(t2).toMatchObject({ points: 2, winsByTime: 1, played: 1 });
  });
});

// ---------------------------------------------------------------------------
// recordResult – Fehler
// ---------------------------------------------------------------------------

describe('M07: recordResult – Validierung (SPEC Ergebnis-Payload)', () => {
  it.each<[string, Omit<RR, 'type'>, DomainErrorCode]>([
    [
      'unbekannte Partie',
      { matchId: 'nope', outcome: 'win', winnerTeamId: 'T1' },
      'MATCH_NOT_FOUND',
    ],
    [
      'Freilos-Partie',
      { matchId: 'A-r1-bye', outcome: 'win', winnerTeamId: 'T3' },
      'MATCH_NOT_PLAYABLE',
    ],
    ['Freilos-Partie als draw', { matchId: 'A-r1-bye', outcome: 'draw' }, 'MATCH_NOT_PLAYABLE'],
    ['win ohne Sieger', { matchId: 'A-r1', outcome: 'win' }, 'INVALID_RESULT'],
    ['winByTime ohne Sieger', { matchId: 'A-r1', outcome: 'winByTime' }, 'INVALID_RESULT'],
    [
      'Sieger aus derselben Gruppe, aber nicht in der Partie',
      { matchId: 'A-r1', outcome: 'win', winnerTeamId: 'T3' },
      'INVALID_RESULT',
    ],
    [
      'Sieger aus anderer Gruppe',
      { matchId: 'A-r1', outcome: 'winByTime', winnerTeamId: 'T4' },
      'INVALID_RESULT',
    ],
    [
      'unbekannter Sieger',
      { matchId: 'A-r1', outcome: 'win', winnerTeamId: 'ghost' },
      'INVALID_RESULT',
    ],
    ['draw mit Sieger', { matchId: 'A-r1', outcome: 'draw', winnerTeamId: 'T1' }, 'INVALID_RESULT'],
    [
      'cups bei trackCups aus (win)',
      { matchId: 'A-r1', outcome: 'win', winnerTeamId: 'T1', cups: { a: 10, b: 2 } },
      'INVALID_RESULT',
    ],
    [
      'cups bei trackCups aus (draw)',
      { matchId: 'A-r1', outcome: 'draw', cups: { a: 3, b: 3 } },
      'INVALID_RESULT',
    ],
  ])('M07/S01: %s → %s (trackCups aus)', (_name, payload, code) => {
    expectError(heat1Running().decide(rr(payload)), code);
  });

  it.each<[string, Omit<RR, 'type'>]>([
    ['win ohne cups', { matchId: 'A-r1', outcome: 'win', winnerTeamId: 'T1' }],
    ['winByTime ohne cups', { matchId: 'A-r1', outcome: 'winByTime', winnerTeamId: 'T2' }],
    ['draw ohne cups', { matchId: 'A-r1', outcome: 'draw' }],
    ['draw mit ungleichen Bechern', { matchId: 'A-r1', outcome: 'draw', cups: { a: 3, b: 4 } }],
    [
      'Sieger A mit weniger Bechern',
      { matchId: 'A-r1', outcome: 'win', winnerTeamId: 'T1', cups: { a: 4, b: 6 } },
    ],
    [
      'Sieger B mit weniger Bechern',
      { matchId: 'A-r1', outcome: 'winByTime', winnerTeamId: 'T2', cups: { a: 6, b: 4 } },
    ],
    [
      'draw mit Sieger und gleichen Bechern',
      { matchId: 'A-r1', outcome: 'draw', winnerTeamId: 'T1', cups: { a: 5, b: 5 } },
    ],
  ])('S01: %s → INVALID_RESULT (trackCups an, Gruppenphase)', (_name, payload) => {
    expectError(heat1Running({ trackCups: true }).decide(rr(payload)), 'INVALID_RESULT');
  });

  it('M07: zweites Ergebnis für dieselbe Partie → RESULT_ALREADY_RECORDED', () => {
    const s = heat1Running();
    s.run(rr({ matchId: 'A-r1', outcome: 'win', winnerTeamId: 'T1' }));
    expectError(
      s.decide(rr({ matchId: 'A-r1', outcome: 'win', winnerTeamId: 'T1' })),
      'RESULT_ALREADY_RECORDED',
    );
    expectError(s.decide(rr({ matchId: 'A-r1', outcome: 'draw' })), 'RESULT_ALREADY_RECORDED');
  });

  it('M07: Partie eines nicht gestarteten Durchgangs → HEAT_NOT_STARTED', () => {
    const s = heat1Running();
    expectError(
      s.decide(rr({ matchId: 'A-r2', outcome: 'win', winnerTeamId: 'T1' })),
      'HEAT_NOT_STARTED',
    );
    expectError(
      startedSession().decide(rr({ matchId: 'A-r1', outcome: 'win', winnerTeamId: 'T1' })),
      'HEAT_NOT_STARTED',
    );
  });

  it('M19/M07: Korrektur = undo des Ergebnisses + neues recordResult', () => {
    const s = heat1Running();
    s.run(rr({ matchId: 'A-r1', outcome: 'win', winnerTeamId: 'T1' }));
    s.run({ type: 'undo' });
    expect(s.state.results['A-r1']).toBeUndefined();
    const e = expectSingle(
      s.decide(rr({ matchId: 'A-r1', outcome: 'win', winnerTeamId: 'T2' })),
      'ResultRecorded',
    );
    expect(e.payload).toStrictEqual({ matchId: 'A-r1', outcome: 'win', winnerTeamId: 'T2' });
  });

  it('M19/M07: Redo des aufgehobenen Ergebnisses → wieder RESULT_ALREADY_RECORDED', () => {
    const s = heat1Running();
    s.run(rr({ matchId: 'A-r1', outcome: 'draw' }));
    const [undone] = s.run({ type: 'undo' });
    if (!undone) throw new Error('kein Undone');
    expect(s.state.results['A-r1']).toBeUndefined();
    s.run({ type: 'undoEvent', eventId: undone.id });
    expect(s.state.results['A-r1']).toEqual({ outcome: 'draw' });
    expectError(s.decide(rr({ matchId: 'A-r1', outcome: 'draw' })), 'RESULT_ALREADY_RECORDED');
  });
});

// ---------------------------------------------------------------------------
// recordResult – KO
// ---------------------------------------------------------------------------

describe('M14: recordResult im KO', () => {
  it('M14: draw im KO → DRAW_NOT_ALLOWED_IN_KNOCKOUT', () => {
    expectError(
      finalReady().decide(rr({ matchId: 'FINAL', outcome: 'draw' })),
      'DRAW_NOT_ALLOWED_IN_KNOCKOUT',
    );
  });

  it('M14/S01: draw im KO mit gleichen Bechern (trackCups an) → DRAW_NOT_ALLOWED_IN_KNOCKOUT', () => {
    expectError(
      finalReady({ trackCups: true }).decide(
        rr({ matchId: 'FINAL', outcome: 'draw', cups: { a: 6, b: 6 } }),
      ),
      'DRAW_NOT_ALLOWED_IN_KNOCKOUT',
    );
  });

  it.each<[string, Omit<RR, 'type'>]>([
    ['win', { matchId: 'FINAL', outcome: 'win', winnerTeamId: 'T1' }],
    [
      'winByTime (nächster Becher gewinnt)',
      { matchId: 'FINAL', outcome: 'winByTime', winnerTeamId: 'T4' },
    ],
  ])('M14: KO-Ergebnis %s wird gespeichert', (_name, payload) => {
    const e = expectSingle(finalReady().decide(rr(payload)), 'ResultRecorded');
    expect(e.payload).toStrictEqual(payload);
  });

  it.each<[string, Omit<RR, 'type'>]>([
    ['ohne cups', { matchId: 'FINAL', outcome: 'win', winnerTeamId: 'T1' }],
    ['mit cups', { matchId: 'FINAL', outcome: 'win', winnerTeamId: 'T1', cups: { a: 10, b: 9 } }],
    [
      'winByTime bei gleichen Bechern',
      { matchId: 'FINAL', outcome: 'winByTime', winnerTeamId: 'T4', cups: { a: 7, b: 7 } },
    ],
  ])('S01/M14: trackCups an – cups im KO optional (%s)', (_name, payload) => {
    const e = expectSingle(finalReady({ trackCups: true }).decide(rr(payload)), 'ResultRecorded');
    expect(e.payload).toStrictEqual(payload);
  });

  it.each<[string, Omit<RR, 'type'>]>([
    ['ohne Sieger', { matchId: 'FINAL', outcome: 'win' }],
    ['Sieger nicht in der Partie', { matchId: 'FINAL', outcome: 'winByTime', winnerTeamId: 'T2' }],
  ])('M14: KO %s → INVALID_RESULT', (_name, payload) => {
    expectError(finalReady().decide(rr(payload)), 'INVALID_RESULT');
  });

  it('M14/S01: KO mit cups, Sieger hat weniger Becher → INVALID_RESULT', () => {
    expectError(
      finalReady({ trackCups: true }).decide(
        rr({ matchId: 'FINAL', outcome: 'win', winnerTeamId: 'T1', cups: { a: 3, b: 9 } }),
      ),
      'INVALID_RESULT',
    );
  });

  it('M14: KO-Partie vor HeatStarted → HEAT_NOT_STARTED', () => {
    expectError(
      finalReady({}, false).decide(rr({ matchId: 'FINAL', outcome: 'win', winnerTeamId: 'T1' })),
      'HEAT_NOT_STARTED',
    );
  });
});

// ---------------------------------------------------------------------------
// recordPlayoff
// ---------------------------------------------------------------------------

const sorted = (xs: readonly string[]) => [...xs].sort();
const playoffSets = (s: TournamentState, groupId: string) =>
  computeStandings(s, groupId).needsPlayoff.map(sorted);

describe('M09: recordPlayoff (SPEC Stechen)', () => {
  it('M09: Fixture – Kreis in Gruppe A verlangt Stechen [T1,T2,T3], Gruppe B nicht', () => {
    const { s } = groupStageDone('circle');
    expect(playoffSets(s.state, 'A')).toEqual([['T1', 'T2', 'T3']]);
    expect(playoffSets(s.state, 'B')).toEqual([]);
  });

  it('M09: Erfolg → PlayoffRecorded; danach ist die Teilmenge nicht mehr in needsPlayoff', () => {
    const { s } = groupStageDone('circle');
    const e = expectSingle(
      s.decide(rp({ groupId: 'A', tiedTeamIds: ['T1', 'T2', 'T3'], winnerTeamId: 'T2' })),
      'PlayoffRecorded',
    );
    expect(e.payload.groupId).toBe('A');
    expect(e.payload.winnerTeamId).toBe('T2');
    expect(sorted(e.payload.tiedTeamIds)).toEqual(['T1', 'T2', 'T3']);
    s.append(e);
    const st = computeStandings(s.state, 'A');
    expect(st.needsPlayoff).toEqual([]);
    expect(st.rows[0]).toMatchObject({ teamId: 'T2', rank: 1, rankReason: 'playoff' });
  });

  it('M09: tiedTeamIds als Menge – andere Reihenfolge wird akzeptiert', () => {
    const { s } = groupStageDone('circle');
    const e = expectSingle(
      s.decide(rp({ groupId: 'A', tiedTeamIds: ['T3', 'T1', 'T2'], winnerTeamId: 'T3' })),
      'PlayoffRecorded',
    );
    expect(sorted(e.payload.tiedTeamIds)).toEqual(['T1', 'T2', 'T3']);
  });

  it('M09: unbekannte Gruppe → GROUP_NOT_FOUND', () => {
    const { s } = groupStageDone('circle');
    expectError(
      s.decide(rp({ groupId: 'Z', tiedTeamIds: ['T1', 'T2'], winnerTeamId: 'T1' })),
      'GROUP_NOT_FOUND',
    );
  });

  it('M09: Gruppe nicht komplett → GROUP_STAGE_INCOMPLETE', () => {
    const s = heat1Running();
    s.run(rr({ matchId: 'A-r1', outcome: 'draw' }));
    expectError(
      s.decide(rp({ groupId: 'A', tiedTeamIds: ['T1', 'T2'], winnerTeamId: 'T1' })),
      'GROUP_STAGE_INCOMPLETE',
    );
  });

  it('M09/M19: letztes Gruppenergebnis aufgehoben → GROUP_STAGE_INCOMPLETE', () => {
    const { s } = groupStageDone('circle');
    s.run({ type: 'undo' });
    expectError(
      s.decide(rp({ groupId: 'A', tiedTeamIds: ['T1', 'T2', 'T3'], winnerTeamId: 'T1' })),
      'GROUP_STAGE_INCOMPLETE',
    );
  });

  it.each<[string, Omit<RP, 'type'>]>([
    ['Gruppe ohne Gleichstand', { groupId: 'B', tiedTeamIds: ['T4', 'T5'], winnerTeamId: 'T4' }],
    [
      'echte Teilmenge des Gleichstands',
      { groupId: 'A', tiedTeamIds: ['T1', 'T2'], winnerTeamId: 'T1' },
    ],
    [
      'Obermenge mit fremdem Team',
      { groupId: 'A', tiedTeamIds: ['T1', 'T2', 'T3', 'T4'], winnerTeamId: 'T1' },
    ],
    ['Teams einer anderen Gruppe', { groupId: 'A', tiedTeamIds: ['T4', 'T5'], winnerTeamId: 'T4' }],
  ])('M09: %s → PLAYOFF_NOT_NEEDED', (_name, payload) => {
    const { s } = groupStageDone('circle');
    expectError(s.decide(rp(payload)), 'PLAYOFF_NOT_NEEDED');
  });

  it('M09: Gleichstand ganz innerhalb der Weiterkommenden (Platz 1–2, q = 2) → tied, kein needsPlayoff, recordPlayoff → PLAYOFF_NOT_NEEDED', () => {
    const { s } = groupStageDone('topTie', { q: 2 });
    const st = computeStandings(s.state, 'A');
    expect(st.rows.map((r) => [r.teamId, r.rank, r.rankReason])).toEqual([
      ['T1', 1, 'tied'],
      ['T2', 1, 'tied'],
      ['T3', 3, 'points'],
    ]);
    expect(st.needsPlayoff).toEqual([]);
    expectError(
      s.decide(rp({ groupId: 'A', tiedTeamIds: ['T1', 'T2'], winnerTeamId: 'T1' })),
      'PLAYOFF_NOT_NEEDED',
    );
  });

  it('M09: derselbe Gleichstand über die q-Grenze (q = 1) → Stechen nötig und zulässig', () => {
    const { s } = groupStageDone('topTie', { q: 1 });
    expect(playoffSets(s.state, 'A')).toEqual([['T1', 'T2']]);
    expectSingle(
      s.decide(rp({ groupId: 'A', tiedTeamIds: ['T2', 'T1'], winnerTeamId: 'T2' })),
      'PlayoffRecorded',
    );
  });

  it('M09: klare Gruppe ohne Gleichstand → PLAYOFF_NOT_NEEDED', () => {
    const { s } = groupStageDone('clear');
    expectError(
      s.decide(rp({ groupId: 'A', tiedTeamIds: ['T2', 'T3'], winnerTeamId: 'T2' })),
      'PLAYOFF_NOT_NEEDED',
    );
  });

  it.each([
    ['Team außerhalb des Gleichstands (andere Gruppe)', 'T4'],
    ['unbekanntes Team', 'ghost'],
  ])('M09: Sieger %s → INVALID_RESULT', (_name, winner) => {
    const { s } = groupStageDone('circle');
    expectError(
      s.decide(rp({ groupId: 'A', tiedTeamIds: ['T1', 'T2', 'T3'], winnerTeamId: winner })),
      'INVALID_RESULT',
    );
  });

  it('M09: dasselbe Stechen zweimal → beim zweiten Mal PLAYOFF_NOT_NEEDED', () => {
    const { s } = groupStageDone('circle');
    s.run(rp({ groupId: 'A', tiedTeamIds: ['T1', 'T2', 'T3'], winnerTeamId: 'T1' }));
    expectError(
      s.decide(rp({ groupId: 'A', tiedTeamIds: ['T1', 'T2', 'T3'], winnerTeamId: 'T1' })),
      'PLAYOFF_NOT_NEEDED',
    );
  });

  it('M09: mehrere Stechen nacheinander (q = 2, Gruppe A nur Unentschieden)', () => {
    const { s } = groupStageDone('draws', { q: 2 });
    expect(playoffSets(s.state, 'A')).toEqual([['T1', 'T2', 'T3']]);
    // Teilmenge des zweiten Stechens vor dem ersten nicht zulässig
    expectError(
      s.decide(rp({ groupId: 'A', tiedTeamIds: ['T1', 'T3'], winnerTeamId: 'T1' })),
      'PLAYOFF_NOT_NEEDED',
    );
    s.run(rp({ groupId: 'A', tiedTeamIds: ['T1', 'T2', 'T3'], winnerTeamId: 'T2' }));
    expect(playoffSets(s.state, 'A')).toEqual([['T1', 'T3']]);
    const e = expectSingle(
      s.decide(rp({ groupId: 'A', tiedTeamIds: ['T3', 'T1'], winnerTeamId: 'T3' })),
      'PlayoffRecorded',
    );
    s.append(e);
    const st = computeStandings(s.state, 'A');
    expect(st.needsPlayoff).toEqual([]);
    expect(st.rows.slice(0, 3).map((r) => [r.teamId, r.rank])).toEqual([
      ['T2', 1],
      ['T3', 2],
      ['T1', 3],
    ]);
  });

  it('M09: q = 1 – nach dem ersten Stechen kein zweites nötig (Rest hinter q)', () => {
    const { s } = groupStageDone('draws', { q: 1 });
    s.run(rp({ groupId: 'A', tiedTeamIds: ['T1', 'T2', 'T3'], winnerTeamId: 'T2' }));
    expect(playoffSets(s.state, 'A')).toEqual([]);
    expectError(
      s.decide(rp({ groupId: 'A', tiedTeamIds: ['T1', 'T3'], winnerTeamId: 'T1' })),
      'PLAYOFF_NOT_NEEDED',
    );
  });

  it('M09/S01: mit trackCups und gleicher Becherdifferenz im Kreis weiterhin Stechen nötig', () => {
    const { s } = groupStageDone('circle', { trackCups: true });
    expect(playoffSets(s.state, 'A')).toEqual([['T1', 'T2', 'T3']]);
    expectSingle(
      s.decide(rp({ groupId: 'A', tiedTeamIds: ['T1', 'T2', 'T3'], winnerTeamId: 'T1' })),
      'PlayoffRecorded',
    );
  });

  it('M19/Stechen: undo des ersten Stechens, auf dem ein zweites liegt → UNDO_HAS_DEPENDENTS', () => {
    const { s } = groupStageDone('draws', { q: 2 });
    const [first] = s.run(
      rp({ groupId: 'A', tiedTeamIds: ['T1', 'T2', 'T3'], winnerTeamId: 'T2' }),
    );
    const [second] = s.run(rp({ groupId: 'A', tiedTeamIds: ['T1', 'T3'], winnerTeamId: 'T1' }));
    if (!first || !second) throw new Error('Stechen fehlen');
    const r = s.decide({ type: 'undoEvent', eventId: first.id });
    if (r.ok) throw new Error('erwartet UNDO_HAS_DEPENDENTS');
    expect(r.error.code).toBe('UNDO_HAS_DEPENDENTS');
    expect(r.error.dependents).toContain(second.id);
  });
});

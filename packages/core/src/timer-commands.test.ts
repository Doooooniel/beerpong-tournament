// Regeltests aus SPEC M13 („Timer“), M12 (ohne Zeitlimit), Architekturregel 4 und 6:
// pauseTimer, resumeTimer, extendTimer, restartTimer über decide + apply.
// Fixture: TournamentStarted wird per Hand gebaut, Durchgänge per HeatStarted mit festem `at` gestartet.
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  DomainEventSchema,
  apply,
  decide,
  initialState,
  remainingMs,
} from './index.js';
import type {
  Command,
  DecideContext,
  DomainErrorCode,
  DomainEvent,
  DomainEventType,
  EventOf,
  Heat,
  Match,
  NewEvent,
  Timer,
  TournamentState,
} from './index.js';

// ---------------------------------------------------------------------------
// Testhilfen (lokal)
// ---------------------------------------------------------------------------

const T0 = 1_700_000_000_000;
const SEC = 1_000;
const MIN = 60_000;
/** Zeitpunkt, an dem h1 in der Standard-Fixture gestartet wird. */
const START = T0 + 10 * MIN;
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

/** Ereignisfolge mit lückenlosem seq und explizitem `at`; Zustand wird schrittweise per apply gebaut. */
class Fixture {
  state: TournamentState = initialState();
  private seq = 0;

  add<T extends Exclude<DomainEventType, 'Undone'>>(
    at: number,
    type: T,
    payload: EventOf<T>['payload'],
    id: string = `e${this.seq + 1}`,
  ): EventOf<T> {
    return this.push({ id, type, v: 1, payload, at }) as EventOf<T>;
  }

  undo(at: number, undoes: string, cascade: string[] = []): EventOf<'Undone'> {
    return this.push({
      id: `u${this.seq + 1}`,
      type: 'Undone',
      v: 1,
      undoes,
      payload: { cascade },
      at,
    }) as EventOf<'Undone'>;
  }

  /** decide → seq vergeben → apply. Scheitert der Befehl, scheitert der Test. */
  run(command: Command, now: number): DomainEvent[] {
    const result = decide(this.state, command, ctx(now));
    if (!result.ok) {
      throw new Error(
        `decide(${command.type}) failed: ${result.error.code} ${result.error.message}`,
      );
    }
    return result.value.map((event: NewEvent) => this.applyNew(event));
  }

  expectError(command: Command, now: number, code: DomainErrorCode): void {
    const result = decide(this.state, command, ctx(now));
    if (result.ok) {
      throw new Error(`expected ${code} for ${command.type}, got ${JSON.stringify(result.value)}`);
    }
    expect(result.error.code).toBe(code);
    expect(result.error.message.length).toBeGreaterThan(0);
  }

  timer(heatId = 'h1'): Timer {
    const t = this.state.timers[heatId];
    if (!t) throw new Error(`kein Timer für ${heatId}`);
    return t;
  }

  private applyNew(event: NewEvent): DomainEvent {
    this.seq += 1;
    const full = DomainEventSchema.parse({ ...event, seq: this.seq });
    this.state = apply(this.state, full);
    return full;
  }

  private push(partial: Record<string, unknown>): DomainEvent {
    this.seq += 1;
    const event = DomainEventSchema.parse({ ...partial, seq: this.seq });
    this.state = apply(this.state, event);
    return event;
  }
}

const groupMatch = (id: string, groupId: string, a: string, b: string): Match => ({
  id,
  phase: 'group',
  round: 1,
  position: 1,
  groupId,
  a: { teamId: a },
  b: { teamId: b },
  bye: false,
});

const heat = (id: string, index: number, matchIds: string[]): Heat => ({
  id,
  phase: 'group',
  round: 1,
  index,
  matchIds,
});

/** Turnier angelegt, 4 Teams, 1 Tisch – noch nicht gestartet. */
const created = (): Fixture => {
  const f = new Fixture();
  f.add(T0, 'TournamentCreated', { name: 'Sommerturnier', settings: DEFAULT_SETTINGS }, 'created');
  for (const [i, name] of ['Alpha', 'Bravo', 'Charlie', 'Delta'].entries()) {
    f.add(T0 + (i + 1) * SEC, 'TeamAdded', { teamId: `t${i + 1}`, name, players: [name] });
  }
  f.add(T0 + 5 * SEC, 'TableCountSet', { tableCount: 1 });
  return f;
};

/** Gestartet: Gruppen A/B, je eine Partie, zwei Durchgänge h1 (mA) und h2 (mB). Kein Durchgang läuft. */
const started = (): Fixture => {
  const f = created();
  f.add(
    T0 + 6 * SEC,
    'TournamentStarted',
    {
      groups: [
        { id: 'A', teamIds: ['t1', 't2'] },
        { id: 'B', teamIds: ['t3', 't4'] },
      ],
      advancersPerGroup: 1,
      matches: [groupMatch('mA', 'A', 't1', 't2'), groupMatch('mB', 'B', 't3', 't4')],
      heats: [heat('h1', 1, ['mA']), heat('h2', 2, ['mB'])],
    },
    'started',
  );
  return f;
};

/** h1 läuft seit START mit 15 min. */
const running = (durationMs: number | null = GROUP_MS): Fixture => {
  const f = started();
  f.add(START, 'HeatStarted', { heatId: 'h1', durationMs }, 'hs1');
  return f;
};

const only = <T extends DomainEventType>(events: DomainEvent[], type: T): EventOf<T> => {
  expect(events).toHaveLength(1);
  const [event] = events;
  if (!event || event.type !== type) throw new Error(`erwartet ${type}, erhalten ${event?.type}`);
  return event as EventOf<T>;
};

// ---------------------------------------------------------------------------
// Fixture-Prüfung
// ---------------------------------------------------------------------------

describe('Fixture: HeatStarted setzt den Timer aus dem Ereignis-at (Architekturregel 6)', () => {
  it('Regel 6: HeatStarted → Timer { durationMs, startedAt = at, pausedAt null, pausedTotalMs 0 }', () => {
    const f = running();
    expect(f.timer()).toEqual({
      durationMs: GROUP_MS,
      startedAt: START,
      pausedAt: null,
      pausedTotalMs: 0,
    });
    expect(f.state.timers['h2']).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Vorbedingungen gemeinsam
// ---------------------------------------------------------------------------

describe('Timer-Befehle – Vorbedingungen (M13)', () => {
  const commands: Command[] = [
    { type: 'pauseTimer', heatId: 'h1' },
    { type: 'resumeTimer', heatId: 'h1' },
    { type: 'extendTimer', heatId: 'h1', byMs: MIN },
    { type: 'restartTimer', heatId: 'h1' },
  ];

  it.each(commands.map((c) => [c.type, c] as const))(
    'M13 %s vor Turnierstart → TOURNAMENT_NOT_STARTED',
    (_type, command) => {
      created().expectError(command, START, 'TOURNAMENT_NOT_STARTED');
    },
  );

  it.each(commands.map((c) => [c.type, c] as const))(
    'M13 %s ohne angelegtes Turnier → TOURNAMENT_NOT_CREATED',
    (_type, command) => {
      new Fixture().expectError(command, START, 'TOURNAMENT_NOT_CREATED');
    },
  );

  it.each(commands.map((c) => [c.type, { ...c, heatId: 'unbekannt' } as Command] as const))(
    'M13 %s mit unbekanntem Durchgang → HEAT_NOT_FOUND',
    (_type, command) => {
      running().expectError(command, START + MIN, 'HEAT_NOT_FOUND');
    },
  );

  it.each(commands.map((c) => [c.type, c] as const))(
    'M13 %s für nicht gestarteten Durchgang → TIMER_NOT_RUNNING',
    (_type, command) => {
      started().expectError(command, START, 'TIMER_NOT_RUNNING');
    },
  );

  it.each(commands.map((c) => [c.type, { ...c, heatId: 'h2' } as Command] as const))(
    'M13 %s für anderen, nicht gestarteten Durchgang h2 → TIMER_NOT_RUNNING',
    (_type, command) => {
      running().expectError(command, START + MIN, 'TIMER_NOT_RUNNING');
    },
  );

  it('M13 Fehler erzeugen keine Ereignisse und ändern den Zustand nicht', () => {
    const f = running(null);
    const before = f.state;
    f.expectError({ type: 'pauseTimer', heatId: 'h1' }, START + MIN, 'TIMER_UNLIMITED');
    expect(f.state).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// pauseTimer
// ---------------------------------------------------------------------------

describe('pauseTimer (M13)', () => {
  it('M13 Erfolg: TimerPaused { heatId } mit at = ctx.now, v = 1', () => {
    const f = running();
    const now = START + 4 * MIN;
    const event = only(f.run({ type: 'pauseTimer', heatId: 'h1' }, now), 'TimerPaused');
    expect(event.payload).toEqual({ heatId: 'h1' });
    expect(event.at).toBe(now);
    expect(event.v).toBe(1);
  });

  it('M13 Erfolg: timer.pausedAt = now, Rest unverändert', () => {
    const f = running();
    const now = START + 4 * MIN;
    f.run({ type: 'pauseTimer', heatId: 'h1' }, now);
    expect(f.timer()).toEqual({
      durationMs: GROUP_MS,
      startedAt: START,
      pausedAt: now,
      pausedTotalMs: 0,
    });
  });

  it('M13 pausiert: Restzeit bleibt eingefroren', () => {
    const f = running();
    f.run({ type: 'pauseTimer', heatId: 'h1' }, START + 4 * MIN);
    expect(remainingMs(f.timer(), START + 4 * MIN)).toBe(11 * MIN);
    expect(remainingMs(f.timer(), START + 30 * MIN)).toBe(11 * MIN);
  });

  it('M13 bereits pausiert → TIMER_ALREADY_PAUSED', () => {
    const f = running();
    f.run({ type: 'pauseTimer', heatId: 'h1' }, START + MIN);
    f.expectError({ type: 'pauseTimer', heatId: 'h1' }, START + 2 * MIN, 'TIMER_ALREADY_PAUSED');
  });

  it('M12 ohne Zeitlimit (durationMs null) → TIMER_UNLIMITED', () => {
    running(null).expectError({ type: 'pauseTimer', heatId: 'h1' }, START + MIN, 'TIMER_UNLIMITED');
  });

  it('M13 Pause nach Fortsetzen ist wieder erlaubt', () => {
    const f = running();
    f.run({ type: 'pauseTimer', heatId: 'h1' }, START + MIN);
    f.run({ type: 'resumeTimer', heatId: 'h1' }, START + 2 * MIN);
    const event = only(f.run({ type: 'pauseTimer', heatId: 'h1' }, START + 3 * MIN), 'TimerPaused');
    expect(event.at).toBe(START + 3 * MIN);
    expect(f.timer().pausedAt).toBe(START + 3 * MIN);
  });

  it('M13 Pause wirkt nur auf den genannten Durchgang', () => {
    const f = running();
    f.add(START + MIN, 'HeatStarted', { heatId: 'h2', durationMs: GROUP_MS });
    f.run({ type: 'pauseTimer', heatId: 'h1' }, START + 2 * MIN);
    expect(f.timer('h1').pausedAt).toBe(START + 2 * MIN);
    expect(f.timer('h2').pausedAt).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// resumeTimer
// ---------------------------------------------------------------------------

describe('resumeTimer (M13)', () => {
  it('M13 Erfolg: TimerResumed { heatId } mit at = ctx.now', () => {
    const f = running();
    f.run({ type: 'pauseTimer', heatId: 'h1' }, START + 4 * MIN);
    const now = START + 7 * MIN;
    const event = only(f.run({ type: 'resumeTimer', heatId: 'h1' }, now), 'TimerResumed');
    expect(event.payload).toEqual({ heatId: 'h1' });
    expect(event.at).toBe(now);
  });

  it('M13 Erfolg: pausedAt = null, pausedTotalMs wächst um (now − pausedAt)', () => {
    const f = running();
    f.run({ type: 'pauseTimer', heatId: 'h1' }, START + 4 * MIN);
    f.run({ type: 'resumeTimer', heatId: 'h1' }, START + 7 * MIN);
    expect(f.timer()).toEqual({
      durationMs: GROUP_MS,
      startedAt: START,
      pausedAt: null,
      pausedTotalMs: 3 * MIN,
    });
  });

  it('M13 mehrfach pausiert: pausedTotalMs summiert alle Pausen', () => {
    const f = running();
    f.run({ type: 'pauseTimer', heatId: 'h1' }, START + 1 * MIN);
    f.run({ type: 'resumeTimer', heatId: 'h1' }, START + 2 * MIN); // +1 min
    f.run({ type: 'pauseTimer', heatId: 'h1' }, START + 5 * MIN);
    f.run({ type: 'resumeTimer', heatId: 'h1' }, START + 5 * MIN + 30 * SEC); // +30 s
    expect(f.timer().pausedTotalMs).toBe(MIN + 30 * SEC);
    expect(f.timer().pausedAt).toBeNull();
  });

  it('M13 läuft (nicht pausiert) → TIMER_NOT_PAUSED', () => {
    running().expectError({ type: 'resumeTimer', heatId: 'h1' }, START + MIN, 'TIMER_NOT_PAUSED');
  });

  it('M13 nach Fortsetzen erneut fortsetzen → TIMER_NOT_PAUSED', () => {
    const f = running();
    f.run({ type: 'pauseTimer', heatId: 'h1' }, START + MIN);
    f.run({ type: 'resumeTimer', heatId: 'h1' }, START + 2 * MIN);
    f.expectError({ type: 'resumeTimer', heatId: 'h1' }, START + 3 * MIN, 'TIMER_NOT_PAUSED');
  });
});

// ---------------------------------------------------------------------------
// extendTimer
// ---------------------------------------------------------------------------

describe('extendTimer (M13)', () => {
  it('M13 Erfolg: TimerExtended { heatId, byMs } mit at = ctx.now', () => {
    const f = running();
    const now = START + 5 * MIN;
    const event = only(
      f.run({ type: 'extendTimer', heatId: 'h1', byMs: 2 * MIN }, now),
      'TimerExtended',
    );
    expect(event.payload).toEqual({ heatId: 'h1', byMs: 2 * MIN });
    expect(event.at).toBe(now);
  });

  it('M13 Erfolg: durationMs + byMs, sonst unverändert', () => {
    const f = running();
    f.run({ type: 'extendTimer', heatId: 'h1', byMs: 2 * MIN }, START + 5 * MIN);
    expect(f.timer()).toEqual({
      durationMs: GROUP_MS + 2 * MIN,
      startedAt: START,
      pausedAt: null,
      pausedTotalMs: 0,
    });
  });

  it('M13 mehrfach verlängert: Verlängerungen addieren sich', () => {
    const f = running();
    f.run({ type: 'extendTimer', heatId: 'h1', byMs: MIN }, START + 5 * MIN);
    f.run({ type: 'extendTimer', heatId: 'h1', byMs: 30 * SEC }, START + 6 * MIN);
    expect(f.timer().durationMs).toBe(GROUP_MS + MIN + 30 * SEC);
  });

  it('M13 erlaubt auch pausiert; Pause bleibt bestehen', () => {
    const f = running();
    f.run({ type: 'pauseTimer', heatId: 'h1' }, START + 4 * MIN);
    f.run({ type: 'extendTimer', heatId: 'h1', byMs: MIN }, START + 6 * MIN);
    expect(f.timer()).toEqual({
      durationMs: GROUP_MS + MIN,
      startedAt: START,
      pausedAt: START + 4 * MIN,
      pausedTotalMs: 0,
    });
    expect(remainingMs(f.timer(), START + 6 * MIN)).toBe(12 * MIN);
  });

  it('M13 erlaubt auch nach Ablauf (Restzeit wird wieder positiv)', () => {
    const f = running();
    const now = START + GROUP_MS + 20 * SEC;
    expect(remainingMs(f.timer(), now)).toBe(-20 * SEC);
    f.run({ type: 'extendTimer', heatId: 'h1', byMs: MIN }, now);
    expect(remainingMs(f.timer(), now)).toBe(40 * SEC);
  });

  it('M12 ohne Zeitlimit → TIMER_UNLIMITED', () => {
    running(null).expectError(
      { type: 'extendTimer', heatId: 'h1', byMs: MIN },
      START + MIN,
      'TIMER_UNLIMITED',
    );
  });
});

// ---------------------------------------------------------------------------
// restartTimer
// ---------------------------------------------------------------------------

describe('restartTimer (M13, SPEC „Neustart setzt auf die Dauer aus HeatStarted zurück“)', () => {
  it('M13 Erfolg laufend: TimerRestarted { heatId, durationMs } mit at = ctx.now', () => {
    const f = running();
    const now = START + 5 * MIN;
    const event = only(f.run({ type: 'restartTimer', heatId: 'h1' }, now), 'TimerRestarted');
    expect(event.payload).toEqual({ heatId: 'h1', durationMs: GROUP_MS });
    expect(event.at).toBe(now);
  });

  it('M13 Erfolg laufend: startedAt = now, pausedAt null, pausedTotalMs 0, durationMs = Startdauer', () => {
    const f = running();
    const now = START + 5 * MIN;
    f.run({ type: 'restartTimer', heatId: 'h1' }, now);
    expect(f.timer()).toEqual({
      durationMs: GROUP_MS,
      startedAt: now,
      pausedAt: null,
      pausedTotalMs: 0,
    });
    expect(remainingMs(f.timer(), now)).toBe(GROUP_MS);
  });

  it('M13 erlaubt pausiert: Pause und Pausensumme werden zurückgesetzt, Timer läuft', () => {
    const f = running();
    f.run({ type: 'pauseTimer', heatId: 'h1' }, START + MIN);
    f.run({ type: 'resumeTimer', heatId: 'h1' }, START + 2 * MIN);
    f.run({ type: 'pauseTimer', heatId: 'h1' }, START + 3 * MIN);
    const now = START + 4 * MIN;
    f.run({ type: 'restartTimer', heatId: 'h1' }, now);
    expect(f.timer()).toEqual({
      durationMs: GROUP_MS,
      startedAt: now,
      pausedAt: null,
      pausedTotalMs: 0,
    });
  });

  it('M13 Verlängerungen verfallen beim Neustart', () => {
    const f = running();
    f.run({ type: 'extendTimer', heatId: 'h1', byMs: 3 * MIN }, START + 5 * MIN);
    const events = f.run({ type: 'restartTimer', heatId: 'h1' }, START + 6 * MIN);
    expect(only(events, 'TimerRestarted').payload.durationMs).toBe(GROUP_MS);
    expect(f.timer().durationMs).toBe(GROUP_MS);
  });

  it('M13 zweiter Neustart nach erneuter Verlängerung: wieder die Startdauer', () => {
    const f = running();
    f.run({ type: 'restartTimer', heatId: 'h1' }, START + MIN);
    f.run({ type: 'extendTimer', heatId: 'h1', byMs: MIN }, START + 2 * MIN);
    const events = f.run({ type: 'restartTimer', heatId: 'h1' }, START + 3 * MIN);
    expect(only(events, 'TimerRestarted').payload.durationMs).toBe(GROUP_MS);
    expect(f.timer()).toEqual({
      durationMs: GROUP_MS,
      startedAt: START + 3 * MIN,
      pausedAt: null,
      pausedTotalMs: 0,
    });
  });

  it('M13 Startdauer kommt aus HeatStarted, nicht aus späteren Einstellungen', () => {
    const f = running(12 * MIN);
    f.add(START + MIN, 'SettingsUpdated', { settings: { timerByPhase: { group: 20 * MIN } } });
    const events = f.run({ type: 'restartTimer', heatId: 'h1' }, START + 2 * MIN);
    expect(only(events, 'TimerRestarted').payload.durationMs).toBe(12 * MIN);
  });

  it('M13/M19 Startdauer aus dem wirksamen HeatStarted: aufgehobener Start zählt nicht', () => {
    const f = started();
    const first = f.add(START, 'HeatStarted', { heatId: 'h1', durationMs: 5 * MIN });
    f.undo(START + SEC, first.id);
    f.add(START + 2 * SEC, 'HeatStarted', { heatId: 'h1', durationMs: 8 * MIN });
    const events = f.run({ type: 'restartTimer', heatId: 'h1' }, START + MIN);
    expect(only(events, 'TimerRestarted').payload.durationMs).toBe(8 * MIN);
    expect(f.timer().durationMs).toBe(8 * MIN);
  });

  it('M12 ohne Zeitlimit → TIMER_UNLIMITED', () => {
    running(null).expectError(
      { type: 'restartTimer', heatId: 'h1' },
      START + MIN,
      'TIMER_UNLIMITED',
    );
  });
});

// ---------------------------------------------------------------------------
// Undo von Timer-Ereignissen (M19)
// ---------------------------------------------------------------------------

describe('Timer-Ereignisse und Undo (M13, M19)', () => {
  it('M19 aufgehobenes TimerPaused → Timer läuft, Fortsetzen → TIMER_NOT_PAUSED, Pausieren erlaubt', () => {
    const f = running();
    const [paused] = f.run({ type: 'pauseTimer', heatId: 'h1' }, START + MIN);
    if (!paused) throw new Error('TimerPaused fehlt');
    f.undo(START + 2 * MIN, paused.id);
    expect(f.timer().pausedAt).toBeNull();
    f.expectError({ type: 'resumeTimer', heatId: 'h1' }, START + 3 * MIN, 'TIMER_NOT_PAUSED');
    f.run({ type: 'pauseTimer', heatId: 'h1' }, START + 3 * MIN);
    expect(f.timer().pausedAt).toBe(START + 3 * MIN);
  });

  it('M19 aufgehobenes TimerExtended → durationMs wieder ohne Verlängerung', () => {
    const f = running();
    const [extended] = f.run({ type: 'extendTimer', heatId: 'h1', byMs: 2 * MIN }, START + MIN);
    if (!extended) throw new Error('TimerExtended fehlt');
    f.undo(START + 2 * MIN, extended.id);
    expect(f.timer().durationMs).toBe(GROUP_MS);
  });

  it('M19 aufgehobenes TimerRestarted → vorheriger Timerstand inkl. Verlängerung und Pausen', () => {
    const f = running();
    f.run({ type: 'pauseTimer', heatId: 'h1' }, START + MIN);
    f.run({ type: 'resumeTimer', heatId: 'h1' }, START + 2 * MIN);
    f.run({ type: 'extendTimer', heatId: 'h1', byMs: MIN }, START + 3 * MIN);
    const before = f.timer();
    const [restarted] = f.run({ type: 'restartTimer', heatId: 'h1' }, START + 4 * MIN);
    if (!restarted) throw new Error('TimerRestarted fehlt');
    f.undo(START + 5 * MIN, restarted.id);
    expect(f.timer()).toEqual(before);
  });
});

// ---------------------------------------------------------------------------
// Kombination: Restzeit gegen Handrechnung
// ---------------------------------------------------------------------------

describe('Kombination Pause/Fortsetzen/Verlängern → remainingMs (M13, SPEC-Formel)', () => {
  it('M13 Ablauf mit zwei Pausen und einer Verlängerung stimmt mit Handrechnung', () => {
    const f = running(); // 15 min ab START
    f.run({ type: 'pauseTimer', heatId: 'h1' }, START + 3 * MIN); // aktiv 3 min
    f.run({ type: 'resumeTimer', heatId: 'h1' }, START + 5 * MIN); // Pause 2 min
    f.run({ type: 'extendTimer', heatId: 'h1', byMs: 90 * SEC }, START + 6 * MIN); // 16:30
    f.run({ type: 'pauseTimer', heatId: 'h1' }, START + 10 * MIN); // aktiv 3 + 5 = 8 min
    // pausiert: 16:30 − 8:00 = 8:30, eingefroren
    expect(remainingMs(f.timer(), START + 10 * MIN)).toBe(8 * MIN + 30 * SEC);
    expect(remainingMs(f.timer(), START + 12 * MIN)).toBe(8 * MIN + 30 * SEC);
    f.run({ type: 'resumeTimer', heatId: 'h1' }, START + 12 * MIN); // Pause 2 min, Summe 4 min
    expect(f.timer().pausedTotalMs).toBe(4 * MIN);
    // 1 min nach Fortsetzen: 8:30 − 1:00 = 7:30
    expect(remainingMs(f.timer(), START + 13 * MIN)).toBe(7 * MIN + 30 * SEC);
    // Ablauf bei START + 12 min + 8:30
    expect(remainingMs(f.timer(), START + 20 * MIN + 30 * SEC)).toBe(0);
    expect(remainingMs(f.timer(), START + 21 * MIN)).toBe(-30 * SEC);
  });

  it('M13 Neustart nach Pausen und Verlängerung: volle Startdauer ab Neustart', () => {
    const f = running();
    f.run({ type: 'pauseTimer', heatId: 'h1' }, START + 3 * MIN);
    f.run({ type: 'extendTimer', heatId: 'h1', byMs: MIN }, START + 4 * MIN);
    f.run({ type: 'restartTimer', heatId: 'h1' }, START + 6 * MIN);
    expect(remainingMs(f.timer(), START + 6 * MIN)).toBe(GROUP_MS);
    expect(remainingMs(f.timer(), START + 7 * MIN)).toBe(GROUP_MS - MIN);
  });

  it('M12 ohne Zeitlimit: Restzeit bleibt null', () => {
    const f = running(null);
    expect(remainingMs(f.timer(), START + 30 * MIN)).toBeNull();
  });
});

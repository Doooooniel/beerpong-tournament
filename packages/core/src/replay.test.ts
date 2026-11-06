// Regeltests aus SPEC M19/M20 und ADR 026 (Wirksamkeit, Protokoll im Zustand, replay ≡ apply).
// Alle Ereignisse werden direkt gebaut und per Schema geprüft; decide wird hier nicht benutzt.
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, DomainEventSchema, apply, initialState, replay } from './index.js';
import type {
  DomainEvent,
  DomainEventType,
  EventOf,
  Heat,
  Match,
  TournamentState,
} from './index.js';

const T0 = 1_767_225_600_000; // feste Zeit, 2026-01-01T00:00:00Z

/** Baut eine Ereignisfolge mit lückenlosem seq und festen Zeiten. */
class EventLog {
  readonly events: DomainEvent[] = [];

  add<T extends Exclude<DomainEventType, 'Undone'>>(
    type: T,
    payload: EventOf<T>['payload'],
    id: string = `e${this.events.length + 1}`,
  ): EventOf<T> {
    return this.push({ id, type, v: 1, payload }) as EventOf<T>;
  }

  undo(
    undoes: string,
    cascade: string[] = [],
    id = `u${this.events.length + 1}`,
  ): EventOf<'Undone'> {
    return this.push({
      id,
      type: 'Undone',
      v: 1,
      undoes,
      payload: { cascade },
    }) as EventOf<'Undone'>;
  }

  private push(partial: Record<string, unknown>): DomainEvent {
    const seq = this.events.length + 1;
    const event = DomainEventSchema.parse({ ...partial, seq, at: T0 + seq * 1_000 });
    this.events.push(event);
    return event;
  }
}

const stepwise = (events: readonly DomainEvent[]): TournamentState =>
  events.reduce((state, event) => apply(state, event), initialState());

/** Fachlicher Zustand ohne version und log. */
const domain = (state: TournamentState): TournamentState => ({ ...state, version: 0, log: [] });

const undoneFlag = (state: TournamentState, id: string): boolean => {
  const entry = state.log.find((e) => e.event.id === id);
  if (!entry) throw new Error(`Protokolleintrag ${id} fehlt`);
  return entry.undone;
};

const created = (log: EventLog) =>
  log.add('TournamentCreated', { name: 'Sommerturnier', settings: DEFAULT_SETTINGS }, 'created');

const groupMatch = (id: string, groupId: string, a: string, b: string): Match => ({
  id,
  phase: 'group',
  round: 1,
  groupId,
  a: { teamId: a },
  b: { teamId: b },
  bye: false,
});

/** 4 Teams, Gruppen A/B je 2 Teams, 1 Tisch → zwei Durchgänge in Runde 1. */
const startedTournament = (log: EventLog) => {
  created(log);
  for (const t of ['t1', 't2', 't3', 't4']) {
    log.add('TeamAdded', { teamId: t, name: `Team ${t}`, players: [`Spieler ${t}`] }, `add-${t}`);
  }
  log.add('TableCountSet', { tableCount: 1 }, 'tables');
  const matches: Match[] = [groupMatch('mA', 'A', 't1', 't2'), groupMatch('mB', 'B', 't3', 't4')];
  const heats: Heat[] = [
    { id: 'h1', phase: 'group', round: 1, index: 1, matchIds: ['mA'] },
    { id: 'h2', phase: 'group', round: 1, index: 2, matchIds: ['mB'] },
  ];
  return log.add(
    'TournamentStarted',
    {
      groups: [
        { id: 'A', teamIds: ['t1', 't2'] },
        { id: 'B', teamIds: ['t3', 't4'] },
      ],
      advancersPerGroup: 1,
      matches,
      heats,
    },
    'started',
  );
};

describe('initialState / replay – Grundlagen (M20, ADR 026)', () => {
  it('ADR026-1: initialState hat version 0, kein Turnier und leeres Protokoll', () => {
    const s = initialState();
    expect(s.version).toBe(0);
    expect(s.created).toBe(false);
    expect(s.log).toEqual([]);
    expect(s.teams).toEqual([]);
  });

  it('ADR026-1: replay([]) ergibt initialState()', () => {
    expect(replay([])).toEqual(initialState());
  });

  it('M20/ADR026-1: log enthält alle Ereignisse inkl. Undone in seq-Reihenfolge', () => {
    const log = new EventLog();
    created(log);
    const added = log.add('TeamAdded', { teamId: 't1', name: 'Becherbande', players: ['Ana'] });
    const u = log.undo(added.id);
    const s = replay(log.events);
    expect(s.log.map((e) => e.event)).toEqual(log.events);
    expect(s.log.map((e) => e.event.seq)).toEqual([1, 2, 3]);
    expect(s.log.map((e) => e.undone)).toEqual([false, true, false]);
    expect(undoneFlag(s, u.id)).toBe(false);
  });

  it('ADR020/ADR026-1: version = seq des letzten Ereignisses, auch wenn es ein Undone ist', () => {
    const log = new EventLog();
    created(log);
    const added = log.add('TeamAdded', { teamId: 't1', name: 'Becherbande', players: ['Ana'] });
    expect(replay(log.events).version).toBe(2);
    log.undo(added.id);
    expect(replay(log.events).version).toBe(3);
    expect(stepwise(log.events).version).toBe(3);
  });
});

describe('Wirksamkeit von Undone (M19, ADR 026)', () => {
  it('M19: aufgehobenes TeamAdded wirkt nicht, bleibt aber mit undone: true im log', () => {
    const log = new EventLog();
    created(log);
    const a = log.add('TeamAdded', { teamId: 't1', name: 'Becherbande', players: ['Ana'] });
    log.add('TeamAdded', { teamId: 't2', name: 'Pongistas', players: ['Ben'] });
    log.undo(a.id);
    const s = replay(log.events);
    expect(s.teams.map((t) => t.id)).toEqual(['t2']);
    expect(undoneFlag(s, a.id)).toBe(true);
  });

  it('M19: Aufheben eines mittleren Ereignisses lässt spätere Ereignisse wirksam', () => {
    const log = new EventLog();
    created(log);
    const sound = log.add('SettingsUpdated', { settings: { soundEnabled: false } });
    log.add('SettingsUpdated', { settings: { rotationIntervalMs: 20_000 } });
    log.undo(sound.id);
    const s = replay(log.events);
    expect(s.settings.soundEnabled).toBe(DEFAULT_SETTINGS.soundEnabled);
    expect(s.settings.rotationIntervalMs).toBe(20_000);
  });

  it('M19: aufgehobenes TeamRenamed stellt den alten Namen wieder her', () => {
    const log = new EventLog();
    created(log);
    log.add('TeamAdded', { teamId: 't1', name: 'Alt', players: ['Ana'] });
    const r = log.add('TeamRenamed', { teamId: 't1', name: 'Neu' });
    log.undo(r.id);
    expect(replay(log.events).teams).toEqual([{ id: 't1', name: 'Alt', players: ['Ana'] }]);
  });

  it('ADR026-2: Undone hebt Ziel und cascade gemeinsam auf', () => {
    const log = new EventLog();
    created(log);
    const a = log.add('TeamAdded', { teamId: 't1', name: 'Alt', players: ['Ana'] });
    const r = log.add('TeamRenamed', { teamId: 't1', name: 'Neu' });
    const p = log.add('PlayersSet', { teamId: 't1', players: ['Ana', 'Cem'] });
    log.undo(a.id, [r.id, p.id]);
    const s = replay(log.events);
    expect(s.teams).toEqual([]);
    expect([a.id, r.id, p.id].map((id) => undoneFlag(s, id))).toEqual([true, true, true]);
  });

  it('ADR026-3: Undone auf ein Undone stellt Ziel und Kaskade wieder her (Redo)', () => {
    const log = new EventLog();
    created(log);
    const a = log.add('TeamAdded', { teamId: 't1', name: 'Alt', players: ['Ana'] });
    const r = log.add('TeamRenamed', { teamId: 't1', name: 'Neu' });
    const u1 = log.undo(a.id, [r.id]);
    const u2 = log.undo(u1.id);
    const s = replay(log.events);
    expect(s.teams).toEqual([{ id: 't1', name: 'Neu', players: ['Ana'] }]);
    expect(undoneFlag(s, a.id)).toBe(false);
    expect(undoneFlag(s, r.id)).toBe(false);
    expect(undoneFlag(s, u1.id)).toBe(true);
    expect(undoneFlag(s, u2.id)).toBe(false);
  });

  it('ADR026-3: Undo des Undo des Undo hebt wieder auf; ein weiteres stellt wieder her', () => {
    const log = new EventLog();
    created(log);
    const a = log.add('TeamAdded', { teamId: 't1', name: 'Alt', players: ['Ana'] });
    const r = log.add('TeamRenamed', { teamId: 't1', name: 'Neu' });
    const u1 = log.undo(a.id, [r.id]);
    const u2 = log.undo(u1.id);
    const u3 = log.undo(u2.id);
    let s = replay(log.events);
    expect(s.teams).toEqual([]);
    expect([a.id, r.id, u1.id, u2.id, u3.id].map((id) => undoneFlag(s, id))).toEqual([
      true,
      true,
      false,
      true,
      false,
    ]);
    log.undo(u3.id);
    s = replay(log.events);
    expect(s.teams).toEqual([{ id: 't1', name: 'Neu', players: ['Ana'] }]);
    expect(undoneFlag(s, u2.id)).toBe(false);
  });

  it('S06/ADR026-1: aufgehobenes BeamerViewSet setzt die Ansicht zurück', () => {
    const log = new EventLog();
    created(log);
    const before = replay(log.events).beamer;
    const v = log.add('BeamerViewSet', { view: 'podium' });
    log.add('BeamerModeSet', { mode: 'fixed' });
    log.undo(v.id);
    const s = replay(log.events);
    expect(s.beamer).toEqual({ mode: 'fixed', view: before.view });
  });
});

describe('Aufgehobene Ereignisse wirken nicht: Zustand ≡ Zustand ohne sie (ADR 026-1)', () => {
  type Scenario = [name: string, build: (log: EventLog) => string[]];
  // build liefert alle IDs, die danach als aufgehoben gelten (auch aufgehobene Undone).
  const scenarios: Scenario[] = [
    [
      'TeamRemoved aufgehoben → Team wieder an alter Position',
      (log) => {
        created(log);
        log.add('TeamAdded', { teamId: 't1', name: 'Eins', players: ['A'] });
        log.add('TeamAdded', { teamId: 't2', name: 'Zwei', players: ['B'] });
        log.add('TeamAdded', { teamId: 't3', name: 'Drei', players: ['C'] });
        const rm = log.add('TeamRemoved', { teamId: 't2' });
        log.undo(rm.id);
        return [rm.id];
      },
    ],
    [
      'TableCountSet aufgehoben → vorherige Tischanzahl',
      (log) => {
        created(log);
        log.add('TableCountSet', { tableCount: 4 });
        const t = log.add('TableCountSet', { tableCount: 6 });
        log.undo(t.id);
        return [t.id];
      },
    ],
    [
      'TeamAssignedToGroup und GroupsAssigned aufgehoben',
      (log) => {
        created(log);
        log.add('TeamAdded', { teamId: 't1', name: 'Eins', players: ['A'] });
        log.add('TeamAdded', { teamId: 't2', name: 'Zwei', players: ['B'] });
        log.add('TeamAssignedToGroup', { teamId: 't1', groupId: 'A' });
        const g = log.add('GroupsAssigned', { assignment: { t1: 'B', t2: 'A' } });
        const one = log.add('TeamAssignedToGroup', { teamId: 't2', groupId: 'B' });
        log.undo(g.id, [one.id]);
        return [g.id, one.id];
      },
    ],
    [
      'TournamentStarted mit Kaskade aufgehoben → wieder Setup',
      (log) => {
        const started = startedTournament(log);
        const hs = log.add('HeatStarted', { heatId: 'h1', durationMs: 900_000, startedAt: T0 });
        const rr = log.add('ResultRecorded', { matchId: 'mA', outcome: 'win', winnerTeamId: 't1' });
        log.undo(started.id, [hs.id, rr.id]);
        return [started.id, hs.id, rr.id];
      },
    ],
    [
      'TimerPaused aufgehoben → Timer läuft weiter',
      (log) => {
        startedTournament(log);
        log.add('HeatStarted', { heatId: 'h1', durationMs: 900_000, startedAt: T0 });
        const p = log.add('TimerPaused', { heatId: 'h1', pausedAt: T0 + 60_000 });
        log.undo(p.id);
        return [p.id];
      },
    ],
    [
      'ResultRecorded aufgehoben → Partie ohne Ergebnis',
      (log) => {
        startedTournament(log);
        log.add('HeatStarted', { heatId: 'h1', durationMs: null, startedAt: T0 });
        const rr = log.add('ResultRecorded', { matchId: 'mA', outcome: 'draw' });
        log.undo(rr.id);
        return [rr.id];
      },
    ],
    [
      'Redo: aufgehobenes Undone → Ereignis wirkt wieder',
      (log) => {
        created(log);
        const a = log.add('TeamAdded', { teamId: 't1', name: 'Eins', players: ['A'] });
        const u1 = log.undo(a.id);
        log.undo(u1.id);
        return [u1.id];
      },
    ],
  ];

  it.each(scenarios)('ADR026-1: %s', (_name, build) => {
    const log = new EventLog();
    const undoneIds = new Set(build(log));
    const full = replay(log.events);
    const effective = log.events.filter((e) => e.type !== 'Undone' && !undoneIds.has(e.id));
    expect(domain(full)).toEqual(domain(replay(effective)));
    for (const entry of full.log) {
      expect(entry.undone).toBe(undoneIds.has(entry.event.id));
    }
  });

  it('ADR026-1: aufgehobenes TournamentStarted → Phase wieder setup, keine Partien', () => {
    const log = new EventLog();
    const started = startedTournament(log);
    log.undo(started.id);
    const s = replay(log.events);
    expect(s.phase).toBe('setup');
    expect(s.matches).toEqual([]);
    expect(s.heats).toEqual([]);
    expect(s.teams).toHaveLength(4);
  });

  it('ADR026-1: aufgehobenes ResultRecorded entfernt das Ergebnis', () => {
    const log = new EventLog();
    startedTournament(log);
    log.add('HeatStarted', { heatId: 'h1', durationMs: 900_000, startedAt: T0 });
    const rr = log.add('ResultRecorded', { matchId: 'mA', outcome: 'win', winnerTeamId: 't2' });
    expect(replay(log.events).results['mA']).toBeDefined();
    log.undo(rr.id);
    expect(replay(log.events).results['mA']).toBeUndefined();
  });
});

describe('replay(events) ≡ schrittweises apply (ADR 026-1, N03)', () => {
  const sequences: [string, (log: EventLog) => void][] = [
    [
      'Setup mit Undo und Redo',
      (log) => {
        created(log);
        const a = log.add('TeamAdded', { teamId: 't1', name: 'Eins', players: ['A'] });
        const r = log.add('TeamRenamed', { teamId: 't1', name: 'Eins neu' });
        log.add('BeamerModeSet', { mode: 'fixed' });
        const u1 = log.undo(a.id, [r.id]);
        const u2 = log.undo(u1.id);
        log.undo(u2.id);
      },
    ],
    [
      'Gestartetes Turnier mit Timer und Ergebnis',
      (log) => {
        startedTournament(log);
        log.add('HeatStarted', { heatId: 'h1', durationMs: 900_000, startedAt: T0 });
        const p = log.add('TimerPaused', { heatId: 'h1', pausedAt: T0 + 10_000 });
        log.add('TimerResumed', { heatId: 'h1', resumedAt: T0 + 20_000 });
        log.add('TimerExtended', { heatId: 'h1', byMs: 60_000 });
        log.undo(p.id);
        log.add('ResultRecorded', { matchId: 'mA', outcome: 'winByTime', winnerTeamId: 't1' });
        log.add('BeamerViewSet', { view: 'standings' });
      },
    ],
  ];

  it.each(sequences)('ADR026-1: %s', (_name, build) => {
    const log = new EventLog();
    build(log);
    const viaReplay = replay(log.events);
    expect(stepwise(log.events)).toEqual(viaReplay);
    expect(viaReplay.version).toBe(log.events.length);
    expect(viaReplay.log).toHaveLength(log.events.length);
  });

  it('ADR026-1: apply nach jedem Schritt ≡ replay des Präfixes', () => {
    const log = new EventLog();
    created(log);
    const a = log.add('TeamAdded', { teamId: 't1', name: 'Eins', players: ['A'] });
    const u1 = log.undo(a.id);
    log.undo(u1.id);
    let state = initialState();
    log.events.forEach((event, i) => {
      state = apply(state, event);
      expect(state).toEqual(replay(log.events.slice(0, i + 1)));
    });
  });
});

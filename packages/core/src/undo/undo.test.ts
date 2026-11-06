// Regeltests aus SPEC M19 und ADR 026: undo, undoEvent, Redo, Bestätigung bei Abhängigen.
// Setup-Befehle laufen über decide; alles Nichtdeterministische kommt aus einem festen ctx.
import { describe, expect, it } from 'vitest';
import { DomainEventSchema, apply, decide, initialState } from '../index.js';
import type {
  Command,
  DecideContext,
  DomainError,
  DomainErrorCode,
  DomainEvent,
  DomainEventType,
  EventOf,
  NewEvent,
  Result,
  TournamentState,
} from '../index.js';

const T0 = 1_767_225_600_000; // feste Zeit, 2026-01-01T00:00:00Z

type NewUndone = Extract<NewEvent, { type: 'Undone' }>;

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

  decide(command: Command, ctx: DecideContext = this.ctx()): Result<NewEvent[], DomainError> {
    return decide(this.state, command, ctx);
  }

  run(command: Command): DomainEvent[] {
    const r = this.decide(command);
    if (!r.ok) throw new Error(`${command.type}: ${r.error.code} – ${r.error.message}`);
    return r.value.map((e) => this.append(e));
  }

  one<T extends DomainEventType>(command: Command, type: T): EventOf<T> {
    const events = this.run(command);
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe(type);
    return events[0] as EventOf<T>;
  }

  append(e: NewEvent): DomainEvent {
    const event = DomainEventSchema.parse({ ...e, seq: this.events.length + 1 });
    this.events.push(event);
    this.state = apply(this.state, event);
    return event;
  }

  create(): EventOf<'TournamentCreated'> {
    return this.one({ type: 'createTournament', name: 'Sommerturnier' }, 'TournamentCreated');
  }

  addTeam(name: string, players: string[] = [`${name} Spieler`]): EventOf<'TeamAdded'> {
    return this.one({ type: 'addTeam', name, players }, 'TeamAdded');
  }

  undo(confirm?: boolean): Result<NewEvent[], DomainError> {
    return this.decide(confirm === undefined ? { type: 'undo' } : { type: 'undo', confirm });
  }

  undoEvent(eventId: string, confirm?: boolean): Result<NewEvent[], DomainError> {
    return this.decide(
      confirm === undefined
        ? { type: 'undoEvent', eventId }
        : { type: 'undoEvent', eventId, confirm },
    );
  }

  /** Übernimmt ein erfolgreiches Undo-Ergebnis (genau ein Undone) in die Sitzung. */
  commit(r: Result<NewEvent[], DomainError>): EventOf<'Undone'> {
    const undone = expectSingleUndone(r);
    return this.append(undone) as EventOf<'Undone'>;
  }

  isUndone(id: string): boolean {
    const entry = this.state.log.find((e) => e.event.id === id);
    if (!entry) throw new Error(`Protokolleintrag ${id} fehlt`);
    return entry.undone;
  }

  teamNames(): string[] {
    return this.state.teams.map((t) => t.name);
  }
}

function expectSingleUndone(r: Result<NewEvent[], DomainError>): NewUndone {
  if (!r.ok) throw new Error(`erwartet ok, erhalten ${r.error.code}: ${r.error.message}`);
  expect(r.value).toHaveLength(1);
  const [e] = r.value;
  if (!e || e.type !== 'Undone') throw new Error(`erwartet Undone, erhalten ${e?.type}`);
  return e;
}

function expectError(r: Result<NewEvent[], DomainError>, code: DomainErrorCode): DomainError {
  if (r.ok) throw new Error(`erwartet Fehler ${code}, erhalten ${r.value.length} Ereignis(se)`);
  expect(r.error.code).toBe(code);
  return r.error;
}

/** Fachlicher Zustand ohne version und log. */
const domain = (state: TournamentState): TournamentState => ({ ...state, version: 0, log: [] });

describe('undo – letzte Aktion (M19, ADR 026-4)', () => {
  it('M19: undo erzeugt genau ein Undone auf die letzte Aktion; id/at aus ctx', () => {
    const s = new Session();
    s.create();
    const added = s.addTeam('Becherbande');
    const ctx: DecideContext = { now: T0 + 99_000, random: () => 0.5, newId: () => 'undo-1' };
    const undone = expectSingleUndone(s.decide({ type: 'undo' }, ctx));
    expect(undone).toEqual({
      id: 'undo-1',
      type: 'Undone',
      v: 1,
      at: T0 + 99_000,
      undoes: added.id,
      payload: { cascade: [] },
    });
  });

  it('M19: nach undo ist das Team weg und im Protokoll als aufgehoben markiert', () => {
    const s = new Session();
    s.create();
    const added = s.addTeam('Becherbande');
    const u = s.commit(s.undo());
    expect(s.state.teams).toEqual([]);
    expect(s.isUndone(added.id)).toBe(true);
    expect(s.isUndone(u.id)).toBe(false);
    expect(s.state.version).toBe(u.seq);
  });

  it('ADR026-4: wiederholtes undo geht weiter zurück bis NOTHING_TO_UNDO', () => {
    const s = new Session();
    s.create();
    const x = s.addTeam('X');
    const y = s.addTeam('Y');
    const rename = s.one(
      { type: 'renameTeam', teamId: x.payload.teamId, name: 'X2' },
      'TeamRenamed',
    );

    expect(s.commit(s.undo()).undoes).toBe(rename.id);
    expect(s.teamNames()).toEqual(['X', 'Y']);
    expect(s.commit(s.undo()).undoes).toBe(y.id);
    expect(s.teamNames()).toEqual(['X']);
    expect(s.commit(s.undo()).undoes).toBe(x.id);
    expect(s.teamNames()).toEqual([]);
    expectError(s.undo(), 'NOTHING_TO_UNDO');
  });

  it('ADR026-4: undo überspringt BeamerModeSet und BeamerViewSet', () => {
    const s = new Session();
    s.create();
    const x = s.addTeam('X');
    s.one({ type: 'setBeamerMode', mode: 'fixed' }, 'BeamerModeSet');
    s.one({ type: 'setBeamerView', view: 'standings' }, 'BeamerViewSet');
    expect(s.commit(s.undo()).undoes).toBe(x.id);
    expect(s.state.beamer).toEqual({ mode: 'fixed', view: 'standings' });
  });

  it('ADR026-4: undo zielt nie auf ein Undone (kein Redo per undo)', () => {
    const s = new Session();
    s.create();
    const x = s.addTeam('X');
    s.addTeam('Y');
    s.commit(s.undo());
    expect(s.commit(s.undo()).undoes).toBe(x.id);
  });

  it('ADR026-4: undo nach Redo hebt das wiederhergestellte Ereignis direkt auf', () => {
    const s = new Session();
    s.create();
    const x = s.addTeam('X');
    const u1 = s.commit(s.undo());
    s.commit(s.undoEvent(u1.id));
    expect(s.teamNames()).toEqual(['X']);
    expect(s.commit(s.undo()).undoes).toBe(x.id);
    expect(s.teamNames()).toEqual([]);
  });

  it('ADR026-4: undo überspringt per Kaskade aufgehobene Ereignisse', () => {
    const s = new Session();
    s.create();
    const x = s.addTeam('X');
    s.one({ type: 'renameTeam', teamId: x.payload.teamId, name: 'X2' }, 'TeamRenamed');
    s.commit(s.undoEvent(x.id, true));
    expectError(s.undo(), 'NOTHING_TO_UNDO');
  });

  it('ADR026-4: nur TournamentCreated vorhanden → NOTHING_TO_UNDO', () => {
    const s = new Session();
    s.create();
    expectError(s.undo(), 'NOTHING_TO_UNDO');
  });

  it('ADR026-4: nur TournamentCreated und Beamer-Ereignisse → NOTHING_TO_UNDO', () => {
    const s = new Session();
    s.create();
    s.one({ type: 'setBeamerMode', mode: 'fixed' }, 'BeamerModeSet');
    s.one({ type: 'setBeamerView', view: 'bracket' }, 'BeamerViewSet');
    expectError(s.undo(), 'NOTHING_TO_UNDO');
  });

  it('ADR026-4: undo ohne Turnier → TOURNAMENT_NOT_CREATED', () => {
    const s = new Session();
    expectError(s.undo(), 'TOURNAMENT_NOT_CREATED');
  });

  it('ADR026-4: undo mit confirm: true verhält sich wie ohne (letzte Aktion hat keine Abhängigen)', () => {
    const s = new Session();
    s.create();
    const x = s.addTeam('X');
    const u = expectSingleUndone(s.undo(true));
    expect(u.undoes).toBe(x.id);
    expect(u.payload.cascade).toEqual([]);
  });

  type Step = [name: string, act: (s: Session, teamId: string) => void];
  const steps: Step[] = [
    ['updateSettings', (s) => s.run({ type: 'updateSettings', settings: { soundEnabled: false } })],
    ['setTableCount', (s) => s.run({ type: 'setTableCount', tableCount: 6 })],
    ['renameTeam', (s, t) => s.run({ type: 'renameTeam', teamId: t, name: 'Neuer Name' })],
    ['setPlayers', (s, t) => s.run({ type: 'setPlayers', teamId: t, players: ['Ana', 'Ben'] })],
    ['removeTeam', (s, t) => s.run({ type: 'removeTeam', teamId: t })],
    ['addTeam', (s) => s.run({ type: 'addTeam', name: 'Dazu', players: ['Zoe'] })],
    ['setBeamerView (gezielt)', (s) => s.run({ type: 'setBeamerView', view: 'podium' })],
  ];

  it.each(steps)(
    'M19: Aufheben von %s stellt den fachlichen Zustand davor wieder her',
    (_n, act) => {
      const s = new Session();
      s.create();
      s.run({ type: 'setTableCount', tableCount: 4 });
      const a = s.addTeam('Becherbande');
      s.addTeam('Pongistas');
      const before = domain(s.state);
      act(s, a.payload.teamId);
      const last = s.events.at(-1);
      if (!last) throw new Error('kein Ereignis');
      s.commit(s.undoEvent(last.id));
      expect(domain(s.state)).toEqual(before);
    },
  );
});

describe('undoEvent – gezielt aus dem Protokoll (M19, ADR 026-4)', () => {
  it('M19: unbekannte Ereignis-ID → EVENT_NOT_FOUND', () => {
    const s = new Session();
    s.create();
    s.addTeam('X');
    expectError(s.undoEvent('gibt-es-nicht'), 'EVENT_NOT_FOUND');
  });

  it.each([undefined, true])(
    'M19: TournamentCreated → CANNOT_UNDO_CREATION (confirm=%s)',
    (confirm) => {
      const s = new Session();
      const c = s.create();
      s.addTeam('X');
      expectError(s.undoEvent(c.id, confirm), 'CANNOT_UNDO_CREATION');
    },
  );

  it('M19: bereits aufgehobenes Ereignis → NOTHING_TO_UNDO', () => {
    const s = new Session();
    s.create();
    const x = s.addTeam('X');
    s.commit(s.undo());
    expectError(s.undoEvent(x.id), 'NOTHING_TO_UNDO');
  });

  it('ADR026-2: per Kaskade aufgehobenes Ereignis → NOTHING_TO_UNDO', () => {
    const s = new Session();
    s.create();
    const x = s.addTeam('X');
    const r = s.one({ type: 'renameTeam', teamId: x.payload.teamId, name: 'X2' }, 'TeamRenamed');
    s.commit(s.undoEvent(x.id, true));
    expectError(s.undoEvent(r.id), 'NOTHING_TO_UNDO');
  });

  it('M19: mittleres Ereignis ohne Abhängige gezielt aufheben, spätere bleiben wirksam', () => {
    const s = new Session();
    s.create();
    const x = s.addTeam('X');
    const y = s.addTeam('Y');
    const rx = s.one({ type: 'renameTeam', teamId: x.payload.teamId, name: 'X2' }, 'TeamRenamed');
    s.one({ type: 'renameTeam', teamId: y.payload.teamId, name: 'Y2' }, 'TeamRenamed');
    const u = s.commit(s.undoEvent(rx.id));
    expect(u.undoes).toBe(rx.id);
    expect(u.payload.cascade).toEqual([]);
    expect(s.teamNames()).toEqual(['X', 'Y2']);
  });

  it('ADR026-4: Beamer-Ereignisse dürfen gezielt aufgehoben werden', () => {
    const s = new Session();
    s.create();
    const initialBeamer = s.state.beamer;
    const mode = s.one({ type: 'setBeamerMode', mode: 'fixed' }, 'BeamerModeSet');
    s.addTeam('X');
    const u = s.commit(s.undoEvent(mode.id));
    expect(u.undoes).toBe(mode.id);
    expect(s.state.beamer.mode).toBe(initialBeamer.mode);
    expect(s.teamNames()).toEqual(['X']);
  });

  it('ADR026-2: confirm: true ohne Abhängige → cascade []', () => {
    const s = new Session();
    s.create();
    const x = s.addTeam('X');
    s.addTeam('Y');
    const u = expectSingleUndone(s.undoEvent(x.id, true));
    expect(u.undoes).toBe(x.id);
    expect(u.payload.cascade).toEqual([]);
  });
});

describe('Abhängige spätere Ereignisse: Warnung und Bestätigung (M19, ADR 026-2)', () => {
  const setup = () => {
    const s = new Session();
    s.create();
    const x = s.addTeam('X');
    const y = s.addTeam('Y');
    const t = x.payload.teamId;
    const rx = s.one({ type: 'renameTeam', teamId: t, name: 'X2' }, 'TeamRenamed');
    s.one({ type: 'setBeamerView', view: 'standings' }, 'BeamerViewSet');
    const ry = s.one({ type: 'renameTeam', teamId: y.payload.teamId, name: 'Y2' }, 'TeamRenamed');
    const px = s.one({ type: 'setPlayers', teamId: t, players: ['Ana', 'Cem'] }, 'PlayersSet');
    return { s, x, y, rx, ry, px };
  };

  it.each([undefined, false])(
    'M19: ohne Bestätigung (confirm=%s) → UNDO_HAS_DEPENDENTS mit IDs in seq-Reihenfolge',
    (confirm) => {
      const { s, x, rx, px } = setup();
      const error = expectError(s.undoEvent(x.id, confirm), 'UNDO_HAS_DEPENDENTS');
      expect(error.dependents).toEqual([rx.id, px.id]);
    },
  );

  it('M19: decide mit UNDO_HAS_DEPENDENTS verändert den Zustand nicht (rein)', () => {
    const { s, x } = setup();
    const before = JSON.stringify(s.state);
    expectError(s.undoEvent(x.id), 'UNDO_HAS_DEPENDENTS');
    expect(JSON.stringify(s.state)).toBe(before);
  });

  it('ADR026-2: mit confirm: true genau EIN Undone mit cascade = Abhängige', () => {
    const { s, x, rx, px } = setup();
    const u = expectSingleUndone(s.undoEvent(x.id, true));
    expect(u.undoes).toBe(x.id);
    expect(u.payload.cascade).toEqual([rx.id, px.id]);
  });

  it('ADR026-2: Ziel und Kaskade werden gemeinsam aufgehoben, Unabhängige bleiben', () => {
    const { s, x, ry, rx, px } = setup();
    s.commit(s.undoEvent(x.id, true));
    expect(s.teamNames()).toEqual(['Y2']);
    expect([x.id, rx.id, px.id].map((id) => s.isUndone(id))).toEqual([true, true, true]);
    expect(s.isUndone(ry.id)).toBe(false);
    expect(s.state.beamer.view).toBe('standings');
  });

  it('ADR026-2: Kaskade wird per Redo gemeinsam wiederhergestellt', () => {
    const { s, x, rx, px } = setup();
    const u1 = s.commit(s.undoEvent(x.id, true));
    const u2 = s.commit(s.undoEvent(u1.id));
    expect(u2.undoes).toBe(u1.id);
    expect(u2.payload.cascade).toEqual([]);
    expect([x.id, rx.id, px.id].map((id) => s.isUndone(id))).toEqual([false, false, false]);
    const team = s.state.teams.find((t) => t.id === x.payload.teamId);
    expect(team).toEqual({ id: x.payload.teamId, name: 'X2', players: ['Ana', 'Cem'] });
  });

  it('ADR026-6: aufgehobene spätere Ereignisse zählen nicht als Abhängige', () => {
    const { s, x, rx, px } = setup();
    expect(s.commit(s.undo()).undoes).toBe(px.id);
    const error = expectError(s.undoEvent(x.id), 'UNDO_HAS_DEPENDENTS');
    expect(error.dependents).toEqual([rx.id]);
    expect(error.dependents).not.toContain(px.id);
  });
});

describe('Redo – Undone aufheben (M19, ADR 026-3/5)', () => {
  it('ADR026-3: undoEvent auf ein wirksames Undone stellt wieder her, cascade []', () => {
    const s = new Session();
    s.create();
    const x = s.addTeam('X');
    const u1 = s.commit(s.undo());
    const u2 = s.commit(s.undoEvent(u1.id));
    expect(u2.undoes).toBe(u1.id);
    expect(u2.payload.cascade).toEqual([]);
    expect(s.teamNames()).toEqual(['X']);
    expect(s.isUndone(x.id)).toBe(false);
    expect(s.isUndone(u1.id)).toBe(true);
  });

  it('ADR026-3: Undo des Undo des Undo hebt erneut auf, dann wieder her', () => {
    const s = new Session();
    s.create();
    const x = s.addTeam('X');
    const u1 = s.commit(s.undo());
    const u2 = s.commit(s.undoEvent(u1.id));
    const u3 = s.commit(s.undoEvent(u2.id));
    expect(u3.undoes).toBe(u2.id);
    expect(s.teamNames()).toEqual([]);
    expect([x.id, u1.id, u2.id, u3.id].map((id) => s.isUndone(id))).toEqual([
      true,
      false,
      true,
      false,
    ]);
    s.commit(s.undoEvent(u3.id));
    expect(s.teamNames()).toEqual(['X']);
  });

  it('ADR026-5: Redo nach neuer Aktion → REDO_NOT_POSSIBLE', () => {
    const s = new Session();
    s.create();
    s.addTeam('X');
    const u1 = s.commit(s.undo());
    s.addTeam('Y');
    expectError(s.undoEvent(u1.id), 'REDO_NOT_POSSIBLE');
    expectError(s.undoEvent(u1.id, true), 'REDO_NOT_POSSIBLE');
  });

  it('ADR026-5: Redo nach neuer Einstellung → REDO_NOT_POSSIBLE', () => {
    const s = new Session();
    s.create();
    s.run({ type: 'setTableCount', tableCount: 3 });
    const u1 = s.commit(s.undo());
    s.run({ type: 'updateSettings', settings: { trackCups: true } });
    expectError(s.undoEvent(u1.id), 'REDO_NOT_POSSIBLE');
  });

  it('ADR026-5: Redo erlaubt, wenn danach nur Beamer-Ereignisse liegen', () => {
    const s = new Session();
    s.create();
    s.addTeam('X');
    const u1 = s.commit(s.undo());
    s.run({ type: 'setBeamerMode', mode: 'fixed' });
    s.run({ type: 'setBeamerView', view: 'timer' });
    s.commit(s.undoEvent(u1.id));
    expect(s.teamNames()).toEqual(['X']);
  });

  it('ADR026-5: Redo erlaubt, wenn die neue Aktion selbst wieder aufgehoben ist', () => {
    const s = new Session();
    s.create();
    s.addTeam('X');
    const u1 = s.commit(s.undo());
    s.addTeam('Y');
    s.commit(s.undo());
    s.commit(s.undoEvent(u1.id));
    expect(s.teamNames()).toEqual(['X']);
  });

  it('ADR026-5: Redo eines älteren Undone erlaubt, wenn danach nur Undone liegen', () => {
    const s = new Session();
    s.create();
    s.addTeam('X');
    s.addTeam('Y');
    const uy = s.commit(s.undo());
    s.commit(s.undo()); // hebt X auf
    s.commit(s.undoEvent(uy.id));
    expect(s.teamNames()).toEqual(['Y']);
  });

  it('ADR026-5 (erweitert): Redo, dessen Ereignis von einem weiterhin aufgehobenen abhängt → REDO_NOT_POSSIBLE', () => {
    const s = new Session();
    s.create();
    const x = s.addTeam('X');
    const rx = s.one({ type: 'renameTeam', teamId: x.payload.teamId, name: 'X2' }, 'TeamRenamed');
    const u1 = s.commit(s.undo()); // hebt TeamRenamed auf
    expect(u1.undoes).toBe(rx.id);
    const u2 = s.commit(s.undoEvent(x.id)); // keine Abhängigen mehr, da TeamRenamed aufgehoben
    expect(u2.payload.cascade).toEqual([]);
    expectError(s.undoEvent(u1.id), 'REDO_NOT_POSSIBLE');
    s.commit(s.undoEvent(u2.id));
    s.commit(s.undoEvent(u1.id));
    expect(s.teamNames()).toEqual(['X2']);
  });

  it('ADR026-3: bereits aufgehobenes Undone erneut aufheben → NOTHING_TO_UNDO', () => {
    const s = new Session();
    s.create();
    s.addTeam('X');
    const u1 = s.commit(s.undo());
    s.commit(s.undoEvent(u1.id));
    expectError(s.undoEvent(u1.id), 'NOTHING_TO_UNDO');
  });

  it('ADR026-2: Redo braucht keine Bestätigung, auch wenn das Undone eine Kaskade hatte', () => {
    const s = new Session();
    s.create();
    const x = s.addTeam('X');
    s.one({ type: 'renameTeam', teamId: x.payload.teamId, name: 'X2' }, 'TeamRenamed');
    const u1 = s.commit(s.undoEvent(x.id, true));
    const redo = expectSingleUndone(s.undoEvent(u1.id));
    expect(redo.payload.cascade).toEqual([]);
  });
});

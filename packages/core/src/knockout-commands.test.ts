// Regeltests KO-Phase über decide/apply: advancePhase (M11, M10, M09, S04), Nur-KO-Start (M04),
// KO-Ergebnisse (M14), Zeitlimit je Stufe (M12), Durchgänge (M15) und komplette Durchläufe.
// Geschrieben nur aus SPEC und den Festlegungen des Nutzers, ohne Kenntnis der Implementierung.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_SETTINGS,
  DomainEventSchema,
  buildBracket,
  computeStandings,
  crossSeeding,
  decide,
  drawKnockout,
  heatStatus,
  initialState,
  apply,
  replay,
  resolveSlot,
  teamsOf,
  winnerOf,
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
  RecordResult,
  Result,
  Settings,
  SettingsPatch,
  Slot,
  TournamentState,
} from './index.js';

// ---------------------------------------------------------------------------
// Testhilfen (lokal)
// ---------------------------------------------------------------------------

const T0 = 1_767_225_600_000; // 2026-01-01T00:00:00Z

/** Kleiner LCG mit festem Seed, Werte in [0, 1). Kein Math.random. */
const lcg = (seed: number): (() => number) => {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
};

const at = <T>(xs: readonly T[], i: number): T => {
  const x = xs[i];
  if (x === undefined) throw new Error(`Index ${i} fehlt`);
  return x;
};

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

type ResultInput = Omit<RecordResult, 'type' | 'matchId'>;
/** Ergebnis einer Partie aus den beiden feststehenden Teams. */
type Pick = (a: string, b: string) => ResultInput;

/** Testsitzung: decide → seq vergeben → Schema prüfen → apply (wie der Server, ohne I/O). */
class Session {
  state: TournamentState = initialState();
  readonly events: DomainEvent[] = [];
  private nextId = 0;
  clock = T0;

  ctx(random: () => number = lcg(1)): DecideContext {
    this.clock += 1_000;
    return { now: this.clock, random, newId: () => `id-${++this.nextId}` };
  }

  decide(command: Command, random?: () => number): Result<NewEvent[], DomainError> {
    return decide(this.state, command, this.ctx(random));
  }

  run(command: Command, random?: () => number): DomainEvent[] {
    const r = this.decide(command, random);
    if (!r.ok) throw new Error(`${command.type}: ${r.error.code} – ${r.error.message}`);
    return r.value.map((e) => this.append(e));
  }

  one<T extends DomainEventType>(command: Command, type: T, random?: () => number): EventOf<T> {
    const events = this.run(command, random);
    expect(events).toHaveLength(1);
    const [e] = events;
    if (!e || e.type !== type) throw new Error(`erwartet ${type}, erhalten ${e?.type}`);
    return e as EventOf<T>;
  }

  append(e: NewEvent): DomainEvent {
    const event = DomainEventSchema.parse({ ...e, seq: this.events.length + 1 });
    this.events.push(event);
    this.state = apply(this.state, event);
    return event;
  }

  /** Undone direkt einspielen (ohne decide), z. B. für ein bewusst unvollständiges Protokoll. */
  pushUndone(undoes: string, cascade: string[] = []): DomainEvent {
    const ctx = this.ctx();
    return this.append({
      id: ctx.newId(),
      type: 'Undone',
      v: 1,
      at: ctx.now,
      undoes,
      payload: { cascade },
    } as unknown as NewEvent);
  }

  expectError(command: Command, code: DomainErrorCode): DomainError {
    const r = this.decide(command);
    if (r.ok) throw new Error(`erwartet ${code}, erhalten ${JSON.stringify(r.value)}`);
    expect(r.error.code).toBe(code);
    expect(r.error.message.length).toBeGreaterThan(0);
    return r.error;
  }

  match(id: string): Match {
    const m = this.state.matches.find((x) => x.id === id);
    if (!m) throw new Error(`Partie ${id} fehlt`);
    return m;
  }

  heat(id: string): Heat {
    const h = this.state.heats.find((x) => x.id === id);
    if (!h) throw new Error(`Durchgang ${id} fehlt`);
    return h;
  }

  /** Startet den Durchgang und erfasst Ergebnisse (außer `skip`). Liefert das HeatStarted. */
  playHeat(heatId: string, pick: Pick, skip: readonly string[] = []): EventOf<'HeatStarted'> {
    const hs = this.one({ type: 'startHeat', heatId }, 'HeatStarted');
    for (const matchId of this.heat(heatId).matchIds) {
      if (skip.includes(matchId)) continue;
      this.recordFor(matchId, pick);
    }
    return hs;
  }

  recordFor(matchId: string, pick: Pick): EventOf<'ResultRecorded'> {
    const [a, b] = teamsOf(this.state, this.match(matchId));
    if (a === null || b === null) throw new Error(`Partie ${matchId} hat noch keine zwei Teams`);
    return this.one({ type: 'recordResult', matchId, ...pick(a, b) }, 'ResultRecorded');
  }

  /** Alle Durchgänge der Phase(n) in Reihenfolge von state.heats spielen. */
  playPhase(isPhase: (h: Heat) => boolean, pick: Pick): void {
    for (const h of this.state.heats.filter(isPhase)) this.playHeat(h.id, pick);
  }
}

const isGroupHeat = (h: Heat) => h.phase === 'group';
const isKoHeat = (h: Heat) => h.phase !== 'group';

/** Team mit kleinerem Index in `order` gewinnt. */
const byOrder =
  (order: readonly string[], outcome: 'win' | 'winByTime' = 'win'): Pick =>
  (a, b) => ({ outcome, winnerTeamId: order.indexOf(a) < order.indexOf(b) ? a : b });

const NAMES = Array.from({ length: 64 }, (_, i) => `Team ${String(i + 1).padStart(2, '0')}`);

interface Fixture {
  s: Session;
  ids: string[];
  /** Teams je Gruppe in Hinzufüge-Reihenfolge. */
  groups: Record<string, string[]>;
}

/**
 * Turnier anlegen, Teams hinzufügen und laut Muster zuteilen ('AABB' → Team 1, 2 in A, …;
 * '-' = nicht zuteilen). Ohne Muster werden nur `n` Teams angelegt.
 */
const setup = (opts: {
  pattern?: string;
  n?: number;
  tableCount?: number;
  settings?: SettingsPatch;
}): Fixture => {
  const s = new Session();
  s.one(
    opts.settings
      ? { type: 'createTournament', name: 'Sommerturnier', settings: opts.settings }
      : { type: 'createTournament', name: 'Sommerturnier' },
    'TournamentCreated',
  );
  s.one({ type: 'setTableCount', tableCount: opts.tableCount ?? 2 }, 'TableCountSet');
  const n = opts.pattern?.length ?? opts.n ?? 0;
  const ids = NAMES.slice(0, n).map(
    (name) =>
      s.one({ type: 'addTeam', name, players: [`${name} Spieler`] }, 'TeamAdded').payload.teamId,
  );
  const groups: Record<string, string[]> = {};
  [...(opts.pattern ?? '')].forEach((g, i) => {
    if (g === '-') return;
    const teamId = at(ids, i);
    s.one({ type: 'assignTeamToGroup', teamId, groupId: g }, 'TeamAssignedToGroup');
    (groups[g] ??= []).push(teamId);
  });
  return { s, ids, groups };
};

/** Gruppen + KO: anlegen, starten, Gruppenphase komplett spielen (Standard: Reihenfolge gewinnt). */
const groupStageDone = (
  pattern: string,
  opts: { tableCount?: number; settings?: SettingsPatch; pick?: Pick } = {},
): Fixture => {
  const groupCount = new Set(pattern.replace(/-/g, '')).size as Settings['groupCount'];
  const f = setup({
    pattern,
    tableCount: opts.tableCount ?? 2,
    settings: { groupCount, ...opts.settings },
  });
  f.s.one({ type: 'startTournament' }, 'TournamentStarted');
  f.s.playPhase(isGroupHeat, opts.pick ?? byOrder(f.ids));
  return f;
};

const advance = (f: Fixture): EventOf<'PhaseAdvanced'> =>
  f.s.one({ type: 'advancePhase' }, 'PhaseAdvanced');

const koOnlyStarted = (
  n: number,
  opts: { tableCount?: number; settings?: SettingsPatch; seed?: number } = {},
): Fixture & { started: EventOf<'TournamentStarted'> } => {
  const f = setup({
    n,
    tableCount: opts.tableCount ?? 2,
    settings: { mode: 'koOnly', ...opts.settings },
  });
  const started = f.s.one({ type: 'startTournament' }, 'TournamentStarted', lcg(opts.seed ?? 1));
  return { ...f, started };
};

const STAGE_ORDER: KoStage[] = [
  'ko64',
  'ko32',
  'ko16',
  'quarterfinal',
  'semifinal',
  'thirdPlace',
  'final',
];

const byStage = (matches: readonly Match[], phase: KoStage): Match[] =>
  matches.filter((m) => m.phase === phase).sort((x, y) => x.position - y.position);

/**
 * Erwartete KO-Durchgänge (Festlegung): Stufe für Stufe in Baumreihenfolge, Platz 3 vor dem
 * Finale, à tableCount, Freilos-Partien ohne Tisch, phase = Stufe, round 1, index 1..n je Stufe.
 */
const expectedKoHeats = (matches: readonly Match[], tableCount: number) => {
  const out: Omit<Heat, 'id'>[] = [];
  for (const stage of STAGE_ORDER) {
    const ids = byStage(matches, stage)
      .filter((m) => !m.bye)
      .map((m) => m.id);
    for (let i = 0; i * tableCount < ids.length; i++) {
      out.push({
        phase: stage,
        round: 1,
        index: i + 1,
        matchIds: ids.slice(i * tableCount, (i + 1) * tableCount),
      });
    }
  }
  return out;
};

const withoutId = (heats: readonly Heat[]): Omit<Heat, 'id'>[] =>
  heats.map((h) => ({ phase: h.phase, round: h.round, index: h.index, matchIds: h.matchIds }));

/** Payload ohne Durchgangs-IDs (deren Bildung ist nicht festgelegt). */
const shape = (p: { matches: Match[]; heats: Heat[] }) => ({
  matches: p.matches,
  heats: withoutId(p.heats),
});

/** Erste KO-Runde aus Gruppenplätzen; Platz k = k-tes Team der Gruppe (Reihenfolge gewinnt). */
const seededFirstRound = (groups: Record<string, string[]>, q: number): [Slot, Slot][] =>
  crossSeeding(Object.keys(groups).sort(), q).map(([x, y]) => [
    { teamId: at(groups[x.groupId] ?? [], x.rank - 1) },
    { teamId: at(groups[y.groupId] ?? [], y.rank - 1) },
  ]);

const slotTeam = (slot: Slot): string | null =>
  slot !== null && 'teamId' in slot ? slot.teamId : null;

const pairingOf = (m: Match): [string | null, string | null] => [slotTeam(m.a), slotTeam(m.b)];

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// advancePhase – Fehlerfälle
// ---------------------------------------------------------------------------

describe('advancePhase – Fehlerfälle (M11, ARCHITECTURE advancePhase, M09)', () => {
  it('M11: vor dem Start (Phase setup) → TOURNAMENT_NOT_STARTED', () => {
    const { s } = setup({ pattern: 'AABB' });
    s.expectError({ type: 'advancePhase' }, 'TOURNAMENT_NOT_STARTED');
  });

  it('M04: Nur-KO (bereits in Phase knockout) → TOURNAMENT_ALREADY_STARTED', () => {
    const { s } = koOnlyStarted(4);
    s.expectError({ type: 'advancePhase' }, 'TOURNAMENT_ALREADY_STARTED');
  });

  it('M11: nach PhaseAdvanced ein zweites Mal → TOURNAMENT_ALREADY_STARTED', () => {
    const f = groupStageDone('AABB');
    advance(f);
    f.s.expectError({ type: 'advancePhase' }, 'TOURNAMENT_ALREADY_STARTED');
  });

  it('ARCH advancePhase: direkt nach dem Start ohne Ergebnisse → GROUP_STAGE_INCOMPLETE', () => {
    const f = setup({ pattern: 'AABB' });
    f.s.one({ type: 'startTournament' }, 'TournamentStarted');
    f.s.expectError({ type: 'advancePhase' }, 'GROUP_STAGE_INCOMPLETE');
  });

  it('ARCH advancePhase: genau eine Gruppenpartie ohne Ergebnis → GROUP_STAGE_INCOMPLETE', () => {
    const f = setup({ pattern: 'AAABBB', tableCount: 1 });
    f.s.one({ type: 'startTournament' }, 'TournamentStarted');
    const heats = f.s.state.heats.filter(isGroupHeat);
    const last = at(heats, heats.length - 1);
    for (const h of heats.slice(0, -1)) f.s.playHeat(h.id, byOrder(f.ids));
    f.s.playHeat(last.id, byOrder(f.ids), [at(last.matchIds, last.matchIds.length - 1)]);
    f.s.expectError({ type: 'advancePhase' }, 'GROUP_STAGE_INCOMPLETE');
  });

  it('M19/ARCH advancePhase: letztes Gruppenergebnis per undo aufgehoben → GROUP_STAGE_INCOMPLETE', () => {
    const f = groupStageDone('AABB');
    f.s.one({ type: 'undo' }, 'Undone');
    f.s.expectError({ type: 'advancePhase' }, 'GROUP_STAGE_INCOMPLETE');
  });

  it('M09: Kreis in Gruppe A ohne Becherdifferenz → PLAYOFF_REQUIRED', () => {
    const f = setup({ pattern: 'AAABB' });
    const [x, y, z] = f.groups['A'] as [string, string, string];
    f.s.one({ type: 'startTournament' }, 'TournamentStarted');
    f.s.playPhase(isGroupHeat, circle([x, y, z], byOrder(f.ids)));
    f.s.expectError({ type: 'advancePhase' }, 'PLAYOFF_REQUIRED');
  });

  it('M09/M19: Stechen per undo aufgehoben → wieder PLAYOFF_REQUIRED', () => {
    const f = setup({ pattern: 'AAABB' });
    const [x, y, z] = f.groups['A'] as [string, string, string];
    f.s.one({ type: 'startTournament' }, 'TournamentStarted');
    f.s.playPhase(isGroupHeat, circle([x, y, z], byOrder(f.ids)));
    f.s.one(
      { type: 'recordPlayoff', groupId: 'A', tiedTeamIds: [x, y, z], winnerTeamId: y },
      'PlayoffRecorded',
    );
    f.s.one({ type: 'undo' }, 'Undone');
    f.s.expectError({ type: 'advancePhase' }, 'PLAYOFF_REQUIRED');
  });
});

/** Kreis x > y > z > x (je Sieg), alle anderen Partien nach `rest`. */
function circle([x, y, z]: [string, string, string], rest: Pick): Pick {
  const beats: [string, string][] = [
    [x, y],
    [y, z],
    [z, x],
  ];
  return (a, b) => {
    for (const [w, l] of beats) {
      if ((a === w && b === l) || (a === l && b === w)) return { outcome: 'win', winnerTeamId: w };
    }
    return rest(a, b);
  };
}

// ---------------------------------------------------------------------------
// advancePhase – Erfolg: Setzung
// ---------------------------------------------------------------------------

describe('advancePhase – Über-Kreuz-Setzung aus der Tabelle (M11, M10)', () => {
  it('M11: 4 Teams, 2 Gruppen, q=1 → genau ein PhaseAdvanced v1 mit Finale A1–B1, at = ctx.now', () => {
    const f = groupStageDone('AABB');
    const r = f.s.decide({ type: 'advancePhase' });
    if (!r.ok) throw new Error(r.error.code);
    expect(r.value).toHaveLength(1);
    const pa = f.s.append(at(r.value, 0)) as EventOf<'PhaseAdvanced'>;
    expect(pa.type).toBe('PhaseAdvanced');
    expect(pa.v).toBe(1);
    expect(pa.at).toBe(f.s.clock);
    const [a1] = f.groups['A'] as [string];
    const [b1] = f.groups['B'] as [string];
    expect(pa.payload.matches).toHaveLength(1);
    expect(pa.payload.matches[0]).toMatchObject({
      phase: 'final',
      round: 1,
      position: 1,
      groupId: null,
      a: { teamId: a1 },
      b: { teamId: b1 },
      bye: false,
    });
    expect(f.s.state.phase).toBe('knockout');
  });

  it('M11 Pflichtfall: 2 Gruppen à 4, q=2 → Halbfinale A1–B2 und B1–A2, Finale aus den Siegern', () => {
    const f = groupStageDone('AAAABBBB');
    const pa = advance(f);
    const [a1, a2] = f.groups['A'] as [string, string];
    const [b1, b2] = f.groups['B'] as [string, string];
    const sf = byStage(pa.payload.matches, 'semifinal');
    expect(sf.map(pairingOf)).toEqual([
      [a1, b2],
      [b1, a2],
    ]);
    const [fin] = byStage(pa.payload.matches, 'final') as [Match];
    expect(fin.a).toEqual({ winnerOf: at(sf, 0).id });
    expect(fin.b).toEqual({ winnerOf: at(sf, 1).id });
  });

  it('M11 Pflichtfall: 4 Gruppen à 4, q=2 → Viertelfinale A1–B2, C1–D2, B1–A2, D1–C2', () => {
    const f = groupStageDone('AAAABBBBCCCCDDDD', { tableCount: 8 });
    const pa = advance(f);
    const g = (id: string, rank: number) => at(f.groups[id] ?? [], rank - 1);
    expect(byStage(pa.payload.matches, 'quarterfinal').map(pairingOf)).toEqual([
      [g('A', 1), g('B', 2)],
      [g('C', 1), g('D', 2)],
      [g('B', 1), g('A', 2)],
      [g('D', 1), g('C', 2)],
    ]);
  });

  it('M11/M10: 2 Gruppen à 8, Standard q=4 → Viertelfinale A1–B4, A3–B2, B1–A4, B3–A2', () => {
    const f = groupStageDone('AAAAAAAABBBBBBBB', { tableCount: 8 });
    const pa = advance(f);
    const g = (id: string, rank: number) => at(f.groups[id] ?? [], rank - 1);
    expect(byStage(pa.payload.matches, 'quarterfinal').map(pairingOf)).toEqual([
      [g('A', 1), g('B', 4)],
      [g('A', 3), g('B', 2)],
      [g('B', 1), g('A', 4)],
      [g('B', 3), g('A', 2)],
    ]);
  });

  it('M11: 1 Gruppe à 4, Standard q=2 → Finale P1–P2', () => {
    const f = groupStageDone('AAAA');
    const pa = advance(f);
    const [p1, p2] = f.groups['A'] as [string, string];
    expect(pa.payload.matches.map(pairingOf)).toEqual([[p1, p2]]);
    expect(pa.payload.matches[0]?.phase).toBe('final');
  });

  it('M06/M11: ungleiche Gruppengrößen (3 und 2), q=1 → Finale A1–B1', () => {
    const f = groupStageDone('AAABB');
    const pa = advance(f);
    expect(pa.payload.matches.map(pairingOf)).toEqual([
      [at(f.groups['A'] ?? [], 0), at(f.groups['B'] ?? [], 0)],
    ]);
  });

  it('M09: Kreis in Gruppe A, Stechen gewinnt das mittlere Team → es ist A1', () => {
    const f = setup({ pattern: 'AAABB' });
    const [x, y, z] = f.groups['A'] as [string, string, string];
    f.s.one({ type: 'startTournament' }, 'TournamentStarted');
    f.s.playPhase(isGroupHeat, circle([x, y, z], byOrder(f.ids)));
    f.s.one(
      { type: 'recordPlayoff', groupId: 'A', tiedTeamIds: [x, y, z], winnerTeamId: y },
      'PlayoffRecorded',
    );
    const pa = advance(f);
    expect(pa.payload.matches.map(pairingOf)).toEqual([[y, at(f.groups['B'] ?? [], 0)]]);
  });

  it('M09/S01: Kreis mit Becherdifferenz → bestes cupDiff wird A1, kein Stechen nötig', () => {
    const f = setup({ pattern: 'AAABBB', settings: { groupCount: 2, trackCups: true } });
    const [x, y, z] = f.groups['A'] as [string, string, string];
    // x schlägt y 10:9, y schlägt z 10:9, z schlägt x 10:0 → Differenz x −9, y 0, z +9
    const scores: Record<string, ResultInput> = {
      [`${x}|${y}`]: { outcome: 'win', winnerTeamId: x, cups: { a: 10, b: 9 } },
      [`${y}|${z}`]: { outcome: 'win', winnerTeamId: y, cups: { a: 10, b: 9 } },
      [`${z}|${x}`]: { outcome: 'win', winnerTeamId: z, cups: { a: 10, b: 0 } },
    };
    const pick: Pick = (a, b) => {
      const direct = scores[`${a}|${b}`];
      if (direct) return direct;
      const flipped = scores[`${b}|${a}`];
      if (flipped?.cups) return { ...flipped, cups: { a: flipped.cups.b, b: flipped.cups.a } };
      const w = f.ids.indexOf(a) < f.ids.indexOf(b) ? a : b;
      return { outcome: 'win', winnerTeamId: w, cups: w === a ? { a: 10, b: 0 } : { a: 0, b: 10 } };
    };
    f.s.one({ type: 'startTournament' }, 'TournamentStarted');
    f.s.playPhase(isGroupHeat, pick);
    const pa = advance(f);
    expect(pa.payload.matches.map(pairingOf)).toEqual([[z, at(f.groups['B'] ?? [], 0)]]);
  });

  it('M09/M10: Gleichstand hinter q (Platz 2 geteilt, q=1) ist irrelevant → advancePhase erlaubt', () => {
    const f = setup({ pattern: 'AAABBB' });
    const [x, y, z] = f.groups['A'] as [string, string, string];
    const pick: Pick = (a, b) =>
      a === x || b === x
        ? { outcome: 'win', winnerTeamId: x }
        : [a, b].includes(y) && [a, b].includes(z)
          ? { outcome: 'draw' }
          : byOrder(f.ids)(a, b);
    f.s.one({ type: 'startTournament' }, 'TournamentStarted');
    f.s.playPhase(isGroupHeat, pick);
    const pa = advance(f);
    expect(pa.payload.matches.map(pairingOf)).toEqual([[x, at(f.groups['B'] ?? [], 0)]]);
  });

  it.each<[string, string, number, boolean, number]>([
    ['2 Gruppen à 2, q=1', 'AABB', 1, false, 2],
    ['2 Gruppen à 2, q=1, Platz 3 an', 'AABB', 1, true, 2],
    ['2 Gruppen à 4, q=2', 'AAAABBBB', 2, false, 1],
    ['2 Gruppen à 4, q=2, Platz 3 an', 'AAAABBBB', 2, true, 2],
    ['2 Gruppen à 4, q=2, Platz 3 an, 3 Tische', 'AAAABBBB', 2, true, 3],
    ['4 Gruppen à 4, q=2, Platz 3 an', 'AAAABBBBCCCCDDDD', 2, true, 3],
    ['2 Gruppen à 8, q=4', 'AAAAAAAABBBBBBBB', 4, false, 4],
    ['1 Gruppe à 5, q=2', 'AAAAA', 2, true, 2],
  ])(
    'M11/M15: %s → matches = buildBracket(Setzung), heats Stufe für Stufe à tableCount',
    (_name, pattern, q, thirdPlace, tables) => {
      const f = groupStageDone(pattern, {
        tableCount: tables,
        settings: { thirdPlaceMatch: thirdPlace },
      });
      const pa = advance(f);
      expect(pa.payload.matches).toEqual(buildBracket(seededFirstRound(f.groups, q), thirdPlace));
      expect(withoutId(pa.payload.heats)).toEqual(expectedKoHeats(pa.payload.matches, tables));
    },
  );

  it('S04: Platz 3 → Partie thirdPlace aus den Verlierern der Halbfinals, Durchgang vor dem Finale', () => {
    const f = groupStageDone('AAAABBBB', { settings: { thirdPlaceMatch: true } });
    const pa = advance(f);
    const sf = byStage(pa.payload.matches, 'semifinal');
    const [p3] = byStage(pa.payload.matches, 'thirdPlace') as [Match];
    expect(p3.a).toEqual({ loserOf: at(sf, 0).id });
    expect(p3.b).toEqual({ loserOf: at(sf, 1).id });
    expect(pa.payload.heats.map((h) => h.phase)).toEqual(['semifinal', 'thirdPlace', 'final']);
  });

  it('S04: Platz 3 aus → keine Partie thirdPlace', () => {
    const pa = advance(groupStageDone('AAAABBBB'));
    expect(pa.payload.matches.some((m) => m.phase === 'thirdPlace')).toBe(false);
    expect(pa.payload.heats.map((h) => h.phase)).toEqual(['semifinal', 'final']);
  });

  it('S04: thirdPlaceMatch nach dem Start eingeschaltet → wirkt beim Phasenwechsel', () => {
    const f = setup({ pattern: 'AAAABBBB' });
    f.s.one({ type: 'startTournament' }, 'TournamentStarted');
    f.s.one({ type: 'updateSettings', settings: { thirdPlaceMatch: true } }, 'SettingsUpdated');
    f.s.playPhase(isGroupHeat, byOrder(f.ids));
    expect(advance(f).payload.matches.some((m) => m.phase === 'thirdPlace')).toBe(true);
  });

  it('M15: tableCount 1 → jede Partie ein eigener Durchgang (HF 1, HF 2, Platz 3, Finale)', () => {
    const f = groupStageDone('AAAABBBB', { tableCount: 1, settings: { thirdPlaceMatch: true } });
    const pa = advance(f);
    expect(pa.payload.heats.map((h) => [h.phase, h.index, h.matchIds.length])).toEqual([
      ['semifinal', 1, 1],
      ['semifinal', 2, 1],
      ['thirdPlace', 1, 1],
      ['final', 1, 1],
    ]);
  });

  it('ADR 025: KO-IDs kollidieren nicht mit Gruppen-IDs; nach apply alle Partien und Durchgänge im Zustand', () => {
    const f = groupStageDone('AAAABBBB', { settings: { thirdPlaceMatch: true } });
    const groupMatches = f.s.state.matches.length;
    const groupHeats = f.s.state.heats.length;
    const pa = advance(f);
    const matchIds = f.s.state.matches.map((m) => m.id);
    const heatIds = f.s.state.heats.map((h) => h.id);
    expect(new Set(matchIds).size).toBe(matchIds.length);
    expect(new Set(heatIds).size).toBe(heatIds.length);
    expect(f.s.state.matches).toHaveLength(groupMatches + pa.payload.matches.length);
    expect(f.s.state.heats).toHaveLength(groupHeats + pa.payload.heats.length);
    for (const h of pa.payload.heats) for (const m of h.matchIds) expect(matchIds).toContain(m);
  });

  it('M11/Arch. Regel 4: Setzung ohne Zufall – ctx.random wird nicht benutzt, Payload unabhängig vom Seed', () => {
    const f = groupStageDone('AAAABBBBCCCCDDDD', { tableCount: 4 });
    let calls = 0;
    const counting = () => {
      calls += 1;
      return 0.3;
    };
    const r1 = f.s.decide({ type: 'advancePhase' }, counting);
    const r2 = f.s.decide({ type: 'advancePhase' }, lcg(999));
    if (!r1.ok) throw new Error(`advancePhase: ${r1.error.code}`);
    if (!r2.ok) throw new Error(`advancePhase: ${r2.error.code}`);
    expect(calls).toBe(0);
    const e1 = at(r1.value, 0);
    const e2 = at(r2.value, 0);
    if (e1.type !== 'PhaseAdvanced' || e2.type !== 'PhaseAdvanced')
      throw new Error('kein PhaseAdvanced');
    expect(shape(e1.payload)).toEqual(shape(e2.payload));
  });
});

// ---------------------------------------------------------------------------
// advancePhase – Undo / Redo
// ---------------------------------------------------------------------------

describe('advancePhase – Undo, Redo, Undo mit abhängigen Ereignissen (M19, ADR 026)', () => {
  it('M19: undo von PhaseAdvanced → Phase groups, keine KO-Partien/-Durchgänge; erneut advancePhase liefert denselben Baum', () => {
    const f = groupStageDone('AAAABBBB', { settings: { thirdPlaceMatch: true } });
    const pa = advance(f);
    f.s.one({ type: 'undo' }, 'Undone');
    expect(f.s.state.phase).toBe('groups');
    expect(f.s.state.matches.some((m) => m.phase !== 'group')).toBe(false);
    expect(f.s.state.heats.some(isKoHeat)).toBe(false);
    const again = advance(f);
    expect(shape(again.payload)).toEqual(shape(pa.payload));
  });

  it('M19: Redo von PhaseAdvanced → wieder Phase knockout mit demselben Baum', () => {
    const f = groupStageDone('AAAABBBB');
    advance(f);
    const before = clone(f.s.state.matches);
    const u = f.s.one({ type: 'undo' }, 'Undone');
    f.s.one({ type: 'undoEvent', eventId: u.id }, 'Undone');
    expect(f.s.state.phase).toBe('knockout');
    expect(f.s.state.matches).toEqual(before);
  });

  it('M19: PhaseAdvanced mit gestartetem KO-Durchgang → UNDO_HAS_DEPENDENTS; mit confirm zurück in groups', () => {
    const f = groupStageDone('AAAABBBB');
    const pa = advance(f);
    const hs = f.s.one({ type: 'startHeat', heatId: at(pa.payload.heats, 0).id }, 'HeatStarted');
    const error = f.s.expectError({ type: 'undoEvent', eventId: pa.id }, 'UNDO_HAS_DEPENDENTS');
    expect(error.dependents).toContain(hs.id);
    f.s.one({ type: 'undoEvent', eventId: pa.id, confirm: true }, 'Undone');
    expect(f.s.state.phase).toBe('groups');
    expect(f.s.state.timers[hs.payload.heatId]).toBeUndefined();
    expect(replay(f.s.events)).toEqual(f.s.state);
  });
});

// ---------------------------------------------------------------------------
// startTournament – Nur-KO
// ---------------------------------------------------------------------------

describe('startTournament bei Modus koOnly (M04, M11, M15)', () => {
  it.each([0, 1])('M04: %i Team(s) → NOT_ENOUGH_TEAMS', (n) => {
    const { s } = setup({ n, settings: { mode: 'koOnly' } });
    s.expectError({ type: 'startTournament' }, 'NOT_ENOUGH_TEAMS');
  });

  it('M04: 2 Teams → nur ein Finale, ein Durchgang; groups [], advancersPerGroup null; Phase knockout', () => {
    const { s, ids, started } = koOnlyStarted(2);
    expect(started.v).toBe(1);
    expect(started.payload.groups).toEqual([]);
    expect(started.payload.advancersPerGroup).toBeNull();
    expect(started.payload.matches).toHaveLength(1);
    const [fin] = started.payload.matches as [Match];
    expect(fin.phase).toBe('final');
    expect([slotTeam(fin.a), slotTeam(fin.b)].sort()).toEqual([...ids].sort());
    expect(withoutId(started.payload.heats)).toEqual([
      { phase: 'final', round: 1, index: 1, matchIds: [fin.id] },
    ]);
    expect(s.state.phase).toBe('knockout');
  });

  it('M04 Pflichtfall: 6 Teams → 8 Plätze, 2 Freilose; Viertelfinal-Durchgang nur mit den 2 echten Partien', () => {
    const { ids, started } = koOnlyStarted(6, { tableCount: 4 });
    const qf = byStage(started.payload.matches, 'quarterfinal');
    expect(qf).toHaveLength(4);
    expect(qf.filter((m) => m.bye)).toHaveLength(2);
    expect(byStage(started.payload.matches, 'semifinal')).toHaveLength(2);
    expect(byStage(started.payload.matches, 'final')).toHaveLength(1);
    const placed = qf.flatMap((m) => [slotTeam(m.a), slotTeam(m.b)]).filter((t) => t !== null);
    expect(placed.sort()).toEqual([...ids].sort());
    expect(started.payload.heats.map((h) => [h.phase, h.matchIds.length])).toEqual([
      ['quarterfinal', 2],
      ['semifinal', 2],
      ['final', 1],
    ]);
    for (const h of started.payload.heats) {
      for (const m of h.matchIds) expect(qf.find((x) => x.id === m)?.bye ?? false).toBe(false);
    }
  });

  it.each<[number, number, boolean]>([
    [2, 1, false],
    [3, 2, true],
    [4, 2, true],
    [5, 1, false],
    [6, 2, true],
    [8, 3, false],
    [13, 4, true],
    [16, 8, false],
    [33, 16, true],
    [64, 16, true],
  ])(
    'M04/M11: %i Teams, %i Tische, Platz 3 %s → matches = buildBracket(drawKnockout(Teams, ctx.random)), heats Stufe für Stufe',
    (n, tables, thirdPlace) => {
      const seed = n * 31 + tables;
      const { ids, started } = koOnlyStarted(n, {
        tableCount: tables,
        seed,
        settings: { thirdPlaceMatch: thirdPlace },
      });
      const expected = buildBracket(drawKnockout(ids, lcg(seed)), thirdPlace);
      expect(started.payload.matches).toEqual(expected);
      expect(withoutId(started.payload.heats)).toEqual(
        expectedKoHeats(started.payload.matches, tables),
      );
    },
  );

  it('S04: Nur-KO mit 4 Teams und Platz 3 → Durchgänge Halbfinale, Platz 3, Finale', () => {
    const { started } = koOnlyStarted(4, { settings: { thirdPlaceMatch: true } });
    expect(started.payload.matches.filter((m) => m.phase === 'thirdPlace')).toHaveLength(1);
    expect(started.payload.heats.map((h) => h.phase)).toEqual(['semifinal', 'thirdPlace', 'final']);
  });

  it('M04: Gruppenzuteilungen werden ignoriert (teilweise zugeteilt, dann Modus koOnly)', () => {
    const f = setup({ pattern: 'AAB---' });
    f.s.one({ type: 'updateSettings', settings: { mode: 'koOnly' } }, 'SettingsUpdated');
    const started = f.s.one({ type: 'startTournament' }, 'TournamentStarted', lcg(8));
    expect(started.payload.groups).toEqual([]);
    expect(started.payload.matches.every((m) => m.phase !== 'group' && m.groupId === null)).toBe(
      true,
    );
    expect(started.payload.matches).toEqual(buildBracket(drawKnockout(f.ids, lcg(8)), false));
  });

  it('M04: Teams werden in Hinzufüge-Reihenfolge gelost (entferntes Team fehlt)', () => {
    const f = setup({ n: 5, settings: { mode: 'koOnly' } });
    f.s.one({ type: 'removeTeam', teamId: at(f.ids, 1) }, 'TeamRemoved');
    const rest = f.ids.filter((_, i) => i !== 1);
    const started = f.s.one({ type: 'startTournament' }, 'TournamentStarted', lcg(77));
    expect(started.payload.matches).toEqual(buildBracket(drawKnockout(rest, lcg(77)), false));
  });

  it('Arch. Regel 4: gleicher Seed → gleiche Losung; verschiedene Seeds → nicht immer gleich', () => {
    const payload = (seed: number) => koOnlyStarted(6, { seed }).started.payload;
    expect(shape(payload(5))).toEqual(shape(payload(5)));
    const distinct = new Set(
      Array.from({ length: 12 }, (_, i) => JSON.stringify(payload(i + 1).matches)),
    );
    expect(distinct.size).toBeGreaterThan(1);
  });

  it('Arch. Regel 4: Losung nutzt ctx.random, nie Math.random', () => {
    const f = setup({ n: 6, settings: { mode: 'koOnly' } });
    const spy = vi.spyOn(Math, 'random');
    let calls = 0;
    const base = lcg(3);
    f.s.one({ type: 'startTournament' }, 'TournamentStarted', () => {
      calls += 1;
      return base();
    });
    expect(calls).toBeGreaterThan(0);
    expect(spy).not.toHaveBeenCalled();
  });

  it('M04: zweiter Start → TOURNAMENT_ALREADY_STARTED', () => {
    koOnlyStarted(4).s.expectError({ type: 'startTournament' }, 'TOURNAMENT_ALREADY_STARTED');
  });

  it('M19: undo des Nur-KO-Starts → Phase setup, keine Partien; erneuter Start mit gleichem Seed gleich', () => {
    const { s, started } = koOnlyStarted(6, { seed: 21 });
    s.one({ type: 'undo' }, 'Undone');
    expect(s.state.phase).toBe('setup');
    expect(s.state.matches).toEqual([]);
    expect(s.state.heats).toEqual([]);
    const again = s.one({ type: 'startTournament' }, 'TournamentStarted', lcg(21));
    expect(shape(again.payload)).toEqual(shape(started.payload));
  });
});

// ---------------------------------------------------------------------------
// KO-Ergebnisse
// ---------------------------------------------------------------------------

/** Nur-KO mit 6 Teams (fester Seed): Viertelfinale mit 2 Freilos-Partien und 2 echten Partien. */
const koWithBye = () => {
  const f = koOnlyStarted(6, { tableCount: 4, seed: 11 });
  const qf = byStage(f.s.state.matches, 'quarterfinal');
  const bye = qf.find((m) => m.bye);
  const real = qf.find((m) => !m.bye);
  if (!bye || !real) throw new Error('Losung ohne Freilos/echte Partie');
  return { ...f, qf, bye, real };
};

describe('recordResult im KO – spezifische Regeln (M14, M11, SPEC → KO)', () => {
  it('M11: Freilos-Sieger steht ohne Ergebnis fest (winnerOf, resolveSlot der Folgepartie)', () => {
    const { s, bye } = koWithBye();
    const byeTeam = slotTeam(bye.a) ?? slotTeam(bye.b);
    expect(byeTeam).not.toBeNull();
    expect(s.state.results[bye.id]).toBeUndefined();
    expect(winnerOf(s.state, bye.id)).toBe(byeTeam);
    const next = s.state.matches.find((m) =>
      [m.a, m.b].some((x) => x !== null && 'winnerOf' in x && x.winnerOf === bye.id),
    );
    if (!next) throw new Error('keine Folgepartie');
    const slot =
      next.a !== null && 'winnerOf' in next.a && next.a.winnerOf === bye.id ? next.a : next.b;
    expect(resolveSlot(s.state, slot)).toBe(byeTeam);
  });

  it('M11/SPEC Freilose: Ergebnis für eine KO-Freilos-Partie → MATCH_NOT_PLAYABLE', () => {
    const { s, bye } = koWithBye();
    s.one({ type: 'startHeat', heatId: at(s.state.heats, 0).id }, 'HeatStarted');
    const byeTeam = slotTeam(bye.a) ?? slotTeam(bye.b) ?? 'x';
    s.expectError(
      { type: 'recordResult', matchId: bye.id, outcome: 'win', winnerTeamId: byeTeam },
      'MATCH_NOT_PLAYABLE',
    );
  });

  it('M14: Sieger muss eines der feststehenden Teams sein (Verlierer der Quelle → INVALID_RESULT)', () => {
    const f = groupStageDone('AAAABBBB', { tableCount: 2 });
    const pa = advance(f);
    const [sfHeat, finHeat] = pa.payload.heats as [Heat, Heat];
    f.s.playHeat(sfHeat.id, byOrder(f.ids));
    f.s.one({ type: 'startHeat', heatId: finHeat.id }, 'HeatStarted');
    const [sf1] = byStage(pa.payload.matches, 'semifinal') as [Match];
    const [fin] = byStage(pa.payload.matches, 'final') as [Match];
    const winner = winnerOf(f.s.state, sf1.id);
    const loser = [slotTeam(sf1.a), slotTeam(sf1.b)].find((t) => t !== winner) ?? 'x';
    f.s.expectError(
      { type: 'recordResult', matchId: fin.id, outcome: 'win', winnerTeamId: loser },
      'INVALID_RESULT',
    );
  });

  it('M14: draw im erzeugten KO-Baum (Halbfinale) → DRAW_NOT_ALLOWED_IN_KNOCKOUT', () => {
    const f = groupStageDone('AAAABBBB');
    const pa = advance(f);
    f.s.one({ type: 'startHeat', heatId: at(pa.payload.heats, 0).id }, 'HeatStarted');
    f.s.expectError(
      {
        type: 'recordResult',
        matchId: at(byStage(pa.payload.matches, 'semifinal'), 0).id,
        outcome: 'draw',
      },
      'DRAW_NOT_ALLOWED_IN_KNOCKOUT',
    );
  });

  it('M14: winByTime („nächster Becher gewinnt“) – der Sieger zieht in die Folgepartie ein', () => {
    const f = groupStageDone('AAAABBBB');
    const pa = advance(f);
    const [sfHeat] = pa.payload.heats as [Heat];
    f.s.playHeat(sfHeat.id, (a) => ({ outcome: 'winByTime', winnerTeamId: a }));
    const sf = byStage(pa.payload.matches, 'semifinal');
    const [fin] = byStage(f.s.state.matches, 'final') as [Match];
    expect(teamsOf(f.s.state, fin)).toEqual([slotTeam(at(sf, 0).a), slotTeam(at(sf, 1).a)]);
  });

  it('M11/SPEC KO: Quelle ohne wirksames Ergebnis → Folgepartie MATCH_NOT_PLAYABLE (auch bei gestartetem Durchgang)', () => {
    // Protokoll bewusst ohne Kaskade aufgehoben (Undone direkt eingespielt): Finale läuft,
    // Halbfinal-Ergebnis 1 ist aber nicht mehr wirksam → Sieger von HF 1 steht nicht fest.
    const f = groupStageDone('AAAABBBB');
    const pa = advance(f);
    const [sfHeat, finHeat] = pa.payload.heats as [Heat, Heat];
    f.s.playHeat(sfHeat.id, byOrder(f.ids));
    f.s.one({ type: 'startHeat', heatId: finHeat.id }, 'HeatStarted');
    const [sf1] = byStage(pa.payload.matches, 'semifinal') as [Match];
    const sf1Result = f.s.events.find(
      (e) => e.type === 'ResultRecorded' && e.payload.matchId === sf1.id,
    );
    if (!sf1Result) throw new Error('kein HF-Ergebnis');
    f.s.pushUndone(sf1Result.id);
    const [fin] = byStage(pa.payload.matches, 'final') as [Match];
    const [, b] = teamsOf(f.s.state, fin);
    expect(teamsOf(f.s.state, fin)[0]).toBeNull();
    f.s.expectError(
      { type: 'recordResult', matchId: fin.id, outcome: 'win', winnerTeamId: b ?? 'x' },
      'MATCH_NOT_PLAYABLE',
    );
  });
});

// ---------------------------------------------------------------------------
// Zeitlimit je KO-Stufe beim startHeat (M12) mit erzeugten Durchgängen
// ---------------------------------------------------------------------------

const CUSTOM_TIMERS: Settings['timerByPhase'] = {
  ...DEFAULT_SETTINGS.timerByPhase,
  group: 840_000,
  ko64: 720_000,
  ko32: 660_000,
  ko16: 540_000,
  quarterfinal: 480_000,
};

describe('startHeat in erzeugten KO-Durchgängen – Zeitlimit je Stufe (M12)', () => {
  it.each<[number, KoStage, number | null]>([
    [2, 'final', null],
    [3, 'semifinal', null],
    [6, 'quarterfinal', 480_000],
    [16, 'ko16', 540_000],
    [17, 'ko32', 660_000],
    [33, 'ko64', 720_000],
  ])('M12: Nur-KO mit %i Teams → erste Stufe %s, durationMs %s', (n, stage, ms) => {
    const { s, started } = koOnlyStarted(n, {
      tableCount: 16,
      settings: { timerByPhase: CUSTOM_TIMERS },
    });
    const first = at(started.payload.heats, 0);
    expect(first.phase).toBe(stage);
    const hs = s.one({ type: 'startHeat', heatId: first.id }, 'HeatStarted');
    expect(hs.payload.durationMs).toBe(ms);
  });

  it('M12: Gruppen + KO (2 Gruppen à 8, q=4) → Viertelfinale mit timerByPhase.quarterfinal', () => {
    const f = groupStageDone('AAAAAAAABBBBBBBB', {
      tableCount: 8,
      settings: { timerByPhase: CUSTOM_TIMERS },
    });
    const pa = advance(f);
    const hs = f.s.one({ type: 'startHeat', heatId: at(pa.payload.heats, 0).id }, 'HeatStarted');
    expect(hs.payload.durationMs).toBe(480_000);
  });

  it('M12/S04: Halbfinale, Platz 3 und Finale immer ohne Zeitlimit (durationMs null)', () => {
    const f = groupStageDone('AAAABBBB', {
      tableCount: 2,
      settings: { thirdPlaceMatch: true, timerByPhase: CUSTOM_TIMERS },
    });
    const pa = advance(f);
    const durations: [string, number | null][] = [];
    for (const h of pa.payload.heats) {
      const hs = f.s.playHeat(h.id, byOrder(f.ids));
      durations.push([h.phase, hs.payload.durationMs]);
    }
    expect(durations).toEqual([
      ['semifinal', null],
      ['thirdPlace', null],
      ['final', null],
    ]);
  });

  it('SPEC streng nacheinander: erster KO-Durchgang erst nach dem Halbfinale startbar → Finale vorher gesperrt', () => {
    const f = groupStageDone('AAAABBBB');
    const pa = advance(f);
    const [, finHeat] = pa.payload.heats as [Heat, Heat];
    f.s.expectError({ type: 'startHeat', heatId: finHeat.id }, 'PREVIOUS_HEAT_NOT_FINISHED');
  });
});

// ---------------------------------------------------------------------------
// Komplette Durchläufe
// ---------------------------------------------------------------------------

describe('Komplette Durchläufe bis zum Finale (M04, M11, M14, M16, S04)', () => {
  it('M04 groupsKo: 4 Teams, 2 Gruppen, q=1 → Gruppenphase, Finale A1–B1, Sieger steht fest', () => {
    const f = groupStageDone('AABB');
    const pa = advance(f);
    expect(pa.payload.heats).toHaveLength(1);
    const [finHeat] = pa.payload.heats as [Heat];
    const [a1] = f.groups['A'] as [string];
    const [b1] = f.groups['B'] as [string];
    const hs = f.s.playHeat(finHeat.id, () => ({ outcome: 'winByTime', winnerTeamId: b1 }));
    expect(hs.payload.durationMs).toBeNull();
    const [fin] = byStage(f.s.state.matches, 'final') as [Match];
    expect(teamsOf(f.s.state, fin)).toEqual([a1, b1]);
    expect(winnerOf(f.s.state, fin.id)).toBe(b1);
    for (const h of f.s.state.heats) expect(heatStatus(f.s.state, h.id)).toBe('finished');
    expect(replay(f.s.events)).toEqual(f.s.state);
  });

  it('M04 koOnly Pflichtfall: 6 Teams, Platz 3, 2 Tische → Viertelfinale (2 Freilose), Halbfinale, Platz 3, Finale', () => {
    const { s, ids, started } = koOnlyStarted(6, {
      tableCount: 2,
      seed: 4,
      settings: { thirdPlaceMatch: true },
    });
    expect(started.payload.heats.map((h) => [h.phase, h.matchIds.length])).toEqual([
      ['quarterfinal', 2],
      ['semifinal', 2],
      ['thirdPlace', 1],
      ['final', 1],
    ]);
    s.playPhase(isKoHeat, byOrder(ids));

    const sf = byStage(s.state.matches, 'semifinal');
    const sfWinners = sf.map((m) => winnerOf(s.state, m.id));
    const sfLosers = sf.map((m) => {
      const [a, b] = teamsOf(s.state, m);
      return a === winnerOf(s.state, m.id) ? b : a;
    });
    const [p3] = byStage(s.state.matches, 'thirdPlace') as [Match];
    const [fin] = byStage(s.state.matches, 'final') as [Match];
    expect(teamsOf(s.state, p3)).toEqual(sfLosers);
    expect(teamsOf(s.state, fin)).toEqual(sfWinners);
    // Reihenfolge gewinnt: Team 1 und Team 2 bestreiten nicht zwingend das Finale, aber Team 1 gewinnt alles.
    expect(winnerOf(s.state, fin.id)).toBe(at(ids, 0));
    // Freilos-Partien ohne Ergebnis, alle anderen KO-Partien mit Ergebnis
    for (const m of s.state.matches) {
      if (m.bye) expect(s.state.results[m.id]).toBeUndefined();
      else expect(s.state.results[m.id]).toBeDefined();
    }
    for (const h of s.state.heats) expect(heatStatus(s.state, h.id)).toBe('finished');
    expect(replay(s.events)).toEqual(s.state);
  });

  it('M04 groupsKo: 8 Teams, 2 Gruppen, q=2, Platz 3, 1 Tisch → alle KO-Durchgänge einzeln bis zum Finale', () => {
    const f = groupStageDone('AAAABBBB', { tableCount: 1, settings: { thirdPlaceMatch: true } });
    const pa = advance(f);
    expect(pa.payload.heats).toHaveLength(4);
    f.s.playPhase(isKoHeat, byOrder(f.ids));
    const [a1, a2] = f.groups['A'] as [string, string];
    const [b1, b2] = f.groups['B'] as [string, string];
    const [p3] = byStage(f.s.state.matches, 'thirdPlace') as [Match];
    const [fin] = byStage(f.s.state.matches, 'final') as [Match];
    // HF1 A1–B2 → A1, HF2 B1–A2 → A2 (A-Teams wurden zuerst hinzugefügt)
    expect(teamsOf(f.s.state, fin)).toEqual([a1, a2]);
    expect(teamsOf(f.s.state, p3)).toEqual([b2, b1]);
    expect(winnerOf(f.s.state, fin.id)).toBe(a1);
    expect(winnerOf(f.s.state, p3.id)).toBe(b1);
    for (const h of f.s.state.heats) expect(heatStatus(f.s.state, h.id)).toBe('finished');
  });
});

// ---------------------------------------------------------------------------
// KO-Grenze 64 Teams (N06, Nutzerentscheidung) und Platz 3 nur mit zwei echten Halbfinals (S04)
// ---------------------------------------------------------------------------

/** Wie setup, aber mit beliebig vielen Teams (eigene Namen, > 64 möglich). */
const bigSetup = (opts: { n?: number; pattern?: string; settings: SettingsPatch }): Fixture => {
  const s = new Session();
  s.one(
    { type: 'createTournament', name: 'Großturnier', settings: opts.settings },
    'TournamentCreated',
  );
  s.one({ type: 'setTableCount', tableCount: 16 }, 'TableCountSet');
  const n = opts.pattern?.length ?? opts.n ?? 0;
  const ids = Array.from(
    { length: n },
    (_, i) =>
      s.one(
        { type: 'addTeam', name: `Team ${String(i + 1).padStart(3, '0')}`, players: ['P'] },
        'TeamAdded',
      ).payload.teamId,
  );
  const groups: Record<string, string[]> = {};
  [...(opts.pattern ?? '')].forEach((g, i) => {
    const teamId = at(ids, i);
    s.one({ type: 'assignTeamToGroup', teamId, groupId: g }, 'TeamAssignedToGroup');
    (groups[g] ??= []).push(teamId);
  });
  return { s, ids, groups };
};

/** 'A'×size + 'B'×size + … für `count` Gruppen. */
const groupPattern = (count: number, size: number): string =>
  'ABCDEFGHIJKLMNOP'
    .slice(0, count)
    .split('')
    .map((g) => g.repeat(size))
    .join('');

describe('KO-Grenze 64 Teams (N06, M04, M10 – Nutzerentscheidung)', () => {
  it.each([65, 70])('N06/M04: koOnly mit %i Teams → TOO_MANY_TEAMS', (n) => {
    const { s } = bigSetup({ n, settings: { mode: 'koOnly' } });
    const r = s.decide({ type: 'startTournament' });
    if (r.ok) throw new Error('erwartet TOO_MANY_TEAMS, erhalten Ereignisse');
    expect(String(r.error.code)).toBe('TOO_MANY_TEAMS');
    expect(r.error.message.length).toBeGreaterThan(0);
  });

  it('N06/M04: koOnly mit genau 64 Teams bleibt erlaubt (Grenzfall)', () => {
    const { s } = bigSetup({ n: 64, settings: { mode: 'koOnly' } });
    const started = s.one({ type: 'startTournament' }, 'TournamentStarted');
    expect(byStage(started.payload.matches, 'ko64')).toHaveLength(32);
  });

  it('N06/M10: groupsKo, 16 Gruppen à 8, advancersPerGroup 8 → 128 KO-Teams → INVALID_ADVANCERS', () => {
    const { s } = bigSetup({
      pattern: groupPattern(16, 8),
      settings: { groupCount: 16, advancersPerGroup: 8 },
    });
    s.expectError({ type: 'startTournament' }, 'INVALID_ADVANCERS');
  });

  it('N06/M10: groupsKo, 8 Gruppen à 16, advancersPerGroup 16 → 128 KO-Teams → INVALID_ADVANCERS', () => {
    const { s } = bigSetup({
      pattern: groupPattern(8, 16),
      settings: { groupCount: 8, advancersPerGroup: 16 },
    });
    s.expectError({ type: 'startTournament' }, 'INVALID_ADVANCERS');
  });

  it.each<[number, number, number]>([
    [16, 4, 4],
    [8, 8, 8],
    [16, 8, 4],
  ])(
    'N06/M10: groupsKo, %i Gruppen à %i, advancersPerGroup %i → Gruppen × q = 64 erlaubt (Grenzfall)',
    (count, size, q) => {
      const { s } = bigSetup({
        pattern: groupPattern(count, size),
        settings: { groupCount: count as Settings['groupCount'], advancersPerGroup: q },
      });
      const started = s.one({ type: 'startTournament' }, 'TournamentStarted');
      expect(started.payload.advancersPerGroup).toBe(q);
      expect(started.payload.groups).toHaveLength(count);
    },
  );
});

describe('S04: Spiel um Platz 3 nur mit zwei echten Halbfinals (Nutzerentscheidung)', () => {
  it('S04: koOnly mit 3 Teams und thirdPlaceMatch → keine Partie und kein Durchgang thirdPlace', () => {
    const { started } = koOnlyStarted(3, { settings: { thirdPlaceMatch: true } });
    expect(started.payload.matches.some((m) => m.phase === 'thirdPlace')).toBe(false);
    expect(started.payload.heats.some((h) => h.phase === 'thirdPlace')).toBe(false);
    expect(byStage(started.payload.matches, 'semifinal').filter((m) => m.bye)).toHaveLength(1);
    expect(started.payload.heats.map((h) => h.phase)).toEqual(['semifinal', 'final']);
  });

  it('S04: koOnly mit 3 Teams und Platz 3 – Durchlauf bis zum Finale ohne Platz 3', () => {
    const { s, ids } = koOnlyStarted(3, { settings: { thirdPlaceMatch: true } });
    s.playPhase(isKoHeat, byOrder(ids));
    const [fin] = byStage(s.state.matches, 'final') as [Match];
    expect(winnerOf(s.state, fin.id)).not.toBeNull();
    for (const h of s.state.heats) expect(heatStatus(s.state, h.id)).toBe('finished');
  });

  it('S04: koOnly mit 4 Teams und Platz 3 → Platz 3 vorhanden (Gegenprobe)', () => {
    const { started } = koOnlyStarted(4, { settings: { thirdPlaceMatch: true } });
    expect(started.payload.matches.filter((m) => m.phase === 'thirdPlace')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Gleichstand ganz innerhalb der Weiterkommenden (SPEC → Tabelle, Nutzerentscheidung)
// ---------------------------------------------------------------------------

/** Ergebnisse nach Tabelle `beats` (Sieger zuerst) bzw. `draws`; alles andere nach `rest`. */
const scripted =
  (beats: [string, string][], draws: [string, string][], rest: Pick): Pick =>
  (a, b) => {
    const is = ([x, y]: [string, string]) => (a === x && b === y) || (a === y && b === x);
    const win = beats.find(is);
    if (win) return { outcome: 'win', winnerTeamId: win[0] };
    if (draws.some(is)) return { outcome: 'draw' };
    return rest(a, b);
  };

describe('M09/M10: Gleichstand innerhalb von q → kein Stechen, Setzung nach Gruppenreihenfolge', () => {
  it('M09: Gleichstand um Platz 1–2 bei q=2 → advancePhase ohne Stechen; A1 = früher hinzugefügtes Team', () => {
    const f = setup({ pattern: 'AAAABBBB' });
    const [a0, a1, a2, a3] = f.groups['A'] as [string, string, string, string];
    // a0 und a1 spielen remis und schlagen beide a2 und a3 → je 7 Punkte, direkter Vergleich remis
    const pick = scripted(
      [
        [a0, a2],
        [a0, a3],
        [a1, a2],
        [a1, a3],
        [a2, a3],
      ],
      [[a0, a1]],
      byOrder(f.ids),
    );
    f.s.one({ type: 'startTournament' }, 'TournamentStarted');
    f.s.playPhase(isGroupHeat, pick);
    const st = computeStandings(f.s.state, 'A');
    expect(st.needsPlayoff).toEqual([]);
    expect(st.rows.slice(0, 2).map((r) => [r.teamId, r.rank, r.rankReason])).toEqual([
      [a0, 1, 'tied'],
      [a1, 1, 'tied'],
    ]);
    const pa = advance(f);
    const [b0, b1] = f.groups['B'] as [string, string];
    expect(byStage(pa.payload.matches, 'semifinal').map(pairingOf)).toEqual([
      [a0, b1],
      [b0, a1],
    ]);
  });

  it('M09: Gleichstand um Platz 1–2 der später hinzugefügten Teams (a2, a3) → A1 = a2, A2 = a3', () => {
    const f = setup({ pattern: 'AAAABBBB' });
    const [a0, a1, a2, a3] = f.groups['A'] as [string, string, string, string];
    const pick = scripted(
      [
        [a2, a0],
        [a2, a1],
        [a3, a0],
        [a3, a1],
        [a0, a1],
      ],
      [[a2, a3]],
      byOrder(f.ids),
    );
    f.s.one({ type: 'startTournament' }, 'TournamentStarted');
    f.s.playPhase(isGroupHeat, pick);
    const pa = advance(f);
    const [b0, b1] = f.groups['B'] as [string, string];
    expect(byStage(pa.payload.matches, 'semifinal').map(pairingOf)).toEqual([
      [a2, b1],
      [b0, a3],
    ]);
  });

  it('M09: Kreis dreier Teams ganz innerhalb von q=4 → kein Stechen; A1/A2/A3 nach Gruppenreihenfolge', () => {
    const f = setup({ pattern: 'AAAABBBB', settings: { advancersPerGroup: 4 } });
    const [x, y, z, w] = f.groups['A'] as [string, string, string, string];
    // Kreis x > y > z > x, alle schlagen w → je 6 Punkte, Mini-Tabelle je 3
    const pick = circle([x, y, z], byOrder(f.ids));
    f.s.one({ type: 'startTournament' }, 'TournamentStarted');
    f.s.playPhase(isGroupHeat, pick);
    expect(computeStandings(f.s.state, 'A').needsPlayoff).toEqual([]);
    const pa = advance(f);
    const g = (id: string, rank: number) => at(f.groups[id] ?? [], rank - 1);
    // Setzung 2 Gruppen, q=4: A1–B4, A3–B2, B1–A4, B3–A2
    expect(byStage(pa.payload.matches, 'quarterfinal').map(pairingOf)).toEqual([
      [x, g('B', 4)],
      [z, g('B', 2)],
      [g('B', 1), w],
      [g('B', 3), y],
    ]);
  });

  it('M09: Kreis dreier Teams über die Grenze q=2 (Plätze 1–3) → PLAYOFF_REQUIRED', () => {
    const f = setup({ pattern: 'AAAABBBB' });
    const [x, y, z] = f.groups['A'] as [string, string, string];
    f.s.one({ type: 'startTournament' }, 'TournamentStarted');
    f.s.playPhase(isGroupHeat, circle([x, y, z], byOrder(f.ids)));
    f.s.expectError({ type: 'advancePhase' }, 'PLAYOFF_REQUIRED');
  });
});

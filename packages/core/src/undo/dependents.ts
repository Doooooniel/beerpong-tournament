import { STRUCTURAL_SETTINGS } from '../domain/settings.js';
import type { FindDependents, Heat, LogEntry, Match } from '../domain/types.js';
import type { DomainEvent, DomainEventType } from '../events/index.js';

const TIMER_TYPES = new Set<DomainEventType>([
  'HeatStarted',
  'TimerPaused',
  'TimerResumed',
  'TimerExtended',
  'TimerRestarted',
]);
const SETUP_TYPES = new Set<DomainEventType>([
  'TeamAdded',
  'TeamRemoved',
  'TableCountSet',
  'TeamAssignedToGroup',
  'GroupsAssigned',
]);
/** Ereignisse, die nie von anderen abhängen (ADR 026). */
const NEVER_DEPENDENT = new Set<DomainEventType>(['Undone', 'BeamerModeSet', 'BeamerViewSet']);

/** Partien, Durchgänge und Gruppen aus allen Spielplan-Ereignissen des Logs, auch aufgehobenen. */
export interface ScheduleIndex {
  creatorOf: Map<string, string>;
  matches: Map<string, Match>;
  heats: Map<string, Heat>;
  heatOfMatch: Map<string, Heat>;
  /** Unmittelbar vorheriger Durchgang in Spielreihenfolge (streng nacheinander). */
  previousHeat: Map<string, Heat>;
}

export const indexSchedule = (log: readonly LogEntry[]): ScheduleIndex => {
  const index: ScheduleIndex = {
    creatorOf: new Map(),
    matches: new Map(),
    heats: new Map(),
    heatOfMatch: new Map(),
    previousHeat: new Map(),
  };
  let last: Heat | null = null;
  for (const { event, undone } of log) {
    if (event.type !== 'TournamentStarted' && event.type !== 'PhaseAdvanced') continue;
    for (const m of event.payload.matches) {
      index.matches.set(m.id, m);
      index.creatorOf.set(m.id, event.id);
    }
    for (const h of event.payload.heats) {
      if (!undone) {
        if (last) index.previousHeat.set(h.id, last);
        last = h;
      }
      index.heats.set(h.id, h);
      index.creatorOf.set(h.id, event.id);
      for (const m of h.matchIds) index.heatOfMatch.set(m, h);
    }
    if (event.type === 'TournamentStarted') {
      for (const g of event.payload.groups) index.creatorOf.set(g.id, event.id);
    }
  }
  return index;
};

const heatIdOf = (e: DomainEvent): string | null =>
  TIMER_TYPES.has(e.type) || e.type === 'TablesSwapped'
    ? (e.payload as { heatId: string }).heatId
    : null;

const sourcesOf = (m: Match): string[] =>
  [m.a, m.b].flatMap((slot) => {
    if (slot === null || 'teamId' in slot) return [];
    return ['winnerOf' in slot ? slot.winnerOf : slot.loserOf];
  });

/** Hängt das spätere Ereignis `e` direkt vom früheren `p` ab? Regeln a–i, ADR 026. */
export const dependsOn = (e: DomainEvent, p: DomainEvent, ix: ScheduleIndex): boolean => {
  if (NEVER_DEPENDENT.has(e.type)) return false;

  // a: Team-Ereignisse hängen vom TeamAdded ab.
  if (p.type === 'TeamAdded') {
    const t = p.payload.teamId;
    if (
      (e.type === 'TeamRenamed' ||
        e.type === 'PlayersSet' ||
        e.type === 'TeamRemoved' ||
        e.type === 'TeamAssignedToGroup') &&
      e.payload.teamId === t
    )
      return true;
    if (e.type === 'GroupsAssigned' && t in e.payload.assignment) return true;
  }

  // b: Start hängt vom Setup ab.
  if (e.type === 'TournamentStarted') {
    if (SETUP_TYPES.has(p.type)) return true;
    if (p.type !== 'SettingsUpdated') return false;
    if (STRUCTURAL_SETTINGS.some((k) => p.payload.settings[k] !== undefined)) return true;
    // Nur-KO: der Start enthält den Baum, also auch das Spiel um Platz 3 (S04).
    const containsBracket = e.payload.matches.some((m) => m.phase !== 'group');
    return containsBracket && p.payload.settings.thirdPlaceMatch !== undefined;
  }

  // c: Verweise auf Durchgänge, Partien, Gruppen hängen von deren Erzeuger ab.
  const heatId = heatIdOf(e);
  if (p.type === 'TournamentStarted' || p.type === 'PhaseAdvanced') {
    if (e.type === 'PhaseAdvanced' && p.type === 'TournamentStarted') return true;
    const ref =
      heatId ??
      (e.type === 'ResultRecorded'
        ? e.payload.matchId
        : e.type === 'PlayoffRecorded'
          ? e.payload.groupId
          : null);
    if (ref !== null && ix.creatorOf.get(ref) === p.id) return true;
  }

  // d: Timer-Kette eines Durchgangs.
  if (heatId !== null && TIMER_TYPES.has(e.type) && TIMER_TYPES.has(p.type))
    return heatIdOf(p) === heatId;

  if (p.type === 'ResultRecorded') {
    const pm = ix.matches.get(p.payload.matchId);
    // e: Durchgang hängt von den Ergebnissen des vorherigen Durchgangs ab (streng nacheinander).
    if (e.type === 'HeatStarted') {
      const previous = ix.previousHeat.get(e.payload.heatId);
      if (previous?.matchIds.includes(p.payload.matchId)) return true;
      // j: KO-Durchgang hängt von den Ergebnissen der Quellpartien seiner Partien ab.
      const heat = ix.heats.get(e.payload.heatId);
      return (
        !!heat &&
        heat.matchIds.some((m) => {
          const match = ix.matches.get(m);
          return !!match && sourcesOf(match).includes(p.payload.matchId);
        })
      );
    }
    // f: KO-Baum hängt von Gruppenergebnissen ab.
    if (e.type === 'PhaseAdvanced') return pm?.phase === 'group';
    // g: Stechen hängt von den Ergebnissen der Gruppe ab.
    if (e.type === 'PlayoffRecorded') return !!pm && pm.groupId === e.payload.groupId;
    // h: KO-Ergebnis hängt von den Ergebnissen seiner Quellen ab.
    if (e.type === 'ResultRecorded') {
      const em = ix.matches.get(e.payload.matchId);
      return !!em && sourcesOf(em).includes(p.payload.matchId);
    }
  }

  if (p.type === 'PlayoffRecorded') {
    if (e.type === 'PhaseAdvanced') return true; // f
    if (e.type === 'PlayoffRecorded') return e.payload.groupId === p.payload.groupId; // g
  }

  // f: Spiel um Platz 3 bestimmt den Baum.
  if (e.type === 'PhaseAdvanced' && p.type === 'SettingsUpdated')
    return p.payload.settings.thirdPlaceMatch !== undefined;

  // i: Ergebnis nur in gestartetem Durchgang.
  if (e.type === 'ResultRecorded' && p.type === 'HeatStarted')
    return ix.heatOfMatch.get(e.payload.matchId)?.id === p.payload.heatId;

  return false;
};

export const findDependents: FindDependents = (state, targetId) => {
  const start = state.log.findIndex((entry) => entry.event.id === targetId);
  const target = state.log[start];
  if (!target || target.undone) return [];
  const ix = indexSchedule(state.log);
  const chain: DomainEvent[] = [target.event];
  const result: string[] = [];
  for (const { event, undone } of state.log.slice(start + 1)) {
    if (undone || NEVER_DEPENDENT.has(event.type)) continue;
    if (chain.some((p) => dependsOn(event, p, ix))) {
      chain.push(event);
      result.push(event.id);
    }
  }
  return result;
};

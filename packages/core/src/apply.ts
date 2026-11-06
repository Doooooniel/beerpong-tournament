import { groupIds, mergeSettings } from './domain/settings.js';
import type { Apply, LogEntry, MatchResult, Team, TournamentState } from './domain/types.js';
import { DEFAULT_SETTINGS } from './domain/settings.js';
import type { DomainEvent } from './events/index.js';
import { markUndone } from './undo/effective.js';

export const initialState = (): TournamentState => ({
  version: 0,
  name: '',
  createdAt: null,
  settings: mergeSettings(DEFAULT_SETTINGS, {}),
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

const updateTeam = (teams: Team[], teamId: string, change: Partial<Team>): Team[] =>
  teams.map((t) => (t.id === teamId ? { ...t, ...change } : t));

const withoutKey = <V>(record: Record<string, V>, key: string): Record<string, V> =>
  Object.fromEntries(Object.entries(record).filter(([k]) => k !== key));

/** Fachliche Wirkung eines wirksamen Ereignisses (ohne log/version). */
const reduce = (s: TournamentState, e: DomainEvent): TournamentState => {
  switch (e.type) {
    case 'TournamentCreated':
      return {
        ...s,
        name: e.payload.name,
        createdAt: e.at,
        settings: mergeSettings(e.payload.settings, {}),
      };
    case 'SettingsUpdated': {
      const settings = mergeSettings(s.settings, e.payload.settings);
      const valid = new Set(groupIds(settings.groupCount));
      const groupAssignment = Object.fromEntries(
        Object.entries(s.groupAssignment).filter(([, g]) => valid.has(g)),
      );
      return { ...s, settings, groupAssignment };
    }
    case 'TeamAdded':
      return {
        ...s,
        teams: [
          ...s.teams,
          { id: e.payload.teamId, name: e.payload.name, players: e.payload.players },
        ],
      };
    case 'TeamRenamed':
      return { ...s, teams: updateTeam(s.teams, e.payload.teamId, { name: e.payload.name }) };
    case 'PlayersSet':
      return { ...s, teams: updateTeam(s.teams, e.payload.teamId, { players: e.payload.players }) };
    case 'TeamRemoved':
      return {
        ...s,
        teams: s.teams.filter((t) => t.id !== e.payload.teamId),
        groupAssignment: withoutKey(s.groupAssignment, e.payload.teamId),
      };
    case 'TableCountSet':
      return { ...s, tableCount: e.payload.tableCount };
    case 'TeamAssignedToGroup': {
      const { teamId, groupId } = e.payload;
      // Nach einem Undo von groupCount kann die Gruppe fehlen; dann gilt das Team als nicht zugeteilt.
      const exists = groupId !== null && groupIds(s.settings.groupCount).includes(groupId);
      return {
        ...s,
        groupAssignment: exists
          ? { ...s.groupAssignment, [teamId]: groupId }
          : withoutKey(s.groupAssignment, teamId),
      };
    }
    case 'GroupsAssigned': {
      const valid = new Set(groupIds(s.settings.groupCount));
      const assignment = Object.entries(e.payload.assignment).filter(([, g]) => valid.has(g));
      return { ...s, groupAssignment: Object.fromEntries(assignment) };
    }
    case 'TournamentStarted':
      return {
        ...s,
        phase: s.settings.mode === 'koOnly' ? 'knockout' : 'groups',
        groups: e.payload.groups,
        advancersPerGroup: e.payload.advancersPerGroup,
        matches: e.payload.matches,
        heats: e.payload.heats,
      };
    case 'PhaseAdvanced':
      return {
        ...s,
        phase: 'knockout',
        matches: [...s.matches, ...e.payload.matches],
        heats: [...s.heats, ...e.payload.heats],
      };
    case 'TablesSwapped': {
      const { heatId, tableA, tableB } = e.payload;
      const heats = s.heats.map((h) => {
        const a = h.matchIds[tableA - 1];
        const b = h.matchIds[tableB - 1];
        if (h.id !== heatId || a === undefined || b === undefined) return h;
        const matchIds = [...h.matchIds];
        matchIds[tableA - 1] = b;
        matchIds[tableB - 1] = a;
        return { ...h, matchIds };
      });
      return { ...s, heats };
    }
    case 'HeatStarted': {
      const { heatId, durationMs } = e.payload;
      const timer = { durationMs, startedAt: e.at, pausedAt: null, pausedTotalMs: 0 };
      return { ...s, timers: { ...s.timers, [heatId]: timer } };
    }
    case 'TimerPaused': {
      const t = s.timers[e.payload.heatId];
      if (!t || t.pausedAt !== null) return s;
      return {
        ...s,
        timers: { ...s.timers, [e.payload.heatId]: { ...t, pausedAt: e.at } },
      };
    }
    case 'TimerResumed': {
      const t = s.timers[e.payload.heatId];
      if (!t || t.pausedAt === null) return s;
      const resumed = {
        ...t,
        pausedAt: null,
        pausedTotalMs: t.pausedTotalMs + (e.at - t.pausedAt),
      };
      return { ...s, timers: { ...s.timers, [e.payload.heatId]: resumed } };
    }
    case 'TimerExtended': {
      const t = s.timers[e.payload.heatId];
      if (!t || t.durationMs === null) return s;
      const extended = { ...t, durationMs: t.durationMs + e.payload.byMs };
      return { ...s, timers: { ...s.timers, [e.payload.heatId]: extended } };
    }
    case 'TimerRestarted': {
      const t = s.timers[e.payload.heatId];
      if (!t) return s;
      const restarted = { ...t, startedAt: e.at, pausedAt: null, pausedTotalMs: 0 };
      return { ...s, timers: { ...s.timers, [e.payload.heatId]: restarted } };
    }
    case 'ResultRecorded': {
      const { matchId, outcome, winnerTeamId, cups } = e.payload;
      const result: MatchResult = { outcome };
      if (winnerTeamId !== undefined) result.winnerTeamId = winnerTeamId;
      if (cups !== undefined) result.cups = { ...cups };
      return { ...s, results: { ...s.results, [matchId]: result } };
    }
    case 'PlayoffRecorded':
      return { ...s, playoffs: [...s.playoffs, { ...e.payload }] };
    case 'BeamerModeSet':
      return { ...s, beamer: { ...s.beamer, mode: e.payload.mode } };
    case 'BeamerViewSet':
      return { ...s, beamer: { ...s.beamer, view: e.payload.view } };
    case 'Undone':
      return s;
  }
};

/** Fachlichen Zustand aus dem Log neu aufbauen; aufgehobene Ereignisse wirken nicht. */
export const rebuild = (log: LogEntry[]): TournamentState => {
  const flagged = markUndone(log.map((entry) => entry.event));
  const domain = flagged.reduce(
    (s, entry) => (entry.undone ? s : reduce(s, entry.event)),
    initialState(),
  );
  return { ...domain, version: log.at(-1)?.event.seq ?? 0, log: flagged };
};

export const apply: Apply = (state, event) => {
  if (event.type === 'Undone') return rebuild([...state.log, { event, undone: false }]);
  return {
    ...reduce(state, event),
    version: event.seq,
    log: [...state.log, { event, undone: false }],
  };
};

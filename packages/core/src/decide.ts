import type { CommandOf } from './commands/index.js';
import { domainError, type DomainError, type DomainErrorCode } from './domain/errors.js';
import {
  DEFAULT_SETTINGS,
  groupIds,
  mergeSettings,
  STRUCTURAL_SETTINGS,
} from './domain/settings.js';
import type { Decide, DecideContext, LogEntry, Team, TournamentState } from './domain/types.js';
import type { DomainEventType, EventOf, NewEvent } from './events/index.js';
import { apply } from './apply.js';
import { err, ok, type Result } from './result.js';
import { dependsOn, findDependents, indexSchedule } from './undo/dependents.js';

type Decision = Result<NewEvent[], DomainError>;

const fail = (code: DomainErrorCode, message: string, dependents?: string[]): Decision =>
  err(domainError(code, message, dependents));

const event = <T extends Exclude<DomainEventType, 'Undone'>>(
  ctx: DecideContext,
  type: T,
  payload: EventOf<T>['payload'],
): Decision => ok([{ id: ctx.newId(), type, v: 1, at: ctx.now, payload } as NewEvent]);

const normalize = (name: string): string => name.trim().toLowerCase();

const nameTaken = (teams: Team[], name: string, exceptId?: string): boolean =>
  teams.some((t) => t.id !== exceptId && normalize(t.name) === normalize(name));

const findTeam = (state: TournamentState, teamId: string): Team | undefined =>
  state.teams.find((t) => t.id === teamId);

const isUndoable = (entry: LogEntry): boolean =>
  !entry.undone &&
  entry.event.type !== 'Undone' &&
  entry.event.type !== 'BeamerModeSet' &&
  entry.event.type !== 'BeamerViewSet';

const notStarted = (state: TournamentState): Decision | null =>
  state.phase === 'setup'
    ? null
    : fail('TOURNAMENT_ALREADY_STARTED', 'Not allowed after the tournament has started.');

const updateSettings = (
  state: TournamentState,
  cmd: CommandOf<'updateSettings'>,
  ctx: DecideContext,
): Decision => {
  const patch = cmd.settings;
  const locked = [
    ...(state.phase === 'setup' ? [] : STRUCTURAL_SETTINGS),
    ...(state.phase === 'knockout' ? (['thirdPlaceMatch'] as const) : []),
  ].filter((key) => patch[key] !== undefined);
  if (locked.length > 0) return fail('SETTING_LOCKED', `Locked settings: ${locked.join(', ')}.`);
  const { timerByPhase, ...rest } = patch;
  const empty =
    Object.values(rest).every((v) => v === undefined) &&
    Object.values(timerByPhase ?? {}).every((v) => v === undefined);
  // Leerer Patch: kein Ereignis, damit das Protokoll keine leeren Einträge bekommt (M20).
  if (empty) return ok([]);
  return event(ctx, 'SettingsUpdated', { settings: patch });
};

const assignTeamToGroup = (
  state: TournamentState,
  cmd: CommandOf<'assignTeamToGroup'>,
  ctx: DecideContext,
): Decision => {
  if (!findTeam(state, cmd.teamId)) return fail('TEAM_NOT_FOUND', 'Unknown team.');
  if (cmd.groupId !== null) {
    const known =
      state.settings.mode === 'groupsKo' &&
      groupIds(state.settings.groupCount).includes(cmd.groupId);
    if (!known) return fail('GROUP_NOT_FOUND', 'Unknown group.');
  }
  return event(ctx, 'TeamAssignedToGroup', { teamId: cmd.teamId, groupId: cmd.groupId });
};

/** Redo (ADR 026-5): keine neueren Aktionen, keine weiterhin aufgehobene Grundlage. */
const redo = (state: TournamentState, index: number, ctx: DecideContext): Decision => {
  const target = state.log[index]?.event;
  if (target?.type !== 'Undone') return fail('EVENT_NOT_FOUND', 'Unknown event.');
  if (state.log.slice(index + 1).some(isUndoable))
    return fail('REDO_NOT_POSSIBLE', 'Newer actions exist.');
  const restored = new Set([target.undoes, ...target.payload.cascade]);
  const ix = indexSchedule(state.log);
  const restoredEvents = state.log.filter((l) => restored.has(l.event.id)).map((l) => l.event);
  const missingBasis = state.log.some(
    (l) =>
      l.undone &&
      l.event.type !== 'Undone' &&
      !restored.has(l.event.id) &&
      restoredEvents.some((r) => r.seq > l.event.seq && dependsOn(r, l.event, ix)),
  );
  if (missingBasis) return fail('REDO_NOT_POSSIBLE', 'A required event is still undone.');
  return undone(state, ctx, target.id, []);
};

const hasDuplicateNames = (teams: Team[]): boolean =>
  new Set(teams.map((t) => normalize(t.name))).size !== teams.length;

/** Undone erzeugen; Undo/Redo darf keine doppelten Teamnamen hinterlassen (M03). */
const undone = (
  state: TournamentState,
  ctx: DecideContext,
  undoes: string,
  cascade: string[],
): Decision => {
  const e: NewEvent = {
    id: ctx.newId(),
    type: 'Undone',
    v: 1,
    at: ctx.now,
    undoes,
    payload: { cascade },
  };
  const after = apply(state, { ...e, seq: state.version + 1 });
  if (hasDuplicateNames(after.teams))
    return fail('TEAM_NAME_TAKEN', 'Undoing this would create a duplicate team name.');
  return ok([e]);
};

const undoEvent = (
  state: TournamentState,
  eventId: string,
  confirm: boolean,
  ctx: DecideContext,
): Decision => {
  const index = state.log.findIndex((l) => l.event.id === eventId);
  const entry = state.log[index];
  if (!entry) return fail('EVENT_NOT_FOUND', 'Unknown event.');
  if (entry.undone) return fail('NOTHING_TO_UNDO', 'Event is already undone.');
  if (entry.event.type === 'TournamentCreated')
    return fail('CANNOT_UNDO_CREATION', 'The tournament itself cannot be undone.');
  if (entry.event.type === 'Undone') return redo(state, index, ctx);
  const dependents = findDependents(state, eventId);
  const decision = undone(state, ctx, eventId, dependents);
  if (decision.ok && dependents.length > 0 && !confirm)
    return fail('UNDO_HAS_DEPENDENTS', 'Later events depend on this event.', dependents);
  return decision;
};

export const decide: Decide = (state, command, ctx) => {
  if (command.type === 'createTournament') {
    if (state.created) return fail('TOURNAMENT_ALREADY_CREATED', 'Tournament already exists.');
    return event(ctx, 'TournamentCreated', {
      name: command.name.trim(),
      settings: mergeSettings(DEFAULT_SETTINGS, command.settings ?? {}),
    });
  }
  if (!state.created) return fail('TOURNAMENT_NOT_CREATED', 'Create the tournament first.');

  switch (command.type) {
    case 'updateSettings':
      return updateSettings(state, command, ctx);
    case 'addTeam': {
      const name = command.name.trim();
      const blocked = notStarted(state);
      if (blocked) return blocked;
      if (nameTaken(state.teams, name)) return fail('TEAM_NAME_TAKEN', 'Team name already used.');
      return event(ctx, 'TeamAdded', {
        teamId: ctx.newId(),
        name,
        players: command.players.map((p) => p.trim()),
      });
    }
    case 'renameTeam': {
      const name = command.name.trim();
      if (!findTeam(state, command.teamId)) return fail('TEAM_NOT_FOUND', 'Unknown team.');
      if (nameTaken(state.teams, name, command.teamId))
        return fail('TEAM_NAME_TAKEN', 'Team name already used.');
      return event(ctx, 'TeamRenamed', { teamId: command.teamId, name });
    }
    case 'setPlayers':
      if (!findTeam(state, command.teamId)) return fail('TEAM_NOT_FOUND', 'Unknown team.');
      return event(ctx, 'PlayersSet', {
        teamId: command.teamId,
        players: command.players.map((p) => p.trim()),
      });
    case 'removeTeam':
      return (
        notStarted(state) ??
        (findTeam(state, command.teamId)
          ? event(ctx, 'TeamRemoved', { teamId: command.teamId })
          : fail('TEAM_NOT_FOUND', 'Unknown team.'))
      );
    case 'setTableCount':
      return notStarted(state) ?? event(ctx, 'TableCountSet', { tableCount: command.tableCount });
    case 'assignTeamToGroup':
      return notStarted(state) ?? assignTeamToGroup(state, command, ctx);
    case 'setBeamerMode':
      return event(ctx, 'BeamerModeSet', { mode: command.mode });
    case 'setBeamerView':
      return event(ctx, 'BeamerViewSet', { view: command.view });
    case 'undo': {
      const last = state.log.findLast(isUndoable);
      if (!last || last.event.type === 'TournamentCreated')
        return fail('NOTHING_TO_UNDO', 'Nothing to undo.');
      return undoEvent(state, last.event.id, command.confirm === true, ctx);
    }
    case 'undoEvent':
      return undoEvent(state, command.eventId, command.confirm === true, ctx);
    case 'randomizeGroups':
      return notStarted(state) ?? fail('NOT_IMPLEMENTED', 'Comes with M3.');
    case 'startTournament':
    case 'advancePhase':
    case 'swapTables':
    case 'startHeat':
    case 'pauseTimer':
    case 'resumeTimer':
    case 'extendTimer':
    case 'restartTimer':
    case 'recordResult':
    case 'recordPlayoff':
      return fail('NOT_IMPLEMENTED', 'Comes with M3.');
  }
};

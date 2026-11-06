import { z } from 'zod';
import {
  BeamerModeSchema,
  BeamerViewSchema,
  CupsSchema,
  IdSchema,
  NameSchema,
  OutcomeSchema,
  PlayersSchema,
} from '../domain/schemas.js';
import { SettingsPatchSchema } from '../domain/settings.js';

const command = <T extends string, S extends z.ZodRawShape>(type: T, shape: S) =>
  z.object({ type: z.literal(type), ...shape }).strict();

const heat = { heatId: IdSchema };
const table = z.number().int().positive();
/** Bei UNDO_HAS_DEPENDENTS muss der Admin mit `confirm: true` bestätigen (M19). */
const confirm = { confirm: z.boolean().optional() };

// Turnier
export const CreateTournamentSchema = command('createTournament', {
  name: NameSchema,
  settings: SettingsPatchSchema.optional(),
});
export const UpdateSettingsSchema = command('updateSettings', { settings: SettingsPatchSchema });
export const SetTableCountSchema = command('setTableCount', { tableCount: table });
export const StartTournamentSchema = command('startTournament', {});
export const AdvancePhaseSchema = command('advancePhase', {});

// Teams und Gruppen
export const AddTeamSchema = command('addTeam', { name: NameSchema, players: PlayersSchema });
export const RenameTeamSchema = command('renameTeam', { teamId: IdSchema, name: NameSchema });
export const SetPlayersSchema = command('setPlayers', { teamId: IdSchema, players: PlayersSchema });
export const RemoveTeamSchema = command('removeTeam', { teamId: IdSchema });
export const AssignTeamToGroupSchema = command('assignTeamToGroup', {
  teamId: IdSchema,
  groupId: IdSchema.nullable(),
});
export const RandomizeGroupsSchema = command('randomizeGroups', {});

// Durchgänge und Timer
export const SwapTablesSchema = command('swapTables', { ...heat, tableA: table, tableB: table });
export const StartHeatSchema = command('startHeat', heat);
export const PauseTimerSchema = command('pauseTimer', heat);
export const ResumeTimerSchema = command('resumeTimer', heat);
export const ExtendTimerSchema = command('extendTimer', {
  ...heat,
  byMs: z.number().int().positive(),
});
export const RestartTimerSchema = command('restartTimer', heat);

// Ergebnisse
export const RecordResultSchema = command('recordResult', {
  matchId: IdSchema,
  outcome: OutcomeSchema,
  winnerTeamId: IdSchema.optional(),
  cups: CupsSchema.optional(),
});
export const RecordPlayoffSchema = command('recordPlayoff', {
  groupId: IdSchema,
  tiedTeamIds: z.array(IdSchema).min(2),
  winnerTeamId: IdSchema,
});

// Beamer
export const SetBeamerModeSchema = command('setBeamerMode', { mode: BeamerModeSchema });
export const SetBeamerViewSchema = command('setBeamerView', { view: BeamerViewSchema });

// Rückgängig (ADR 026)
export const UndoSchema = command('undo', confirm);
export const UndoEventSchema = command('undoEvent', { eventId: IdSchema, ...confirm });

export const CommandSchema = z.discriminatedUnion('type', [
  CreateTournamentSchema,
  UpdateSettingsSchema,
  AddTeamSchema,
  RenameTeamSchema,
  SetPlayersSchema,
  RemoveTeamSchema,
  SetTableCountSchema,
  AssignTeamToGroupSchema,
  RandomizeGroupsSchema,
  StartTournamentSchema,
  AdvancePhaseSchema,
  SwapTablesSchema,
  StartHeatSchema,
  PauseTimerSchema,
  ResumeTimerSchema,
  ExtendTimerSchema,
  RestartTimerSchema,
  RecordResultSchema,
  RecordPlayoffSchema,
  SetBeamerModeSchema,
  SetBeamerViewSchema,
  UndoSchema,
  UndoEventSchema,
]);

export type Command = z.infer<typeof CommandSchema>;
export type CommandType = Command['type'];
export type CommandOf<T extends CommandType> = Extract<Command, { type: T }>;

export type CreateTournament = z.infer<typeof CreateTournamentSchema>;
export type UpdateSettings = z.infer<typeof UpdateSettingsSchema>;
export type SetTableCount = z.infer<typeof SetTableCountSchema>;
export type StartTournament = z.infer<typeof StartTournamentSchema>;
export type AdvancePhase = z.infer<typeof AdvancePhaseSchema>;
export type AddTeam = z.infer<typeof AddTeamSchema>;
export type RenameTeam = z.infer<typeof RenameTeamSchema>;
export type SetPlayers = z.infer<typeof SetPlayersSchema>;
export type RemoveTeam = z.infer<typeof RemoveTeamSchema>;
export type AssignTeamToGroup = z.infer<typeof AssignTeamToGroupSchema>;
export type RandomizeGroups = z.infer<typeof RandomizeGroupsSchema>;
export type SwapTables = z.infer<typeof SwapTablesSchema>;
export type StartHeat = z.infer<typeof StartHeatSchema>;
export type PauseTimer = z.infer<typeof PauseTimerSchema>;
export type ResumeTimer = z.infer<typeof ResumeTimerSchema>;
export type ExtendTimer = z.infer<typeof ExtendTimerSchema>;
export type RestartTimer = z.infer<typeof RestartTimerSchema>;
export type RecordResult = z.infer<typeof RecordResultSchema>;
export type RecordPlayoff = z.infer<typeof RecordPlayoffSchema>;
export type SetBeamerMode = z.infer<typeof SetBeamerModeSchema>;
export type SetBeamerView = z.infer<typeof SetBeamerViewSchema>;
export type Undo = z.infer<typeof UndoSchema>;
export type UndoEvent = z.infer<typeof UndoEventSchema>;

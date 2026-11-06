import type { z } from 'zod';
import type { Command } from '../commands/index.js';
import type { DomainEvent, NewEvent } from '../events/index.js';
import type { Result } from '../result.js';
import type { DomainError } from './errors.js';
import type {
  BeamerModeSchema,
  BeamerViewSchema,
  CupsSchema,
  GroupSchema,
  HeatSchema,
  KoStageSchema,
  MatchSchema,
  OutcomeSchema,
  PhaseSchema,
  SlotSchema,
} from './schemas.js';
import type { Settings } from './settings.js';

export type TeamId = string;
export type GroupId = string;
export type MatchId = string;
export type HeatId = string;
export type EventId = string;

export type Phase = z.infer<typeof PhaseSchema>;
export type KoStage = z.infer<typeof KoStageSchema>;
export type Slot = z.infer<typeof SlotSchema>;
export type Match = z.infer<typeof MatchSchema>;
export type Heat = z.infer<typeof HeatSchema>;
export type Group = z.infer<typeof GroupSchema>;
export type Cups = z.infer<typeof CupsSchema>;
export type Outcome = z.infer<typeof OutcomeSchema>;
export type BeamerMode = z.infer<typeof BeamerModeSchema>;
export type BeamerView = z.infer<typeof BeamerViewSchema>;

export interface Team {
  id: TeamId;
  name: string;
  players: string[];
}

/** Architekturregel 6: nur diese Werte; Restzeit rechnet der Client. */
export interface Timer {
  durationMs: number | null;
  startedAt: number;
  pausedAt: number | null;
  pausedTotalMs: number;
}

export interface MatchResult {
  outcome: Outcome;
  winnerTeamId?: TeamId;
  cups?: Cups;
}

export interface Playoff {
  groupId: GroupId;
  tiedTeamIds: TeamId[];
  winnerTeamId: TeamId;
}

/** Abgeleitet: setup vor TournamentStarted, groups bis PhaseAdvanced, danach knockout. */
export type TournamentPhase = 'setup' | 'groups' | 'knockout';

export interface LogEntry {
  event: DomainEvent;
  /** Durch ein wirksames Undone aufgehoben (ADR 026). */
  undone: boolean;
}

export interface TournamentState {
  /** seq des letzten Ereignisses, 0 vor dem ersten (ADR 020). */
  version: number;
  created: boolean;
  name: string;
  createdAt: number | null;
  settings: Settings;
  tableCount: number;
  phase: TournamentPhase;
  /** In Reihenfolge des Hinzufügens. */
  teams: Team[];
  /** Gruppenzuteilung vor dem Start; fehlender Eintrag = nicht zugeteilt. */
  groupAssignment: Record<TeamId, GroupId>;
  /** Ab Start: Gruppen aus TournamentStarted. */
  groups: Group[];
  advancersPerGroup: number | null;
  matches: Match[];
  /** Tisch = Position in `matchIds` + 1; TablesSwapped ordnet um. */
  heats: Heat[];
  timers: Record<HeatId, Timer>;
  results: Record<MatchId, MatchResult>;
  playoffs: Playoff[];
  beamer: { mode: BeamerMode; view: BeamerView };
  /** Alle Ereignisse in seq-Reihenfolge, auch aufgehobene (Protokoll M20, ADR 026). */
  log: LogEntry[];
}

/** Nichtdeterministisches vom Server (Architekturregel 4). */
export interface DecideContext {
  now: number;
  /** Gleichverteilt in [0, 1). */
  random: () => number;
  newId: () => string;
}

export type Decide = (
  state: TournamentState,
  command: Command,
  ctx: DecideContext,
) => Result<NewEvent[], DomainError>;

export type Apply = (state: TournamentState, event: DomainEvent) => TournamentState;

export type Replay = (events: readonly DomainEvent[]) => TournamentState;

/**
 * IDs aller späteren wirksamen Ereignisse, die (transitiv) vom Ziel abhängen, in seq-Reihenfolge.
 * Undone- und Beamer-Ereignisse sind nie abhängig.
 */
export type FindDependents = (state: TournamentState, targetId: EventId) => EventId[];

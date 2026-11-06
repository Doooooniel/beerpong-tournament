import { z } from 'zod';
import { BeamerModeSetSchema, BeamerViewSetSchema } from './beamer.js';
import {
  HeatStartedSchema,
  TablesSwappedSchema,
  TimerExtendedSchema,
  TimerPausedSchema,
  TimerRestartedSchema,
  TimerResumedSchema,
} from './heat.js';
import { PlayoffRecordedSchema, ResultRecordedSchema } from './result.js';
import {
  GroupsAssignedSchema,
  PlayersSetSchema,
  TeamAddedSchema,
  TeamAssignedToGroupSchema,
  TeamRemovedSchema,
  TeamRenamedSchema,
} from './team.js';
import {
  PhaseAdvancedSchema,
  SettingsUpdatedSchema,
  TableCountSetSchema,
  TournamentCreatedSchema,
  TournamentStartedSchema,
} from './tournament.js';
import { UndoneSchema } from './undone.js';

export * from './beamer.js';
export * from './heat.js';
export * from './result.js';
export * from './team.js';
export * from './tournament.js';
export * from './undone.js';

export const DomainEventSchema = z.discriminatedUnion('type', [
  TournamentCreatedSchema,
  SettingsUpdatedSchema,
  TeamAddedSchema,
  TeamRenamedSchema,
  PlayersSetSchema,
  TeamRemovedSchema,
  TableCountSetSchema,
  TeamAssignedToGroupSchema,
  GroupsAssignedSchema,
  TournamentStartedSchema,
  TablesSwappedSchema,
  HeatStartedSchema,
  TimerPausedSchema,
  TimerResumedSchema,
  TimerExtendedSchema,
  TimerRestartedSchema,
  ResultRecordedSchema,
  PlayoffRecordedSchema,
  PhaseAdvancedSchema,
  BeamerModeSetSchema,
  BeamerViewSetSchema,
  UndoneSchema,
]);

export type DomainEvent = z.infer<typeof DomainEventSchema>;
export type DomainEventType = DomainEvent['type'];
export type EventOf<T extends DomainEventType> = Extract<DomainEvent, { type: T }>;

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** Von decide erzeugtes Ereignis; `seq` vergibt der Ereignisspeicher beim Anhängen. */
export type NewEvent = DistributiveOmit<DomainEvent, 'seq'>;

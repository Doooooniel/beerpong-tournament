import { z } from 'zod';
import { IdSchema, NameSchema, PlayersSchema } from '../domain/schemas.js';
import { eventSchema } from './envelope.js';

export const TeamAddedSchema = eventSchema(
  'TeamAdded',
  1,
  z.object({ teamId: IdSchema, name: NameSchema, players: PlayersSchema }).strict(),
);

export const TeamRenamedSchema = eventSchema(
  'TeamRenamed',
  1,
  z.object({ teamId: IdSchema, name: NameSchema }).strict(),
);

export const PlayersSetSchema = eventSchema(
  'PlayersSet',
  1,
  z.object({ teamId: IdSchema, players: PlayersSchema }).strict(),
);

export const TeamRemovedSchema = eventSchema(
  'TeamRemoved',
  1,
  z.object({ teamId: IdSchema }).strict(),
);

export const TeamAssignedToGroupSchema = eventSchema(
  'TeamAssignedToGroup',
  1,
  z.object({ teamId: IdSchema, groupId: IdSchema.nullable() }).strict(),
);

/** Ergebnis von randomizeGroups; der Zufall steckt als Wert im Ereignis (ADR 021). */
export const GroupsAssignedSchema = eventSchema(
  'GroupsAssigned',
  1,
  z.object({ assignment: z.record(IdSchema, IdSchema) }).strict(),
);

export type TeamAdded = z.infer<typeof TeamAddedSchema>;
export type TeamRenamed = z.infer<typeof TeamRenamedSchema>;
export type PlayersSet = z.infer<typeof PlayersSetSchema>;
export type TeamRemoved = z.infer<typeof TeamRemovedSchema>;
export type TeamAssignedToGroup = z.infer<typeof TeamAssignedToGroupSchema>;
export type GroupsAssigned = z.infer<typeof GroupsAssignedSchema>;

import { z } from 'zod';
import { CupsSchema, IdSchema, OutcomeSchema } from '../domain/schemas.js';
import { eventSchema } from './envelope.js';

/** SPEC → Ergebnis-Payload. Fachliche Prüfung (winner/cups/draw im KO) in decide. */
export const ResultRecordedSchema = eventSchema(
  'ResultRecorded',
  1,
  z
    .object({
      matchId: IdSchema,
      outcome: OutcomeSchema,
      winnerTeamId: IdSchema.optional(),
      cups: CupsSchema.optional(),
    })
    .strict(),
);

/** SPEC → Stechen. */
export const PlayoffRecordedSchema = eventSchema(
  'PlayoffRecorded',
  1,
  z
    .object({
      groupId: IdSchema,
      tiedTeamIds: z.array(IdSchema).min(2),
      winnerTeamId: IdSchema,
    })
    .strict(),
);

export type ResultRecorded = z.infer<typeof ResultRecordedSchema>;
export type PlayoffRecorded = z.infer<typeof PlayoffRecordedSchema>;

import { z } from 'zod';
import { IdSchema } from '../domain/schemas.js';
import { eventSchema } from './envelope.js';

const heat = { heatId: IdSchema };
const timestamp = z.number().int().nonnegative();
const table = z.number().int().positive();

export const TablesSwappedSchema = eventSchema(
  'TablesSwapped',
  1,
  z.object({ ...heat, tableA: table, tableB: table }).strict(),
);

/** Timer-Werte nach Architekturregel 6; `durationMs: null` = ohne Zeitlimit. */
export const HeatStartedSchema = eventSchema(
  'HeatStarted',
  1,
  z
    .object({ ...heat, durationMs: z.number().int().positive().nullable(), startedAt: timestamp })
    .strict(),
);

export const TimerPausedSchema = eventSchema(
  'TimerPaused',
  1,
  z.object({ ...heat, pausedAt: timestamp }).strict(),
);

export const TimerResumedSchema = eventSchema(
  'TimerResumed',
  1,
  z.object({ ...heat, resumedAt: timestamp }).strict(),
);

export const TimerExtendedSchema = eventSchema(
  'TimerExtended',
  1,
  z.object({ ...heat, byMs: z.number().int().positive() }).strict(),
);

export const TimerRestartedSchema = eventSchema(
  'TimerRestarted',
  1,
  z.object({ ...heat, startedAt: timestamp }).strict(),
);

export type TablesSwapped = z.infer<typeof TablesSwappedSchema>;
export type HeatStarted = z.infer<typeof HeatStartedSchema>;
export type TimerPaused = z.infer<typeof TimerPausedSchema>;
export type TimerResumed = z.infer<typeof TimerResumedSchema>;
export type TimerExtended = z.infer<typeof TimerExtendedSchema>;
export type TimerRestarted = z.infer<typeof TimerRestartedSchema>;

import { z } from 'zod';
import { IdSchema } from '../domain/schemas.js';

const envelope = {
  id: IdSchema,
  seq: z.number().int().positive(),
  at: z.number().int().nonnegative(),
};

/** Ereignis-Schema `{ id, seq, type, v, at, payload }` (ARCHITECTURE → Ereignisse). */
export const eventSchema = <T extends string, V extends number, P extends z.ZodType>(
  type: T,
  v: V,
  payload: P,
) => z.object({ ...envelope, type: z.literal(type), v: z.literal(v), payload }).strict();

/** Wie eventSchema, zusätzlich Pflichtfeld `undoes` (nur Undone). */
export const undoingEventSchema = <T extends string, V extends number, P extends z.ZodType>(
  type: T,
  v: V,
  payload: P,
) =>
  z
    .object({ ...envelope, type: z.literal(type), v: z.literal(v), payload, undoes: IdSchema })
    .strict();

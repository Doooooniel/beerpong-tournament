import { z } from 'zod';
import { IdSchema } from '../domain/schemas.js';
import { undoingEventSchema } from './envelope.js';

/**
 * Hebt `undoes` und alle IDs in `cascade` gemeinsam auf (ADR 026).
 * Zielt `undoes` auf ein Undone, werden dessen Ereignisse wiederhergestellt (Redo).
 */
export const UndoneSchema = undoingEventSchema(
  'Undone',
  1,
  z.object({ cascade: z.array(IdSchema) }).strict(),
);

export type Undone = z.infer<typeof UndoneSchema>;

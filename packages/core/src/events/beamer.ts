import { z } from 'zod';
import { BeamerModeSchema, BeamerViewSchema } from '../domain/schemas.js';
import { eventSchema } from './envelope.js';

export const BeamerModeSetSchema = eventSchema(
  'BeamerModeSet',
  1,
  z.object({ mode: BeamerModeSchema }).strict(),
);

export const BeamerViewSetSchema = eventSchema(
  'BeamerViewSet',
  1,
  z.object({ view: BeamerViewSchema }).strict(),
);

export type BeamerModeSet = z.infer<typeof BeamerModeSetSchema>;
export type BeamerViewSet = z.infer<typeof BeamerViewSetSchema>;

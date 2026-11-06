import { z } from 'zod';
import { GroupSchema, HeatSchema, MatchSchema, NameSchema } from '../domain/schemas.js';
import { SettingsPatchSchema, SettingsSchema } from '../domain/settings.js';
import { eventSchema } from './envelope.js';

export const TournamentCreatedSchema = eventSchema(
  'TournamentCreated',
  1,
  z.object({ name: NameSchema, settings: SettingsSchema }).strict(),
);

/** Enthält nur die geänderten Felder. */
export const SettingsUpdatedSchema = eventSchema(
  'SettingsUpdated',
  1,
  z.object({ settings: SettingsPatchSchema }).strict(),
);

export const TableCountSetSchema = eventSchema(
  'TableCountSet',
  1,
  z.object({ tableCount: z.number().int().positive() }).strict(),
);

/** Spielplan der ersten Phase (Gruppen bzw. KO-Baum bei Nur-KO), inkl. Freilosen. */
export const TournamentStartedSchema = eventSchema(
  'TournamentStarted',
  1,
  z
    .object({
      groups: z.array(GroupSchema),
      advancersPerGroup: z.number().int().positive().nullable(),
      matches: z.array(MatchSchema),
      heats: z.array(HeatSchema),
    })
    .strict(),
);

/** Vollständiger KO-Baum aller Stufen (ADR 025). */
export const PhaseAdvancedSchema = eventSchema(
  'PhaseAdvanced',
  1,
  z.object({ matches: z.array(MatchSchema), heats: z.array(HeatSchema) }).strict(),
);

export type TournamentCreated = z.infer<typeof TournamentCreatedSchema>;
export type SettingsUpdated = z.infer<typeof SettingsUpdatedSchema>;
export type TableCountSet = z.infer<typeof TableCountSetSchema>;
export type TournamentStarted = z.infer<typeof TournamentStartedSchema>;
export type PhaseAdvanced = z.infer<typeof PhaseAdvancedSchema>;

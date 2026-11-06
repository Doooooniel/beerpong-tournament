import { z } from 'zod';

const durationMs = z.number().int().positive();

export const TimerByPhaseSchema = z
  .object({
    group: durationMs.nullable(),
    ko64: durationMs.nullable(),
    ko32: durationMs.nullable(),
    ko16: durationMs.nullable(),
    quarterfinal: durationMs.nullable(),
    // M12: Halbfinale, Platz 3 und Finale immer ohne Zeitlimit.
    semifinal: z.null(),
    thirdPlace: z.null(),
    final: z.null(),
  })
  .strict();

export const GROUP_COUNTS = [1, 2, 4, 8, 16] as const;

export const SettingsSchema = z
  .object({
    mode: z.enum(['groupsKo', 'koOnly']),
    groupCount: z.literal(GROUP_COUNTS),
    trackCups: z.boolean(),
    thirdPlaceMatch: z.boolean(),
    advancersPerGroup: z.number().int().positive().nullable(),
    timerByPhase: TimerByPhaseSchema,
    timerWarningsMs: z.array(durationMs),
    soundEnabled: z.boolean(),
    showUpcomingOnlyInPreparing: z.boolean(),
    rotationIntervalMs: durationMs,
  })
  .strict();

export const SettingsPatchSchema = SettingsSchema.omit({ timerByPhase: true })
  .partial()
  .extend({ timerByPhase: TimerByPhaseSchema.partial().strict().optional() })
  .strict();

export type Settings = z.infer<typeof SettingsSchema>;
export type SettingsPatch = z.infer<typeof SettingsPatchSchema>;
export type TournamentMode = Settings['mode'];

const TEN_MINUTES = 600_000;

export const DEFAULT_SETTINGS: Settings = {
  mode: 'groupsKo',
  groupCount: 2,
  trackCups: false,
  thirdPlaceMatch: false,
  advancersPerGroup: null,
  timerByPhase: {
    group: 900_000,
    ko64: TEN_MINUTES,
    ko32: TEN_MINUTES,
    ko16: TEN_MINUTES,
    quarterfinal: TEN_MINUTES,
    semifinal: null,
    thirdPlace: null,
    final: null,
  },
  timerWarningsMs: [300_000, 60_000, 30_000],
  soundEnabled: true,
  showUpcomingOnlyInPreparing: false,
  rotationIntervalMs: 15_000,
};

/** Settings, die ab TournamentStarted nicht mehr geändert werden dürfen. */
export const STRUCTURAL_SETTINGS = [
  'mode',
  'groupCount',
  'advancersPerGroup',
  'trackCups',
] as const satisfies readonly (keyof Settings)[];

import { z } from 'zod';

export const IdSchema = z.string().min(1);
export const NameSchema = z.string().trim().min(1);
/** M03: Name + 1..n Spieler, keine Regel zur Anzahl. */
export const PlayersSchema = z.array(NameSchema).min(1);

export const KO_STAGES = [
  'ko64',
  'ko32',
  'ko16',
  'quarterfinal',
  'semifinal',
  'thirdPlace',
  'final',
] as const;
export const KoStageSchema = z.enum(KO_STAGES);
export const PhaseSchema = z.enum(['group', ...KO_STAGES]);

/** Herkunft eines Platzes in einer Partie; `null` = leer (Freilos). */
export const SlotSchema = z.union([
  z.object({ teamId: IdSchema }).strict(),
  z.object({ winnerOf: IdSchema }).strict(),
  z.object({ loserOf: IdSchema }).strict(),
  z.null(),
]);

export const MatchSchema = z
  .object({
    id: IdSchema,
    phase: PhaseSchema,
    /** Runde: Gruppenphase = Spieltag 1..n; KO = 1 (die Stufe steht in `phase`). */
    round: z.number().int().positive(),
    /** Reihenfolge innerhalb der Runde: Gruppe = Partie im Spieltag, KO = Platz im Baum (1..n). */
    position: z.number().int().positive(),
    groupId: IdSchema.nullable(),
    a: SlotSchema,
    b: SlotSchema,
    bye: z.boolean(),
  })
  .strict();

export const HeatSchema = z
  .object({
    id: IdSchema,
    phase: PhaseSchema,
    round: z.number().int().positive(),
    index: z.number().int().positive(),
    /** Reihenfolge = Tisch 1..n, solange kein TablesSwapped vorliegt. */
    matchIds: z.array(IdSchema).min(1),
  })
  .strict();

export const GroupSchema = z
  .object({
    id: IdSchema,
    teamIds: z.array(IdSchema),
  })
  .strict();

export const CupsSchema = z
  .object({
    a: z.number().int().nonnegative(),
    b: z.number().int().nonnegative(),
  })
  .strict();

export const OutcomeSchema = z.enum(['win', 'winByTime', 'draw']);

export const BeamerModeSchema = z.enum(['rotation', 'fixed']);
export const BeamerViewSchema = z.enum(['timer', 'standings', 'bracket', 'upcoming', 'podium']);

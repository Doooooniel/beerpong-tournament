export const DOMAIN_ERROR_CODES = [
  'TOURNAMENT_NOT_CREATED',
  'TOURNAMENT_ALREADY_CREATED',
  'TOURNAMENT_ALREADY_STARTED',
  'TOURNAMENT_NOT_STARTED',
  'SETTING_LOCKED',
  'TEAM_NOT_FOUND',
  'TEAM_NAME_TAKEN',
  'GROUP_NOT_FOUND',
  'GROUP_TOO_SMALL',
  'INVALID_ADVANCERS',
  'GROUP_STAGE_INCOMPLETE',
  'PLAYOFF_REQUIRED',
  'HEAT_NOT_FOUND',
  'HEAT_NOT_STARTED',
  'MATCH_NOT_FOUND',
  'DRAW_NOT_ALLOWED_IN_KNOCKOUT',
  'INVALID_RESULT',
  'EVENT_NOT_FOUND',
  'NOTHING_TO_UNDO',
  'CANNOT_UNDO_CREATION',
  'UNDO_HAS_DEPENDENTS',
  'REDO_NOT_POSSIBLE',
  'TEAMS_UNASSIGNED',
  'NOT_ENOUGH_TEAMS',
  'HEAT_ALREADY_STARTED',
  'PREVIOUS_HEAT_NOT_FINISHED',
  'RESULT_ALREADY_RECORDED',
  'MATCH_NOT_PLAYABLE',
  'INVALID_TABLE',
  'PLAYOFF_NOT_NEEDED',
  'TIMER_NOT_RUNNING',
  'TIMER_ALREADY_PAUSED',
  'TIMER_NOT_PAUSED',
  'TIMER_UNLIMITED',
] as const;

export type DomainErrorCode = (typeof DOMAIN_ERROR_CODES)[number];

export interface DomainError {
  code: DomainErrorCode;
  message: string;
  /** Nur bei UNDO_HAS_DEPENDENTS: IDs der abhängigen späteren Ereignisse. */
  dependents?: string[];
}

export const domainError = (
  code: DomainErrorCode,
  message: string,
  dependents?: string[],
): DomainError => (dependents ? { code, message, dependents } : { code, message });

import { domainError, type DomainError, type DomainErrorCode } from './domain/errors.js';
import type { DecideContext, TournamentState } from './domain/types.js';
import type { DomainEventType, EventOf, NewEvent } from './events/index.js';
import { err, ok, type Result } from './result.js';

/** Ergebnis eines Befehls: neue Ereignisse oder fachlicher Fehler. */
export type Decision = Result<NewEvent[], DomainError>;

export const fail = (code: DomainErrorCode, message: string, dependents?: string[]): Decision =>
  err(domainError(code, message, dependents));

export const event = <T extends Exclude<DomainEventType, 'Undone'>>(
  ctx: DecideContext,
  type: T,
  payload: EventOf<T>['payload'],
): Decision => ok([{ id: ctx.newId(), type, v: 1, at: ctx.now, payload } as NewEvent]);

export const notStarted = (state: TournamentState): Decision | null =>
  state.phase === 'setup'
    ? null
    : fail('TOURNAMENT_ALREADY_STARTED', 'Not allowed after the tournament has started.');

export const started = (state: TournamentState): Decision | null =>
  state.phase === 'setup' ? fail('TOURNAMENT_NOT_STARTED', 'Start the tournament first.') : null;

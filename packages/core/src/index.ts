export { ok, err } from './result.js';
export type { Result } from './result.js';

export * from './domain/errors.js';
export * from './domain/schemas.js';
export * from './domain/settings.js';
export type * from './domain/types.js';
export * from './commands/index.js';
export * from './events/index.js';

/** decide(state, command, ctx) → Result<NewEvent[], DomainError> */
export { decide } from './decide.js';
/** initialState() → leerer Zustand vor TournamentCreated; apply(state, event) → state */
export { apply, initialState } from './apply.js';
/** replay(events) → state; aufgehobene Ereignisse wirken nicht */
export { replay } from './replay.js';
/** findDependents(state, targetEventId) → abhängige spätere Ereignis-IDs */
export { findDependents } from './undo/dependents.js';

// Regeln (M3)
export * from './schedule/round-robin.js';
export * from './schedule/groups.js';
export * from './schedule/heats.js';
export * from './standings/standings.js';
export * from './bracket/bracket.js';
export * from './timer/timer.js';

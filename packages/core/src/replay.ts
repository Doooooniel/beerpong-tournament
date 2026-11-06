import { rebuild } from './apply.js';
import type { Replay } from './domain/types.js';

export const replay: Replay = (events) =>
  rebuild(events.map((event) => ({ event, undone: false })));

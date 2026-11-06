import type { LogEntry } from '../domain/types.js';
import type { DomainEvent } from '../events/index.js';

/**
 * ADR 026: Ein Ereignis ist aufgehoben, wenn ein wirksames Undone es als Ziel oder in der
 * Kaskade nennt. Undone verweist nur auf frühere Ereignisse, daher genügt ein Rückwärtslauf.
 */
export const markUndone = (events: readonly DomainEvent[]): LogEntry[] => {
  const cancelled = new Set<string>();
  const undone = new Array<boolean>(events.length);
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i] as DomainEvent;
    undone[i] = cancelled.has(event.id);
    if (!undone[i] && event.type === 'Undone') {
      cancelled.add(event.undoes);
      for (const id of event.payload.cascade) cancelled.add(id);
    }
  }
  return events.map((event, i) => ({ event, undone: undone[i] === true }));
};

import type { SimEvent } from '../sim/types';

export type EventLogLevel = 'info' | 'warning' | 'critical' | 'success';
export type EventLogFilter = 'all' | 'alerts' | 'routine';

export interface EventLogEntry {
  text: string;
  level: EventLogLevel;
  tick: number;
  x?: number;
  z?: number;
  entityId?: number;
}

/** The simulation retains 240 events; the field report keeps the same window. */
export const EVENT_LOG_LIMIT = 240;

export function eventLogEntryFromEvent(ev: SimEvent): EventLogEntry {
  return {
    text: ev.text,
    level: ev.level ?? 'info',
    tick: ev.tick,
    ...(Number.isFinite(ev.x) ? { x: ev.x } : {}),
    ...(Number.isFinite(ev.z) ? { z: ev.z } : {}),
    ...(ev.entityId !== undefined ? { entityId: ev.entityId } : {}),
  };
}

export function eventLogEntryFromNotice(
  text: string,
  level: EventLogLevel,
  tick: number,
  x?: number,
  z?: number,
  entityId?: number,
): EventLogEntry {
  return {
    text,
    level,
    tick,
    ...(Number.isFinite(x) ? { x } : {}),
    ...(Number.isFinite(z) ? { z } : {}),
    ...(entityId !== undefined ? { entityId } : {}),
  };
}

export function appendEventLog(log: readonly EventLogEntry[], entry: EventLogEntry): EventLogEntry[] {
  const next = [...log, entry];
  return next.length > EVENT_LOG_LIMIT ? next.slice(-EVENT_LOG_LIMIT) : next;
}

export function eventLogVisible(entry: EventLogEntry, query: string, filter: EventLogFilter): boolean {
  if (filter === 'alerts' && entry.level !== 'warning' && entry.level !== 'critical') return false;
  if (filter === 'routine' && entry.level !== 'info' && entry.level !== 'success') return false;
  const needle = query.trim().toLowerCase();
  return needle.length === 0 || entry.text.toLowerCase().includes(needle);
}

/** Only a real map position can be a jump target; (0, 0) is the unknown default. */
export function eventLogJumpable(entry: EventLogEntry): boolean {
  return (
    entry.x !== undefined &&
    entry.z !== undefined &&
    Number.isFinite(entry.x) &&
    Number.isFinite(entry.z) &&
    (entry.x !== 0 || entry.z !== 0)
  );
}

export function eventLogLevelLabel(level: EventLogLevel): string {
  switch (level) {
    case 'critical':
      return 'CRIT';
    case 'warning':
      return 'WARN';
    case 'success':
      return 'OK';
    default:
      return 'INFO';
  }
}

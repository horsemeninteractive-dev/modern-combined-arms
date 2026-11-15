import { describe, expect, it } from 'vitest';
import {
  appendEventLog,
  eventLogEntryFromEvent,
  eventLogJumpable,
  eventLogLevelLabel,
  eventLogVisible,
  EVENT_LOG_LIMIT,
  type EventLogEntry,
} from '../src/ui/eventLog';
import type { SimEvent } from '../src/sim/types';

function event(overrides: Partial<SimEvent> = {}): SimEvent {
  return {
    seq: 1,
    tick: 120,
    type: 'alert',
    team: 0,
    x: 640,
    z: 320,
    text: 'Enemy armour crossing the ridge',
    ...overrides,
  };
}

function entry(overrides: Partial<EventLogEntry> = {}): EventLogEntry {
  return {
    text: 'Enemy armour crossing the ridge',
    level: 'warning',
    tick: 120,
    x: 640,
    z: 320,
    ...overrides,
  };
}

describe('field report entries', () => {
  it('keeps the position and entity of a simulation alert', () => {
    expect(eventLogEntryFromEvent(event({ entityId: 42, level: 'critical' }))).toEqual({
      text: 'Enemy armour crossing the ridge',
      level: 'critical',
      tick: 120,
      x: 640,
      z: 320,
      entityId: 42,
    });
  });

  it('defaults an unlevelled event to info', () => {
    expect(eventLogEntryFromEvent(event({ level: undefined })).level).toBe('info');
  });
});

describe('field report filtering', () => {
  const reports = [
    entry({ text: 'Enemy armour crossing the ridge', level: 'warning' }),
    entry({ text: 'Command post destroyed', level: 'critical', tick: 300 }),
    entry({ text: 'Refinery complete', level: 'success' }),
    entry({ text: 'Harvester idle', level: 'info' }),
  ];

  it('shows every report under ALL', () => {
    expect(reports.filter((report) => eventLogVisible(report, '', 'all'))).toHaveLength(4);
  });

  it('shows only warning and critical reports under ALERTS', () => {
    expect(reports.filter((report) => eventLogVisible(report, '', 'alerts')).map((r) => r.level)).toEqual([
      'warning',
      'critical',
    ]);
  });

  it('shows only info and success reports under ROUTINE', () => {
    expect(reports.filter((report) => eventLogVisible(report, '', 'routine')).map((r) => r.level)).toEqual([
      'success',
      'info',
    ]);
  });

  it('searches case-insensitively and combines with the filter', () => {
    expect(reports.filter((report) => eventLogVisible(report, 'ARMOUR', 'alerts'))).toHaveLength(1);
    expect(reports.filter((report) => eventLogVisible(report, 'armour', 'routine'))).toHaveLength(0);
  });

  it('treats whitespace-only search as no search', () => {
    expect(reports.filter((report) => eventLogVisible(report, '   ', 'all'))).toHaveLength(4);
  });
});

describe('field report jump targets', () => {
  it('only marks a real, non-origin position as jumpable', () => {
    expect(eventLogJumpable(entry())).toBe(true);
    expect(eventLogJumpable(entry({ x: 0, z: 0 }))).toBe(false);
    expect(eventLogJumpable(entry({ x: undefined }))).toBe(false);
  });

  it('labels each severity without relying on colour', () => {
    expect(eventLogLevelLabel('critical')).toBe('CRIT');
    expect(eventLogLevelLabel('warning')).toBe('WARN');
    expect(eventLogLevelLabel('success')).toBe('OK');
    expect(eventLogLevelLabel('info')).toBe('INFO');
  });
});

describe('field report retention', () => {
  it('keeps the newest 240 reports', () => {
    let log: EventLogEntry[] = [];
    for (let i = 1; i <= EVENT_LOG_LIMIT + 2; i++) {
      log = appendEventLog(log, entry({ text: `report ${i}`, tick: i }));
    }
    expect(log).toHaveLength(EVENT_LOG_LIMIT);
    expect(log[0].text).toBe('report 3');
    expect(log[log.length - 1].text).toBe(`report ${EVENT_LOG_LIMIT + 2}`);
  });
});

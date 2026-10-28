import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { UNITS } from '../src/data/units';
import type { SimEvent } from '../src/sim/types';
import {
  UnitVoice,
  unitVoiceForEvent,
  unitVoicePath,
  type UnitVoiceCue,
  type UnitVoicePlayback,
} from '../src/ui/unitVoice';

interface VoiceLine {
  text: string;
  file: string;
  durationMs: number;
}

interface VoiceUnit {
  name: string;
  role: string;
  voice: string;
  lang: string;
  speed: number;
  lines: Record<string, VoiceLine>;
}

interface VoiceManifest {
  version: number;
  engine: string;
  preset: string;
  sampleRate: number;
  bitrateKbps: number;
  cues: string[];
  units: Record<string, VoiceUnit>;
}

const CUES = ['select', 'move', 'attack', 'unableToComply'];
const ROOT = new URL('../public/audio/unit-voice/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('manifest.json', ROOT), 'utf8')) as VoiceManifest;

describe('unit voice set', () => {
  it('covers every registered unit, including national variants', () => {
    expect(Object.keys(manifest.units).sort()).toEqual(Object.keys(UNITS).sort());
    expect(manifest.cues).toEqual(CUES);
    expect(manifest.version).toBe(2);
    expect(manifest.engine).toBe('kokoro-82m-onnx');
    expect(manifest.preset).toBe('field');
    expect(manifest.sampleRate).toBe(24_000);
    expect(manifest.bitrateKbps).toBe(64);
  });

  it('gives every unit four distinct clips with a matching manifest entry', () => {
    const paths = new Set<string>();
    for (const [unitId, unit] of Object.entries(manifest.units)) {
      expect(unit.name).toBe(UNITS[unitId].name);
      expect(unit.role).toBe(UNITS[unitId].role);
      expect(unit.voice).toMatch(/^(af|am|bf|bm)_/);
      expect(unit.lang).toMatch(/^en-(us|gb)$/);
      expect(unit.speed).toBeGreaterThan(0.8);
      expect(unit.speed).toBeLessThan(1.3);
      expect(Object.keys(unit.lines).sort()).toEqual([...CUES].sort());

      for (const cue of CUES) {
        const line = unit.lines[cue];
        expect(line.text.length).toBeGreaterThan(0);
        expect(line.durationMs).toBeGreaterThan(400);
        expect(line.file.startsWith(`${unitId}/`)).toBe(true);
        expect(paths.has(line.file)).toBe(false);
        paths.add(line.file);

        const file = new URL(line.file, ROOT);
        expect(existsSync(file)).toBe(true);
        expect(readFileSync(file).byteLength).toBeGreaterThan(4_000);
        expect(unitVoicePath(unitId, cue as UnitVoiceCue)).toBe(
          `/audio/unit-voice/${line.file}`,
        );
      }
    }
    expect(paths.size).toBe(Object.keys(UNITS).length * CUES.length);
  });

  it('uses a different voice for every unit type', () => {
    const voices = Object.values(manifest.units).map((unit) => unit.voice);
    expect(voices).toHaveLength(Object.keys(UNITS).length);
    expect(new Set(voices).size).toBe(voices.length);
  });
});

function event(overrides: Partial<SimEvent>): SimEvent {
  return {
    seq: 1,
    tick: 1,
    type: 'orderAck',
    team: 0,
    x: 0,
    z: 0,
    text: '',
    ...overrides,
  };
}

describe('unit voice event mapping', () => {
  it('resolves the four authored files for a known unit', () => {
    expect(unitVoicePath('pathfinder', 'select')).toBe(
      '/audio/unit-voice/pathfinder/select.mp3',
    );
    expect(unitVoicePath('pathfinder', 'unableToComply')).toBe(
      '/audio/unit-voice/pathfinder/unableToComply.mp3',
    );
    expect(unitVoicePath('not-a-unit', 'select')).toBeNull();
  });

  it('maps local move and attack acknowledgements', () => {
    expect(
      unitVoiceForEvent(event({ code: 'moveOrder', defId: 'pathfinder' }), 0),
    ).toEqual({ cue: 'move', defId: 'pathfinder' });
    expect(
      unitVoiceForEvent(event({ code: 'attackOrder', defId: 'tank' }), 0),
    ).toEqual({ cue: 'attack', defId: 'tank' });
  });

  it('maps refusals but leaves production failures to the announcer', () => {
    expect(
      unitVoiceForEvent(event({ type: 'orderFailed', defId: 'rifle' }), 0),
    ).toEqual({ cue: 'unableToComply', defId: 'rifle' });
    expect(
      unitVoiceForEvent(
        event({ type: 'orderFailed', code: 'queueFull', defId: 'rifle' }),
        0,
      ),
    ).toBeNull();
  });

  it('never voices enemy orders or unknown definitions', () => {
    expect(
      unitVoiceForEvent(event({ code: 'moveOrder', defId: 'rifle', team: 1 }), 0),
    ).toBeNull();
    expect(
      unitVoiceForEvent(event({ code: 'moveOrder', defId: 'unknown' }), 0),
    ).toBeNull();
    expect(unitVoiceForEvent(event({ code: 'moveOrder' }), 0)).toBeNull();
  });
});

describe('unit voice channel', () => {
  function harness() {
    let now = 0;
    const plays: Array<{ src: string; done: () => void }> = [];
    let stops = 0;
    const timers = new Map<number, () => void>();
    let nextTimer = 1;
    const playback: UnitVoicePlayback = {
      play: (src, done) => plays.push({ src, done }),
      stop: () => {
        stops++;
      },
    };
    const voice = new UnitVoice(playback, {
      now: () => now,
      schedule: (fn) => {
        const id = nextTimer++;
        timers.set(id, fn);
        return id;
      },
      cancel: (handle) => timers.delete(handle as number),
    });
    return {
      voice,
      plays,
      timers,
      get stops() {
        return stops;
      },
      at(ms: number) {
        now = ms;
      },
      fireTimers() {
        for (const fn of [...timers.values()]) fn();
      },
    };
  }

  it('plays a selection bark and then releases the channel on completion', () => {
    const h = harness();
    expect(h.voice.speak('pathfinder', 'select')).toBe(true);
    expect(h.plays.map((p) => p.src)).toEqual([
      '/audio/unit-voice/pathfinder/select.mp3',
    ]);
    expect(h.voice.currentCue).toBe('select');
    h.plays[0].done();
    expect(h.voice.busy).toBe(false);
  });

  it('suppresses a repeated selection inside its cooldown', () => {
    const h = harness();
    h.voice.speak('pathfinder', 'select');
    h.plays[0].done();
    h.at(1000);
    expect(h.voice.speak('pathfinder', 'select')).toBe(false);
    h.at(2700);
    expect(h.voice.speak('pathfinder', 'select')).toBe(true);
  });

  it('interrupts a selection with a higher-priority order acknowledgement', () => {
    const h = harness();
    h.voice.speak('tank', 'select');
    h.at(200);
    expect(h.voice.speak('tank', 'move')).toBe(true);
    expect(h.stops).toBe(1);
    expect(h.voice.currentCue).toBe('move');
  });

  it('lets a refusal interrupt but not a lower-priority selection', () => {
    const h = harness();
    h.voice.speak('tank', 'move');
    h.at(200);
    expect(h.voice.speak('tank', 'select')).toBe(false);
    expect(h.voice.currentCue).toBe('move');
    h.at(400);
    expect(h.voice.speak('tank', 'unableToComply')).toBe(true);
    expect(h.voice.currentCue).toBe('unableToComply');
  });

  it('keeps different units from talking over each other in the same instant', () => {
    const h = harness();
    h.voice.speak('tank', 'select');
    h.at(50);
    expect(h.voice.speak('rifle', 'select')).toBe(false);
    h.plays[0].done();
    h.at(200);
    expect(h.voice.speak('rifle', 'select')).toBe(true);
  });

  it('clears a stuck line with the watchdog', () => {
    const h = harness();
    h.voice.speak('tank', 'move');
    h.fireTimers();
    expect(h.voice.busy).toBe(false);
  });

  it('reset clears cooldowns so a new battle starts clean', () => {
    const h = harness();
    h.voice.speak('tank', 'select');
    h.plays[0].done();
    h.voice.reset();
    h.at(10);
    expect(h.voice.speak('tank', 'select')).toBe(true);
  });
});

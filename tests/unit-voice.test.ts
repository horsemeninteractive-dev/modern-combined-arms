import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { UNITS } from '../src/data/units';
import type { SimEvent } from '../src/sim/types';
import {
  UNIT_VOICE_TAKES,
  UnitVoice,
  unitVoiceForEvent,
  unitVoicePath,
  unitVoiceSetId,
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
  lines: Record<string, VoiceLine[]>;
}

interface VoiceManifest {
  version: number;
  engine: string;
  preset: string;
  sampleRate: number;
  bitrateKbps: number;
  cues: string[];
  takesPerCue: number;
  units: Record<string, VoiceUnit>;
}

const CUES = ['select', 'move', 'attack', 'unableToComply'];
const ROOT = new URL('../public/audio/unit-voice/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('manifest.json', ROOT), 'utf8')) as VoiceManifest;

describe('unit voice set', () => {
  it('gives every registered unit its own recorded voice bank', () => {
    // Every unit resolves to its own cast: canonical slots, both alliance
    // platforms, national replacements and national exclusives. Nothing
    // borrows another platform's lines.
    for (const id of Object.keys(UNITS)) {
      const set = unitVoiceSetId(id);
      expect(set, `${id} resolves a voice set`).toBe(id);
      expect(manifest.units[set!], `${id} → ${set}`).toBeDefined();
    }
    // The manifest holds recorded casts only. A unit in the manifest that is
    // not registered would be an orphan asset, so the two lists must match.
    expect(Object.keys(manifest.units).sort()).toEqual(Object.keys(UNITS).sort());
    expect(manifest.cues).toEqual(CUES);
    expect(manifest.version).toBe(3);
    expect(manifest.takesPerCue).toBe(UNIT_VOICE_TAKES);
    expect(manifest.engine).toBe('kokoro-82m-onnx');
    expect(manifest.preset).toBe('field');
    expect(manifest.sampleRate).toBe(24_000);
    expect(manifest.bitrateKbps).toBe(64);
  });

  it('records three takes for every cue and resolves each take exactly', () => {
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
        const takes = unit.lines[cue];
        expect(takes).toHaveLength(UNIT_VOICE_TAKES);
        for (const [index, line] of takes.entries()) {
          const take = index + 1;
          expect(line.text.length).toBeGreaterThan(0);
          expect(line.durationMs).toBeGreaterThan(400);
          expect(line.file).toBe(`${unitId}/${cue}-${take}.mp3`);
          expect(paths.has(line.file)).toBe(false);
          paths.add(line.file);

          const file = new URL(line.file, ROOT);
          expect(existsSync(file)).toBe(true);
          expect(readFileSync(file).byteLength).toBeGreaterThan(4_000);
          expect(unitVoicePath(unitId, cue as UnitVoiceCue, take)).toBe(
            `/audio/unit-voice/${line.file}`,
          );
        }
      }
    }
    expect(paths.size).toBe(
      Object.keys(manifest.units).length * CUES.length * UNIT_VOICE_TAKES,
    );
  });

  it('gives every unit twelve unique lines, none shared with another unit', () => {
    const seen = new Map<string, string>();
    for (const [unitId, unit] of Object.entries(manifest.units)) {
      const own = new Set<string>();
      for (const cue of CUES) {
        for (const line of unit.lines[cue]) {
          expect(own.has(line.text), `${unitId} repeats "${line.text}"`).toBe(false);
          own.add(line.text);
          const owner = seen.get(line.text);
          expect(owner, `"${line.text}" shared with ${owner}`).toBeUndefined();
          seen.set(line.text, unitId);
        }
      }
      expect(own.size).toBe(CUES.length * UNIT_VOICE_TAKES);
    }
  });

  it('reuses the Kokoro cast deliberately rather than one voice per unit', () => {
    // Kokoro ships 28 English voices for 52 units, so voices repeat across
    // campaign families; the speech itself is what stays unique.
    const voices = Object.values(manifest.units).map((unit) => unit.voice);
    expect(voices).toHaveLength(Object.keys(manifest.units).length);
    expect(new Set(voices).size).toBeGreaterThanOrEqual(20);
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
  it('resolves the three authored takes for a known unit', () => {
    expect(unitVoicePath('pathfinder', 'select')).toBe(
      '/audio/unit-voice/pathfinder/select-1.mp3',
    );
    expect(unitVoicePath('pathfinder', 'select', 2)).toBe(
      '/audio/unit-voice/pathfinder/select-2.mp3',
    );
    expect(unitVoicePath('pathfinder', 'unableToComply', 3)).toBe(
      '/audio/unit-voice/pathfinder/unableToComply-3.mp3',
    );
    // Out-of-range takes clamp to a real file instead of a broken URL.
    expect(unitVoicePath('pathfinder', 'select', 9)).toBe(
      '/audio/unit-voice/pathfinder/select-3.mp3',
    );
    expect(unitVoicePath('pathfinder', 'select', 0)).toBe(
      '/audio/unit-voice/pathfinder/select-1.mp3',
    );
    expect(unitVoicePath('pathfinder', 'select', Number.NaN)).toBe(
      '/audio/unit-voice/pathfinder/select-1.mp3',
    );
    expect(unitVoicePath('not-a-unit', 'select')).toBeNull();
  });

  it('gives alliance platforms and national variants their own cast', () => {
    expect(unitVoicePath('tankEC', 'select')).toBe('/audio/unit-voice/tankEC/select-1.mp3');
    expect(unitVoicePath('navalSupportEC', 'move')).toBe(
      '/audio/unit-voice/navalSupportEC/move-1.mp3',
    );
    expect(unitVoicePath('spearhead', 'select')).toBe(
      '/audio/unit-voice/spearhead/select-1.mp3',
    );
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
    expect(h.plays).toHaveLength(1);
    expect(h.plays[0].src).toMatch(/\/audio\/unit-voice\/pathfinder\/select-[123]\.mp3$/);
    expect(h.voice.currentCue).toBe('select');
    h.plays[0].done();
    expect(h.voice.busy).toBe(false);
  });

  it('plays a different recorded take when one is requested', () => {
    const h = harness();
    expect(h.voice.speak('tank', 'attack', 2)).toBe(true);
    expect(h.plays[0].src).toBe('/audio/unit-voice/tank/attack-2.mp3');
    h.plays[0].done();
    h.at(2000);
    expect(h.voice.speak('tank', 'attack', 3)).toBe(true);
    expect(h.plays[1].src).toBe('/audio/unit-voice/tank/attack-3.mp3');
  });

  it('picks a recorded take when the caller does not choose one', () => {
    const h = harness();
    for (let i = 0; i < 12; i++) {
      h.voice.speak('rifle', 'move');
      const src = h.plays[h.plays.length - 1].src;
      expect(src).toMatch(/\/audio\/unit-voice\/rifle\/move-[123]\.mp3$/);
      h.plays[h.plays.length - 1].done();
      h.at((i + 1) * 2000);
    }
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

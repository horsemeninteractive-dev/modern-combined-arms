import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createIslandAssault } from '../src/data/scenarios';
import { NATIONS, NATION_LIST, factionDef } from '../src/data/factions';
import {
  DEFAULT_NARRATOR,
  NARRATOR_CUE_IDS,
  NARRATOR_LIST,
  narratorAssetPath,
  narratorDef,
  narratorForFaction,
  narratorIdForAlliance,
  narratorIdForFaction,
} from '../src/data/narrators';
import { ANNOUNCEMENT_IDS, Announcer, narratorVoicePath, type VoicePlayback } from '../src/ui/announcer';
import { Game } from '../src/sim/game';

const LINES: {
  presets: Record<string, Record<string, number>>;
  narrators: Record<string, { generation: string; assetRoot: string; voice: { voice: string; speed: number; preset: string }; lines: Record<string, string> }>;
} = JSON.parse(readFileSync(new URL('../tools/narrator-voice/lines.json', import.meta.url), 'utf8'));

const MANIFEST: {
  narrators: Record<
    string,
    {
      generation: string;
      assetVoice: string;
      lines: Record<
        string,
        { status: string; path: string; text: string | null; sampleRate: number; channels: number; seconds: number }
      >;
    }
  >;
} = JSON.parse(readFileSync(new URL('../public/audio/narrator/manifest.json', import.meta.url), 'utf8'));

class Recording implements VoicePlayback {
  played: string[] = [];
  stops = 0;

  play(src: string, _done: () => void): void {
    this.played.push(src);
  }

  stop(): void {
    this.stops++;
  }
}

function clocked(playback: Recording = new Recording()): {
  announcer: Announcer;
  playback: Recording;
  advance: (ms: number) => void;
} {
  let t = 0;
  const timers: { at: number; fn: () => void }[] = [];
  const announcer = new Announcer(playback, {
    now: () => t,
    schedule: (fn, ms) => {
      const handle = { at: t + ms, fn };
      timers.push(handle);
      return handle;
    },
    cancel: (handle) => {
      const index = timers.indexOf(handle as { at: number; fn: () => void });
      if (index >= 0) timers.splice(index, 1);
    },
  });
  return {
    announcer,
    playback,
    advance: (ms: number) => {
      t += ms;
      for (const timer of [...timers]) {
        if (timer.at > t) continue;
        timers.splice(timers.indexOf(timer), 1);
        timer.fn();
      }
    },
  };
}

describe('faction to narrator resolution', () => {
  it('gives every playable nation the narrator of its alliance', () => {
    expect(NATION_LIST.length).toBe(10);
    for (const nation of NATION_LIST) {
      const expected = nation.allianceId === 'eastern' ? 'eastern' : 'defender';
      expect(narratorIdForFaction(nation.id), nation.id).toBe(expected);
    }
  });

  it('resolves the legacy alliance presets to their alliance narrator', () => {
    expect(narratorIdForFaction('baltic')).toBe('defender');
    expect(narratorIdForFaction('expeditionary')).toBe('eastern');
    expect(narratorIdForFaction(factionDef('baltic').id)).toBe('defender');
  });

  it('resolves Defender and Eastern nations to different voices', () => {
    expect(narratorForFaction('lithuania').id).toBe('defender');
    expect(narratorForFaction('russia').id).toBe('eastern');
    expect(narratorDef('defender').root).not.toBe(narratorDef('eastern').root);
    expect(narratorDef('defender').voice.voice).not.toBe(narratorDef('eastern').voice.voice);
  });

  it('falls back to the Defender voice for unknown or missing factions', () => {
    expect(narratorIdForFaction('atlantis')).toBe(DEFAULT_NARRATOR);
    expect(narratorIdForFaction(undefined)).toBe(DEFAULT_NARRATOR);
    expect(narratorIdForFaction('')).toBe(DEFAULT_NARRATOR);
    expect(narratorIdForAlliance('nobody')).toBe(DEFAULT_NARRATOR);
    expect(narratorIdForAlliance(undefined)).toBe(DEFAULT_NARRATOR);
  });

  it('keeps resolution independent of which nation the map loaded', () => {
    // The map's legacy preset and a named nation of the same alliance must not
    // disagree, or the flag and the voice would tell different stories.
    for (const nation of NATION_LIST) {
      expect(narratorIdForFaction(nation.id)).toBe(narratorIdForAlliance(NATIONS[nation.id].allianceId));
    }
  });
});

describe('narrator catalogue coverage', () => {
  it('advertises exactly the cues the announcer knows', () => {
    expect([...NARRATOR_CUE_IDS].sort()).toEqual([...ANNOUNCEMENT_IDS].sort());
  });

  it('authors every cue for the recorded Eastern narrator and none for the recorded Defender set', () => {
    expect(Object.keys(LINES.narrators).sort()).toEqual(NARRATOR_LIST.map((n) => n.id).sort());
    expect(LINES.narrators.defender.generation).toBe('legacy');
    expect(Object.keys(LINES.narrators.defender.lines)).toEqual([]);
    expect(LINES.narrators.eastern.generation).toBe('recorded');
    expect(Object.keys(LINES.narrators.eastern.lines).sort()).toEqual([...ANNOUNCEMENT_IDS].sort());
    for (const [id, text] of Object.entries(LINES.narrators.eastern.lines)) {
      expect(text.trim(), id).not.toBe('');
      // A battlefield report, not exposition: one sentence, spoken in about a
      // second and a half, so it lands inside the event it reports.
      expect(text.length, id).toBeLessThan(60);
      expect(text.split(/[.!?]\s+/).length, id).toBe(1);
      expect(text.endsWith('.'), id).toBe(true);
    }
  });

  it('records the same Kokoro fallback voice and preset the runtime advertises', () => {
    for (const def of NARRATOR_LIST) {
      const entry = LINES.narrators[def.id];
      expect(entry.voice.voice).toBe(def.voice.voice);
      expect(entry.voice.speed).toBe(def.voice.speed);
      expect(entry.voice.preset).toBe(def.voice.preset);
      expect(entry.assetRoot).toBe(def.root);
      expect(LINES.presets[def.voice.preset]).toBeTruthy();
    }
  });

  it('marks both shipped sets as recordings so the Kokoro generator cannot overwrite them', () => {
    for (const def of NARRATOR_LIST) {
      // The Python generator synthesises only `generation: kokoro` entries, so
      // this pairing is what keeps a `--refresh` run away from shipped takes.
      expect(def.legacyAssets, def.id).toBe(true);
      expect(LINES.narrators[def.id].generation, def.id).not.toBe('kokoro');
    }
    expect(MANIFEST.narrators.eastern.generation).toBe('recorded');
    expect(MANIFEST.narrators.eastern.assetVoice).toContain('ElevenLabs');
  });

  it('gives every cue an exactly-named asset in both narrator folders', () => {
    for (const def of NARRATOR_LIST) {
      expect(narratorAssetPath(def.id, 'victory.mp3')).toBe(`${def.root}/victory.mp3`);
      // A directory listing, not existsSync: Windows resolves file names
      // case-insensitively, so `unitLost.mp3` would pass on disk and then 404 in
      // a browser against a cue table that asks for `unitlost.mp3`.
      const folder = new URL(`../public${def.root}`, import.meta.url);
      const present = new Set(readdirSync(folder));
      for (const id of ANNOUNCEMENT_IDS) {
        const path = narratorVoicePath(def.id, id);
        expect(path.startsWith(`${def.root}/`)).toBe(true);
        const name = path.slice(def.root.length + 1);
        expect(present.has(name), `${def.id}: ${name} missing from ${def.root}`).toBe(true);
        expect(readFileSync(new URL(`../public${path}`, import.meta.url)).byteLength, path).toBeGreaterThan(1000);
      }
    }
  });

  it('records a validated manifest entry for every cue of both narrators', () => {
    for (const def of NARRATOR_LIST) {
      const record = MANIFEST.narrators[def.id];
      expect(record, def.id).toBeTruthy();
      expect(Object.keys(record.lines).sort()).toEqual([...ANNOUNCEMENT_IDS].sort());
      for (const [id, line] of Object.entries(record.lines)) {
        expect(line.status, `${def.id}/${id}`).toBe('ok');
        expect(line.sampleRate).toBe(24_000);
        expect(line.channels).toBe(1);
        expect(line.seconds).toBeGreaterThan(0.4);
        expect(line.path).toBe(`${def.root}/${id.toLowerCase()}.mp3`);
        if (def.id === 'eastern') expect(line.text, `${def.id}/${id}`).toBeTruthy();
      }
    }
  });
});

describe('announcer narrator switching', () => {
  it('plays the resolved voice path and cuts the previous narrator', () => {
    const playback = new Recording();
    const { announcer, advance } = clocked(playback);
    expect(announcer.narratorId).toBe(DEFAULT_NARRATOR);

    expect(announcer.announce('enemyDetected')).toBe(true);
    expect(playback.played).toEqual(['/audio/narrator/defender/enemydetected.mp3']);

    advance(13_000);
    announcer.setNarrator('eastern');
    expect(playback.stops).toBe(1);
    // The line that was already speaking is cut: two narrators must not talk.
    expect(announcer.currentId).toBeNull();
    expect(announcer.announce('enemyDetected')).toBe(true);
    expect(playback.played[1]).toBe('/audio/narrator/eastern/enemydetected.mp3');
  });

  it('does not replay an event because a second narrator is configured', () => {
    const playback = new Recording();
    const { announcer, advance } = clocked(playback);
    for (const narrator of ['defender', 'eastern'] as const) {
      announcer.setNarrator(narrator);
      announcer.announce('unitReady');
      advance(6_000);
    }
    expect(playback.played).toEqual([
      '/audio/narrator/defender/unitready.mp3',
      '/audio/narrator/eastern/unitready.mp3',
    ]);
  });

  it('keeps priority, cooldown and one-shot rules across a voice change', () => {
    const { announcer, advance } = clocked();
    announcer.setNarrator('eastern');
    expect(announcer.announce('victory')).toBe(true);
    announcer.setNarrator('defender');
    // `once` belongs to the battle, not to the voice.
    expect(announcer.announce('victory')).toBe(false);
    advance(20_000);
    expect(announcer.announce('victory')).toBe(false);

    expect(announcer.announce('forcesUnderAttack')).toBe(true);
    // A low-priority line still cannot interrupt a critical one.
    expect(announcer.announce('unitReady')).toBe(false);
    advance(4_000);
    // The cue's own cooldown is unchanged by the voice switch.
    expect(announcer.announce('forcesUnderAttack')).toBe(false);
  });
});

describe('narrator selection survives the battle lifecycle', () => {
  it('follows the seat faction through a save and reload', () => {
    const scenario = createIslandAssault();
    scenario.players[0].factionId = 'russia';
    scenario.players[1].factionId = 'lithuania';
    const game = new Game(scenario, { enableAI: false, localPlayerId: 0 });
    expect(narratorForFaction(game.player(0)!.factionId).id).toBe('eastern');

    const loaded = Game.fromSave(game.toSave(), { localPlayerId: 0, enableAI: false });
    expect(narratorForFaction(loaded.player(0)!.factionId).id).toBe('eastern');

    // The other seat of the same battle reports in its own voice.
    expect(narratorForFaction(game.player(1)!.factionId).id).toBe('defender');
  });

  it('keeps the narrator out of the save format and every state hash', () => {
    const game = new Game(createIslandAssault(), { enableAI: false });
    const save = JSON.stringify(game.toSave());
    expect(save.includes('narrator')).toBe(false);
    expect(save.includes('audio/narrator')).toBe(false);
    const before = game.stateHash();
    // A presentation-layer narrator change cannot reach the simulation.
    expect(game.stateHash()).toBe(before);
  });
});

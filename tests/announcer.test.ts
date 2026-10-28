import { existsSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createIslandAssault } from '../src/data/scenarios';
import { Game } from '../src/sim/game';
import type { Entity, SimEvent } from '../src/sim/types';
import { AudioEngine } from '../src/ui/audio';
import {
  ANNOUNCEMENT_IDS,
  Announcer,
  VOICE_MANIFEST,
  announcementForEvent,
  voicePath,
  type VoicePlayback,
} from '../src/ui/announcer';

function event(partial: Partial<SimEvent>): SimEvent {
  return {
    seq: 1,
    tick: 0,
    type: 'notice',
    team: 0,
    x: 0,
    z: 0,
    text: '',
    ...partial,
  };
}

class RecordingPlayback implements VoicePlayback {
  played: string[] = [];
  stops = 0;
  private done: (() => void) | null = null;

  play(src: string, done: () => void): void {
    this.played.push(src);
    this.done = done;
  }

  stop(): void {
    this.stops++;
    this.done = null;
  }

  finish(): void {
    const done = this.done;
    this.done = null;
    done?.();
  }
}

/** Advance the announcer's clock and its stuck-line watchdog together. */
function clock() {
  let t = 1000;
  const timers: { at: number; fn: () => void }[] = [];
  return {
    now: () => t,
    schedule: (fn: () => void, ms: number): unknown => {
      const handle = { at: t + ms, fn };
      timers.push(handle);
      return handle;
    },
    cancel: (handle: unknown) => {
      const index = timers.indexOf(handle as { at: number; fn: () => void });
      if (index >= 0) timers.splice(index, 1);
    },
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

function announcerWith(playback: RecordingPlayback): { announcer: Announcer; tick: ReturnType<typeof clock> } {
  const tick = clock();
  const announcer = new Announcer(playback, {
    now: tick.now,
    schedule: tick.schedule,
    cancel: tick.cancel,
  });
  return { announcer, tick };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('announcer manifest', () => {
  it('maps every registered line to an existing asset under the authored folder', () => {
    const paths = new Set<string>();
    for (const id of ANNOUNCEMENT_IDS) {
      const cue = VOICE_MANIFEST[id];
      const path = voicePath(id);
      expect(path).toBe(`/audio/battlesys/${cue.file}`);
      expect(paths.has(path)).toBe(false);
      paths.add(path);
      expect(existsSync(new URL(`../public/audio/battlesys/${cue.file}`, import.meta.url))).toBe(true);
    }
    expect(paths.size).toBe(20);
  });
});

describe('event to voice mapping', () => {
  it('maps player construction, production and ownership transitions', () => {
    expect(announcementForEvent(event({ type: 'buildingPlaced', team: 0 }), 0)).toBe('buildingUnderConstruction');
    expect(announcementForEvent(event({ type: 'buildingComplete', team: 0 }), 0)).toBe('constructionComplete');
    expect(announcementForEvent(event({ type: 'unitBuilt', team: 0 }), 0)).toBe('unitReady');
    expect(announcementForEvent(event({ type: 'orderAck', team: 0, code: 'productionStarted' }), 0)).toBe('productionUnderway');
    expect(announcementForEvent(event({ type: 'orderAck', team: 0, code: 'productionCancelled' }), 0)).toBe('productionCancelled');
    expect(announcementForEvent(event({ type: 'orderFailed', team: 0, code: 'queueFull' }), 0)).toBe('queueFull');
    expect(announcementForEvent(event({ type: 'notice', team: 0, code: 'powerRestored' }), 0)).toBe('powerRestored');
    expect(announcementForEvent(event({ type: 'capture', team: 0 }), 0)).toBe('siteSecured');
  });

  it('maps losses and attack alerts only for the player', () => {
    expect(announcementForEvent(event({ type: 'buildingLost', team: 0 }), 0)).toBe('structureLost');
    expect(announcementForEvent(event({ type: 'unitLost', team: 0 }), 0)).toBe('unitLost');
    expect(announcementForEvent(event({ type: 'alert', team: 0, code: 'baseUnderAttack' }), 0)).toBe('baseUnderAttack');
    expect(announcementForEvent(event({ type: 'alert', team: 0, code: 'forcesUnderAttack' }), 0)).toBe('forcesUnderAttack');
    expect(announcementForEvent(event({ type: 'notice', team: 0, code: 'enemyDetected' }), 0)).toBe('enemyDetected');
  });

  it('never announces enemy or unrelated AI events to the player', () => {
    expect(announcementForEvent(event({ type: 'buildingComplete', team: 1 }), 0)).toBeNull();
    expect(announcementForEvent(event({ type: 'unitBuilt', team: 1 }), 0)).toBeNull();
    expect(announcementForEvent(event({ type: 'buildingLost', team: 1 }), 0)).toBeNull();
    expect(announcementForEvent(event({ type: 'unitLost', team: 1 }), 0)).toBeNull();
    expect(announcementForEvent(event({ type: 'alert', team: 1, code: 'baseUnderAttack' }), 0)).toBeNull();
    expect(announcementForEvent(event({ type: 'capture', team: 1 }), 0)).toBeNull();
  });

  it('announces a lost strategic site even though the capturing team is the enemy', () => {
    expect(announcementForEvent(event({ type: 'capture', team: 1, code: 'siteLost' }), 0)).toBe('siteLost');
  });

  it('plays victory once for the player and never on defeat', () => {
    expect(announcementForEvent(event({ type: 'victory', team: 0 }), 0)).toBe('victory');
    expect(announcementForEvent(event({ type: 'defeat', team: 0 }), 0)).toBeNull();
    expect(announcementForEvent(event({ type: 'victory', team: 1 }), 0)).toBeNull();
  });
});

describe('announcer playback', () => {
  it('requests the authored file for a mapped event', () => {
    const playback = new RecordingPlayback();
    const { announcer } = announcerWith(playback);
    expect(announcer.announce('constructionComplete')).toBe(true);
    expect(playback.played).toEqual(['/audio/battlesys/constructioncomplete.mp3']);
  });

  it('suppresses repeated deliveries and honours the per-line cooldown', () => {
    const playback = new RecordingPlayback();
    const { announcer, tick } = announcerWith(playback);
    announcer.announce('queueFull');
    playback.finish();
    // Same transition arriving twice in one tick must not replay.
    expect(announcer.announce('queueFull')).toBe(false);
    expect(playback.played).toHaveLength(1);
    tick.advance(VOICE_MANIFEST.queueFull.cooldownMs);
    expect(announcer.announce('queueFull')).toBe(true);
    expect(playback.played).toHaveLength(2);
  });

  it('lets a critical line interrupt and then suppresses lower-priority chatter', () => {
    const playback = new RecordingPlayback();
    const { announcer } = announcerWith(playback);
    announcer.announce('unitReady');
    expect(announcer.announce('baseUnderAttack')).toBe(true);
    expect(playback.stops).toBe(1);
    expect(playback.played.at(-1)).toContain('baseunderattack.mp3');
    // Critical lines do not take a queued informational line behind them.
    announcer.announce('unitReady');
    playback.finish();
    expect(playback.played).toHaveLength(2);
  });

  it('holds one informational line behind a non-critical line and expires it', () => {
    const playback = new RecordingPlayback();
    const { announcer, tick } = announcerWith(playback);
    announcer.announce('unitReady');
    expect(announcer.announce('productionUnderway')).toBe(false);
    playback.finish();
    expect(playback.played.at(-1)).toContain('productionunderway.mp3');
    playback.finish();
    expect(announcer.currentId).toBeNull();

    // A line that has waited too long is dropped rather than played out of context.
    announcer.announce('constructionComplete');
    const played = playback.played.length;
    announcer.announce('buildingSold');
    tick.advance(5000);
    playback.finish();
    expect(announcer.currentId).toBeNull();
    expect(playback.played).toHaveLength(played);
  });

  it('plays victory at most once per battle even after teardown', () => {
    const playback = new RecordingPlayback();
    const { announcer } = announcerWith(playback);
    announcer.announce('victory');
    playback.finish();
    expect(announcer.announce('victory')).toBe(false);
    announcer.reset();
    expect(announcer.announce('victory')).toBe(true);
  });

  it('survives a failing media element and clears the active line', () => {
    const playback = new RecordingPlayback();
    playback.play = () => {
      throw new Error('no audio device');
    };
    const { announcer } = announcerWith(playback);
    expect(announcer.announce('unitReady')).toBe(true);
    expect(announcer.currentId).toBeNull();
    expect(announcer.announce('constructionComplete')).toBe(true);
  });

  it('stops a stuck line instead of silencing the rest of the battle', () => {
    const playback = new RecordingPlayback();
    const { announcer, tick } = announcerWith(playback);
    announcer.announce('baseUnderAttack');
    tick.advance(12000);
    expect(announcer.currentId).toBeNull();
    expect(announcer.announce('victory')).toBe(true);
  });
});

describe('simulation transitions', () => {
  function barracksSite(game: Game): { x: number; z: number } {
    for (let z = 24; z <= 44; z++) {
      for (let x = 10; x <= 28; x++) {
        if (game.placementStatus(0, 'barracks', x, z).ok) return { x, z };
      }
    }
    throw new Error('no barracks site');
  }

  it('announces a completed structure once, at completion and not at placement', () => {
    const scenario = createIslandAssault();
    // The scenario opens with a player barracks under construction; remove it
    // so this test observes only the structure it places.
    scenario.structures = scenario.structures.filter((s) => s.defId !== 'barracks');
    const game = new Game(scenario, { enableAI: false });
    const site = barracksSite(game);
    game.enqueueCommand({ type: 'placeBuilding', team: 0, defId: 'barracks', tileX: site.x, tileZ: site.z });
    game.tick();
    expect(game.state.events.filter((e) => e.type === 'buildingPlaced')).toHaveLength(1);
    expect(game.state.events.filter((e) => e.type === 'buildingComplete')).toHaveLength(0);

    for (let i = 0; i < 20 * 60; i++) {
      const siteEntity = game.entitiesOf(0, 'building').find((e) => e.defId === 'barracks');
      if (siteEntity && !siteEntity.construction) break;
      game.tick();
    }

    expect(game.state.events.filter((e) => e.type === 'buildingComplete')).toHaveLength(1);
    const completed = game.state.events.find((e) => e.type === 'buildingComplete')!;
    expect(announcementForEvent(completed, 0)).toBe('constructionComplete');
    // Extra ticks after completion must not emit the transition again.
    game.advance(20 * 3);
    expect(game.state.events.filter((e) => e.type === 'buildingComplete')).toHaveLength(1);
  });

  it('announces one unit-ready transition per completed production item', () => {
    const game = new Game(createIslandAssault(), { enableAI: false });
    const hq = game.entitiesOf(0, 'building').find((e) => e.defId === 'commandPost')!;
    game.enqueueCommand({ type: 'produce', team: 0, buildingId: hq.id, defId: 'engineer' });
    game.advance(20 * 16);
    expect(game.state.events.filter((e) => e.code === 'productionStarted')).toHaveLength(1);
    const built = game.state.events.filter((e) => e.type === 'unitBuilt' && e.team === 0);
    expect(built).toHaveLength(1);
    expect(announcementForEvent(built[0], 0)).toBe('unitReady');
  });

  it('reports a real queue rejection once and coalesces repeated attack alerts', () => {
    const scenario = createIslandAssault();
    scenario.structures.push({ defId: 'factory', owner: 0, x: 30, z: 34 });
    const game = new Game(scenario, { enableAI: false });
    const factory = game.entitiesOf(0, 'building').find((e) => e.defId === 'factory')!;
    // Isolate the queue-capacity rejection from the affordability rule.
    game.player(0)!.mats = 10000;
    for (let i = 0; i < 5; i++) {
      game.enqueueCommand({ type: 'produce', team: 0, buildingId: factory.id, defId: 'tank' });
    }
    game.advance(1);
    game.enqueueCommand({ type: 'produce', team: 0, buildingId: factory.id, defId: 'tank' });
    game.advance(1);
    const rejected = game.state.events.filter((e) => e.code === 'queueFull');
    expect(rejected).toHaveLength(1);
    expect(announcementForEvent(rejected[0], 0)).toBe('queueFull');

    const hq = game.entitiesOf(0, 'building').find((e) => e.defId === 'commandPost')!;
    const raider = game.state.entities.find((e) => e.kind === 'unit' && e.owner === 1 && e.defId === 'tank')!;
    raider.x = hq.x + 70;
    raider.z = hq.z;
    game.enqueueCommand({ type: 'attack', team: 1, ids: [raider.id], targetId: hq.id });
    game.advance(20 * 8);
    const alerts = game.state.events.filter((e) => e.code === 'baseUnderAttack');
    expect(alerts).toHaveLength(1);
    expect(announcementForEvent(alerts[0], 0)).toBe('baseUnderAttack');
  });

  it('does not emit a player detection for a unit that stays hidden in fog', () => {
    const game = new Game(createIslandAssault(), { enableAI: false });
    const enemy = game.state.entities.find((e: Entity) => e.kind === 'unit' && e.owner === 1)!;
    enemy.x = 600;
    enemy.z = 600;
    game.advance(3);
    expect(game.state.events.filter((e) => e.code === 'enemyDetected')).toHaveLength(0);
  });
});

describe('audio settings gating', () => {
  class FakeAudio {
    src: string;
    volume = 1;
    preload = '';
    muted = false;
    paused = true;
    constructor(src?: string) {
      this.src = src ?? '';
    }
    play(): Promise<void> {
      this.paused = false;
      return Promise.resolve();
    }
    pause(): void {
      this.paused = true;
    }
    addEventListener(): void {}
    removeEventListener(): void {}
  }

  function startedEngine(): { audio: AudioEngine; created: FakeAudio[] } {
    const created: FakeAudio[] = [];
    class Constructed extends FakeAudio {
      constructor(src?: string) {
        super(src);
        created.push(this);
      }
    }
    vi.stubGlobal('Audio', Constructed);
    const audio = new AudioEngine();
    // The real game calls init() from the first user gesture; this test only
    // needs the playback path, not a Web Audio graph.
    (audio as unknown as { started: boolean }).started = true;
    return { audio, created };
  }

  it('requests the announcer asset through the shared audio engine', () => {
    const { audio, created } = startedEngine();
    audio.setVoiceVolume(0.8);
    audio.announce('unitReady');
    expect(created).toHaveLength(1);
    expect(created[0].src).toBe('/audio/battlesys/unitready.mp3');
  });

  it('stays silent when the game is muted or the announcer volume is zero', () => {
    const { audio, created } = startedEngine();
    audio.setMuted(true);
    audio.announce('victory');
    expect(created).toHaveLength(0);

    audio.setMuted(false);
    audio.setVoiceVolume(0);
    audio.announce('victory');
    expect(created).toHaveLength(0);
  });
});

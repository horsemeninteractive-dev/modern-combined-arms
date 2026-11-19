import { describe, expect, it } from 'vitest';
import {
  MISSION_FORMAT,
  MISSION_FORMAT_VERSION,
  MissionRuntime,
  dueInMissionCinematics,
  evaluateMissionTriggers,
  orderedCinematics,
  parseMission,
  validateMission,
  type MissionDoc,
} from '../src/mission';
import {
  CinematicPlayer,
  type CinematicActorStage,
  type CinematicWorld,
} from '../src/ui/cinematics';
import { Game } from '../src/sim/game';
import { parseScenario } from '../src/sim/scenario';
import { createIslandAssault } from '../src/data/scenarios';
import { CAMPAIGNS } from '../src/data/campaign';
import { validateCampaignDefinition } from '../src/campaign';

type Raw = Record<string, any>;

function cinematic(overrides: Raw = {}): Raw {
  return {
    id: 'scene',
    kind: 'opening',
    skippable: true,
    steps: [
      {
        kind: 'camera',
        target: { kind: 'position', x: 4, z: 4 },
        durationSeconds: 1,
      },
      { kind: 'line', speaker: 'Command', text: 'Move out.', durationSeconds: 2 },
    ],
    ...overrides,
  };
}

function missionRaw(cinematics: Raw[] = [cinematic()]): Raw {
  return {
    format: MISSION_FORMAT,
    version: MISSION_FORMAT_VERSION,
    id: 'op-cinematic-extension',
    title: 'Cinematic Extension',
    description: 'A mission that exercises the extended presentation model.',
    briefing: { summary: 'Hold.', friendly: 'A section.', enemy: 'A patrol.' },
    objectives: [{ id: 'win', title: 'Hold the line', kind: 'primary', dependsOn: [] }],
    variables: [],
    regions: [],
    triggers: [],
    aiGroups: [],
    reinforcements: [],
    entities: [],
    cinematics,
    consequences: [],
    carryover: { enabled: false, assets: [] },
  };
}

function parse(cinematics: Raw[] = [cinematic()]): MissionDoc {
  return parseMission(missionRaw(cinematics));
}

class TestCamera {
  cx = 0;
  cz = 0;
  zoom = 30;
  yaw?: number;
  screenLift = 0;
  screenLiftX = 0;
  centerOn(x: number, z: number): void {
    this.cx = x;
    this.cz = z;
  }
  setZoom(zoom: number): void {
    this.zoom = zoom;
  }
  setFraming(cx: number, cz: number, zoom: number, yaw?: number): void {
    this.cx = cx;
    this.cz = cz;
    this.zoom = zoom;
    if (yaw !== undefined) this.yaw = yaw;
  }
  setScreenLift(pixels: number, horizontal = 0): void {
    this.screenLift = pixels;
    this.screenLiftX = horizontal;
  }
}

class TestWorld implements CinematicWorld {
  readonly camera = new TestCamera();
  readonly entities = new Map<string, { x: number; z: number }>();
  restored: { cx: number; cz: number; zoom: number; yaw?: number } | null = null;
  reducedMotion = false;
  readonly effects: Array<{ kind: string; x: number; z: number; scale: number }> = [];
  readonly shakes: number[] = [];
  readonly voices: string[] = [];
  readonly sounds: Array<{ cue: string; gain: number }> = [];
  readonly staged = new Map<string, CinematicActorStage>();
  readonly stageHistory: Array<{ key: string; state: CinematicActorStage }> = [];
  readonly fires: Array<{ fromX: number; fromZ: number; toX: number; toZ: number; scale: number }> = [];
  clearedActors = 0;
  stopped = 0;
  resolveEntity(key: string) {
    return this.entities.get(key) ?? null;
  }
  resolveActor(key: string) {
    const point = this.entities.get(key);
    return point ? { ...point, facing: 0, alpha: 1 } : null;
  }
  stageActor(key: string, state: CinematicActorStage): void {
    const next = { ...this.staged.get(key), ...state };
    this.staged.set(key, next);
    this.stageHistory.push({ key, state: next });
  }
  clearActors(): void {
    this.clearedActors += 1;
    this.staged.clear();
  }
  fire(fromX: number, fromZ: number, toX: number, toZ: number, scale: number): void {
    this.fires.push({ fromX, fromZ, toX, toZ, scale });
  }
  restoreCamera(state: { cx: number; cz: number; zoom: number; yaw?: number }): void {
    this.restored = state;
    this.camera.setFraming(state.cx, state.cz, state.zoom, state.yaw);
  }
  shake(amount: number): void {
    this.shakes.push(amount);
  }
  effect(kind: string, x: number, z: number, scale: number): void {
    this.effects.push({ kind, x, z, scale });
  }
  playVoice(src: string): void {
    this.voices.push(src);
  }
  stopVoice(): void {
    this.stopped += 1;
  }
  sound(cue: string, gain: number): void {
    this.sounds.push({ cue, gain });
  }
}

describe('cinematic presentation schema', () => {
  it('accepts every campaign presentation context', () => {
    const contexts = [
      'opening',
      'briefing',
      'inMission',
      'debrief',
      'intermission',
      'ending',
    ];
    const doc = parse(
      contexts.map((kind, index) =>
        cinematic({
          id: kind,
          kind,
          ...(kind === 'inMission' ? { atSeconds: 20 } : {}),
          steps: [{ kind: 'line', speaker: 'Command', text: `Line ${index}`, durationSeconds: 1 }],
        }),
      ),
    );
    expect(doc.cinematics.map((entry) => entry.kind)).toEqual(contexts);
  });

  it('parses presentation metadata, effects and camera extensions', () => {
    const doc = parse([
      cinematic({
        steps: [
          {
            kind: 'camera',
            target: { kind: 'entity', entity: 'own-hq' },
            durationSeconds: 2,
            holdSeconds: 1,
            rotationDegrees: 90,
            track: true,
            shake: 0.4,
            ease: 'linear',
          },
          {
            kind: 'line',
            speaker: 'Sgt. Raudonė',
            text: 'Contact.',
            durationSeconds: 2,
            portrait: 'assets/portraits/raudone.webp',
            voice: 'assets/voice/contact.mp3',
            radio: true,
          },
          { kind: 'notify', heading: 'Kestrel Bay · 06:20', text: 'First light.', durationSeconds: 3 },
          { kind: 'effect', effect: 'explosion', target: { kind: 'restore' }, scale: 1.4 },
          { kind: 'sound', cue: 'alert', gain: 0.5 },
        ],
      }),
    ]);
    expect(doc.cinematics[0].steps[0]).toMatchObject({
      track: true,
      rotationDegrees: 90,
      shake: 0.4,
      ease: 'linear',
    });
    expect(doc.cinematics[0].steps[1]).toMatchObject({ radio: true, portrait: 'assets/portraits/raudone.webp' });
    expect(doc.cinematics[0].steps[2]).toMatchObject({ heading: 'Kestrel Bay · 06:20' });
    expect(doc.cinematics[0].steps[3]).toMatchObject({ kind: 'effect', scale: 1.4 });
    expect(doc.cinematics[0].steps[4]).toMatchObject({ kind: 'sound', cue: 'alert', gain: 0.5 });
  });

  it('keeps a legacy story without the extended fields valid', () => {
    const doc = parse([
      {
        id: 'legacy',
        kind: 'ending',
        skippable: true,
        dialogue: [{ speaker: 'Command', line: 'The line holds.' }],
      },
    ]);
    expect(doc.cinematics[0].steps).toHaveLength(1);
    expect(validateMission(doc).filter((issue) => issue.severity === 'error')).toEqual([]);
  });

  it('rejects an out-of-range camera rotation', () => {
    const doc = parse([
      cinematic({
        steps: [
          {
            kind: 'camera',
            target: { kind: 'entity', entity: 'own-hq' },
            rotationDegrees: 45,
            durationSeconds: 0,
          },
        ],
      }),
    ]);
    const step = doc.cinematics[0].steps[0];
    if (step.kind === 'camera') step.rotationDegrees = 361;
    expect(
      validateMission(doc).some((issue) => issue.code === 'cinematic-rotation-invalid'),
    ).toBe(true);
  });

  it('rejects a campaign-only context inside a mission document', () => {
    expect(() => parse([cinematic({ kind: 'campaignIntro' })])).toThrow(
      /cinematic-context-misplaced/,
    );
  });
});

describe('multiple sequences and ordering', () => {
  it('plays every sequence of a framing context in document order', () => {
    const doc = parse([
      cinematic({ id: 'first' }),
      cinematic({ id: 'second' }),
    ]);
    expect(orderedCinematics(doc.cinematics, 'opening').map((entry) => entry.id)).toEqual([
      'first',
      'second',
    ]);
    const issues = validateMission(doc);
    expect(issues.some((issue) => issue.code === 'cinematic-context-multiple')).toBe(true);
    expect(issues.some((issue) => issue.code === 'cinematic-context-duplicate')).toBe(false);
  });

  it('orders in-mission scenes by time, with document order breaking ties', () => {
    const doc = parse([
      cinematic({ id: 'late', kind: 'inMission', atSeconds: 20 }),
      cinematic({ id: 'tie-a', kind: 'inMission', atSeconds: 10 }),
      cinematic({ id: 'tie-b', kind: 'inMission', atSeconds: 10 }),
    ]);
    expect(orderedCinematics(doc.cinematics, 'inMission').map((entry) => entry.id)).toEqual([
      'tie-a',
      'tie-b',
      'late',
    ]);
    expect(
      dueInMissionCinematics(doc.cinematics, 10, new Set(['tie-a'])).map((entry) => entry.id),
    ).toEqual(['tie-b']);
  });
});

describe('extended cinematic player', () => {
  function playable(): { doc: MissionDoc; world: TestWorld; player: CinematicPlayer } {
    const doc = parse([
      cinematic({
        steps: [
          {
            kind: 'camera',
            target: { kind: 'entity', entity: 'convoy' },
            durationSeconds: 2,
            track: true,
            shake: 0.5,
          },
          {
            kind: 'line',
            speaker: 'Command',
            text: 'Hold.',
            durationSeconds: 2,
            voice: 'assets/voice/hold.mp3',
            radio: true,
          },
          {
            kind: 'effect',
            effect: 'explosion',
            target: { kind: 'entity', entity: 'convoy' },
            scale: 2,
            durationSeconds: 0.1,
          },
          { kind: 'sound', cue: 'alert', gain: 0.6 },
        ],
      }),
    ]);
    const world = new TestWorld();
    world.camera.cx = 10;
    world.camera.cz = 20;
    world.entities.set('convoy', { x: 100, z: 200 });
    return { doc, world, player: new CinematicPlayer(doc.cinematics[0], world) };
  }

  it('tracks a moving entity and pulses shake', () => {
    const { world, player } = playable();
    player.start();
    player.update(1);
    expect(world.camera.cx).toBeCloseTo(55, 4);
    expect(world.shakes).toEqual([0.5]);
    world.entities.set('convoy', { x: 300, z: 400 });
    player.update(0.5);
    expect(world.camera.cx).toBeGreaterThan(60);
  });

  it('plays voice, switches to the radio line, and fires an effect', () => {
    const { world, player } = playable();
    player.start();
    player.update(2);
    expect(world.voices).toEqual(['assets/voice/hold.mp3']);
    expect(player.frame.radio).toBe(true);
    expect(player.frame.line).toBe('Hold.');
    player.update(2);
    expect(world.stopped).toBeGreaterThan(0);
    expect(world.effects).toEqual([{ kind: 'explosion', x: 100, z: 200, scale: 2 }]);
    player.update(2);
    expect(world.sounds).toEqual([{ cue: 'alert', gain: 0.6 }]);
  });

  it('pauses without losing progress and resumes deterministically', () => {
    const { world, player } = playable();
    player.start();
    player.update(1);
    const cx = world.camera.cx;
    player.pause();
    player.update(10);
    expect(world.camera.cx).toBe(cx);
    expect(player.frame.paused).toBe(true);
    player.resume();
    player.update(1);
    expect(world.camera.cx).toBeGreaterThan(cx);
  });

  it('seeks to a beat and reconstructs the camera framing', () => {
    const { doc, world, player } = playable();
    player.start();
    expect(player.seekToStep(2)).toBe(true);
    expect(world.camera.cx).toBe(100);
    expect(world.camera.cz).toBe(200);
    expect(doc.cinematics[0].steps[2].kind).toBe('effect');
  });

  it('returns to the scene-start framing with a restore beat', () => {
    const doc = parse([
      cinematic({
        steps: [
          { kind: 'camera', target: { kind: 'position', x: 40, z: 40 }, durationSeconds: 0 },
          { kind: 'camera', target: { kind: 'restore' }, durationSeconds: 1 },
        ],
      }),
    ]);
    const world = new TestWorld();
    world.camera.cx = 5;
    world.camera.cz = 9;
    world.camera.zoom = 25;
    const player = new CinematicPlayer(doc.cinematics[0], world);
    player.update(0.1);
    player.update(1);
    expect(world.camera.cx).toBeCloseTo(5, 4);
    expect(world.camera.cz).toBeCloseTo(9, 4);
    expect(world.camera.zoom).toBeCloseTo(25, 4);
  });

  it('interpolates an authored camera orbit and restores the original yaw', () => {
    const doc = parse([
      cinematic({
        steps: [
          {
            kind: 'camera',
            target: { kind: 'position', x: 40, z: 40 },
            rotationDegrees: 90,
            durationSeconds: 2,
          },
          { kind: 'notify', text: 'Held.', durationSeconds: 1 },
        ],
      }),
    ]);
    const world = new TestWorld();
    world.camera.cx = 5;
    world.camera.cz = 9;
    world.camera.zoom = 25;
    world.camera.yaw = 0.2;
    const player = new CinematicPlayer(doc.cinematics[0], world);
    player.start();
    expect(world.camera.yaw).toBeCloseTo(0.2, 6);
    player.update(1);
    expect(world.camera.yaw).toBeCloseTo(0.2 + (Math.PI / 2 - 0.2) / 2, 4);
    player.update(1);
    expect(world.camera.yaw).toBeCloseTo(Math.PI / 2, 4);
    player.update(1);
    expect(world.camera.yaw).toBeCloseTo(0.2, 6);
    expect(world.restored?.yaw).toBeCloseTo(0.2, 6);
  });
});

describe('actor staging beats', () => {
  function actorDoc(steps: Raw[]): MissionDoc {
    return parse([cinematic({ steps })]);
  }

  it('parses every presentation-only actor action', () => {
    const doc = actorDoc([
      { kind: 'actor', action: 'move', entity: 'squad', x: 4, z: 4, durationSeconds: 2, ease: 'linear' },
      { kind: 'actor', action: 'turn', entity: 'squad', facingDegrees: 90, durationSeconds: 1 },
      { kind: 'actor', action: 'animate', entity: 'squad', pose: 'walk', durationSeconds: 1 },
      { kind: 'actor', action: 'fire', entity: 'squad', target: { kind: 'entity', entity: 'bunker' }, scale: 2, durationSeconds: 1 },
      { kind: 'actor', action: 'enter', entity: 'squad', structure: 'bunker', durationSeconds: 1 },
      { kind: 'actor', action: 'leave', entity: 'squad', structure: 'bunker', x: 6, z: 6, durationSeconds: 1 },
      { kind: 'actor', action: 'appear', entity: 'squad', durationSeconds: 1 },
      { kind: 'actor', action: 'disappear', entity: 'squad', durationSeconds: 1 },
    ]);
    expect(doc.cinematics[0].steps.map((step) => (step.kind === 'actor' ? step.action : step.kind))).toEqual([
      'move',
      'turn',
      'animate',
      'fire',
      'enter',
      'leave',
      'appear',
      'disappear',
    ]);
    expect(doc.cinematics[0].steps[0]).toMatchObject({ ease: 'linear', x: 4, z: 4 });
    expect(doc.cinematics[0].steps[3]).toMatchObject({ target: { kind: 'entity', entity: 'bunker' }, scale: 2 });
  });

  it('stages a move, turn, fire, animation and fade without touching the entity', () => {
    const doc = actorDoc([
      { kind: 'actor', action: 'move', entity: 'squad', x: 4, z: 4, durationSeconds: 2 },
      { kind: 'actor', action: 'turn', entity: 'squad', facingDegrees: 90, durationSeconds: 1 },
      { kind: 'actor', action: 'fire', entity: 'squad', target: { kind: 'entity', entity: 'bunker' }, scale: 2, durationSeconds: 1 },
      { kind: 'actor', action: 'animate', entity: 'squad', pose: 'walk', durationSeconds: 1 },
      { kind: 'actor', action: 'disappear', entity: 'squad', durationSeconds: 1 },
      { kind: 'actor', action: 'appear', entity: 'squad', durationSeconds: 1 },
    ]);
    const world = new TestWorld();
    world.entities.set('squad', { x: 10, z: 10 });
    world.entities.set('bunker', { x: 40, z: 40 });
    const player = new CinematicPlayer(doc.cinematics[0], world);
    player.start();
    player.update(1);
    // Halfway through a smooth move to tile 4,4 (world 18,18).
    expect(world.staged.get('squad')?.x).toBeCloseTo(14, 4);
    expect(world.staged.get('squad')?.z).toBeCloseTo(14, 4);
    expect(world.entities.get('squad')).toEqual({ x: 10, z: 10 });
    player.update(1);
    expect(world.staged.get('squad')?.x).toBeCloseTo(18, 4);
    player.update(1);
    expect(world.staged.get('squad')?.facing).toBeCloseTo(Math.PI / 2, 4);
    expect(world.fires).toEqual([{ fromX: 18, fromZ: 18, toX: 40, toZ: 40, scale: 2 }]);
    player.update(1);
    expect(world.staged.get('squad')?.pose).toBe('walk');
    player.update(1);
    expect(world.staged.get('squad')?.pose).toBeNull();
    player.update(1);
    expect(world.staged.get('squad')?.alpha).toBe(0);
    player.update(1);
    expect(world.clearedActors).toBe(1);
    expect(world.entities.get('squad')).toEqual({ x: 10, z: 10 });
  });

  it('enters and leaves a structure as a fade, not a teleport in the simulation', () => {
    const doc = actorDoc([
      { kind: 'actor', action: 'enter', entity: 'squad', structure: 'bunker', durationSeconds: 2 },
      { kind: 'actor', action: 'leave', entity: 'squad', structure: 'bunker', x: 6, z: 6, durationSeconds: 2 },
    ]);
    const world = new TestWorld();
    world.entities.set('squad', { x: 10, z: 10 });
    world.entities.set('bunker', { x: 40, z: 40 });
    const player = new CinematicPlayer(doc.cinematics[0], world);
    player.start();
    player.update(2);
    expect(world.staged.get('squad')).toMatchObject({ x: 40, z: 40, alpha: 0 });
    player.update(1);
    expect(world.staged.get('squad')?.x).toBeCloseTo(33, 4);
    expect(world.staged.get('squad')?.alpha).toBeCloseTo(0.5, 4);
    player.update(1);
    expect(world.clearedActors).toBe(1);
    expect(world.entities.get('squad')).toEqual({ x: 10, z: 10 });
    expect(world.entities.get('bunker')).toEqual({ x: 40, z: 40 });
  });

  it('leaves a missing actor as a no-op instead of inventing one', () => {
    const doc = actorDoc([
      { kind: 'actor', action: 'move', entity: 'ghost', x: 4, z: 4, durationSeconds: 1 },
    ]);
    const world = new TestWorld();
    const player = new CinematicPlayer(doc.cinematics[0], world);
    player.start();
    player.update(1);
    expect(world.stageHistory).toEqual([]);
    expect(world.clearedActors).toBe(1);
  });

  it('validates actor destinations, poses, targets and structure references', () => {
    const doc = actorDoc([
      { kind: 'actor', action: 'move', entity: 'squad', x: 4, z: 4, durationSeconds: 1 },
      { kind: 'actor', action: 'fire', entity: 'squad', target: { kind: 'position', x: 4, z: 4 }, durationSeconds: 1 },
      { kind: 'actor', action: 'enter', entity: 'squad', structure: 'bunker', durationSeconds: 1 },
    ]);
    const move = doc.cinematics[0].steps[0];
    if (move.kind === 'actor' && move.action === 'move') move.x = 99;
    const fire = doc.cinematics[0].steps[1];
    if (fire.kind === 'actor' && fire.action === 'fire') fire.target = { kind: 'restore' };
    const enter = doc.cinematics[0].steps[2];
    if (enter.kind === 'actor' && enter.action === 'enter') enter.structure = 'squad';
    const issues = validateMission(doc, {
      width: 10,
      height: 10,
      entityKeys: new Set(['squad', 'bunker']),
    });
    expect(issues.some((issue) => issue.code === 'cinematic-target-outside')).toBe(true);
    expect(issues.some((issue) => issue.code === 'cinematic-target-invalid')).toBe(true);
    expect(issues.some((issue) => issue.code === 'cinematic-structure-self')).toBe(true);
    expect(() =>
      actorDoc([
        { kind: 'actor', action: 'animate', entity: 'squad', pose: 'run', durationSeconds: 1 },
      ]),
    ).toThrow();
  });
});

describe('cinematic triggers', () => {
  function triggerDoc(): MissionDoc {
    const doc = parse([
      cinematic({
        id: 'ambush',
        kind: 'inMission',
        atSeconds: 60,
        steps: [{ kind: 'line', speaker: 'Command', text: 'Ambush.', durationSeconds: 1 }],
      }),
    ]);
    doc.triggers.push({
      id: 'fire',
      once: true,
      conditions: [{ kind: 'elapsed', seconds: 0 }],
      actions: [{ kind: 'startCinematic', cinematic: 'ambush' }],
    });
    return doc;
  }

  it('requests a sequence without changing mission state', () => {
    const doc = triggerDoc();
    const runtime = MissionRuntime.fromDoc(doc);
    const before = JSON.stringify({
      variables: runtime.variables,
      objectives: runtime.objectives,
      outcome: runtime.outcome,
    });
    const requested: string[] = [];
    evaluateMissionTriggers(
      runtime,
      { tick: 0, startedAtTick: 0, units: [], aliveAuthored: new Set() },
      {
        message: () => {},
        objectiveChanged: () => {},
        cinematicRequested: (id) => requested.push(id),
      },
    );
    expect(requested).toEqual(['ambush']);
    // Only the trigger's own latches move. Mission variables, objectives and
    // outcome are untouched by a presentation request.
    expect(
      JSON.stringify({
        variables: runtime.variables,
        objectives: runtime.objectives,
        outcome: runtime.outcome,
      }),
    ).toBe(before);
  });

  it('rejects an unknown cinematic and a non-in-mission reference', () => {
    const unknown = parse([cinematic()]);
    unknown.triggers.push({
      id: 'fire',
      once: true,
      conditions: [{ kind: 'elapsed', seconds: 0 }],
      actions: [{ kind: 'startCinematic', cinematic: 'missing' }],
    });
    expect(validateMission(unknown).some((issue) => issue.code === 'action-cinematic-missing')).toBe(
      true,
    );
    const wrongContext = parse([cinematic()]);
    wrongContext.triggers.push({
      id: 'fire',
      once: true,
      conditions: [{ kind: 'elapsed', seconds: 0 }],
      actions: [{ kind: 'startCinematic', cinematic: 'scene' }],
    });
    expect(validateMission(wrongContext).some((issue) => issue.code === 'action-cinematic-context')).toBe(
      true,
    );
  });

  it('hands trigger requests to presentation once and never through a save', () => {
    const base = createIslandAssault();
    const raw = JSON.parse(JSON.stringify(base)) as Raw;
    const start = base.players[0];
    raw.units.push({ defId: 'rifle', owner: 0, x: start.startX, z: start.startZ, key: 'village-rifles' });
    raw.mission = {
      ...missionRaw([
        cinematic({
          id: 'ambush',
          kind: 'inMission',
          atSeconds: 60,
          steps: [{ kind: 'line', speaker: 'Command', text: 'Ambush.', durationSeconds: 1 }],
        }),
      ]),
      triggers: [
        {
          id: 'fire',
          once: true,
          conditions: [{ kind: 'elapsed', seconds: 0 }],
          actions: [{ kind: 'startCinematic', cinematic: 'ambush' }],
        },
      ],
    };
    const game = new Game(parseScenario(raw), { enableAI: false });
    game.advance(2);
    expect(game.consumeCinematicRequests()).toEqual(['ambush']);
    expect(game.consumeCinematicRequests()).toEqual([]);
    const restored = Game.fromSave(JSON.parse(JSON.stringify(game.toSave())), { enableAI: false });
    expect(restored.consumeCinematicRequests()).toEqual([]);
  });
});

describe('campaign cinematic definitions', () => {
  it('rejects a mission-only context and a broken campaign scene', () => {
    const def = JSON.parse(JSON.stringify(CAMPAIGNS[0]));
    def.cinematics = [
      {
        id: 'intro',
        kind: 'opening',
        skippable: true,
        steps: [],
        dialogue: [],
      },
    ];
    const issues = validateCampaignDefinition(def);
    expect(issues.some((issue) => issue.code === 'campaign-cinematic-context')).toBe(true);
    expect(issues.some((issue) => issue.code === 'campaign-cinematic-empty')).toBe(true);
  });

  it('accepts campaign introduction, intermission and finale sequences', () => {
    const def = JSON.parse(JSON.stringify(CAMPAIGNS[0]));
    def.cinematics = ['campaignIntro', 'intermission', 'campaignFinale'].map((kind) => ({
      id: kind,
      kind,
      skippable: true,
      steps: [{ kind: 'line', speaker: 'Command', text: 'The line holds.', durationSeconds: 2 }],
      dialogue: [],
    }));
    const issues = validateCampaignDefinition(def);
    expect(
      issues.filter(
        (issue) => issue.severity === 'error' && issue.code.startsWith('campaign-cinematic'),
      ),
    ).toEqual([]);
  });
});
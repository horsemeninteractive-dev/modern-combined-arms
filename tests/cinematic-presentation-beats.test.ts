import { describe, expect, it } from 'vitest';
import {
  MISSION_FORMAT,
  MISSION_FORMAT_VERSION,
  parseMission,
  validateMission,
  type MissionDoc,
} from '../src/mission';
import {
  CinematicPlayer,
  cinematicSeconds,
  type CinematicActorStage,
  type CinematicWorld,
} from '../src/ui/cinematics';
import { CAMPAIGNS } from '../src/data/campaign';
import { validateCampaignDefinition } from '../src/campaign';

type Raw = Record<string, any>;

function scene(overrides: Raw = {}): Raw {
  return {
    id: 'presentation',
    kind: 'opening',
    skippable: true,
    steps: [
      { kind: 'camera', target: { kind: 'position', x: 4, z: 4 }, durationSeconds: 2 },
      { kind: 'line', speaker: 'Command', text: 'Move out.', durationSeconds: 2 },
    ],
    ...overrides,
  };
}

function missionRaw(cinematics: Raw[] = [scene()]): Raw {
  return {
    format: MISSION_FORMAT,
    version: MISSION_FORMAT_VERSION,
    id: 'op-presentation-beats',
    title: 'Presentation Beats',
    description: 'A mission that exercises transitions, cards and music cues.',
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

function parse(cinematics: Raw[] = [scene()]): MissionDoc {
  return parseMission(missionRaw(cinematics));
}

class TestCamera {
  cx = 0;
  cz = 0;
  zoom = 30;
  yaw?: number;
  setFraming(cx: number, cz: number, zoom: number, yaw?: number): void {
    this.cx = cx;
    this.cz = cz;
    this.zoom = zoom;
    if (yaw !== undefined) this.yaw = yaw;
  }
  centerOn(x: number, z: number): void {
    this.cx = x;
    this.cz = z;
  }
  setZoom(zoom: number): void {
    this.zoom = zoom;
  }
  setScreenLift(): void {}
}

class TestWorld implements CinematicWorld {
  readonly camera = new TestCamera();
  reducedMotion = false;
  readonly music: string[] = [];
  resolveEntity(): { x: number; z: number } | null {
    return null;
  }
  stageActor(_key: string, _stage: CinematicActorStage): void {}
  restoreCamera(): void {}
  playMusic(track: string): void {
    this.music.push(track);
  }
}

const presentationSteps: Raw[] = [
  { kind: 'camera', target: { kind: 'position', x: 4, z: 4 }, durationSeconds: 2 },
  { kind: 'card', heading: 'CHAPTER II', subheading: 'The eastern corridor', body: 'Dawn.', durationSeconds: 2 },
  { kind: 'music', track: 'forward-command', durationSeconds: 0 },
  { kind: 'line', speaker: 'Command', text: 'Move out.', durationSeconds: 2 },
];

describe('cinematic transitions, cards and music cues', () => {
  it('parses authored edge transitions and the new beats', () => {
    const doc = parse([
      scene({
        transition: {
          in: { kind: 'fade', durationSeconds: 0.8 },
          out: { kind: 'fade', durationSeconds: 1.2 },
        },
        steps: presentationSteps,
      }),
    ]);
    const cinematic = doc.cinematics[0];
    expect(cinematic.transition).toEqual({
      in: { kind: 'fade', durationSeconds: 0.8 },
      out: { kind: 'fade', durationSeconds: 1.2 },
    });
    expect(cinematic.steps[1]).toEqual({
      kind: 'card',
      heading: 'CHAPTER II',
      subheading: 'The eastern corridor',
      body: 'Dawn.',
      durationSeconds: 2,
    });
    expect(cinematic.steps[2]).toEqual({ kind: 'music', track: 'forward-command', durationSeconds: 0 });
  });

  it('defaults to no authored transition, so older scenes still hard cut', () => {
    const cinematic = parse().cinematics[0];
    expect(cinematic.transition).toBeUndefined();
    expect(cinematic.steps).toHaveLength(2);
  });

  it('counts a card and a music hold in the scene clock', () => {
    const doc = parse([scene({ steps: presentationSteps })]);
    // 2 camera + 2 card + 0 music + 2 line.
    expect(cinematicSeconds(doc.cinematics[0])).toBeCloseTo(6, 5);
  });

  it('dips the frame through black at the authored edges', () => {
    const doc = parse([
      scene({
        transition: {
          in: { kind: 'fade', durationSeconds: 0.8 },
          out: { kind: 'fade', durationSeconds: 1 },
        },
        steps: [
          { kind: 'line', speaker: 'Command', text: 'One.', durationSeconds: 3 },
          { kind: 'line', speaker: 'Command', text: 'Two.', durationSeconds: 3 },
        ],
      }),
    ]);
    const world = new TestWorld();
    const player = new CinematicPlayer(doc.cinematics[0], world);
    player.start();
    expect(player.frame.veil).toBeCloseTo(1, 5);
    player.update(0.4);
    expect(player.frame.veil).toBeCloseTo(0.5, 5);
    player.update(0.5);
    expect(player.frame.veil).toBe(0);
    // The out fade covers the final second of a six-second scene, which starts
    // at 5.0s of presentation time.
    player.update(4.6);
    expect(player.frame.veil).toBeCloseTo(0.5, 5);
    player.update(0.45);
    expect(player.frame.veil).toBeGreaterThan(0.9);
  });

  it('skips the dip for reduced motion but keeps the authored timing', () => {
    const doc = parse([
      scene({ transition: { in: { kind: 'fade', durationSeconds: 1 } }, steps: presentationSteps }),
    ]);
    const world = new TestWorld();
    world.reducedMotion = true;
    const player = new CinematicPlayer(doc.cinematics[0], world);
    player.start();
    expect(player.frame.veil).toBe(0);
    expect(player.totalSeconds).toBeCloseTo(6, 5);
  });

  it('shows a chapter card for its beat and starts a music cue', () => {
    const doc = parse([scene({ steps: presentationSteps })]);
    const world = new TestWorld();
    const player = new CinematicPlayer(doc.cinematics[0], world);
    player.start();
    expect(player.frame.card).toBeNull();
    player.update(2.1);
    expect(player.frame.card).toEqual({
      heading: 'CHAPTER II',
      subheading: 'The eastern corridor',
      body: 'Dawn.',
    });
    player.update(2);
    expect(player.frame.card).toBeNull();
    expect(world.music).toEqual(['forward-command']);
  });

  it('rejects unknown soundtrack tracks and empty card headings', () => {
    const doc = parse([scene({ steps: presentationSteps })]);
    const steps = doc.cinematics[0].steps;
    (steps[1] as Extract<(typeof steps)[number], { kind: 'card' }>).heading = '  ';
    (steps[2] as Extract<(typeof steps)[number], { kind: 'music' }>).track = 'not-a-track';
    const codes = validateMission(doc).map((issue) => issue.code);
    expect(codes).toContain('cinematic-card-heading');
    expect(codes).toContain('cinematic-music-track');
  });

  it('reports an authored fade with no duration as a warning, not a defect', () => {
    const doc = parse([
      scene({ transition: { out: { kind: 'fade', durationSeconds: 0 } } }),
    ]);
    const issues = validateMission(doc).filter(
      (issue) => issue.code === 'cinematic-transition-zero',
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('warning');
  });

  it('validates campaign framing scenes the same way', () => {
    const def = CAMPAIGNS[0];
    const issues = validateCampaignDefinition({
      ...def,
      cinematics: [
        {
          id: 'intro',
          kind: 'campaignIntro',
          skippable: true,
          transition: { in: { kind: 'fade', durationSeconds: 0.5 } },
          steps: [
            { kind: 'card', heading: '', durationSeconds: 2 },
            { kind: 'music', track: 'contested-ground', durationSeconds: 1 },
          ],
          dialogue: [],
        },
      ],
    });
    const codes = issues.map((issue) => issue.code);
    expect(codes).toContain('campaign-cinematic-card');
    expect(codes).not.toContain('campaign-cinematic-music');
    expect(codes).not.toContain('campaign-cinematic-transition');
  });
});

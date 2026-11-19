import { describe, expect, it } from 'vitest';
import {
  MISSION_FORMAT,
  MISSION_FORMAT_VERSION,
  MissionFormatError,
  parseMission,
  type MissionDoc,
  type MissionResult,
} from '../src/mission';
import {
  CinematicPlayer,
  cinematicEase,
  cinematicPausesSimulation,
  cinematicSeconds,
  cinematicWorldPoint,
  interpolateCamera,
  localiseCinematic,
  type CinematicCamera,
  type CinematicCameraState,
  type CinematicWorld,
} from '../src/ui/cinematics';
import {
  briefingObjectiveRows,
  briefingText,
  missionBriefingMarkup,
} from '../src/ui/missionBriefing';
import { missionDebriefMarkup, missionOutcomeCopy } from '../src/ui/missionDebrief';
import { defaultComposition } from '../src/identity/flag';
import { CAMPAIGNS } from '../src/data/campaign';
import { TILE_SIZE } from '../src/sim/constants';
import {
  campaignResultOutlook,
  createCampaignState,
  launchCampaignMission,
  submitCampaignResult,
} from '../src/campaign';

type Raw = Record<string, any>;

const OBJECTIVES = [
  { id: 'ridge', title: 'Secure the ridge', kind: 'primary', dependsOn: [] },
  { id: 'convoy', title: 'Secret convoy', kind: 'secondary', dependsOn: [], initialState: 'hidden' },
  { id: 'sweep', title: 'Clean sweep', kind: 'bonus', dependsOn: ['ridge'] },
];

function cinematic(overrides: Raw = {}): Raw {
  return {
    id: 'opening',
    kind: 'opening',
    skippable: true,
    steps: [
      {
        kind: 'camera',
        target: { kind: 'entity', entity: 'own-hq' },
        zoom: 24,
        durationSeconds: 2,
      },
      { kind: 'line', speaker: 'Command', text: 'Move out.', durationSeconds: 3 },
    ],
    ...overrides,
  };
}

function missionRaw(overrides: Raw = {}): Raw {
  return {
    format: MISSION_FORMAT,
    version: MISSION_FORMAT_VERSION,
    id: 'op-presentation',
    title: 'Presentation Exercise',
    description: 'A mission used to test briefing and playback data.',
    briefing: {
      summary: '{{callsign}} holds the ridge.',
      friendly: 'A reinforced company.',
      enemy: 'A screening force.',
      subtitle: 'Defensive · Land',
      context: 'The ridge anchors the supply route.',
      commanderNote: 'Keep the ridge, {{name}}.',
      enemyIntent: 'Probe the eastern approach before dawn.',
      personnel: ['Sgt. Example'],
      instructions: ['Dig in before first light.', 'Keep the command post intact.'],
    },
    debrief: {
      victory: 'The ridge is held and the route is open.',
      defeat: 'The ridge is lost; the route is closed.',
    },
    objectives: OBJECTIVES,
    variables: [],
    regions: [],
    triggers: [],
    aiGroups: [],
    reinforcements: [],
    entities: [{ key: 'own-hq', name: 'Command Post', role: 'protected' }],
    cinematics: [cinematic()],
    consequences: [],
    carryover: { enabled: false, assets: [] },
    ...overrides,
  };
}

function parse(overrides: Raw = {}): MissionDoc {
  return parseMission(missionRaw(overrides));
}

class TestCamera implements CinematicCamera {
  cx = 0;
  cz = 0;
  zoom = 40;
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
  restored: CinematicCameraState | null = null;
  reducedMotion = false;

  resolveEntity(key: string): { x: number; z: number } | null {
    return this.entities.get(key) ?? null;
  }

  restoreCamera(state: CinematicCameraState): void {
    this.restored = state;
    this.camera.setFraming(state.cx, state.cz, state.zoom, state.yaw);
  }
}

function playableWorld(): TestWorld {
  const world = new TestWorld();
  world.camera.cx = 10;
  world.camera.cz = 20;
  world.camera.zoom = 30;
  world.entities.set('own-hq', { x: 100, z: 200 });
  return world;
}

describe('structured mission briefing', () => {
  it('parses the authored dossier and debrief copy', () => {
    const doc = parse();
    expect(doc.briefing.subtitle).toBe('Defensive · Land');
    expect(doc.briefing.context).toContain('supply route');
    expect(doc.briefing.personnel).toEqual(['Sgt. Example']);
    expect(doc.briefing.instructions).toHaveLength(2);
    expect(doc.debrief?.victory).toContain('ridge is held');
  });

  it('resolves commander tokens without touching the authored document', () => {
    const doc = parse();
    expect(briefingText(doc.briefing.summary, { name: 'Ana Reyes', callsign: 'Kestrel' })).toBe(
      'Kestrel holds the ridge.',
    );
    expect(briefingText(doc.briefing.summary, null)).toBe('{{callsign}} holds the ridge.');
  });

  it('renders categories and omits hidden objectives', () => {
    const doc = parse();
    const markup = missionBriefingMarkup(doc, {
      commander: { name: 'Ana Reyes', callsign: 'Kestrel' },
      code: 'BALTIC / 09',
    });
    expect(markup).toContain('Secure the ridge');
    expect(markup).toContain('PRIMARY');
    expect(markup).toContain('Clean sweep');
    expect(markup).toContain('BONUS');
    // A trigger-gated objective is not named until the mission reveals it.
    expect(markup).not.toContain('Secret convoy');
    expect(markup).toContain('Kestrel holds the ridge.');
    expect(markup).toContain('Ana Reyes');
    expect(markup).toContain('Sgt. Example');
  });

  it('omits absent optional sections', () => {
    const doc = parse({
      briefing: { summary: 'Situation.', friendly: 'Friendlies.', enemy: 'Enemy.' },
      debrief: undefined,
    });
    const markup = missionBriefingMarkup(doc);
    expect(markup).not.toContain('NAMED PERSONNEL');
    expect(markup).not.toContain('ENEMY INTENT');
    expect(markup).not.toContain('INSTRUCTIONS');
    expect(markup).not.toContain('COMMANDER NOTE');
    expect(briefingObjectiveRows(doc, null).map((row) => row.id)).toEqual(['ridge', 'sweep']);
  });

  it('rejects an authored empty instruction rather than silently dropping it', () => {
    const raw = missionRaw();
    raw.briefing.instructions = ['Dig in.', '  '];
    expect(() => parseMission(raw)).toThrow(/briefing\.instructions\[1\]/);
  });
});

describe('cinematic data', () => {
  it('parses a typed timeline and keeps its dialogue view', () => {
    const doc = parse();
    const sequence = doc.cinematics[0];
    expect(sequence.kind).toBe('opening');
    expect(sequence.steps).toHaveLength(2);
    expect(sequence.steps[0].kind).toBe('camera');
    expect(sequence.dialogue).toEqual([{ speaker: 'Command', line: 'Move out.' }]);
    expect(cinematicSeconds(sequence)).toBe(5);
  });

  it('folds a legacy dialogue list into the timeline', () => {
    const doc = parse({
      cinematics: [
        {
          id: 'legacy',
          kind: 'ending',
          skippable: true,
          dialogue: [{ speaker: 'Command', line: 'The line holds.' }],
        },
      ],
    });
    expect(doc.cinematics[0].steps).toHaveLength(1);
    expect(doc.cinematics[0].steps[0]).toMatchObject({
      kind: 'line',
      text: 'The line holds.',
    });
  });

  it('accepts the authored in-mission context and its time gate', () => {
    const doc = parse({
      cinematics: [
        cinematic({
          id: 'contact',
          kind: 'in-mission',
          atSeconds: 45,
        }),
      ],
    });
    expect(doc.cinematics[0].kind).toBe('inMission');
    expect(doc.cinematics[0].atSeconds).toBe(45);
  });

  it('rejects a sequence with no steps', () => {
    expect(() => parse({ cinematics: [cinematic({ steps: [] })] })).toThrow(/cinematic-empty/);
  });

  it('rejects an in-mission sequence without a time gate', () => {
    expect(() => parse({ cinematics: [cinematic({ kind: 'inMission' })] })).toThrow(
      /cinematic-time-missing/,
    );
  });

  it('rejects negative camera and dialogue timings', () => {
    expect(() =>
      parse({
        cinematics: [
          cinematic({
            steps: [
              {
                kind: 'camera',
                target: { kind: 'position', x: 4, z: 4 },
                durationSeconds: -1,
              },
            ],
          }),
        ],
      }),
    ).toThrow(/cinematic-duration-invalid/);
    expect(() =>
      parse({
        cinematics: [
          cinematic({
            steps: [{ kind: 'line', speaker: 'A', text: 'B', durationSeconds: 0 }],
          }),
        ],
      }),
    ).toThrow(/cinematic-duration-invalid/);
  });

  it('rejects an unknown camera entity when placements are known', () => {
    const raw = missionRaw({
      cinematics: [
        cinematic({
          steps: [
            {
              kind: 'camera',
              target: { kind: 'entity', entity: 'missing-hq' },
              durationSeconds: 1,
            },
          ],
        }),
      ],
    });
    expect(() =>
      parseMission(raw, { entityKeys: new Set(['own-hq']) }),
    ).toThrow(/cinematic.*missing-hq|entity-ref-missing/);
  });

  it('rejects an unsupported step kind during parsing', () => {
    expect(() =>
      parse({
        cinematics: [cinematic({ steps: [{ kind: 'explosion', seconds: 1 }] })],
      }),
    ).toThrow(MissionFormatError);
  });
});

describe('camera interpolation', () => {
  it('uses a smoothstep with fixed endpoints', () => {
    expect(cinematicEase(0)).toBe(0);
    expect(cinematicEase(0.5)).toBe(0.5);
    expect(cinematicEase(1)).toBe(1);
    expect(interpolateCamera({ cx: 0, cz: 0, zoom: 10 }, { cx: 100, cz: 40, zoom: 30 }, 0.5)).toEqual({
      cx: 50,
      cz: 20,
      zoom: 20,
    });
    expect(
      interpolateCamera(
        { cx: 0, cz: 0, zoom: 10, yaw: 0 },
        { cx: 0, cz: 0, zoom: 10, yaw: Math.PI / 2 },
        0.5,
      ).yaw,
    ).toBeCloseTo(Math.PI / 4, 6);
  });

  it('converts authored tile coordinates to world units', () => {
    const point = cinematicWorldPoint(2, 3);
    expect(point.x).toBeCloseTo(2.5 * TILE_SIZE, 5);
    expect(point.z).toBeCloseTo(3.5 * TILE_SIZE, 5);
  });

  it('pauses the simulation only for framing contexts', () => {
    expect(cinematicPausesSimulation('opening')).toBe(true);
    expect(cinematicPausesSimulation('intermission')).toBe(true);
    expect(cinematicPausesSimulation('ending')).toBe(true);
    expect(cinematicPausesSimulation('inMission')).toBe(false);
  });
});

describe('cinematic playback', () => {
  it('moves the camera over the authored duration and then shows the line', () => {
    const doc = parse();
    const world = playableWorld();
    let finished = 0;
    const player = new CinematicPlayer(doc.cinematics[0], world, () => finished++);
    player.start();
    expect(world.camera.cx).toBe(10);

    player.update(1);
    expect(world.camera.cx).toBeCloseTo(55, 4);
    expect(world.camera.cz).toBeCloseTo(110, 4);
    expect(world.camera.zoom).toBeCloseTo(27, 4);
    expect(player.frame.line).toBeNull();

    player.update(1);
    expect(world.camera.cx).toBeCloseTo(100, 4);
    expect(player.frame.line).toBe('Move out.');
    expect(player.frame.speaker).toBe('Command');

    player.update(3);
    expect(finished).toBe(1);
    expect(player.finished).toBe(true);
    expect(world.restored).toEqual({ cx: 10, cz: 20, zoom: 30 });
    expect(world.camera.cx).toBe(10);
    expect(world.camera.screenLift).toBe(0);
  });

  it('holds the previous framing when an entity target is gone', () => {
    const doc = parse();
    const world = playableWorld();
    world.entities.clear();
    const player = new CinematicPlayer(doc.cinematics[0], world);
    player.start();
    player.update(1.5);
    // The position holds because the entity is gone, while the authored zoom
    // still interpolates toward the shot the author asked for.
    expect(world.camera.cx).toBe(10);
    expect(world.camera.cz).toBe(20);
    player.update(0.5);
    expect(world.camera.zoom).toBe(24);
  });

  it('cuts camera travel when reduced motion is requested', () => {
    const doc = parse();
    const world = playableWorld();
    world.reducedMotion = true;
    const player = new CinematicPlayer(doc.cinematics[0], world);
    player.start();
    player.update(0.1);
    expect(world.camera.cx).toBe(100);
    expect(world.camera.cz).toBe(200);
  });

  it('skips once, restoring the camera and running the callback exactly once', () => {
    const doc = parse();
    const world = playableWorld();
    let finished = 0;
    const player = new CinematicPlayer(doc.cinematics[0], world, () => finished++);
    player.start();
    expect(player.skip()).toBe(true);
    expect(player.skip()).toBe(false);
    expect(finished).toBe(1);
    expect(world.restored).toEqual({ cx: 10, cz: 20, zoom: 30 });
  });

  it('honours an unskippable sequence unless skip-all forces it', () => {
    const doc = parse({ cinematics: [cinematic({ skippable: false })] });
    const world = playableWorld();
    let finished = 0;
    const player = new CinematicPlayer(doc.cinematics[0], world, () => finished++);
    player.start();
    expect(player.skip()).toBe(false);
    expect(finished).toBe(0);
    expect(player.skip(true)).toBe(true);
    expect(finished).toBe(1);
  });

  it('localises commander tokens in the copy it plays', () => {
    const doc = parse({
      cinematics: [
        cinematic({
          steps: [{ kind: 'line', speaker: '{{callsign}}', text: '{{name}} takes the ridge.', durationSeconds: 2 }],
        }),
      ],
    });
    const localised = localiseCinematic(doc.cinematics[0], {
      name: 'Ana Reyes',
      callsign: 'Kestrel',
    });
    expect(localised.steps[0]).toMatchObject({
      speaker: 'Kestrel',
      text: 'Ana Reyes takes the ridge.',
    });
    // The authored document is untouched.
    expect(doc.cinematics[0].steps[0]).toMatchObject({ speaker: '{{callsign}}' });
  });
});

describe('result-driven debrief', () => {
  function pendingCampaign() {
    const def = CAMPAIGNS[0];
    let state = createCampaignState(def, {
      name: 'Ana Reyes',
      callsign: 'Kestrel',
      background: 'Baltic staff officer.',
    });
    state = launchCampaignMission(state, def, state.currentMissionId);
    const mission = def.missions.find((entry) => entry.id === state.currentMissionId)!;
    const result: MissionResult = {
      missionId: mission.id,
      outcome: 'victory',
      tick: 2_400,
      elapsedSeconds: 120,
      objectives: [
        { id: 'break-hq', title: 'Break the command post', kind: 'primary', state: 'complete' },
        { id: 'clean-sweep', title: 'Clean sweep', kind: 'bonus', state: 'failed' },
      ],
      friendly: {
        unitsBuilt: 12,
        unitsLost: 3,
        kills: 9,
        buildingsBuilt: 4,
        matsGathered: 900,
      },
      enemy: { unitsLost: 14, kills: 3 },
      entities: state.deployments.map((deployment) => ({
        key: deployment.key,
        role: 'veteran' as const,
        name: 'Sgt. Emilija Raudonė',
        survived: false,
      })),
    };
    state = submitCampaignResult(state, def, mission.id, result);
    return { def, state, mission, result };
  }

  it('uses authored outcome copy and reports captured telemetry', () => {
    const { mission, result } = pendingCampaign();
    const copy = missionOutcomeCopy(result, mission.mission);
    expect(copy.heading).toBe('Operation Complete');
    // The debrief shows the operation's own authored copy, not a generic line.
    expect(copy.copy).toBe(mission.mission.debrief?.victory);
    expect(copy.copy.length).toBeGreaterThan(0);

    const markup = missionDebriefMarkup(result, { mission: mission.mission });
    expect(markup).toContain('MISSION DEBRIEF');
    expect(markup).toContain('UNITS BUILT');
    expect(markup).toContain('STRUCTURES');
    expect(markup).toContain('2:00');
  });

  it('shows what acceptance would change without applying it', () => {
    const { def, state, mission, result } = pendingCampaign();
    const before = JSON.parse(JSON.stringify(state));
    const outlook = campaignResultOutlook(state, def)!;
    expect(outlook.consequences.map((entry) => entry.key)).toEqual(['standing', 'lastOperation']);
    expect(outlook.veterans).toHaveLength(1);
    expect(outlook.veterans[0].lost).toBe(true);
    expect(outlook.nextMissionName).toBe('Rust Pass');
    // The derivation is read-only: pending, roster and progression are intact.
    expect(JSON.parse(JSON.stringify(state))).toEqual(before);

    const markup = missionDebriefMarkup(result, { mission: mission.mission, outlook });
    expect(markup).toContain('IF ACCEPTED');
    expect(markup).toContain('Not yet applied');
    expect(markup).toContain('PERMANENTLY LOST');
    expect(markup).toContain('NEXT OPERATION');
    expect(markup).toContain('Rust Pass');
  });

  it('flies the command flag captured at deployment in the report', () => {
    const { result } = pendingCampaign();
    const markup = missionDebriefMarkup(result, { flag: defaultComposition() });
    expect(markup).toContain('COMMAND FLAG · AS FLOWN AT DEPLOYMENT');
    expect(markup).toContain('<svg');
    expect(markup).toContain('Command flag flown during this operation');
    // No capture means no flag: the report never invents one or reads storage
    // to fill the gap after the fact.
    expect(missionDebriefMarkup(result)).not.toContain('AS FLOWN AT DEPLOYMENT');
  });

  it('keeps the legacy debrief caller working without context', () => {
    const { result } = pendingCampaign();
    const markup = missionDebriefMarkup(result);
    expect(markup).toContain('MISSION DEBRIEF');
    expect(markup).not.toContain('IF ACCEPTED');
  });
});

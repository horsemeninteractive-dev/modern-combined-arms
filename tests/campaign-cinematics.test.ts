import { describe, expect, it } from 'vitest';
import { CAMPAIGNS, type CampaignDef } from '../src/data/campaign';
import { validateCampaignDefinition } from '../src/campaign';
import {
  CAMPAIGN_CINEMATICS_KEY,
  campaignCinematicsFor,
  campaignWithCinematics,
  clearCampaignCinematics,
  readCampaignCinematics,
  saveCampaignCinematics,
  type CampaignCinematicStorage,
} from '../src/campaign/cinematics';
import type { MissionCinematicDoc } from '../src/mission/types';
import { cinematicStepSeconds } from '../src/ui/cinematics';

type Raw = Record<string, any>;

function memoryStorage(seed: Record<string, string> = {}): CampaignCinematicStorage & {
  data: Map<string, string>;
} {
  const data = new Map(Object.entries(seed));
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
  };
}

function scene(overrides: Raw = {}): MissionCinematicDoc {
  return {
    id: 'intro',
    kind: 'campaignIntro',
    skippable: true,
    steps: [{ kind: 'line', speaker: 'Command', text: 'The corridor opens.', durationSeconds: 3 }],
    dialogue: [],
    ...overrides,
  } as MissionCinematicDoc;
}

function definitionWithScenes(scenes: MissionCinematicDoc[]): CampaignDef {
  return { ...CAMPAIGNS[0], cinematics: scenes };
}

function campaignErrorCodes(def: CampaignDef): string[] {
  return validateCampaignDefinition(def)
    .filter((issue) => issue.severity === 'error' && issue.code.startsWith('campaign-cinematic'))
    .map((issue) => issue.code);
}

describe('campaign cinematic overlay storage', () => {
  it('round-trips one campaign scene list under a versioned key', () => {
    const storage = memoryStorage();
    const scenes = [scene(), scene({ id: 'outro', kind: 'campaignFinale' })];
    saveCampaignCinematics(storage, CAMPAIGNS[0].id, scenes);

    const raw = JSON.parse(storage.data.get(CAMPAIGN_CINEMATICS_KEY) ?? '{}');
    expect(raw.version).toBe(1);
    expect(Object.keys(raw.campaigns)).toEqual([CAMPAIGNS[0].id]);
    expect(readCampaignCinematics(storage)[CAMPAIGNS[0].id]).toEqual(scenes);
  });

  it('replaces a campaign scene list without disturbing another campaign', () => {
    const storage = memoryStorage();
    saveCampaignCinematics(storage, 'alpha', [scene()]);
    saveCampaignCinematics(storage, 'beta', [scene({ id: 'beta-intro' })]);
    saveCampaignCinematics(storage, 'alpha', [scene({ id: 'alpha-rewrite' })]);

    const overlay = readCampaignCinematics(storage);
    expect(overlay.alpha.map((entry) => entry.id)).toEqual(['alpha-rewrite']);
    expect(overlay.beta.map((entry) => entry.id)).toEqual(['beta-intro']);
  });

  it('returns the shipped scenes when nothing has been authored', () => {
    const shipped = [scene({ id: 'shipped' })];
    const def = definitionWithScenes(shipped);
    const scenes = campaignCinematicsFor(def, memoryStorage());
    expect(scenes).toEqual(shipped);
    expect(scenes).not.toBe(def.cinematics);
  });

  it('applies the overlay to the definition and keeps every other field', () => {
    const storage = memoryStorage();
    const authored = [scene({ id: 'authored' })];
    saveCampaignCinematics(storage, CAMPAIGNS[0].id, authored);

    const merged = campaignWithCinematics(CAMPAIGNS[0], storage);
    expect(merged.cinematics).toEqual(authored);
    expect(merged.id).toBe(CAMPAIGNS[0].id);
    expect(merged.missions).toBe(CAMPAIGNS[0].missions);
    expect(merged.variables).toBe(CAMPAIGNS[0].variables);
  });

  it('clears only the named campaign', () => {
    const storage = memoryStorage();
    saveCampaignCinematics(storage, 'alpha', [scene()]);
    saveCampaignCinematics(storage, 'beta', [scene()]);
    clearCampaignCinematics(storage, 'alpha');
    expect(readCampaignCinematics(storage).alpha).toBeUndefined();
    expect(readCampaignCinematics(storage).beta).toHaveLength(1);
  });

  it('ignores damaged, foreign-version and malformed records', () => {
    const shipped = [scene({ id: 'shipped' })];
    const def = definitionWithScenes(shipped);
    const cases = [
      'not json at all',
      JSON.stringify({ version: 2, campaigns: { [def.id]: [scene()] } }),
      JSON.stringify({ version: 1, campaigns: { [def.id]: 'nope' } }),
      JSON.stringify({
        version: 1,
        campaigns: { [def.id]: [{ ...scene(), kind: 'opening' }] },
      }),
      JSON.stringify({
        version: 1,
        campaigns: { [def.id]: [{ ...scene(), steps: 'nope' }] },
      }),
    ];
    for (const raw of cases) {
      const storage = memoryStorage({ [CAMPAIGN_CINEMATICS_KEY]: raw });
      expect(readCampaignCinematics(storage)).toEqual({});
      expect(campaignCinematicsFor(def, storage)).toEqual(shipped);
    }
  });

  it('falls back to the shipped scenes when the stored overlay no longer validates', () => {
    const shipped = [scene({ id: 'shipped' })];
    const def = definitionWithScenes(shipped);
    const storage = memoryStorage();
    saveCampaignCinematics(storage, def.id, [scene({ id: 'broken', steps: [] })]);

    expect(readCampaignCinematics(storage)[def.id]).toHaveLength(1);
    expect(campaignCinematicsFor(def, storage)).toEqual(shipped);
  });
});

describe('campaign framing scene validation', () => {
  it('accepts a clean introduction, intermission and finale', () => {
    const def = definitionWithScenes([
      scene(),
      scene({ id: 'mid', kind: 'intermission' }),
      scene({ id: 'end', kind: 'campaignFinale' }),
    ]);
    expect(campaignErrorCodes(def)).toEqual([]);
  });

  it('rejects camera beats outside the authored range', () => {
    const def = definitionWithScenes([
      scene({
        steps: [
          {
            kind: 'camera',
            target: { kind: 'position', x: 12, z: 8 },
            zoom: 4,
            rotationDegrees: 540,
            shake: 2,
            ease: 'bouncy',
            durationSeconds: 1,
          },
        ],
      }),
    ]);
    const codes = campaignErrorCodes(def);
    expect(codes).toContain('campaign-cinematic-rotation');
    expect(codes).toContain('campaign-cinematic-shake');
    expect(codes).toContain('campaign-cinematic-ease');
  });

  it('rejects actor, effect and sound beats the presentation layer cannot run', () => {
    const def = definitionWithScenes([
      scene({
        steps: [
          { kind: 'actor', action: 'animate', entity: 'runner', pose: 'dance', durationSeconds: 0 },
          { kind: 'actor', action: 'enter', entity: 'runner', structure: 'runner', durationSeconds: 1 },
          { kind: 'effect', effect: 'fireworks', target: { kind: 'position', x: 1, z: 2 }, scale: 0 },
          { kind: 'sound', cue: '', gain: 3, durationSeconds: -1 },
        ] as any,
      }),
    ]);
    const codes = campaignErrorCodes(def);
    expect(codes).toContain('campaign-cinematic-pose');
    expect(codes).toContain('campaign-cinematic-structure');
    expect(codes).toContain('campaign-cinematic-effect');
    expect(codes).toContain('campaign-cinematic-sound');
    expect(codes).toContain('campaign-cinematic-duration');
  });

  it('rejects non-positive notice and dialogue timing', () => {
    const def = definitionWithScenes([
      scene({
        steps: [
          { kind: 'notify', text: 'Harbour lights.', durationSeconds: 0 },
          { kind: 'line', speaker: 'Command', text: 'Move out.', durationSeconds: 0 },
        ],
      }),
    ]);
    expect(campaignErrorCodes(def).filter((code) => code === 'campaign-cinematic-duration')).toHaveLength(2);
  });
});

describe('shipped campaign briefing scenes', () => {
  it('gives every operation a short, skippable briefing after its opening', () => {
    for (const def of CAMPAIGNS) {
      for (const mission of def.missions) {
        const cinematics = mission.mission.cinematics;
        const kinds = cinematics.map((doc) => doc.kind);
        const briefing = cinematics[kinds.indexOf('briefing')];
        expect(briefing, `${def.id}/${mission.id} has no briefing scene`).toBeDefined();
        expect(briefing.skippable).toBe(true);
        // The briefing is a framing scene: it follows the opening and it is not a
        // second opening with a full cast of beats.
        expect(kinds.indexOf('briefing')).toBeGreaterThan(kinds.indexOf('opening'));
        const spoken = briefing.steps.filter((step) => step.kind === 'line');
        expect(spoken.length).toBeGreaterThan(0);
        expect(spoken.length).toBeLessThanOrEqual(3);
        const seconds = briefing.steps.reduce((total, step) => total + cinematicStepSeconds(step), 0);
        expect(seconds).toBeLessThanOrEqual(30);
      }
    }
  });
});

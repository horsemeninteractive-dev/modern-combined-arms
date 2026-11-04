import { describe, expect, it } from 'vitest';
import { CAMPAIGNS, type CampaignDef, type CampaignMission } from '../src/data/campaign';
import { SCENARIOS, scenarioById } from '../src/data/scenarioCatalog';
import {
  buildCampaignScenario,
  createCampaignState,
  launchCampaignMission,
  validateCampaignDefinition,
  type CampaignState,
  type CommanderIdentity,
} from '../src/campaign';
import { parseMission, validateMission } from '../src/mission';
import { validateScenario, type Scenario } from '../src/sim/scenario';
import { TECHS } from '../src/data/research';

const COMMANDER: CommanderIdentity = {
  name: 'Ada Keller',
  callsign: 'Kestrel',
  background: 'Coalition staff officer seconded to the corridor.',
  pronouns: 'she/her',
};

const KNOWN_MAP_IDS = new Set(SCENARIOS.map((entry) => entry.id));

function startedRun(def: CampaignDef): CampaignState {
  return launchCampaignMission(createCampaignState(def, COMMANDER), def);
}

function scenarioFor(def: CampaignDef, mission: CampaignMission, state: CampaignState): Scenario {
  const entry = scenarioById(mission.mapId);
  if (!entry) throw new Error(`Unknown theatre ${mission.mapId}`);
  return buildCampaignScenario({ def, mission, state, base: entry.create() });
}

describe('campaign chain: definition integrity', () => {
  it('validates both definitions against the live catalogue', () => {
    for (const def of CAMPAIGNS) {
      const issues = validateCampaignDefinition(def, { knownMapIds: KNOWN_MAP_IDS });
      expect(
        issues.filter((entry) => entry.severity === 'error'),
        `${def.id}: ${issues.map((entry) => `${entry.code} ${entry.message}`).join(' | ')}`,
      ).toEqual([]);
    }
  });

  it('authors twelve operations per campaign, in order, each on its own theatre', () => {
    const used = new Set<string>();
    for (const def of CAMPAIGNS) {
      expect(def.missions.length).toBe(12);
      def.missions.forEach((mission, index) => {
        expect(mission.id).toBe(`${def.id === 'baltic-line' ? 'baltic' : 'corridor'}-${String(index + 1).padStart(2, '0')}`);
        expect(mission.mission.campaign?.order).toBe(index + 1);
        expect(mission.mission.campaign?.side).toBe(def.allianceId);
        expect(KNOWN_MAP_IDS.has(mission.mapId)).toBe(true);
        // A theatre is authored for exactly one operation.
        expect(used.has(mission.mapId), `${mission.mapId} is used twice`).toBe(false);
        used.add(mission.mapId);
      });
    }
    // Twenty-four operations, twenty-four maps, plus the four legacy campaign
    // theatres that remain in the catalogue.
    expect(used.size).toBe(24);
  });

  it('keeps the opening operation small and the finale unrestricted', () => {
    for (const def of CAMPAIGNS) {
      const first = scenarioById(def.missions[0].mapId)!.create();
      const command = first.players[0];
      expect(command.technologies ?? []).toEqual([]);
      expect(new Set(command.restrictions?.technologies ?? []).size).toBe(Object.keys(TECHS).length);

      const last = scenarioById(def.missions[11].mapId)!.create();
      expect(last.players[0].restrictions?.technologies ?? []).toEqual([]);
      expect(last.players[0].technologies?.length ?? 0).toBeGreaterThanOrEqual(7);
    }
  });

  it('never grants a technology the same operation forbids', () => {
    for (const def of CAMPAIGNS) {
      for (const mission of def.missions) {
        const scenario = scenarioById(mission.mapId)!.create();
        for (const player of scenario.players) {
          const locked = new Set(player.restrictions?.technologies ?? []);
          for (const tech of player.technologies ?? []) {
            expect(locked.has(tech), `${mission.id} grants and forbids ${tech}`).toBe(false);
          }
        }
      }
    }
  });
});

describe('campaign chain: every operation launches and validates', () => {
  for (const def of CAMPAIGNS) {
    describe(def.id, () => {
      const state = startedRun(def);

      it.each(def.missions.map((mission) => [mission.id, mission] as const))(
        '%s deploys a valid, mission-bearing scenario',
        (id, mission) => {
          const scenario = scenarioFor(def, mission, state);
          const errors = validateScenario(scenario).filter((entry) => entry.severity === 'error');
          expect(errors, errors.map((entry) => `${entry.code}: ${entry.message}`).join(' | ')).toEqual(
            [],
          );
          expect(scenario.mission?.id).toBe(id);
          expect(scenario.meta.campaign).toEqual({ campaignId: def.id, missionId: id });
          expect(scenario.structures.some((entry) => entry.key === 'own-hq')).toBe(true);
          expect(scenario.structures.some((entry) => entry.key === 'enemy-hq')).toBe(true);
          // Both sides start with a force; the AI cannot fight with nothing.
          for (const player of scenario.players) {
            expect(scenario.units.some((unit) => unit.owner === player.id)).toBe(true);
          }
        },
      );

      it.each(def.missions.map((mission) => [mission.id, mission] as const))(
        '%s has no unresolved mission references',
        (id, mission) => {
          const scenario = scenarioFor(def, mission, state);
          const doc = scenario.mission!;
          const errors = validateScenario(scenario).filter((entry) => entry.severity === 'error');
          expect(errors).toEqual([]);

          const keys = new Set([
            ...scenario.structures.map((entry) => entry.key),
            ...scenario.units.map((entry) => entry.key),
          ]);
          keys.delete(undefined);
          for (const entity of doc.entities) {
            expect(keys.has(entity.key), `${id}: entity ${entity.key} is not placed`).toBe(true);
          }
          for (const objective of doc.objectives) {
            for (const dependency of objective.dependsOn) {
              expect(
                doc.objectives.some((entry) => entry.id === dependency),
                `${id}: objective ${objective.id} depends on ${dependency}`,
              ).toBe(true);
            }
            for (const protectedKey of objective.protectedEntities ?? []) {
              expect(keys.has(protectedKey), `${id}: protects ${protectedKey}`).toBe(true);
            }
          }
          const regionIds = new Set(doc.regions.map((region) => region.id));
          for (const region of doc.regions) {
            expect(region.x).toBeGreaterThanOrEqual(0);
            expect(region.z).toBeGreaterThanOrEqual(0);
            expect(region.x + region.width).toBeLessThanOrEqual(scenario.width);
            expect(region.z + region.height).toBeLessThanOrEqual(scenario.height);
          }
          const objectiveIds = new Set(doc.objectives.map((entry) => entry.id));
          const variableIds = new Set(doc.variables.map((entry) => entry.id));
          for (const trigger of doc.triggers) {
            for (const condition of trigger.conditions) {
              if (condition.kind === 'regionOccupied') {
                expect(regionIds.has(condition.region), `${id}: ${trigger.id}`).toBe(true);
              }
              if (condition.kind === 'objective') {
                expect(objectiveIds.has(condition.objective), `${id}: ${trigger.id}`).toBe(true);
              }
              if (condition.kind === 'variable') {
                expect(variableIds.has(condition.variable), `${id}: ${trigger.id}`).toBe(true);
              }
              if (condition.kind === 'entityAlive' || condition.kind === 'entityDead') {
                expect(keys.has(condition.entity), `${id}: ${trigger.id} ${condition.entity}`).toBe(
                  true,
                );
              }
            }
            for (const action of trigger.actions) {
              if (action.kind === 'setObjective') {
                expect(objectiveIds.has(action.objective), `${id}: ${trigger.id}`).toBe(true);
              }
              if (action.kind === 'setVariable') {
                expect(variableIds.has(action.variable), `${id}: ${trigger.id}`).toBe(true);
              }
              // Deferred actions stay unauthored: the runtime does not run them.
              expect(['setObjective', 'setVariable', 'message']).toContain(action.kind);
            }
          }
          for (const cinematic of doc.cinematics) {
            for (const step of cinematic.steps) {
              if (step.kind !== 'camera') continue;
              if (step.target.kind === 'entity') {
                expect(keys.has(step.target.entity), `${id}: ${cinematic.id}`).toBe(true);
              }
            }
          }
          expect(validateMission(doc).filter((entry) => entry.severity === 'error')).toEqual([]);
        },
      );

      it.each(def.missions.map((mission) => [mission.id, mission] as const))(
        '%s round-trips through the canonical parser',
        (_id, mission) => {
          const scenario = scenarioFor(def, mission, state);
          const json = JSON.stringify(scenario.mission);
          const parsed = parseMission(JSON.parse(json));
          expect(JSON.stringify(parsed)).toBe(json);
        },
      );
    });
  }
});

describe('campaign chain: roster progression is a deliberate ramp', () => {
  it('opens with infantry only and never offers a platform the operation forbids', () => {
    for (const def of CAMPAIGNS) {
      const firstScenario = scenarioById(def.missions[0].mapId)!.create();
      const locked = new Set(firstScenario.players[0].restrictions?.units ?? []);
      // The opener fields infantry, anti-tank teams, reconnaissance and
      // engineers. Armour is at most a single first-wave hull; nothing else in
      // the mechanised, artillery, aviation or naval branches is available.
      expect(locked.has('tank') || locked.has('ifv')).toBe(true);
      expect(locked.has('spg')).toBe(true);
      expect(locked.has('fighter')).toBe(true);
      expect(locked.has('corvette')).toBe(true);

      for (const mission of def.missions) {
        const scenario = scenarioById(mission.mapId)!.create();
        const restrictions = scenario.players[0].restrictions;
        for (const unit of restrictions?.units ?? []) {
          expect(
            scenario.units.some((entry) => entry.owner === 0 && entry.defId === unit),
            `${mission.id} starts with a unit it forbids: ${unit}`,
          ).toBe(false);
        }
      }
    }
  });

  it('escalates the force the commander is actually given', () => {
    for (const def of CAMPAIGNS) {
      const counts = def.missions.map((mission) => {
        const scenario = scenarioById(mission.mapId)!.create();
        return scenario.units.filter((unit) => unit.owner === 0).length;
      });
      expect(counts[0]).toBeLessThanOrEqual(counts[11]);
      expect(counts[0]).toBeLessThanOrEqual(9);
      expect(counts[11]).toBeGreaterThanOrEqual(9);
    }
  });
});

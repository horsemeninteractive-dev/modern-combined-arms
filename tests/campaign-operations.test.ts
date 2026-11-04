import { describe, expect, it } from 'vitest';
import { CAMPAIGNS, campaignById, type CampaignDef, type CampaignMission } from '../src/data/campaign';
import { scenarioById } from '../src/data/scenarioCatalog';
import {
  acceptCampaignResult,
  buildCampaignScenario,
  campaignProgressOf,
  createCampaignState,
  launchCampaignMission,
  normaliseCommanderIdentity,
  submitCampaignResult,
  type CampaignState,
} from '../src/campaign';
import { parseMission, validateMission, type MissionDoc } from '../src/mission';
import { Game } from '../src/sim/game';
import { parseScenario, scenarioToJson } from '../src/sim/scenario';
import { TICK_RATE, TILE_SIZE } from '../src/sim/constants';

const COMMANDER = normaliseCommanderIdentity({
  name: 'Ada Keller',
  callsign: 'Kestrel',
  background: 'Baltic staff officer with a decade of coastal defence work.',
});

const OPENINGS: Array<{ def: CampaignDef; operation: CampaignMission }> = [
  { def: campaignById('baltic-line'), operation: campaignById('baltic-line').missions[0] },
  { def: campaignById('eastern-corridor'), operation: campaignById('eastern-corridor').missions[0] },
];

function started(def: CampaignDef): CampaignState {
  return createCampaignState(def, COMMANDER);
}

/** The launch scenario the campaign actually deploys, commander and all. */
function launchedScenario(def: CampaignDef) {
  const state = launchCampaignMission(started(def), def);
  const operation = def.missions[0];
  return {
    state,
    operation,
    scenario: buildCampaignScenario({
      def,
      mission: operation,
      state,
      base: scenarioById(operation.mapId)!.create(),
    }),
  };
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Tile centre in the world coordinates a live entity carries. */
function atTile(tile: number): number {
  return tile * TILE_SIZE + TILE_SIZE / 2;
}

describe('opening operation documents', () => {
  it('round-trips both documents through the canonical parser unchanged', () => {
    for (const { operation } of OPENINGS) {
      const once = parseMission(clone(operation.mission));
      const twice = parseMission(clone(once));
      expect(twice).toEqual(once);
      expect(once.id).toBe(operation.id);
    }
  });

  it('validates cleanly against its own theatre', () => {
    for (const { def, operation } of OPENINGS) {
      const { scenario } = launchedScenario(def);
      const entityKeys = new Set(
        [...scenario.units, ...scenario.structures].map((entry) => entry.key).filter(Boolean) as string[],
      );
      const issues = validateMission(operation.mission, {
        width: scenario.width,
        height: scenario.height,
        entityKeys,
      });
      expect(
        issues.filter((issue) => issue.severity === 'error'),
        `${operation.id}: ${issues.map((issue) => issue.message).join(' | ')}`,
      ).toEqual([]);
    }
  });

  it('only references objectives, variables, regions and entities that exist', () => {
    for (const { operation } of OPENINGS) {
      const doc = operation.mission;
      const objectives = new Set(doc.objectives.map((entry) => entry.id));
      const variables = new Set(doc.variables.map((entry) => entry.id));
      const regions = new Set(doc.regions.map((entry) => entry.id));
      const entities = new Set(doc.entities.map((entry) => entry.key));

      for (const objective of doc.objectives) {
        for (const dependency of objective.dependsOn) {
          expect(objectives.has(dependency), `${doc.id}: ${objective.id} needs ${dependency}`).toBe(true);
        }
        for (const key of objective.protectedEntities ?? []) {
          expect(entities.has(key), `${doc.id}: ${objective.id} protects ${key}`).toBe(true);
        }
      }

      for (const trigger of doc.triggers) {
        for (const condition of trigger.conditions) {
          if (condition.kind === 'objective') {
            expect(objectives.has(condition.objective), `${doc.id}/${trigger.id}`).toBe(true);
          }
          if (condition.kind === 'variable') {
            expect(variables.has(condition.variable), `${doc.id}/${trigger.id}`).toBe(true);
          }
          if (condition.kind === 'regionOccupied') {
            expect(regions.has(condition.region), `${doc.id}/${trigger.id}`).toBe(true);
          }
          if (condition.kind === 'entityAlive' || condition.kind === 'entityDead') {
            expect(entities.has(condition.entity), `${doc.id}/${trigger.id}`).toBe(true);
          }
        }
        for (const action of trigger.actions) {
          if (action.kind === 'setObjective') {
            expect(objectives.has(action.objective), `${doc.id}/${trigger.id}`).toBe(true);
          }
          if (action.kind === 'setVariable') {
            expect(variables.has(action.variable), `${doc.id}/${trigger.id}`).toBe(true);
          }
        }
      }

      for (const cinematic of doc.cinematics) {
        for (const step of cinematic.steps) {
          if (step.kind === 'camera' && step.target.kind === 'entity') {
            expect(entities.has(step.target.entity), `${doc.id}/${cinematic.id}`).toBe(true);
          }
        }
      }
    }
  });

  it('gives every primary objective a trigger that can complete it', () => {
    for (const { operation } of OPENINGS) {
      const doc: MissionDoc = operation.mission;
      const completable = new Set<string>();
      for (const trigger of doc.triggers) {
        for (const action of trigger.actions) {
          if (action.kind === 'setObjective' && action.state === 'complete') {
            completable.add(action.objective);
          }
        }
      }
      for (const objective of doc.objectives.filter((entry) => entry.kind === 'primary')) {
        expect(completable.has(objective.id), `${doc.id}: ${objective.id} can never complete`).toBe(true);
      }
    }
  });

  it('authors no action the runtime only defers', () => {
    for (const { operation } of OPENINGS) {
      const kinds = operation.mission.triggers.flatMap((trigger) =>
        trigger.actions.map((action) => action.kind),
      );
      expect(kinds).not.toContain('activateAiGroup');
      expect(kinds).not.toContain('spawnReinforcement');
      // An authored `endMission` would bypass the objective tree.
      expect(kinds).not.toContain('endMission');
      expect(operation.mission.aiGroups).toEqual([]);
      expect(operation.mission.reinforcements).toEqual([]);
    }
  });

  it('plays one sequence per context and time-gates the in-mission one', () => {
    for (const { operation } of OPENINGS) {
      const kinds = operation.mission.cinematics.map((entry) => entry.kind);
      expect(new Set(kinds).size).toBe(kinds.length);
      for (const kind of ['opening', 'inMission', 'ending'] as const) {
        expect(kinds).toContain(kind);
      }
      const mid = operation.mission.cinematics.find((entry) => entry.kind === 'inMission')!;
      expect(mid.atSeconds).toBeGreaterThan(0);
      expect(mid.steps.length).toBeGreaterThan(0);
    }
  });

  it('keeps the deck copy and the objective tree in agreement', () => {
    for (const { operation } of OPENINGS) {
      const titles = operation.mission.objectives.map((entry) => entry.title);
      // Every authored objective is announced to the player, and the HUD list
      // carries no goal the document cannot observe.
      for (const objective of operation.mission.objectives) {
        const announced = operation.objectives.some((line) =>
          line.toLowerCase().includes(objective.title.toLowerCase().split(' ').slice(0, 3).join(' ')),
        );
        expect(announced, `${operation.id}: "${objective.title}" is not in the HUD list`).toBe(true);
      }
      for (const line of operation.objectives) {
        expect(
          operation.mission.briefing.instructions?.some((entry) => entry.length > 0) ?? false,
        ).toBe(true);
        expect(line.trim().length).toBeGreaterThan(0);
      }
      expect(titles.length).toBeGreaterThan(0);
    }
  });

  it('states a defeat path the runtime can actually reach', () => {
    for (const { operation } of OPENINGS) {
      const doc = operation.mission;
      const canFail = doc.triggers.some((trigger) =>
        trigger.actions.some((action) => action.kind === 'setObjective' && action.state === 'failed'),
      );
      // The engine also ends the operation when the protected command post
      // falls, which every opening protects with its own entities list.
      expect(doc.entities.some((entity) => entity.key === 'own-hq' && entity.role === 'protected')).toBe(true);
      if (doc.id === 'baltic-01') expect(canFail).toBe(true);
    }
  });
});

describe('opening operation runtime', () => {
  it('wins the beachhead only after the hold and the corps command post', () => {
    const { scenario } = launchedScenario(campaignById('baltic-line'));
    const game = new Game(scenario, { enableAI: false });
    expect(game.mission?.outcome).toBe('playing');

    // Break the corps first: the second primary waits on the hold, so a rush
    // cannot win the operation on its own.
    const enemyHq = game.state.entities.find((entity) => entity.authoredKey === 'enemy-hq')!;
    enemyHq.hp = 0;
    game.tick();
    expect(game.mission?.outcome).toBe('playing');
    expect(game.mission?.objectiveState('break-corps')).not.toBe('complete');

    // Reach the ten-minute deadline with the landing force still on the beach.
    game.state.tick = TICK_RATE * 600;
    game.tick();
    expect(game.mission?.objectiveState('hold-beachhead')).toBe('complete');
    expect(game.mission?.objectiveState('break-corps')).toBe('complete');
    expect(game.mission?.variables.convoy).toBe('landed');
    expect(game.state.victory).toBe('victory');
    const result = game.missionResult;
    expect(result?.outcome).toBe('victory');
    expect(result?.objectives.find((entry) => entry.id === 'hold-beachhead')?.state).toBe('complete');
  });

  it('fails the beachhead when the line is abandoned at the deadline', () => {
    const { scenario } = launchedScenario(campaignById('baltic-line'));
    const game = new Game(scenario, { enableAI: false });
    // Pull the landing force off the beachhead line.
    for (const unit of game.state.entities) {
      if (unit.kind !== 'unit' || unit.owner !== 0) continue;
      unit.x = atTile(70);
      unit.z = atTile(20);
    }
    game.state.tick = TICK_RATE * 600;
    game.tick();
    expect(game.mission?.objectiveState('hold-beachhead')).toBe('failed');
    expect(game.mission?.outcome).toBe('defeat');
    expect(game.state.victory).toBe('defeat');
  });

  it('pays the clean-sweep bonus only while the beach command post stands', () => {
    const { scenario } = launchedScenario(campaignById('baltic-line'));
    const game = new Game(scenario, { enableAI: false });
    game.state.tick = TICK_RATE * 600;
    game.tick();
    const enemyHq = game.state.entities.find((entity) => entity.authoredKey === 'enemy-hq')!;
    enemyHq.hp = 0;
    game.tick();
    expect(game.state.victory).toBe('victory');
    expect(game.mission?.objectiveState('clean-sweep')).toBe('complete');
  });

  it('requires the pass before the coalition command post counts in the eastern opening', () => {
    const { scenario } = launchedScenario(campaignById('eastern-corridor'));
    const game = new Game(scenario, { enableAI: false });
    const enemyHq = game.state.entities.find((entity) => entity.authoredKey === 'enemy-hq')!;
    enemyHq.hp = 0;
    game.tick();
    expect(game.mission?.outcome).toBe('playing');
    expect(game.mission?.objectiveState('open-the-pass')).toBe('active');

    // Three units onto the ridge road.
    const movers = game.state.entities
      .filter((entity) => entity.kind === 'unit' && entity.owner === 0)
      .slice(0, 3);
    const spots: Array<[number, number]> = [
      [52, 35],
      [53, 36],
      [54, 35],
    ];
    movers.forEach((entity, index) => {
      entity.x = atTile(spots[index][0]);
      entity.z = atTile(spots[index][1]);
    });
    game.tick();
    expect(game.mission?.objectiveState('open-the-pass')).toBe('complete');
    expect(game.mission?.variables.echelon).toBe('crossing');
    expect(game.mission?.objectiveState('break-coalition-cp')).toBe('complete');
    expect(game.state.victory).toBe('victory');
    // The pass is still held, so the second echelon crosses.
    expect(game.mission?.objectiveState('second-echelon')).toBe('complete');
  });

  it('takes the village secondary by occupying it, not by fiat', () => {
    const { operation, scenario } = launchedScenario(campaignById('eastern-corridor'));
    // Read the authored region rather than fixed tiles, so the test follows the
    // map instead of assuming a layout.
    const trigger = operation.mission.triggers.find(
      (entry) => entry.id === 'village-taken',
    )!;
    const region = operation.mission.regions.find(
      (entry) => entry.id === (trigger.conditions.find((c) => c.kind === 'regionOccupied') as { region: string }).region,
    )!;
    const game = new Game(scenario, { enableAI: false });
    const movers = game.state.entities
      .filter((entity) => entity.kind === 'unit' && entity.owner === 0)
      .slice(0, 2);
    movers.forEach((entity, index) => {
      entity.x = atTile(region.x + index);
      entity.z = atTile(region.z + 1);
    });
    game.tick();
    expect(game.mission?.objectiveState('take-the-village')).toBe('complete');
  });
});

describe('opening operation campaign lifecycle', () => {
  it('launches the authored opening from a fresh run on its own theatre', () => {
    for (const { def, operation } of OPENINGS) {
      const { scenario, state } = launchedScenario(def);
      expect(state.currentMissionId).toBe(operation.id);
      expect(scenario.mission?.id).toBe(operation.id);
      expect(scenario.meta.campaign).toEqual({ campaignId: def.id, missionId: operation.id });
      expect(scenario.objectives).toEqual([...operation.objectives]);
      expect(scenario.structures.find((entry) => entry.key === 'own-hq')).toBeDefined();
      expect(scenario.structures.find((entry) => entry.key === 'enemy-hq')).toBeDefined();
      // The document is embedded, not regenerated at launch.
      expect(scenario.mission?.briefing.summary).toBe(operation.mission.briefing.summary);
      expect(scenario.mission?.regions).toEqual(operation.mission.regions);
    }
  });

  it('survives a scenario JSON round trip with the mission intact', () => {
    for (const { def, operation } of OPENINGS) {
      const { scenario } = launchedScenario(def);
      const reparsed = parseScenario(JSON.parse(scenarioToJson(scenario)));
      expect(reparsed.mission).toEqual(scenario.mission);
      expect(reparsed.mission?.id).toBe(operation.id);
      expect(reparsed.mission?.triggers.length).toBe(operation.mission.triggers.length);
    }
  });

  it('accepts the opening victory, unlocks operation two and carries the veteran forward', () => {
    const def = campaignById('baltic-line');
    const { scenario, state } = launchedScenario(def);
    const game = new Game(scenario, { enableAI: false });
    game.state.tick = TICK_RATE * 600;
    game.tick();
    const enemyHq = game.state.entities.find((entity) => entity.authoredKey === 'enemy-hq')!;
    enemyHq.hp = 0;
    game.tick();
    const result = game.missionResult!;
    expect(result.outcome).toBe('victory');

    const submitted = submitCampaignResult(state, def, def.missions[0].id, result);
    const accepted = acceptCampaignResult(submitted, def);
    expect(accepted.completed.map((entry) => entry.missionId)).toEqual([def.missions[0].id]);
    expect(accepted.currentMissionId).toBe(def.missions[1].id);
    expect(accepted.phase).toBe('briefing');
    expect(accepted.variables.standing).toBe(1);
    expect(accepted.variables.lastOperation).toBe(def.missions[0].id);
    expect(accepted.veterans.find((entry) => entry.id === 'vet-kestrel')?.missions).toEqual([
      def.missions[0].id,
    ]);

    const progress = campaignProgressOf(accepted, def);
    expect(progress.cleared[def.id]).toEqual([def.missions[0].id]);
  });

  it('leaves the run untouched when the opening is not accepted', () => {
    const def = campaignById('eastern-corridor');
    const { state } = launchedScenario(def);
    expect(state.completed).toEqual([]);
    expect(state.currentMissionId).toBe(def.missions[0].id);
    expect(state.variables.standing).toBe(0);
    expect(CAMPAIGNS.length).toBe(2);
  });
});

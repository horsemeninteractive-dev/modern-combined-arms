import { describe, expect, it } from 'vitest';
import { defaultComposition } from '../src/identity/flag';
import { CAMPAIGNS, campaignById, type CampaignDef, type CampaignMission } from '../src/data/campaign';
import { scenarioById, SCENARIOS } from '../src/data/scenarioCatalog';
import {
  acceptCampaignResult,
  buildCampaignScenario,
  campaignDeploymentsFor,
  campaignProgressOf,
  CampaignStateError,
  createCampaignState,
  emptyCampaignSave,
  launchCampaignMission,
  migrateLegacyCampaignProgress,
  normaliseCommanderIdentity,
  parseCampaignSave,
  retryCampaignMission,
  serializeCampaignSave,
  submitCampaignResult,
  validateCampaignDefinition,
  validateCampaignState,
  type CampaignMissionRecord,
  type CampaignState,
  type CampaignVeteranDeployment,
  type CommanderIdentity,
} from '../src/campaign';
import type { MissionResult, MissionResultEntity, MissionOutcome } from '../src/mission';
import { Game } from '../src/sim/game';
import { validateScenario } from '../src/sim/scenario';

const DEFENDER = campaignById('baltic-line');
const EASTERN = campaignById('eastern-corridor');

const COMMANDER: CommanderIdentity = {
  name: 'Ada Keller',
  callsign: 'Kestrel',
  background: 'Baltic staff officer with a decade of coastal defence work.',
  pronouns: 'she/her',
};

function mission(def: CampaignDef, index: number): CampaignMission {
  return def.missions[index];
}

function cloneDef(def: CampaignDef): CampaignDef {
  return JSON.parse(JSON.stringify(def)) as CampaignDef;
}

/** A captured result that matches the static mission document plus deployments. */
function resultFor(
  def: CampaignDef,
  operation: CampaignMission,
  outcome: MissionOutcome,
  survived: Record<string, boolean> = {},
  deployments: readonly CampaignVeteranDeployment[] = [],
): MissionResult {
  const entities: MissionResultEntity[] = operation.mission.entities.map((entity) => ({
    key: entity.key,
    ...(entity.name ? { name: entity.name } : {}),
    role: entity.role,
    defId: 'commandPost',
    survived: survived[entity.key] ?? true,
  }));
  for (const deployment of deployments) {
    const veteran = def.roster.find((entry) => entry.id === deployment.veteranId);
    if (!veteran) continue;
    entities.push({
      key: deployment.key,
      name: veteran.name,
      role: 'veteran',
      defId: veteran.defId,
      survived: survived[deployment.key] ?? true,
    });
  }
  return {
    missionId: operation.id,
    outcome,
    tick: 1200,
    elapsedSeconds: 60,
    objectives: operation.mission.objectives.map((objective) => ({
      id: objective.id,
      title: objective.title,
      kind: objective.kind,
      state:
        objective.kind !== 'primary'
          ? 'active'
          : outcome === 'victory'
            ? 'complete'
            : 'failed',
    })),
    friendly: { unitsBuilt: 4, unitsLost: 2, kills: 7, buildingsBuilt: 1, matsGathered: 900 },
    enemy: { unitsLost: 7, kills: 2 },
    entities,
  };
}

function started(def: CampaignDef = DEFENDER): CampaignState {
  return createCampaignState(def, COMMANDER);
}

function acceptMission(
  state: CampaignState,
  def: CampaignDef,
  outcome: MissionOutcome,
  survived: Record<string, boolean> = {},
): CampaignState {
  const launched = launchCampaignMission(state, def);
  const operation = mission(def, def.missions.findIndex((entry) => entry.id === launched.currentMissionId));
  const submitted = submitCampaignResult(
    launched,
    def,
    operation.id,
    resultFor(def, operation, outcome, survived, launched.deployments),
  );
  return acceptCampaignResult(submitted, def);
}

describe('campaign result identity', () => {
  it('records the flag flown at deployment with the pending result', () => {
    const launched = launchCampaignMission(started(), DEFENDER);
    const operation = mission(
      DEFENDER,
      DEFENDER.missions.findIndex((entry) => entry.id === launched.currentMissionId),
    );
    const flag = defaultComposition();
    const submitted = submitCampaignResult(
      launched,
      DEFENDER,
      operation.id,
      resultFor(DEFENDER, operation, 'victory', {}, launched.deployments),
      flag,
    );
    // Persisted with the result, so a debrief reopened after a reload reports the
    // flag the operation was flown under.
    expect(submitted.pending?.flag).toEqual(flag);
  });

  it('leaves the flag absent when the deployment captured none', () => {
    const launched = launchCampaignMission(started(), DEFENDER);
    const operation = mission(
      DEFENDER,
      DEFENDER.missions.findIndex((entry) => entry.id === launched.currentMissionId),
    );
    const submitted = submitCampaignResult(
      launched,
      DEFENDER,
      operation.id,
      resultFor(DEFENDER, operation, 'defeat'),
      null,
    );
    expect(submitted.pending?.flag).toBeUndefined();
  });

  it('keeps the flown flag across a campaign save round-trip', () => {
    const launched = launchCampaignMission(started(), DEFENDER);
    const operation = mission(
      DEFENDER,
      DEFENDER.missions.findIndex((entry) => entry.id === launched.currentMissionId),
    );
    const flag = defaultComposition();
    const submitted = submitCampaignResult(
      launched,
      DEFENDER,
      operation.id,
      resultFor(DEFENDER, operation, 'victory', {}, launched.deployments),
      flag,
    );
    const save = { ...emptyCampaignSave(), runs: { [DEFENDER.id]: submitted } };
    const restored = parseCampaignSave(JSON.parse(serializeCampaignSave(save)), CAMPAIGNS).runs[
      DEFENDER.id
    ];
    expect(restored.pending?.flag).toEqual(flag);
  });
});

describe('campaign definitions', () => {
  it('validates both authored campaigns without errors', () => {
    const mapIds = new Set(SCENARIOS.map((entry) => entry.id));
    for (const def of CAMPAIGNS) {
      const issues = validateCampaignDefinition(def, { knownMapIds: mapIds });
      expect(
        issues.filter((entry) => entry.severity === 'error'),
        `${def.id}: ${issues.map((entry) => `${entry.code} ${entry.path}`).join(', ')}`,
      ).toEqual([]);
      expect(issues.filter((entry) => entry.severity === 'warning')).toEqual([]);
    }
  });

  it('embeds a versioned mission document whose campaign metadata agrees', () => {
    for (const def of CAMPAIGNS) {
      def.missions.forEach((operation, index) => {
        expect(operation.mission.campaign).toEqual({
          campaignId: def.id,
          order: index + 1,
          side: def.allianceId,
        });
        expect(operation.mission.objectives.some((objective) => objective.kind === 'primary')).toBe(
          true,
        );
        // Every operation, authored or template-built, has to observe the
        // opposing headquarters falling: that is the campaign's shared win
        // condition, and no operation may substitute a different one silently.
        expect(
          operation.mission.triggers.some((trigger) =>
            trigger.conditions.some(
              (condition) => condition.kind === 'entityDead' && condition.entity === 'enemy-hq',
            ),
          ),
          `${operation.id} never observes enemy-hq`,
        ).toBe(true);
      });
    }
  });

  it('rejects duplicate operation ids and disagreeing mission metadata', () => {
    const duplicate = cloneDef(DEFENDER);
    duplicate.missions = [duplicate.missions[0], duplicate.missions[0], duplicate.missions[2]];
    expect(
      validateCampaignDefinition(duplicate).some((entry) => entry.code === 'mission-id-duplicate'),
    ).toBe(true);

    const mismatched = cloneDef(DEFENDER);
    mismatched.missions[0].mission.campaign = { campaignId: 'elsewhere', order: 9, side: 'eastern' };
    const issues = validateCampaignDefinition(mismatched);
    expect(issues.some((entry) => entry.code === 'mission-campaign-id')).toBe(true);
    expect(issues.some((entry) => entry.code === 'mission-order')).toBe(true);
    expect(issues.some((entry) => entry.code === 'mission-side')).toBe(true);
  });

  it('rejects undeclared consequences and unknown nations', () => {
    const badConsequence = cloneDef(EASTERN);
    badConsequence.missions[0].mission.consequences.push({
      id: 'ghost',
      key: 'notDeclared',
      value: 1,
    });
    expect(
      validateCampaignDefinition(badConsequence).some(
        (entry) => entry.code === 'consequence-variable-missing',
      ),
    ).toBe(true);

    const badNation = cloneDef(EASTERN);
    badNation.missions[0].playerNationId = 'atlantis';
    expect(
      validateCampaignDefinition(badNation).some(
        (entry) => entry.code === 'mission-command-unknown',
      ),
    ).toBe(true);
  });

  it('rejects a veteran slot that names an unknown roster individual', () => {
    const bad = cloneDef(DEFENDER);
    bad.missions[0].veterans = [
      { key: 'ghost-slot', veteranId: 'vet-ghost', defId: 'rifle' },
    ];
    expect(
      validateCampaignDefinition(bad).some((entry) => entry.code === 'veteran-unknown'),
    ).toBe(true);
  });
});

describe('commander identity', () => {
  it('normalises a profile and keeps pronouns optional', () => {
    expect(
      normaliseCommanderIdentity({
        name: '  Ada Keller ',
        callsign: ' Kestrel ',
        background: ' Staff officer. ',
        pronouns: 'she/her',
      }),
    ).toEqual({
      name: 'Ada Keller',
      callsign: 'Kestrel',
      background: 'Staff officer.',
      pronouns: 'she/her',
    });
    expect(
      normaliseCommanderIdentity({
        name: 'Ada Keller',
        callsign: 'Kestrel',
        background: 'Staff officer.',
      }).pronouns,
    ).toBeUndefined();
  });

  it('rejects short, long and malformed profiles', () => {
    expect(() =>
      normaliseCommanderIdentity({ name: 'A', callsign: 'Kestrel', background: 'x' }),
    ).toThrow(/name/i);
    expect(() =>
      normaliseCommanderIdentity({ name: 'Ada Keller', callsign: 'K', background: 'x' }),
    ).toThrow(/callsign/i);
    expect(() =>
      normaliseCommanderIdentity({ name: 'Ada Keller', callsign: 'Kestrel', background: '' }),
    ).toThrow(/background/i);
    expect(() =>
      normaliseCommanderIdentity({
        name: 'Ada Keller',
        callsign: 'Kestrel!',
        background: 'x',
      }),
    ).toThrow(/callsign/i);
  });

  it('refuses to start a campaign without a valid profile', () => {
    expect(() => createCampaignState(DEFENDER, { name: 'A' })).toThrow(CampaignStateError);
    expect(() => createCampaignState(DEFENDER, null)).toThrow(CampaignStateError);
  });
});

describe('campaign progression', () => {
  it('starts at the first operation with authored variables and roster', () => {
    const state = started();
    expect(state.phase).toBe('briefing');
    expect(state.currentMissionId).toBe(DEFENDER.missions[0].id);
    expect(state.completed).toEqual([]);
    expect(state.variables).toEqual({ lastOperation: '', standing: 0 });
    expect(state.veterans.map((entry) => entry.id)).toEqual(['vet-kestrel', 'vet-vilkas']);
    expect(campaignProgressOf(state, DEFENDER).cleared).toEqual({});
  });

  it('advances only after the result is accepted', () => {
    const launched = launchCampaignMission(started(), DEFENDER);
    const operation = mission(DEFENDER, 0);
    expect(launched.phase).toBe('playing');
    expect(launched.preMission).not.toBeNull();
    expect(launched.deployments).toEqual([{ key: 'kestrel-rifle', veteranId: 'vet-kestrel' }]);

    const submitted = submitCampaignResult(
      launched,
      DEFENDER,
      operation.id,
      resultFor(DEFENDER, operation, 'victory', {}, launched.deployments),
    );
    expect(submitted.phase).toBe('debrief');
    expect(submitted.completed).toEqual([]);
    expect(submitted.variables.standing).toBe(0);
    expect(submitted.currentMissionId).toBe(operation.id);

    const accepted = acceptCampaignResult(submitted, DEFENDER);
    expect(accepted.phase).toBe('briefing');
    expect(accepted.currentMissionId).toBe(DEFENDER.missions[1].id);
    expect(accepted.completed).toHaveLength(1);
    expect(accepted.variables).toEqual({ lastOperation: operation.id, standing: 1 });
    expect(accepted.pending).toBeNull();
    expect(campaignProgressOf(accepted, DEFENDER).cleared).toEqual({
      [DEFENDER.id]: [operation.id],
    });
  });

  it('rejects invalid transitions and duplicate acceptance', () => {
    const state = started();
    expect(() => submitCampaignResult(state, DEFENDER, state.currentMissionId, resultFor(DEFENDER, mission(DEFENDER, 0), 'victory'))).toThrow(
      CampaignStateError,
    );
    const launched = launchCampaignMission(state, DEFENDER);
    const operation = mission(DEFENDER, 0);
    expect(() => acceptCampaignResult(launched, DEFENDER)).toThrow(/no mission result/i);
    expect(() =>
      submitCampaignResult(
        launched,
        DEFENDER,
        DEFENDER.missions[1].id,
        resultFor(DEFENDER, mission(DEFENDER, 1), 'victory'),
      ),
    ).toThrow(CampaignStateError);
    const submitted = submitCampaignResult(
      launched,
      DEFENDER,
      operation.id,
      resultFor(DEFENDER, operation, 'victory', {}, launched.deployments),
    );
    expect(() => submitCampaignResult(submitted, DEFENDER, operation.id, submitted.pending!.result)).toThrow(
      CampaignStateError,
    );
    const accepted = acceptCampaignResult(submitted, DEFENDER);
    // The accepted state is terminal for that attempt: it has no pending result
    // and its briefing phase cannot accept one, so a repeated UI action or a
    // reload after acceptance is refused.
    expect(() => acceptCampaignResult(accepted, DEFENDER)).toThrow(CampaignStateError);
    expect(accepted.completed).toHaveLength(1);
  });

  it('completes only when the final operation is accepted', () => {
    let state = started();
    // Every operation but the last leaves the run on the next briefing.
    for (let index = 0; index < DEFENDER.missions.length - 1; index++) {
      state = acceptMission(state, DEFENDER, 'victory');
      expect(state.phase, DEFENDER.missions[index].id).toBe('briefing');
      expect(state.currentMissionId).toBe(DEFENDER.missions[index + 1].id);
    }
    state = acceptMission(state, DEFENDER, 'victory');
    expect(state.phase).toBe('complete');
    expect(state.completed).toHaveLength(DEFENDER.missions.length);
    // Each operation's authored consequence raises the standing tier to its order.
    expect(state.variables.standing).toBe(DEFENDER.missions.length);
  });
});

describe('retry and veteran carryover', () => {
  it('restores the pre-mission roster and variables on retry', () => {
    const launched = launchCampaignMission(started(), DEFENDER);
    const operation = mission(DEFENDER, 0);
    const submitted = submitCampaignResult(
      launched,
      DEFENDER,
      operation.id,
      resultFor(DEFENDER, operation, 'defeat', { 'kestrel-rifle': false }, launched.deployments),
    );
    const retried = retryCampaignMission(submitted);
    expect(retried.phase).toBe('briefing');
    expect(retried.currentMissionId).toBe(operation.id);
    expect(retried.variables.standing).toBe(0);
    expect(retried.veterans.map((entry) => entry.id)).toContain('vet-kestrel');
    expect(retried.completed).toEqual([]);
    expect(retried.preMission).toBeNull();
    expect(retried.pending).toBeNull();
  });

  it('retires a veteran only when the loss is accepted', () => {
    const launched = launchCampaignMission(started(), DEFENDER);
    const operation = mission(DEFENDER, 0);
    const submitted = submitCampaignResult(
      launched,
      DEFENDER,
      operation.id,
      resultFor(DEFENDER, operation, 'victory', { 'kestrel-rifle': false }, launched.deployments),
    );
    expect(submitted.veterans.map((entry) => entry.id)).toContain('vet-kestrel');
    const accepted = acceptCampaignResult(submitted, DEFENDER);
    expect(accepted.veterans.map((entry) => entry.id)).toEqual(['vet-vilkas']);
    expect(accepted.completed[0].deployments).toEqual(launched.deployments);
  });

  it('carries a survivor into the next operation and records the service', () => {
    const state = acceptMission(started(), DEFENDER, 'victory');
    const veteran = state.veterans.find((entry) => entry.id === 'vet-kestrel');
    expect(veteran?.missions).toEqual([DEFENDER.missions[0].id]);
    expect(campaignDeploymentsFor(state, DEFENDER, DEFENDER.missions[1].id)).toEqual([
      { key: 'kestrel-rifle', veteranId: 'vet-kestrel' },
      { key: 'vilkas-medic', veteranId: 'vet-vilkas' },
    ]);
  });

  it('omits a lost veteran without blocking the operation', () => {
    const accepted = acceptMission(started(), DEFENDER, 'victory', { 'kestrel-rifle': false });
    const deployments = campaignDeploymentsFor(accepted, DEFENDER, DEFENDER.missions[1].id);
    expect(deployments).toEqual([{ key: 'vilkas-medic', veteranId: 'vet-vilkas' }]);
    const launched = launchCampaignMission(accepted, DEFENDER);
    expect(launched.phase).toBe('playing');
  });
});

describe('campaign persistence', () => {
  it('round-trips a pending result and accepted progression', () => {
    const launched = launchCampaignMission(started(EASTERN), EASTERN);
    const operation = mission(EASTERN, 0);
    const submitted = submitCampaignResult(
      launched,
      EASTERN,
      operation.id,
      resultFor(EASTERN, operation, 'victory', {}, launched.deployments),
    );
    const save = {
      ...emptyCampaignSave(),
      runs: { [EASTERN.id]: submitted },
      lastSelection: { campaignId: EASTERN.id, missionId: operation.id },
    };
    const parsed = parseCampaignSave(JSON.parse(serializeCampaignSave(save)), CAMPAIGNS);
    const restored = parsed.runs[EASTERN.id];
    expect(restored.phase).toBe('debrief');
    expect(restored.pending?.result).toEqual(submitted.pending?.result);
    expect(restored.deployments).toEqual(submitted.deployments);
    expect(restored.variables).toEqual(submitted.variables);

    const accepted = acceptCampaignResult(restored, EASTERN);
    expect(accepted.completed).toHaveLength(1);
    expect(accepted.variables.standing).toBe(1);

    const after = {
      ...emptyCampaignSave(),
      runs: { [EASTERN.id]: accepted },
    };
    const reloaded = parseCampaignSave(JSON.parse(serializeCampaignSave(after)), CAMPAIGNS);
    expect(reloaded.runs[EASTERN.id].completed).toHaveLength(1);
    expect(reloaded.runs[EASTERN.id].completed[0].outcome).toBe('victory');
    expect(reloaded.runs[EASTERN.id].currentMissionId).toBe(EASTERN.missions[1].id);
  });

  it('keeps a lost veteran in the accepted record across a reload', () => {
    const accepted = acceptMission(started(), DEFENDER, 'victory', { 'kestrel-rifle': false });
    const save = { ...emptyCampaignSave(), runs: { [DEFENDER.id]: accepted } };
    const restored = parseCampaignSave(JSON.parse(serializeCampaignSave(save)), CAMPAIGNS)
      .runs[DEFENDER.id];
    expect(restored.veterans.map((entry) => entry.id)).toEqual(['vet-vilkas']);
    const record = restored.completed[0];
    expect(record.result?.entities.find((entity) => entity.key === 'kestrel-rifle')).toEqual({
      key: 'kestrel-rifle',
      name: 'Sgt. Emilija Raudonė',
      role: 'veteran',
      defId: 'rifle',
      survived: false,
    });
  });

  it('serialises the same state to the same bytes', () => {
    const state = acceptMission(started(), DEFENDER, 'victory');
    const save = { ...emptyCampaignSave(), runs: { [DEFENDER.id]: state } };
    expect(serializeCampaignSave(save)).toBe(serializeCampaignSave(JSON.parse(serializeCampaignSave(save))));
  });

  it('drops a pending result that does not match its operation', () => {
    const state = started();
    const tampered = {
      ...emptyCampaignSave(),
      runs: {
        [DEFENDER.id]: {
          ...state,
          phase: 'debrief' as const,
          pending: {
            missionId: DEFENDER.missions[1].id,
            result: resultFor(DEFENDER, mission(DEFENDER, 1), 'victory'),
            deployments: [],
          },
        },
      },
    };
    const parsed = parseCampaignSave(JSON.parse(serializeCampaignSave(tampered)), CAMPAIGNS);
    // A debrief without a matching result falls back to the briefing rather than
    // inventing progress from a mismatched record.
    expect(parsed.runs[DEFENDER.id].phase).toBe('briefing');
    expect(parsed.runs[DEFENDER.id].pending).toBeNull();
  });

  it('migrates the pre-S4 cleared set without inventing results', () => {
    const migrated = migrateLegacyCampaignProgress(
      {
        version: 1,
        cleared: { [DEFENDER.id]: [DEFENDER.missions[0].id, DEFENDER.missions[1].id] },
        lastSelection: { campaignId: DEFENDER.id, missionId: DEFENDER.missions[1].id },
      },
      CAMPAIGNS,
    );
    const state = migrated.runs[DEFENDER.id];
    expect(state.completed.map((record: CampaignMissionRecord) => record.missionId)).toEqual([
      DEFENDER.missions[0].id,
      DEFENDER.missions[1].id,
    ]);
    expect(state.completed.every((record) => record.legacy && record.result === undefined)).toBe(true);
    expect(state.completed.map((record) => record.outcome)).toEqual(['victory', 'victory']);
    expect(state.phase).toBe('briefing');
    expect(state.currentMissionId).toBe(DEFENDER.missions[2].id);
    expect(state.commander).toBeNull();
    expect(state.veterans).toHaveLength(DEFENDER.roster.length);
    expect(migrated.lastSelection).toEqual({
      campaignId: DEFENDER.id,
      missionId: DEFENDER.missions[1].id,
    });
  });

  it('validates a saved run and reports structural defects', () => {
    const accepted = acceptMission(started(), DEFENDER, 'victory');
    expect(validateCampaignState(accepted, DEFENDER)).toEqual([]);

    const duplicate: CampaignState = {
      ...accepted,
      completed: [accepted.completed[0], accepted.completed[0]],
    };
    expect(
      validateCampaignState(duplicate, DEFENDER).some(
        (entry) => entry.code === 'state-completed-duplicate',
      ),
    ).toBe(true);

    const { standing: _standing, ...withoutStanding } = accepted.variables;
    const missingVariable: CampaignState = {
      ...accepted,
      variables: withoutStanding,
    };
    expect(
      validateCampaignState(missingVariable, DEFENDER).some(
        (entry) => entry.code === 'state-variable-missing',
      ),
    ).toBe(true);
  });
});

describe('campaign scenario assembly', () => {
  it('builds a valid, mission-bearing scenario with both headquarters keyed', () => {
    const state = started();
    for (const def of CAMPAIGNS) {
      for (const operation of def.missions) {
        const scenario = buildCampaignScenario({
          def,
          mission: operation,
          state: { ...state, campaignId: def.id },
          base: scenarioById(operation.mapId)!.create(),
        });
        expect(scenario.mission?.id).toBe(operation.id);
        expect(scenario.meta.campaign).toEqual({
          campaignId: def.id,
          missionId: operation.id,
        });
        expect(scenario.structures.find((entry) => entry.key === 'enemy-hq')).toBeDefined();
        expect(scenario.structures.find((entry) => entry.key === 'own-hq')).toBeDefined();
        expect(
          validateScenario(scenario).filter((entry) => entry.severity === 'error'),
          `${operation.id}: ${validateScenario(scenario).map((entry) => entry.message).join(', ')}`,
        ).toEqual([]);
      }
    }
  });

  it('places only the veterans the run can actually field', () => {
    let state = launchedWithVeteranLost();
    state = acceptCampaignResult(state, DEFENDER);
    const scenario = buildCampaignScenario({
      def: DEFENDER,
      mission: DEFENDER.missions[1],
      state,
      base: scenarioById(DEFENDER.missions[1].mapId)!.create(),
    });
    const keys = scenario.units.map((entry) => entry.key).filter(Boolean);
    expect(keys).not.toContain('kestrel-rifle');
    expect(keys).toContain('vilkas-medic');
    expect(scenario.mission?.entities.some((entity) => entity.key === 'kestrel-rifle')).toBe(false);
  });

  it('reaches an authoritative mission victory when the opposing command post falls', () => {
    const scenario = buildCampaignScenario({
      def: DEFENDER,
      mission: DEFENDER.missions[0],
      state: started(),
      base: scenarioById(DEFENDER.missions[0].mapId)!.create(),
    });
    const game = new Game(scenario, { enableAI: false });
    expect(game.mission?.outcome).toBe('playing');

    const enemyHq = game.state.entities.find((entity) => entity.authoredKey === 'enemy-hq');
    expect(enemyHq).toBeDefined();
    enemyHq!.hp = 0;
    game.tick();

    // The opening is a held beachhead first: breaking the corps command post
    // early is not a victory until the convoy has landed.
    expect(game.mission?.outcome).toBe('playing');
    game.state.tick = 600 * 60;
    game.tick();

    expect(game.mission?.outcome).toBe('victory');
    expect(game.state.victory).toBe('victory');
    const result = game.missionResult;
    expect(result?.outcome).toBe('victory');
    expect(result?.entities.find((entity) => entity.key === 'enemy-hq')?.survived).toBe(false);
    expect(result?.entities.find((entity) => entity.key === 'kestrel-rifle')?.survived).toBe(true);
  });
});

/** A submitted mission in which the rifle veteran was lost, ready to accept. */
function launchedWithVeteranLost(): CampaignState {
  const launched = launchCampaignMission(started(), DEFENDER);
  const operation = mission(DEFENDER, 0);
  return submitCampaignResult(
    launched,
    DEFENDER,
    operation.id,
    resultFor(DEFENDER, operation, 'victory', { 'kestrel-rifle': false }, launched.deployments),
  );
}

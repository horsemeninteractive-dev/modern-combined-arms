import { describe, expect, it } from 'vitest';
import { Game } from '../src/sim/game';
import { parseScenario, type Scenario } from '../src/sim/scenario';
import { createIslandAssault } from '../src/data/scenarios';
import { TICK_RATE } from '../src/sim/constants';
import {
  MISSION_FORMAT,
  MISSION_FORMAT_VERSION,
  MissionRuntime,
  parseMission,
  validateMission,
  type MissionDoc,
} from '../src/mission';

type Raw = Record<string, any>;

const OBJECTIVES = [
  { id: 'p', title: 'Primary', kind: 'primary', dependsOn: [] },
  { id: 'b', title: 'Bonus', kind: 'bonus', dependsOn: [] },
];

/** A tile on open ground west of the central ridge. */
const FIELD = { id: 'field', x: 20, z: 20, width: 8, height: 8 };

function missionRaw(config: Raw = {}): Raw {
  return {
    format: MISSION_FORMAT,
    version: MISSION_FORMAT_VERSION,
    id: 'op-actions',
    title: 'Action Net',
    description: 'A mission that releases a group, lands a wave and ends itself.',
    briefing: { summary: 'Hold.', friendly: 'A section.', enemy: 'A garrison.' },
    objectives: config.objectives ?? OBJECTIVES,
    variables: config.variables ?? [],
    regions: config.regions ?? [FIELD],
    triggers: config.triggers ?? [],
    aiGroups: config.aiGroups ?? [],
    reinforcements: config.reinforcements ?? [],
    entities: config.entities ?? [],
    cinematics: [],
    consequences: [],
    carryover: { enabled: false, assets: [] },
  };
}

function scenarioFor(raw: Raw, units: Raw[] = []): Scenario {
  const json = JSON.parse(JSON.stringify(createIslandAssault())) as Raw;
  for (const unit of units) json.units.push(unit);
  json.mission = raw;
  return parseScenario(json);
}

/** A group of two authored AI rifle sections waiting in the field. */
const AMBUSH_GROUP = {
  id: 'ambush',
  owner: 1,
  task: 'attack',
  units: ['ambush-a', 'ambush-b'],
  region: 'field',
  initial: 'dormant',
};

const AMBUSH_UNITS = [
  { defId: 'rifle', owner: 1, x: 22, z: 22, key: 'ambush-a' },
  { defId: 'rifle', owner: 1, x: 24, z: 22, key: 'ambush-b' },
];

function releaseTrigger(extra: Raw = {}): Raw {
  return {
    id: 'release-ambush',
    once: true,
    conditions: [{ kind: 'elapsed', seconds: 1 }],
    actions: [{ kind: 'activateAiGroup', group: 'ambush' }],
    ...extra,
  };
}

function authoredUnit(game: Game, key: string) {
  return game.state.entities.find((entity) => entity.authoredKey === key);
}

describe('activateAiGroup', () => {
  it('holds a dormant group until its trigger and releases it once', () => {
    const game = new Game(
      scenarioFor(missionRaw({ aiGroups: [AMBUSH_GROUP], triggers: [releaseTrigger()] }), AMBUSH_UNITS),
      { enableAI: false },
    );
    const held = authoredUnit(game, 'ambush-a');
    expect(held?.missionHold).toBe(true);
    expect(held?.stance).toBe('hold');

    game.advance(TICK_RATE - 1);
    expect(authoredUnit(game, 'ambush-a')?.missionHold).toBe(true);
    expect(game.mission!.isGroupActive('ambush')).toBe(false);

    game.advance(1);
    expect(game.mission!.isGroupActive('ambush')).toBe(true);
    const released = authoredUnit(game, 'ambush-a');
    expect(released?.missionHold).toBe(false);
    expect(released?.stance).toBe('aggressive');

    // A second firing (the trigger is repeatable here) must not re-latch or
    // re-order the group.
    game.mission!.activateGroup('ambush');
    expect(game.mission!.activateGroup('ambush')).toBe(false);
  });

  it('latches in the runtime and survives a save round-trip', () => {
    const doc: MissionDoc = parseMission(
      missionRaw({ aiGroups: [AMBUSH_GROUP] }),
      { entityKeys: new Set(['ambush-a', 'ambush-b']) },
    );
    const runtime = MissionRuntime.fromDoc(doc);
    expect(runtime.isGroupActive('ambush')).toBe(false);
    expect(runtime.activateGroup('ambush')).toBe(true);
    expect(runtime.activateGroup('ambush')).toBe(false);
    expect(runtime.activateGroup('missing')).toBe(false);

    const restored = MissionRuntime.fromState(doc, JSON.parse(JSON.stringify(runtime.snapshot())));
    expect(restored.isGroupActive('ambush')).toBe(true);
    expect(restored.activateGroup('ambush')).toBe(false);

    // A save naming a group that is no longer authored drops the latch instead
    // of resurrecting it.
    const stale = runtime.snapshot();
    stale.groups = ['ambush', 'retired'];
    const cleaned = MissionRuntime.fromState(doc, stale);
    expect(cleaned.isGroupActive('ambush')).toBe(true);
    expect(cleaned.isGroupActive('retired')).toBe(false);
  });
});

describe('spawnReinforcement', () => {
  const WAVE = {
    id: 'relief',
    owner: 1,
    region: 'field',
    units: [{ defId: 'rifle', count: 2 }],
  };

  it('places real units of the wave owner exactly once', () => {
    const game = new Game(
      scenarioFor(
        missionRaw({
          triggers: [
            {
              id: 'call-relief',
              once: true,
              conditions: [{ kind: 'elapsed', seconds: 1 }],
              actions: [{ kind: 'spawnReinforcement', reinforcement: 'relief' }],
            },
          ],
          reinforcements: [WAVE],
        }),
      ),
      { enableAI: false },
    );
    const before = new Set(game.state.entities.map((entity) => entity.id));
    game.advance(TICK_RATE);
    const landed = game.state.entities.filter((entity) => !before.has(entity.id));
    expect(landed).toHaveLength(2);
    expect(landed.every((entity) => entity.owner === 1 && entity.defId === 'rifle' && entity.hp > 0)).toBe(
      true,
    );
    expect(game.mission!.isWaveSpawned('relief')).toBe(true);
  });

  it('arrives on its authored timer without a trigger', () => {
    const game = new Game(
      scenarioFor(missionRaw({ reinforcements: [{ ...WAVE, afterSeconds: 2 }] })),
      { enableAI: false },
    );
    const before = game.state.entities.filter((entity) => entity.owner === 1 && !entity.authoredKey).length;
    game.advance(TICK_RATE * 2 - 1);
    expect(
      game.state.entities.filter((entity) => entity.owner === 1 && !entity.authoredKey).length,
    ).toBe(before);
    game.advance(1);
    expect(
      game.state.entities.filter((entity) => entity.owner === 1 && !entity.authoredKey).length,
    ).toBe(before + 2);
  });

  it('latches the wave so a reload cannot deploy it twice', () => {
    const doc = parseMission(missionRaw({ reinforcements: [WAVE] }));
    const runtime = MissionRuntime.fromDoc(doc);
    expect(runtime.markWaveSpawned('relief')).toBe(true);
    expect(runtime.markWaveSpawned('relief')).toBe(false);
    expect(runtime.markWaveSpawned('other')).toBe(false);
    const restored = MissionRuntime.fromState(doc, JSON.parse(JSON.stringify(runtime.snapshot())));
    expect(restored.isWaveSpawned('relief')).toBe(true);
    expect(restored.markWaveSpawned('relief')).toBe(false);
  });
});

describe('endMission', () => {
  it('finishes the battle with the authored verdict', () => {
    const game = new Game(
      scenarioFor(
        missionRaw({
          triggers: [
            {
              id: 'scripted-win',
              once: true,
              conditions: [{ kind: 'elapsed', seconds: 1 }],
              actions: [{ kind: 'endMission', outcome: 'victory' }],
            },
          ],
        }),
      ),
      { enableAI: false },
    );
    // The primary objective is still open, so only the action can end this.
    expect(game.mission!.objectiveState('p')).toBe('active');
    game.advance(TICK_RATE);
    expect(game.mission!.outcome).toBe('victory');
    expect(game.state.victory).toBe('victory');
  });

  it('cannot reopen a finished mission or overwrite its result', () => {
    const doc = parseMission(missionRaw({}));
    const runtime = MissionRuntime.fromDoc(doc);
    expect(runtime.forceOutcome('defeat')).toBe(true);
    expect(runtime.forceOutcome('victory')).toBe(false);
    expect(runtime.outcome).toBe('defeat');
  });

  it('runs the rest of the trigger but no later trigger', () => {
    const game = new Game(
      scenarioFor(
        missionRaw({
          triggers: [
            {
              id: 'end-then-message',
              priority: 90,
              once: true,
              conditions: [{ kind: 'elapsed', seconds: 1 }],
              actions: [
                { kind: 'endMission', outcome: 'victory' },
                { kind: 'message', text: 'after the verdict' },
              ],
            },
            {
              id: 'later',
              priority: 10,
              once: true,
              conditions: [{ kind: 'elapsed', seconds: 1 }],
              actions: [{ kind: 'message', text: 'must not run' }],
            },
          ],
        }),
      ),
      { enableAI: false },
    );
    game.advance(TICK_RATE);
    const texts = game.state.events
      .filter((event) => event.code === 'missionMessage')
      .map((event) => event.text);
    expect(texts).toContain('after the verdict');
    expect(texts).not.toContain('must not run');
  });
});

describe('authoring diagnostics for the new actions', () => {
  it('warns when a dormant group is never released', () => {
    const doc = parseMission(missionRaw({ aiGroups: [AMBUSH_GROUP] }), {
      entityKeys: new Set(['ambush-a', 'ambush-b']),
    });
    expect(
      validateMission(doc).some((issue) => issue.code === 'ai-group-dormant-unreleased'),
    ).toBe(true);
  });

  it('warns when a wave has neither a spawn action nor a timer', () => {
    const doc = parseMission(
      missionRaw({
        reinforcements: [{ id: 'relief', owner: 1, region: 'field', units: [{ defId: 'rifle', count: 1 }] }],
      }),
    );
    expect(validateMission(doc).some((issue) => issue.code === 'reinforcement-unscheduled')).toBe(
      true,
    );
  });

  it('accepts a released group and a triggered wave without warnings', () => {
    const doc = parseMission(
      missionRaw({
        aiGroups: [AMBUSH_GROUP],
        triggers: [
          releaseTrigger(),
          {
            id: 'call-relief',
            once: true,
            conditions: [{ kind: 'elapsed', seconds: 2 }],
            actions: [{ kind: 'spawnReinforcement', reinforcement: 'relief' }],
          },
        ],
        reinforcements: [
          { id: 'relief', owner: 1, region: 'field', units: [{ defId: 'rifle', count: 1 }] },
        ],
      }),
      { entityKeys: new Set(['ambush-a', 'ambush-b']) },
    );
    const issues = validateMission(doc).filter(
      (issue) =>
        issue.code === 'ai-group-dormant-unreleased' ||
        issue.code === 'reinforcement-unscheduled' ||
        issue.code === 'action-not-executed',
    );
    expect(issues).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import { Game } from '../src/sim/game';
import { parseScenario, type Scenario } from '../src/sim/scenario';
import { createIslandAssault } from '../src/data/scenarios';
import { TICK_RATE, TILE_SIZE } from '../src/sim/constants';
import {
  MISSION_FORMAT,
  MISSION_FORMAT_VERSION,
  MAX_TRIGGER_EXECUTIONS_PER_TICK,
  MissionRuntime,
  parseMission,
  validateMission,
  type MissionDoc,
} from '../src/mission';

type Raw = Record<string, any>;

const BASE_OBJECTIVES = [
  { id: 'p', title: 'Primary One', kind: 'primary', dependsOn: [] },
  { id: 'p2', title: 'Primary Two', kind: 'primary', dependsOn: [] },
  { id: 'b', title: 'Bonus', kind: 'bonus', dependsOn: [] },
];

function missionRaw(config: {
  objectives?: Raw[];
  triggers?: Raw[];
  variables?: Raw[];
  regions?: Raw[];
  entities?: Raw[];
} = {}): Raw {
  return {
    format: MISSION_FORMAT,
    version: MISSION_FORMAT_VERSION,
    id: 'op-trigger-net',
    title: 'Trigger Net',
    description: 'A mission that exercises authored triggers.',
    briefing: { summary: 'Hold the net.', friendly: 'A section.', enemy: 'A patrol.' },
    objectives: config.objectives ?? BASE_OBJECTIVES,
    variables: config.variables ?? [],
    regions: config.regions ?? [],
    triggers: config.triggers ?? [],
    aiGroups: [],
    reinforcements: [],
    entities: config.entities ?? [],
    cinematics: [],
    consequences: [],
    carryover: { enabled: false, assets: [] },
  };
}

function scenarioFor(
  raw: Raw,
  extraUnits: Array<{ key: string; xOffset?: number }> = [],
): Scenario {
  const base = createIslandAssault();
  const json = JSON.parse(JSON.stringify(base)) as Raw;
  const start = base.players[0];
  extraUnits.forEach((unit, index) => {
    json.units.push({
      defId: 'rifle',
      owner: 0,
      x: start.startX + (unit.xOffset ?? index * 2),
      z: start.startZ,
      key: unit.key,
    });
  });
  json.mission = raw;
  return parseScenario(json);
}

function gameFor(raw: Raw, extraUnits: Array<{ key: string; xOffset?: number }> = []): Game {
  return new Game(scenarioFor(raw, extraUnits), { enableAI: false });
}

/** Text of every mission message emitted so far, in event order. */
function messages(game: Game): string[] {
  return game.state.events
    .filter((event) => event.code === 'missionMessage')
    .map((event) => event.text);
}

function messageTrigger(id: string, text: string, extra: Raw = {}): Raw {
  return {
    id,
    once: true,
    conditions: [{ kind: 'elapsed', seconds: 0 }],
    actions: [{ kind: 'message', text }],
    ...extra,
  };
}

describe('trigger conditions', () => {
  it('evaluates elapsed time at the authored second boundary', () => {
    const game = gameFor(
      missionRaw({
        triggers: [
          {
            id: 'one-second',
            once: true,
            conditions: [{ kind: 'elapsed', seconds: 1 }],
            actions: [{ kind: 'message', text: 'one second' }],
          },
        ],
      }),
    );
    game.advance(TICK_RATE - 1);
    expect(messages(game)).toEqual([]);
    game.advance(1);
    expect(messages(game)).toEqual(['one second']);
  });

  it('reads objective state, true and false', () => {
    const game = gameFor(
      missionRaw({
        triggers: [
          {
            id: 'primary-done',
            once: true,
            conditions: [{ kind: 'objective', objective: 'p', state: 'complete' }],
            actions: [{ kind: 'message', text: 'primary done' }],
          },
        ],
      }),
    );
    game.advance(10);
    expect(messages(game)).toEqual([]);
    game.completeObjective('p');
    game.advance(1);
    expect(messages(game)).toEqual(['primary done']);
  });

  it('reads typed variable comparisons', () => {
    const raw = missionRaw({
      variables: [{ id: 'score', type: 'number', default: 0 }],
      triggers: [
        {
          id: 'score-high',
          once: true,
          conditions: [{ kind: 'variable', variable: 'score', op: 'gte', value: 3 }],
          actions: [{ kind: 'message', text: 'score high' }],
        },
      ],
    });
    const game = gameFor(raw);
    game.mission!.setVariable('score', 2);
    game.advance(2);
    expect(messages(game)).toEqual([]);
    game.mission!.setVariable('score', 3);
    game.advance(1);
    expect(messages(game)).toEqual(['score high']);
  });

  it('reads authored entity survival', () => {
    const raw = missionRaw({
      entities: [{ key: 'vip', name: 'VIP', role: 'veteran' }],
      triggers: [
        {
          id: 'vip-alive',
          once: true,
          conditions: [{ kind: 'entityAlive', entity: 'vip' }],
          actions: [{ kind: 'message', text: 'vip alive' }],
        },
      ],
    });
    const alive = gameFor(raw, [{ key: 'vip' }]);
    alive.advance(1);
    expect(messages(alive)).toEqual(['vip alive']);

    const dead = gameFor(raw, [{ key: 'vip' }]);
    const unit = dead.state.entities.find((entity) => entity.authoredKey === 'vip')!;
    unit.hp = 0;
    dead.advance(1);
    expect(messages(dead)).toEqual([]);
  });

  it('reads authored entity loss', () => {
    const raw = missionRaw({
      entities: [{ key: 'target', name: 'Target', role: 'objective' }],
      triggers: [
        {
          id: 'target-lost',
          once: true,
          conditions: [{ kind: 'entityDead', entity: 'target' }],
          actions: [{ kind: 'message', text: 'target lost' }],
        },
      ],
    });
    const alive = gameFor(raw, [{ key: 'target' }]);
    alive.advance(2);
    expect(messages(alive)).toEqual([]);

    const dead = gameFor(raw, [{ key: 'target' }]);
    dead.state.entities.find((entity) => entity.authoredKey === 'target')!.hp = 0;
    dead.advance(1);
    expect(messages(dead)).toEqual(['target lost']);
  });

  it('reads region occupancy by team and threshold', () => {
    const raw = missionRaw({
      regions: [{ id: 'zone', x: 30, z: 30, width: 2, height: 2 }],
      triggers: [
        {
          id: 'zone-held',
          once: true,
          conditions: [{ kind: 'regionOccupied', region: 'zone', team: 0, atLeast: 1 }],
          actions: [{ kind: 'message', text: 'zone held' }],
        },
      ],
    });
    const game = gameFor(raw);
    game.advance(2);
    expect(messages(game)).toEqual([]);
    const unit = game.state.entities.find(
      (entity) => entity.kind === 'unit' && entity.owner === 0 && entity.hp > 0,
    )!;
    unit.x = 30.5 * TILE_SIZE;
    unit.z = 30.5 * TILE_SIZE;
    game.advance(1);
    expect(messages(game)).toEqual(['zone held']);
  });

  it('treats multiple conditions as an AND list', () => {
    const raw = missionRaw({
      variables: [{ id: 'flag', type: 'boolean', default: false }],
      triggers: [
        {
          id: 'both',
          once: true,
          conditions: [
            { kind: 'elapsed', seconds: 0 },
            { kind: 'variable', variable: 'flag', op: 'eq', value: true },
          ],
          actions: [{ kind: 'message', text: 'both' }],
        },
      ],
    });
    const game = gameFor(raw);
    game.advance(5);
    expect(messages(game)).toEqual([]);
    game.mission!.setVariable('flag', true);
    game.advance(1);
    expect(messages(game)).toEqual(['both']);
  });
});

describe('trigger ordering and cascades', () => {
  it('evaluates by descending priority, then trigger id', () => {
    const game = gameFor(
      missionRaw({
        triggers: [
          messageTrigger('z-low', 'low', { priority: 1 }),
          messageTrigger('a-high', 'high', { priority: 5 }),
          messageTrigger('m-mid', 'mid'),
          messageTrigger('b-mid', 'mid-b'),
        ],
      }),
    );
    game.advance(1);
    // Priority 5 first, then 1, then the two priority-0 triggers by id.
    expect(messages(game)).toEqual(['high', 'low', 'mid-b', 'mid']);
  });

  it('executes one trigger’s actions in authored order', () => {
    const game = gameFor(
      missionRaw({
        triggers: [
          {
            id: 'ordered',
            once: true,
            conditions: [{ kind: 'elapsed', seconds: 0 }],
            actions: [
              { kind: 'message', text: 'one' },
              { kind: 'message', text: 'two' },
              { kind: 'message', text: 'three' },
            ],
          },
        ],
      }),
    );
    game.advance(1);
    expect(messages(game)).toEqual(['one', 'two', 'three']);
  });

  it('re-evaluates after a variable change so a dependent trigger fires the same tick', () => {
    const raw = missionRaw({
      variables: [{ id: 'flag', type: 'boolean', default: false }],
      triggers: [
        {
          id: 'set-flag',
          priority: 10,
          once: true,
          conditions: [{ kind: 'elapsed', seconds: 0 }],
          actions: [{ kind: 'setVariable', variable: 'flag', value: true }],
        },
        {
          id: 'read-flag',
          conditions: [{ kind: 'variable', variable: 'flag', op: 'eq', value: true }],
          actions: [{ kind: 'message', text: 'flag seen' }],
        },
      ],
    });
    const game = gameFor(raw);
    game.advance(1);
    expect(messages(game)).toEqual(['flag seen']);
  });

  it('re-evaluates after an objective change so a dependent trigger fires the same tick', () => {
    const raw = missionRaw({
      triggers: [
        {
          id: 'finish-primary',
          priority: 10,
          once: true,
          conditions: [{ kind: 'elapsed', seconds: 0 }],
          actions: [{ kind: 'setObjective', objective: 'p', state: 'complete' }],
        },
        {
          id: 'see-primary',
          conditions: [{ kind: 'objective', objective: 'p', state: 'complete' }],
          actions: [{ kind: 'message', text: 'primary seen' }],
        },
      ],
    });
    const game = gameFor(raw);
    game.advance(1);
    expect(messages(game)).toEqual(['primary seen']);
  });

  it('never executes the same trigger twice in one tick', () => {
    const raw = missionRaw({
      triggers: [
        {
          id: 'self-feeding',
          once: false,
          conditions: [{ kind: 'elapsed', seconds: 0 }],
          actions: [{ kind: 'message', text: 'once per tick' }],
        },
      ],
    });
    const game = gameFor(raw);
    game.advance(1);
    expect(messages(game)).toEqual(['once per tick']);
  });

  it('defers work past the per-tick execution budget', () => {
    const triggers = Array.from({ length: MAX_TRIGGER_EXECUTIONS_PER_TICK + 4 }, (_, i) =>
      messageTrigger(`t${String(i).padStart(2, '0')}`, `m${i}`),
    );
    const game = gameFor(missionRaw({ triggers }));
    game.advance(1);
    expect(messages(game)).toHaveLength(MAX_TRIGGER_EXECUTIONS_PER_TICK);
    game.advance(1);
    expect(messages(game)).toHaveLength(MAX_TRIGGER_EXECUTIONS_PER_TICK + 4);
  });

  it('runs triggers before the terminal outcome, so a bonus completes on the victory tick', () => {
    const game = gameFor(
      missionRaw({
        triggers: [
          {
            id: 'clear-the-net',
            once: true,
            conditions: [{ kind: 'elapsed', seconds: 0 }],
            actions: [
              { kind: 'setObjective', objective: 'p', state: 'complete' },
              { kind: 'setObjective', objective: 'p2', state: 'complete' },
              { kind: 'setObjective', objective: 'b', state: 'complete' },
              { kind: 'message', text: 'net clear' },
            ],
          },
        ],
      }),
    );
    game.advance(1);
    expect(game.state.victory).toBe('victory');
    expect(game.mission!.outcome).toBe('victory');
    expect(game.mission!.objectiveState('b')).toBe('complete');
    expect(messages(game)).toEqual(['net clear']);
    expect(game.missionResult?.objectives.find((o) => o.id === 'b')?.state).toBe('complete');
  });
});

describe('firing policies, delays and cooldowns', () => {
  it('fires a once trigger exactly once', () => {
    const game = gameFor(missionRaw({ triggers: [messageTrigger('once', 'only once')] }));
    game.advance(200);
    expect(messages(game)).toEqual(['only once']);
  });

  it('fires a repeat trigger only on the rising edge', () => {
    const raw = missionRaw({
      variables: [{ id: 'go', type: 'boolean', default: false }],
      triggers: [
        {
          id: 'edge',
          once: false,
          conditions: [{ kind: 'variable', variable: 'go', op: 'eq', value: true }],
          actions: [{ kind: 'message', text: 'edge' }],
        },
      ],
    });
    const game = gameFor(raw);
    game.mission!.setVariable('go', true);
    game.advance(30);
    expect(messages(game)).toEqual(['edge']);

    game.mission!.setVariable('go', false);
    game.advance(1);
    game.mission!.setVariable('go', true);
    game.advance(1);
    expect(messages(game)).toEqual(['edge', 'edge']);
  });

  it('respects a cooldown while the conditions stay true', () => {
    const raw = missionRaw({
      variables: [{ id: 'go', type: 'boolean', default: false }],
      triggers: [
        {
          id: 'pulse',
          once: false,
          cooldownSeconds: 2,
          conditions: [{ kind: 'variable', variable: 'go', op: 'eq', value: true }],
          actions: [{ kind: 'message', text: 'pulse' }],
        },
      ],
    });
    const game = gameFor(raw);
    game.mission!.setVariable('go', true);
    game.advance(1);
    expect(messages(game)).toHaveLength(1);
    game.advance(39);
    expect(messages(game)).toHaveLength(1);
    game.advance(1);
    expect(messages(game)).toHaveLength(2);
    game.advance(40);
    expect(messages(game)).toHaveLength(3);
  });

  it('executes a delayed trigger at its exact due tick', () => {
    const raw = missionRaw({
      triggers: [messageTrigger('delayed', 'delayed', { delaySeconds: 1 })],
    });
    const game = gameFor(raw);
    game.advance(TICK_RATE);
    expect(messages(game)).toEqual([]);
    game.advance(1);
    expect(messages(game)).toEqual(['delayed']);
  });

  it('cancels a pending delay when the conditions stop holding, and can re-arm', () => {
    const raw = missionRaw({
      variables: [{ id: 'go', type: 'boolean', default: false }],
      triggers: [
        {
          id: 'late',
          once: true,
          delaySeconds: 1,
          conditions: [{ kind: 'variable', variable: 'go', op: 'eq', value: true }],
          actions: [{ kind: 'message', text: 'late' }],
        },
      ],
    });
    const game = gameFor(raw);
    game.mission!.setVariable('go', true);
    game.advance(1); // pending, due in 20 ticks
    game.mission!.setVariable('go', false);
    game.advance(40);
    expect(messages(game)).toEqual([]);

    game.mission!.setVariable('go', true);
    game.advance(1); // re-armed: due 20 ticks later
    game.advance(TICK_RATE - 1);
    expect(messages(game)).toEqual([]);
    game.advance(1);
    expect(messages(game)).toEqual(['late']);
  });

  it('executes a zero-delay action during the same evaluation', () => {
    const game = gameFor(
      missionRaw({
        triggers: [messageTrigger('immediate', 'now', { delaySeconds: 0 })],
      }),
    );
    game.advance(1);
    expect(messages(game)).toEqual(['now']);
  });

  it('does not execute triggers once the mission is terminal', () => {
    const game = gameFor(
      missionRaw({
        triggers: [
          {
            id: 'win',
            once: true,
            conditions: [{ kind: 'elapsed', seconds: 0 }],
            actions: [
              { kind: 'setObjective', objective: 'p', state: 'complete' },
              { kind: 'setObjective', objective: 'p2', state: 'complete' },
            ],
          },
          messageTrigger('after', 'too late', {
            conditions: [{ kind: 'elapsed', seconds: 1 }],
          }),
        ],
      }),
    );
    game.advance(200);
    expect(game.state.victory).toBe('victory');
    expect(messages(game)).toEqual([]);
  });
});

describe('trigger actions', () => {
  it('completes objectives through the S2 transition rules', () => {
    const game = gameFor(
      missionRaw({
        triggers: [
          {
            id: 'complete',
            once: true,
            conditions: [{ kind: 'elapsed', seconds: 0 }],
            actions: [{ kind: 'setObjective', objective: 'p', state: 'complete' }],
          },
        ],
      }),
    );
    game.advance(1);
    expect(game.mission!.objectiveState('p')).toBe('complete');
    expect(
      game.state.events.some((event) => event.code === 'objectiveComplete'),
    ).toBe(true);
  });

  it('refuses to complete a hidden objective and changes nothing', () => {
    const raw = missionRaw({
      objectives: [
        ...BASE_OBJECTIVES,
        { id: 'gated', title: 'Gated', kind: 'secondary', dependsOn: [], initialState: 'hidden' },
      ],
      triggers: [
        {
          id: 'force-gated',
          once: true,
          conditions: [{ kind: 'elapsed', seconds: 0 }],
          actions: [{ kind: 'setObjective', objective: 'gated', state: 'complete' }],
        },
      ],
    });
    const game = gameFor(raw);
    game.advance(1);
    expect(game.mission!.objectiveState('gated')).toBe('hidden');
  });

  it('writes only declared variables of the declared type', () => {
    const doc = parseMission(
      missionRaw({ variables: [{ id: 'flag', type: 'boolean', default: false }] }),
    ) as MissionDoc;
    const runtime = MissionRuntime.fromDoc(doc);
    expect(runtime.setVariable('flag', true)).toBe(true);
    expect(runtime.variables.flag).toBe(true);
    expect(runtime.setVariable('flag', 'text')).toBe(false);
    expect(runtime.setVariable('ghost', 1)).toBe(false);
    expect(runtime.variables.flag).toBe(true);
  });

  it('emits each message exactly once', () => {
    const game = gameFor(
      missionRaw({ triggers: [messageTrigger('say', 'hold the net')] }),
    );
    game.advance(200);
    expect(messages(game)).toEqual(['hold the net']);
  });
});

describe('trigger persistence and determinism', () => {
  it('does not re-fire a once trigger after a save and load', () => {
    const game = gameFor(missionRaw({ triggers: [messageTrigger('once', 'fired')] }));
    game.advance(5);
    const save = JSON.parse(JSON.stringify(game.toSave()));
    const restored = Game.fromSave(save, { enableAI: false });
    restored.advance(200);
    expect(messages(restored)).toEqual(['fired']);
  });

  it('preserves a cooldown schedule across a save and load', () => {
    const raw = missionRaw({
      variables: [{ id: 'go', type: 'boolean', default: false }],
      triggers: [
        {
          id: 'pulse',
          once: false,
          cooldownSeconds: 2,
          conditions: [{ kind: 'variable', variable: 'go', op: 'eq', value: true }],
          actions: [{ kind: 'message', text: 'pulse' }],
        },
      ],
    });
    const game = gameFor(raw);
    game.mission!.setVariable('go', true);
    game.advance(1);
    expect(messages(game)).toHaveLength(1);
    const restored = Game.fromSave(JSON.parse(JSON.stringify(game.toSave())), {
      enableAI: false,
    });
    restored.advance(39);
    expect(messages(restored)).toHaveLength(1);
    restored.advance(1);
    expect(messages(restored)).toHaveLength(2);
  });

  it('preserves a pending delay across a save and load', () => {
    const raw = missionRaw({
      triggers: [messageTrigger('delayed', 'delayed', { delaySeconds: 1 })],
    });
    const game = gameFor(raw);
    game.advance(1); // scheduled
    const restored = Game.fromSave(JSON.parse(JSON.stringify(game.toSave())), {
      enableAI: false,
    });
    restored.advance(TICK_RATE - 1);
    expect(messages(restored)).toEqual([]);
    restored.advance(1);
    expect(messages(restored)).toEqual(['delayed']);
  });

  it('loads a save written before trigger state existed', () => {
    const raw = missionRaw({
      triggers: [
        {
          id: 'later',
          once: true,
          conditions: [{ kind: 'elapsed', seconds: 1 }],
          actions: [{ kind: 'message', text: 'later' }],
        },
      ],
    });
    const game = gameFor(raw);
    game.advance(5);
    const save = JSON.parse(JSON.stringify(game.toSave()));
    delete save.state.mission.triggers;
    const restored = Game.fromSave(save, { enableAI: false });
    restored.advance(TICK_RATE);
    expect(messages(restored)).toEqual(['later']);
  });

  it('hashes trigger state and produces identical hashes for identical runs', () => {
    const raw = missionRaw({
      triggers: [messageTrigger('say', 'hello', { delaySeconds: 1 })],
    });
    const a = gameFor(raw);
    const b = gameFor(raw);
    a.advance(5);
    b.advance(5);
    expect(a.stateHash()).toBe(b.stateHash());
    const before = a.stateHash();
    a.advance(TICK_RATE);
    expect(a.stateHash()).not.toBe(before);
    b.advance(TICK_RATE);
    expect(a.stateHash()).toBe(b.stateHash());
  });

  it('round-trips trigger state through a save with an identical hash', () => {
    const raw = missionRaw({
      triggers: [messageTrigger('say', 'hello', { delaySeconds: 1 })],
    });
    const game = gameFor(raw);
    game.advance(5);
    const restored = Game.fromSave(JSON.parse(JSON.stringify(game.toSave())), {
      enableAI: false,
    });
    expect(restored.stateHash()).toBe(game.stateHash());
    expect(restored.mission!.serialize()).toBe(game.mission!.serialize());
  });
});

describe('trigger validation', () => {
  it('rejects a non-integer priority', () => {
    const raw = missionRaw({
      triggers: [messageTrigger('bad', 'bad', { priority: 1.5 })],
    });
    expect(() => parseMission(raw)).toThrow(/priority/);
  });

  it('rejects an action that returns an objective to hidden', () => {
    const raw = missionRaw({
      triggers: [
        {
          id: 'hide',
          once: true,
          conditions: [{ kind: 'elapsed', seconds: 0 }],
          actions: [{ kind: 'setObjective', objective: 'p', state: 'hidden' }],
        },
      ],
    });
    expect(() => parseMission(raw)).toThrow(/hidden/);
  });

  it('rejects ordering comparisons on non-numeric variables', () => {
    const raw = missionRaw({
      variables: [{ id: 'callsign', type: 'string', default: 'Kestrel' }],
      triggers: [
        {
          id: 'ordered',
          once: true,
          conditions: [{ kind: 'variable', variable: 'callsign', op: 'gt', value: 'A' }],
          actions: [{ kind: 'message', text: 'never' }],
        },
      ],
    });
    expect(() => parseMission(raw)).toThrow(/only numbers can be ordered/);
  });

  it('warns about actions this build does not execute', () => {
    const raw = missionRaw({
      triggers: [
        {
          id: 'deferred',
          once: true,
          conditions: [{ kind: 'elapsed', seconds: 5 }],
          actions: [{ kind: 'endMission', outcome: 'victory' }],
        },
      ],
    });
    const doc = parseMission(raw);
    expect(validateMission(doc).some((issue) => issue.code === 'action-not-executed')).toBe(true);
  });

  it('warns about a repeat trigger with nothing to gate it', () => {
    const raw = missionRaw({
      triggers: [
        {
          id: 'always',
          once: false,
          conditions: [],
          actions: [{ kind: 'message', text: 'always' }],
        },
      ],
    });
    const doc = parseMission(raw);
    expect(validateMission(doc).some((issue) => issue.code === 'trigger-repeat-unthrottled')).toBe(
      true,
    );
  });

  it('warns when a trigger only fires on a state it sets itself', () => {
    const raw = missionRaw({
      triggers: [
        {
          id: 'loop',
          once: false,
          conditions: [{ kind: 'objective', objective: 'p', state: 'complete' }],
          actions: [{ kind: 'setObjective', objective: 'p', state: 'complete' }],
        },
      ],
    });
    const doc = parseMission(raw);
    expect(validateMission(doc).some((issue) => issue.code === 'trigger-self-gated')).toBe(true);
  });
});

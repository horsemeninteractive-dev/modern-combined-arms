import { describe, expect, it } from 'vitest';
import { Game } from '../src/sim/game';
import {
  ScenarioFormatError,
  parseScenario,
  scenarioToJson,
  type Scenario,
} from '../src/sim/scenario';
import { createIslandAssault } from '../src/data/scenarios';
import {
  MISSION_FORMAT,
  MISSION_FORMAT_VERSION,
  MissionFormatError,
  MissionRuntime,
  parseMission,
  serializeMissionRuntime,
  validateMission,
  type MissionDoc,
} from '../src/mission';
import { RoomMatch, type RoomSeatDefinition } from '../src/multiplayer/roomMatch';
import { validateScenario } from '../src/sim/scenario';

/** A complete, valid mission used as the baseline for every negative case. */
function missionJson(): Record<string, unknown> {
  return {
    format: MISSION_FORMAT,
    version: MISSION_FORMAT_VERSION,
    id: 'op-first-light',
    title: 'First Light',
    description: 'Open the corridor before dawn.',
    author: 'MCA Mission Team',
    campaign: { campaignId: 'baltic-approach', order: 1, side: 'defender' },
    briefing: {
      summary: 'A village blocks the only road east.',
      friendly: 'Two under-strength sections and a single MBT.',
      enemy: 'A dug-in rifle platoon with mortar support.',
      commanderNote: 'Keep the bridge intact.',
    },
    objectives: [
      { id: 'secure-village', title: 'Secure the village', kind: 'primary', dependsOn: [] },
      {
        id: 'hold-bridge',
        title: 'Hold the bridge',
        kind: 'secondary',
        dependsOn: ['secure-village'],
      },
    ],
    variables: [
      { id: 'village-held', type: 'boolean', default: false },
      { id: 'casualties', type: 'number', default: 0 },
      { id: 'callsign', type: 'string', default: 'Kestrel' },
    ],
    regions: [{ id: 'village', name: 'Village', x: 8, z: 8, width: 4, height: 4 }],
    triggers: [
      {
        id: 'village-entered',
        once: true,
        conditions: [{ kind: 'regionOccupied', region: 'village', team: 0, atLeast: 1 }],
        actions: [
          { kind: 'setVariable', variable: 'village-held', value: true },
          { kind: 'setObjective', objective: 'secure-village', state: 'complete' },
          { kind: 'message', text: 'Village secured.' },
        ],
      },
      {
        id: 'relief-request',
        once: false,
        cooldownSeconds: 90,
        delaySeconds: 5,
        conditions: [
          { kind: 'elapsed', seconds: 240 },
          { kind: 'variable', variable: 'casualties', op: 'gte', value: 3 },
        ],
        actions: [{ kind: 'spawnReinforcement', reinforcement: 'relief' }],
      },
    ],
    aiGroups: [
      { id: 'garrison', owner: 1, task: 'defend', units: ['village-rifles'], region: 'village' },
    ],
    reinforcements: [
      {
        id: 'relief',
        owner: 1,
        region: 'village',
        units: [{ defId: 'rifle', count: 3 }],
        afterSeconds: 300,
      },
    ],
    entities: [{ key: 'village-rifles', name: 'Village Rifles', role: 'veteran' }],
    cinematics: [
      {
        id: 'opening',
        kind: 'opening',
        skippable: true,
        dialogue: [{ speaker: 'Commander', line: 'Move out at first light.' }],
      },
    ],
    consequences: [{ id: 'village-secured', key: 'villageSecured', value: true }],
    carryover: { enabled: true, assets: ['village-rifles'] },
  };
}

/** A scenario carrying the mission plus the authored placement it references. */
function missionScenarioRaw(mutate?: (raw: Record<string, any>) => void): Record<string, any> {
  const scenario = createIslandAssault();
  const raw = JSON.parse(JSON.stringify(scenario)) as Record<string, any>;
  const start = scenario.players[0];
  raw.units.push({ defId: 'rifle', owner: 0, x: start.startX, z: start.startZ, key: 'village-rifles' });
  raw.mission = missionJson();
  mutate?.(raw);
  return raw;
}

function missionScenario(mutate?: (raw: Record<string, any>) => void): Scenario {
  return parseScenario(missionScenarioRaw(mutate));
}

function missionGame(): Game {
  return new Game(missionScenario(), { enableAI: false });
}

const SEATS: RoomSeatDefinition[] = [
  { seatId: 0, playerId: 0, team: 0, token: 'seat-zero-token-000000000000' },
  { seatId: 1, playerId: 1, team: 1, token: 'seat-one-token-0000000000000' },
];

describe('mission document parsing', () => {
  it('parses a complete valid mission', () => {
    const doc = parseMission(missionJson());
    expect(doc.format).toBe(MISSION_FORMAT);
    expect(doc.version).toBe(MISSION_FORMAT_VERSION);
    expect(doc.id).toBe('op-first-light');
    expect(doc.objectives).toHaveLength(2);
    expect(doc.triggers[0].conditions[0]).toEqual({
      kind: 'regionOccupied',
      region: 'village',
      team: 0,
      atLeast: 1,
    });
    expect(doc.carryover).toEqual({ enabled: true, assets: ['village-rifles'] });
    expect(doc.campaign).toEqual({ campaignId: 'baltic-approach', order: 1, side: 'defender' });
  });

  it('rejects a document with no title', () => {
    const raw = missionJson();
    delete raw.title;
    expect(() => parseMission(raw)).toThrow(MissionFormatError);
    expect(() => parseMission(raw)).toThrow(/title/);
  });

  it('rejects a document with no briefing', () => {
    const raw = missionJson();
    delete raw.briefing;
    expect(() => parseMission(raw)).toThrow(/briefing/);
  });

  it('rejects an unsupported mission version and names both versions', () => {
    const raw = { ...missionJson(), version: MISSION_FORMAT_VERSION + 1 };
    expect(() => parseMission(raw)).toThrow(MissionFormatError);
    expect(() => parseMission(raw)).toThrow(/mission\.version/);
    expect(() => parseMission(raw)).toThrow(
      new RegExp(`version ${MISSION_FORMAT_VERSION + 1}.*version ${MISSION_FORMAT_VERSION}`),
    );
  });

  it('rejects a wrong format identifier', () => {
    const raw = { ...missionJson(), format: 'something-else' };
    expect(() => parseMission(raw)).toThrow(/format/);
  });

  it('rejects duplicate child ids inside one namespace', () => {
    const raw = missionJson();
    (raw.objectives as Array<Record<string, unknown>>).push({
      id: 'secure-village',
      title: 'Duplicate',
      kind: 'optional',
      dependsOn: [],
    });
    expect(() => parseMission(raw)).toThrow(/duplicate-id|more than one entry/);
  });

  it('allows the same id in different namespaces', () => {
    const raw = missionJson();
    // "village" is already a region; reusing it as a variable is legal.
    (raw.variables as Array<Record<string, unknown>>).push({
      id: 'village',
      type: 'number',
      default: 0,
    });
    expect(() => parseMission(raw)).not.toThrow();
  });

  it('rejects a region with no area', () => {
    const raw = missionJson();
    (raw.regions as Array<Record<string, unknown>>)[0].width = 0;
    expect(() => parseMission(raw)).toThrow(/regions\[0\]\.width/);
  });

  it('rejects a region that runs off the map when validated in a scenario', () => {
    const raw = missionJson();
    (raw.regions as Array<Record<string, unknown>>)[0].x = 5000;
    expect(() => parseMission(raw, { width: 64, height: 64 })).toThrow(/region-out-of-bounds/);
  });

  it('rejects a variable whose default does not match its type', () => {
    const raw = missionJson();
    (raw.variables as Array<Record<string, unknown>>)[0].default = 3;
    expect(() => parseMission(raw)).toThrow(/variable-default-type|defaults to/);
  });

  it('rejects an unsupported condition kind instead of ignoring it', () => {
    const raw = missionJson();
    (raw.triggers as Array<Record<string, unknown>>)[0].conditions = [{ kind: 'javascript', code: 'x' }];
    expect(() => parseMission(raw)).toThrow(/supported condition/);
  });

  it('rejects an unsupported action kind', () => {
    const raw = missionJson();
    (raw.triggers as Array<Record<string, unknown>>)[0].actions = [{ kind: 'eval', code: 'x' }];
    expect(() => parseMission(raw)).toThrow(/supported action/);
  });

  it('rejects a trigger that references a missing objective', () => {
    const raw = missionJson();
    (raw.triggers as Array<Record<string, unknown>>)[0].actions = [
      { kind: 'setObjective', objective: 'no-such-objective', state: 'complete' },
    ];
    expect(() => parseMission(raw)).toThrow(/unknown objective/);
  });

  it('rejects an objective dependency that does not resolve', () => {
    const raw = missionJson();
    (raw.objectives as Array<Record<string, unknown>>)[1].dependsOn = ['no-such-objective'];
    expect(() => parseMission(raw)).toThrow(/depends on unknown objective/);
  });

  it('reports authored warnings through validateMission without failing the parse', () => {
    const raw = missionJson();
    (raw.triggers as Array<Record<string, unknown>>)[0].conditions = [];
    const doc = parseMission(raw);
    const issues = validateMission(doc);
    expect(issues.some((issue) => issue.code === 'trigger-immediate')).toBe(true);
    expect(issues.filter((issue) => issue.severity === 'error')).toHaveLength(0);
  });
});

describe('scenario integration', () => {
  it('parses a scenario carrying a mission', () => {
    const scenario = missionScenario();
    expect(scenario.mission?.id).toBe('op-first-light');
    expect(scenario.mission?.objectives).toHaveLength(2);
  });

  it('round-trips mission data through scenario JSON', () => {
    const scenario = missionScenario();
    const restored = parseScenario(JSON.parse(scenarioToJson(scenario)));
    expect(restored.mission).toEqual(scenario.mission);
    expect(restored.units.some((u) => u.key === 'village-rifles')).toBe(true);
  });

  it('keeps a mission-less scenario loading exactly as before', () => {
    const plain = parseScenario(JSON.parse(JSON.stringify(createIslandAssault())));
    expect(plain.mission).toBeUndefined();
    expect(() => scenarioToJson(plain)).not.toThrow();
  });

  it('rejects a malformed mission inside a scenario instead of ignoring it', () => {
    expect(() =>
      parseScenario(
        missionScenarioRaw((raw) => {
          raw.mission.version = MISSION_FORMAT_VERSION + 5;
        }),
      ),
    ).toThrow(ScenarioFormatError);
    expect(() =>
      parseScenario(
        missionScenarioRaw((raw) => {
          raw.mission.version = MISSION_FORMAT_VERSION + 5;
        }),
      ),
    ).toThrow(/Unsupported mission version/);
  });

  it('rejects a mission that references an entity the scenario does not place', () => {
    expect(() =>
      parseScenario(
        missionScenarioRaw((raw) => {
          raw.mission.entities = [{ key: 'missing-asset', role: 'veteran' }];
        }),
      ),
    ).toThrow(/not placed in this scenario/);
  });

  it('rejects duplicate authored placement keys across units and structures', () => {
    expect(() =>
      parseScenario(
        missionScenarioRaw((raw) => {
          raw.structures.push({ ...raw.structures[0], key: 'village-rifles' });
        }),
      ),
    ).toThrow(/unique authored key/);
  });

  it('rejects an authored key that is not an identifier', () => {
    expect(() =>
      parseScenario(
        missionScenarioRaw((raw) => {
          raw.units[raw.units.length - 1].key = '1 not a key';
        }),
      ),
    ).toThrow(/identifier/);
  });

  it('flags duplicate authored keys in a scenario assembled in code', () => {
    const scenario = createIslandAssault();
    const start = scenario.players[0];
    scenario.units.push({ defId: 'rifle', owner: 0, x: start.startX, z: start.startZ, key: 'dup' });
    scenario.units.push({ defId: 'rifle', owner: 0, x: start.startX, z: start.startZ, key: 'dup' });
    const issues = validateScenario(scenario);
    expect(issues.some((i) => i.code === 'duplicate-authored-key' && i.severity === 'error')).toBe(
      true,
    );
  });

  it('surfaces mission findings through validateScenario', () => {
    const scenario = missionScenario((raw) => {
      raw.mission.triggers[0].conditions = [];
    });
    const issues = validateScenario(scenario);
    expect(issues.some((issue) => issue.code === 'mission-trigger-immediate')).toBe(true);
  });
});

describe('authored entity identity', () => {
  it('carries the authored key from placement to the runtime entity', () => {
    const game = missionGame();
    const named = game.state.entities.find((entity) => entity.authoredKey === 'village-rifles');
    expect(named).toBeDefined();
    expect(named?.defId).toBe('rifle');
    expect(named?.owner).toBe(0);
  });

  it('leaves produced units and ordinary placements without a key', () => {
    const game = missionGame();
    const keyed = game.state.entities.filter((entity) => entity.authoredKey !== undefined);
    expect(keyed).toHaveLength(1);
  });

  it('preserves the authored key through a save', () => {
    const game = missionGame();
    const restored = Game.fromSave(JSON.parse(JSON.stringify(game.toSave())), { enableAI: false });
    const named = restored.state.entities.find((entity) => entity.authoredKey === 'village-rifles');
    expect(named).toBeDefined();
  });
});

describe('inert mission runtime', () => {
  it('is absent for a skirmish', () => {
    const game = new Game(createIslandAssault(), { enableAI: false });
    expect(game.mission).toBeNull();
    expect(game.state.mission).toBeNull();
  });

  it('initialises variables from defaults and objectives with their opening states', () => {
    const game = missionGame();
    expect(game.mission?.id).toBe('op-first-light');
    expect(game.mission?.version).toBe(MISSION_FORMAT_VERSION);
    expect(game.mission?.variables).toEqual({
      callsign: 'Kestrel',
      casualties: 0,
      'village-held': false,
    });
    // The root objective is live; the dependent one waits for its prerequisite.
    expect(game.mission?.objectives).toEqual([
      { id: 'secure-village', state: 'active' },
      { id: 'hold-bridge', state: 'hidden' },
    ]);
  });

  it('is deterministic: two fresh runtimes serialise identically', () => {
    const doc = parseMission(missionJson()) as MissionDoc;
    const a = MissionRuntime.fromDoc(doc);
    const b = MissionRuntime.fromDoc(doc);
    expect(a.serialize()).toBe(b.serialize());
    expect(a.hash()).toBe(b.hash());
  });

  it('serialises canonically regardless of authored variable order', () => {
    const forward = parseMission(missionJson());
    const reversedRaw = missionJson();
    reversedRaw.variables = [...(reversedRaw.variables as unknown[])].reverse();
    const reversed = parseMission(reversedRaw);
    expect(MissionRuntime.fromDoc(forward).serialize()).toBe(
      MissionRuntime.fromDoc(reversed).serialize(),
    );
  });

  it('restores saved state and drops unknown ids instead of trusting the file', () => {
    const doc = parseMission(missionJson());
    const state = {
      missionId: 'op-first-light',
      version: MISSION_FORMAT_VERSION,
      variables: { casualties: 2, 'village-held': true, ghost: 7 },
      objectives: [
        { id: 'secure-village', state: 'complete' },
        { id: 'no-such-objective', state: 'complete' },
      ],
    };
    const runtime = MissionRuntime.fromState(doc, state);
    expect(runtime.variables).toEqual({ callsign: 'Kestrel', casualties: 2, 'village-held': true });
    expect(runtime.objectives).toEqual([
      { id: 'secure-village', state: 'complete' },
      // Loading heals the authored dependency: a completed prerequisite makes
      // its dependent available, so the mission cannot resume half-resolved.
      { id: 'hold-bridge', state: 'active' },
    ]);
  });

  it('refuses state written for a different mission and starts fresh', () => {
    const doc = parseMission(missionJson());
    const runtime = MissionRuntime.fromState(doc, {
      missionId: 'some-other-mission',
      version: MISSION_FORMAT_VERSION,
      variables: { casualties: 99 },
      objectives: [],
    });
    expect(runtime.variables.casualties).toBe(0);
  });

  it('never mutates mission state as a side effect of ticking', () => {
    const game = missionGame();
    const before = serializeMissionRuntime(game.state.mission!);
    game.advance(40);
    expect(serializeMissionRuntime(game.state.mission!)).toBe(before);
  });
});

describe('mission persistence and determinism', () => {
  it('round-trips mission state through a save', () => {
    const game = missionGame();
    game.advance(50);
    game.state.mission!.variables.casualties = 4;
    const restored = Game.fromSave(JSON.parse(JSON.stringify(game.toSave())), { enableAI: false });
    expect(restored.mission?.id).toBe('op-first-light');
    expect(restored.mission?.variables.casualties).toBe(4);
    expect(restored.state.mission).toEqual(game.state.mission);
  });

  it('restores equivalent gameplay and an identical hash after a save', () => {
    const game = missionGame();
    game.advance(60);
    const restored = Game.fromSave(JSON.parse(JSON.stringify(game.toSave())), { enableAI: false });
    expect(restored.stateHash()).toBe(game.stateHash());
    game.advance(40);
    restored.advance(40);
    expect(restored.stateHash()).toBe(game.stateHash());
  });

  it('accounts for mission state in the state hash', () => {
    const a = missionGame();
    const b = missionGame();
    expect(a.stateHash()).toBe(b.stateHash());
    b.state.mission!.variables.casualties = 5;
    expect(b.stateHash()).not.toBe(a.stateHash());
  });

  it('loads a save written before missions existed', () => {
    const plain = new Game(createIslandAssault(), { enableAI: false });
    plain.advance(20);
    const save = JSON.parse(JSON.stringify(plain.toSave()));
    delete save.state.mission;
    const restored = Game.fromSave(save, { enableAI: false });
    expect(restored.mission).toBeNull();
    expect(restored.state.mission).toBeNull();
    expect(restored.state.tick).toBe(plain.state.tick);
  });

  it('initialises a fresh mission runtime when a mission save has no mission state', () => {
    const game = missionGame();
    const save = JSON.parse(JSON.stringify(game.toSave()));
    delete save.state.mission;
    const restored = Game.fromSave(save, { enableAI: false });
    expect(restored.mission?.id).toBe('op-first-light');
    expect(restored.mission?.variables.casualties).toBe(0);
  });

  it('drops mission state from a save whose scenario no longer carries a mission', () => {
    const game = missionGame();
    const save = JSON.parse(JSON.stringify(game.toSave()));
    delete save.scenario.mission;
    const restored = Game.fromSave(save, { enableAI: false });
    expect(restored.mission).toBeNull();
    expect(restored.state.mission).toBeNull();
  });

  it('keeps a mission-less game identical to a second mission-less game', () => {
    const a = new Game(createIslandAssault(), { enableAI: false });
    const b = new Game(createIslandAssault(), { enableAI: false });
    a.advance(30);
    b.advance(30);
    expect(a.stateHash()).toBe(b.stateHash());
    expect(a.mission).toBeNull();
  });
});

describe('multiplayer isolation', () => {
  it('refuses a mission-bearing scenario when a room is constructed with a game', () => {
    const game = missionGame();
    expect(game.mission).not.toBeNull();
    expect(
      () =>
        new RoomMatch({
          roomId: 'mission-room',
          mode: '1v1',
          seats: SEATS,
          matchDurationMs: 120_000,
          matchDeadlineAt: 1_000_000,
          now: 1000,
          game,
        }),
    ).toThrow(/cannot host a mission/i);
  });

  it('builds its own battlefield and never receives a mission runtime', () => {
    const room = new RoomMatch({
      roomId: 'plain-room',
      mode: '1v1',
      seats: SEATS,
      matchDurationMs: 120_000,
      matchDeadlineAt: 1_000_000,
      now: 1000,
    });
    expect(room.game.mission).toBeNull();
    expect(room.game.state.mission).toBeNull();
    expect(room.game.state.scenario.mission).toBeUndefined();
  });
});

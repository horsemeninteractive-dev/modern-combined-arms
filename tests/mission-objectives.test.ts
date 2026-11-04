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
} from '../src/mission';
import { missionObjectiveMarkup, missionObjectiveView } from '../src/ui/missionObjectiveView';
import { missionDebriefMarkup, missionOutcomeCopy } from '../src/ui/missionDebrief';

type Raw = Record<string, any>;

/** Radar Ridge: a primary root, a dependent primary, a secondary and a bonus. */
function missionRaw(overrides: Raw = {}): Raw {
  return {
    format: MISSION_FORMAT,
    version: MISSION_FORMAT_VERSION,
    id: 'op-radar-ridge',
    title: 'Radar Ridge',
    description: 'Take the ridge before the relief column arrives.',
    briefing: {
      summary: 'A radar station overlooks the eastern road.',
      friendly: 'A mechanised section and a convoy escort.',
      enemy: 'A reinforced infantry company.',
    },
    objectives: [
      { id: 'secure-radar', title: 'Secure the radar station', kind: 'primary', dependsOn: [] },
      {
        id: 'hold-east',
        title: 'Hold the eastern approach',
        kind: 'primary',
        dependsOn: ['secure-radar'],
      },
      {
        id: 'convoy',
        title: 'Preserve the evacuation convoy',
        kind: 'secondary',
        dependsOn: [],
      },
      { id: 'sweep', title: 'Sweep the ridge', kind: 'bonus', dependsOn: [] },
    ],
    variables: [],
    regions: [],
    triggers: [],
    aiGroups: [],
    reinforcements: [],
    entities: [
      { key: 'radar-team', name: 'Radar Team', role: 'veteran' },
      { key: 'convoy-truck', name: 'Convoy Truck', role: 'asset' },
    ],
    cinematics: [],
    consequences: [],
    carryover: { enabled: false, assets: [] },
    ...overrides,
  };
}

/** A→B→C chain used by the dependency tests. */
function chainRaw(): Raw {
  return missionRaw({
    objectives: [
      { id: 'a', title: 'Take the ridge', kind: 'primary', dependsOn: [] },
      { id: 'b', title: 'Clear the village', kind: 'primary', dependsOn: ['a'] },
      { id: 'c', title: 'Open the road', kind: 'bonus', dependsOn: ['b'] },
    ],
  });
}

function scenarioFor(raw: Raw = missionRaw()): Scenario {
  const base = createIslandAssault();
  const json = JSON.parse(JSON.stringify(base)) as Raw;
  const start = base.players[0];
  json.units.push({
    defId: 'rifle',
    owner: 0,
    x: start.startX,
    z: start.startZ,
    key: 'radar-team',
  });
  json.units.push({
    defId: 'rifle',
    owner: 0,
    x: start.startX + 2,
    z: start.startZ,
    key: 'convoy-truck',
  });
  json.mission = raw;
  return parseScenario(json);
}

function gameFor(raw: Raw = missionRaw()): Game {
  return new Game(scenarioFor(raw), { enableAI: false });
}

function stateOf(game: Game, id: string): string | undefined {
  return game.mission!.objectiveState(id);
}

function blockedBy(game: Game, id: string): string[] | undefined {
  return game.mission!.objectives.find((objective) => objective.id === id)?.blockedBy;
}

/** Finish the baseline mission by completing both primary objectives. */
function winMission(game: Game): void {
  expect(game.completeObjective('secure-radar')).toBe(true);
  expect(game.completeObjective('hold-east')).toBe(true);
  game.advance(1);
}

describe('objective activation and dependencies', () => {
  it('starts root objectives active and dependent objectives hidden', () => {
    const game = gameFor();
    expect(stateOf(game, 'secure-radar')).toBe('active');
    expect(stateOf(game, 'convoy')).toBe('active');
    expect(stateOf(game, 'sweep')).toBe('active');
    expect(stateOf(game, 'hold-east')).toBe('hidden');
  });

  it('activates a dependent objective only when its prerequisite completes', () => {
    const game = gameFor();
    expect(game.completeObjective('secure-radar')).toBe(true);
    expect(stateOf(game, 'hold-east')).toBe('active');
    // The completed root stays terminal.
    expect(stateOf(game, 'secure-radar')).toBe('complete');
  });

  it('resolves a multi-level dependency chain in order', () => {
    const game = gameFor(chainRaw());
    expect(stateOf(game, 'a')).toBe('active');
    expect(stateOf(game, 'b')).toBe('hidden');
    expect(stateOf(game, 'c')).toBe('hidden');
    game.completeObjective('a');
    expect(stateOf(game, 'b')).toBe('active');
    expect(stateOf(game, 'c')).toBe('hidden');
    game.completeObjective('b');
    expect(stateOf(game, 'c')).toBe('active');
  });

  it('activates several dependents of one prerequisite deterministically', () => {
    const raw = missionRaw({
      objectives: [
        { id: 'root', title: 'Root', kind: 'primary', dependsOn: [] },
        { id: 'left', title: 'Left', kind: 'primary', dependsOn: ['root'] },
        { id: 'right', title: 'Right', kind: 'bonus', dependsOn: ['root'] },
        { id: 'last', title: 'Last', kind: 'secondary', dependsOn: ['root', 'left'] },
      ],
    });
    const game = gameFor(raw);
    game.completeObjective('root');
    expect(stateOf(game, 'left')).toBe('active');
    expect(stateOf(game, 'right')).toBe('active');
    expect(stateOf(game, 'last')).toBe('hidden');
    game.completeObjective('left');
    expect(stateOf(game, 'last')).toBe('active');
  });

  it('keeps activation deterministic across two identical runs', () => {
    const a = gameFor(chainRaw());
    const b = gameFor(chainRaw());
    a.completeObjective('a');
    b.completeObjective('a');
    expect(a.mission!.serialize()).toBe(b.mission!.serialize());
  });

  it('fails dependents of a failed objective instead of leaving them pending', () => {
    const raw = missionRaw({
      objectives: [
        { id: 'p', title: 'Hold the line', kind: 'primary', dependsOn: [] },
        { id: 's', title: 'Escort the convoy', kind: 'secondary', dependsOn: [] },
        { id: 'f', title: 'Follow the convoy', kind: 'bonus', dependsOn: ['s'] },
        { id: 'f2', title: 'Reach the depot', kind: 'bonus', dependsOn: ['f'] },
      ],
    });
    const game = gameFor(raw);
    expect(game.failObjective('s')).toBe(true);
    expect(stateOf(game, 'f')).toBe('failed');
    expect(stateOf(game, 'f2')).toBe('failed');
    // Blocked objectives name the dependency that failed, so a blocked chain is
    // distinguishable from the player's own failure.
    expect(blockedBy(game, 'f')).toEqual(['s']);
    expect(blockedBy(game, 'f2')).toEqual(['f']);
    expect(blockedBy(game, 's')).toBeUndefined();
    expect(stateOf(game, 'p')).toBe('active');
    expect(game.mission!.outcome).toBe('playing');
  });

  it('refuses to complete a hidden objective', () => {
    const game = gameFor();
    expect(game.completeObjective('hold-east')).toBe(false);
    expect(stateOf(game, 'hold-east')).toBe('hidden');
  });

  it('holds an explicitly trigger-gated objective until it is activated', () => {
    const raw = missionRaw({
      objectives: [
        { id: 'p', title: 'Primary', kind: 'primary', dependsOn: [] },
        { id: 'gated', title: 'Gated', kind: 'secondary', dependsOn: [], initialState: 'hidden' },
      ],
    });
    const game = gameFor(raw);
    expect(stateOf(game, 'gated')).toBe('hidden');
    expect(game.completeObjective('gated')).toBe(false);
    expect(game.activateObjective('gated')).toBe(true);
    expect(game.completeObjective('gated')).toBe(true);
    expect(stateOf(game, 'gated')).toBe('complete');
  });

  it('refuses activation before dependencies complete', () => {
    const game = gameFor();
    // `hold-east` is an ordinary dependent objective, but a trigger asking for
    // it early must still be refused.
    expect(game.activateObjective('hold-east')).toBe(false);
    expect(stateOf(game, 'hold-east')).toBe('hidden');
  });
});

describe('objective transitions', () => {
  it('rejects unknown ids without touching state', () => {
    const game = gameFor();
    const before = game.mission!.serialize();
    expect(game.completeObjective('nope')).toBe(false);
    expect(game.failObjective('nope')).toBe(false);
    expect(game.activateObjective('nope')).toBe(false);
    expect(game.mission!.serialize()).toBe(before);
  });

  it('does not re-apply a completed or failed objective', () => {
    const game = gameFor();
    game.completeObjective('secure-radar');
    const afterComplete = game.mission!.serialize();
    expect(game.completeObjective('secure-radar')).toBe(false);
    expect(game.failObjective('secure-radar')).toBe(false);
    expect(game.mission!.serialize()).toBe(afterComplete);
  });

  it('does not emit a second completion event for a repeated request', () => {
    const game = gameFor();
    game.completeObjective('secure-radar');
    const first = game.state.events.filter((event) => event.code === 'objectiveComplete').length;
    game.completeObjective('secure-radar');
    const second = game.state.events.filter((event) => event.code === 'objectiveComplete').length;
    expect(first).toBe(1);
    expect(second).toBe(1);
  });

  it('emits one event per transition, including activated dependents', () => {
    const game = gameFor();
    game.completeObjective('secure-radar');
    expect(
      game.state.events.filter((event) => event.code === 'objectiveComplete').length,
    ).toBe(1);
    expect(
      game.state.events.filter((event) => event.code === 'objectiveActivated').length,
    ).toBe(1);
  });
});

describe('mission outcome', () => {
  it('wins when every primary objective is complete', () => {
    const game = gameFor();
    game.advance(10);
    winMission(game);
    expect(game.mission!.outcome).toBe('victory');
    expect(game.state.victory).toBe('victory');
    expect(game.missionResult).not.toBeNull();
  });

  it('does not win while a primary objective is incomplete', () => {
    const game = gameFor();
    game.completeObjective('secure-radar');
    game.advance(30);
    expect(game.mission!.outcome).toBe('playing');
    expect(game.state.victory).toBe('playing');
  });

  it('loses when a primary objective fails', () => {
    const game = gameFor();
    expect(game.failObjective('secure-radar')).toBe(true);
    expect(game.mission!.outcome).toBe('defeat');
    game.advance(1);
    expect(game.state.victory).toBe('defeat');
    expect(game.missionResult?.outcome).toBe('defeat');
  });

  it('ignores secondary and bonus objectives for the outcome', () => {
    const game = gameFor();
    game.failObjective('convoy');
    game.completeObjective('sweep');
    game.advance(20);
    expect(game.mission!.outcome).toBe('playing');
    expect(game.state.victory).toBe('playing');
  });

  it('treats the existing force-destruction rule as a mission defeat', () => {
    const game = gameFor();
    for (const entity of game.state.entities) {
      if (entity.owner === 0) entity.hp = 0;
    }
    game.advance(1);
    expect(game.state.victory).toBe('defeat');
    expect(game.mission!.outcome).toBe('defeat');
    expect(game.missionResult?.outcome).toBe('defeat');
  });

  it('keeps the outcome terminal and refuses further objective changes', () => {
    const game = gameFor();
    winMission(game);
    expect(game.completeObjective('sweep')).toBe(false);
    expect(game.failObjective('convoy')).toBe(false);
    expect(game.mission!.outcome).toBe('victory');
  });

  it('leaves a mission-less skirmish on its original victory path', () => {
    const game = new Game(createIslandAssault(), { enableAI: false });
    game.advance(30);
    expect(game.mission).toBeNull();
    expect(game.state.victory).toBe('playing');
    expect(game.missionResult).toBeNull();
  });

  it('does not auto-win a mission just because the enemy is gone', () => {
    const game = gameFor();
    for (const entity of game.state.entities) {
      if (entity.owner === 1) entity.hp = 0;
    }
    game.advance(20);
    expect(game.mission!.outcome).toBe('playing');
    expect(game.state.victory).toBe('playing');
  });
});

describe('mission result capture', () => {
  it('records the actual objective states and mission time', () => {
    const game = gameFor();
    game.advance(TICK_RATE * 2);
    winMission(game);
    const result = game.missionResult!;
    expect(result.missionId).toBe('op-radar-ridge');
    expect(result.outcome).toBe('victory');
    expect(result.elapsedSeconds).toBeCloseTo(game.state.tick / TICK_RATE, 6);
    expect(result.objectives.find((o) => o.id === 'secure-radar')?.state).toBe('complete');
    expect(result.objectives.find((o) => o.id === 'hold-east')?.state).toBe('complete');
    expect(result.objectives.find((o) => o.id === 'convoy')?.state).toBe('active');
  });

  it('records the counters the simulation actually keeps', () => {
    const game = gameFor();
    game.player(0)!.stats.unitsLost = 2;
    game.player(0)!.stats.kills = 5;
    game.player(0)!.stats.unitsBuilt = 7;
    game.player(1)!.stats.unitsLost = 3;
    winMission(game);
    const result = game.missionResult!;
    expect(result.friendly.unitsLost).toBe(2);
    expect(result.friendly.kills).toBe(5);
    expect(result.friendly.unitsBuilt).toBe(7);
    expect(result.enemy.unitsLost).toBe(3);
  });

  it('reports named authored entities that survived or were lost', () => {
    const game = gameFor();
    const radar = game.state.entities.find((entity) => entity.authoredKey === 'radar-team');
    expect(radar).toBeDefined();
    radar!.hp = 0;
    winMission(game);
    const result = game.missionResult!;
    expect(result.entities.find((e) => e.key === 'radar-team')).toMatchObject({
      name: 'Radar Team',
      role: 'veteran',
      survived: false,
    });
    expect(result.entities.find((e) => e.key === 'convoy-truck')?.survived).toBe(true);
  });

  it('captures the result once and keeps it stable', () => {
    const game = gameFor();
    winMission(game);
    const first = JSON.stringify(game.missionResult);
    game.advance(40);
    expect(JSON.stringify(game.missionResult)).toBe(first);
    expect(JSON.stringify(JSON.parse(JSON.stringify(game.toSave())).state.mission.result)).toBe(
      first,
    );
  });

  it('produces identical results for identical runs', () => {
    const a = gameFor();
    const b = gameFor();
    a.advance(25);
    b.advance(25);
    winMission(a);
    winMission(b);
    expect(JSON.stringify(a.missionResult)).toBe(JSON.stringify(b.missionResult));
  });

  it('round-trips a captured result through a save', () => {
    const game = gameFor();
    winMission(game);
    const restored = Game.fromSave(JSON.parse(JSON.stringify(game.toSave())), { enableAI: false });
    expect(restored.mission!.outcome).toBe('victory');
    expect(restored.missionResult).toEqual(game.missionResult);
    expect(restored.state.victory).toBe('victory');
  });
});

describe('mission save, load and determinism', () => {
  it('restores an active objective chain exactly', () => {
    const game = gameFor(chainRaw());
    game.completeObjective('a');
    const restored = Game.fromSave(JSON.parse(JSON.stringify(game.toSave())), { enableAI: false });
    expect(restored.mission!.objectiveState('a')).toBe('complete');
    expect(restored.mission!.objectiveState('b')).toBe('active');
    expect(restored.mission!.objectiveState('c')).toBe('hidden');
    expect(restored.stateHash()).toBe(game.stateHash());
  });

  it('does not duplicate dependency activation after loading', () => {
    const game = gameFor(chainRaw());
    game.completeObjective('a');
    const restored = Game.fromSave(JSON.parse(JSON.stringify(game.toSave())), { enableAI: false });
    // `a` is already terminal, so a repeated request cannot fire its effects.
    const eventsAfterLoad = restored.state.events.length;
    expect(restored.completeObjective('a')).toBe(false);
    expect(restored.state.events).toHaveLength(eventsAfterLoad);
  });

  it('keeps a terminal mission terminal through save and load', () => {
    const game = gameFor();
    winMission(game);
    const restored = Game.fromSave(JSON.parse(JSON.stringify(game.toSave())), { enableAI: false });
    restored.advance(20);
    expect(restored.state.victory).toBe('victory');
    expect(restored.mission!.outcome).toBe('victory');
    expect(restored.missionResult?.outcome).toBe('victory');
  });

  it('re-captures a missing result from the restored end state', () => {
    const game = gameFor();
    winMission(game);
    const save = JSON.parse(JSON.stringify(game.toSave()));
    delete save.state.mission.result;
    const restored = Game.fromSave(save, { enableAI: false });
    expect(restored.missionResult).toEqual(game.missionResult);
  });

  it('accounts for objective and outcome state in the state hash', () => {
    const a = gameFor();
    const b = gameFor();
    expect(a.stateHash()).toBe(b.stateHash());
    b.completeObjective('secure-radar');
    expect(b.stateHash()).not.toBe(a.stateHash());
    const beforeOutcome = b.stateHash();
    b.completeObjective('hold-east');
    expect(b.stateHash()).not.toBe(beforeOutcome);
  });

  it('reads a save written with the inert S1 objective states', () => {
    const game = gameFor();
    const save = JSON.parse(JSON.stringify(game.toSave()));
    save.state.mission.objectives = [
      { id: 'secure-radar', state: 'pending' },
      { id: 'hold-east', state: 'pending' },
      { id: 'convoy', state: 'pending' },
      { id: 'sweep', state: 'pending' },
    ];
    delete save.state.mission.outcome;
    delete save.state.mission.result;
    const restored = Game.fromSave(save, { enableAI: false });
    expect(restored.mission!.objectiveState('secure-radar')).toBe('active');
    expect(restored.mission!.objectiveState('hold-east')).toBe('hidden');
    expect(restored.mission!.outcome).toBe('playing');
  });

  it('still loads a save with no mission state at all', () => {
    const game = gameFor();
    const save = JSON.parse(JSON.stringify(game.toSave()));
    delete save.state.mission;
    const restored = Game.fromSave(save, { enableAI: false });
    expect(restored.mission!.id).toBe('op-radar-ridge');
    expect(restored.mission!.outcome).toBe('playing');
    expect(restored.missionResult).toBeNull();
  });
});

describe('mission objective presentation', () => {
  it('hides hidden objectives from every list', () => {
    const game = gameFor();
    const view = missionObjectiveView(game)!;
    const ids = [...view.primary, ...view.supporting, ...view.resolved].map((line) => line.id);
    expect(ids).not.toContain('hold-east');
    expect(view.primary.map((line) => line.id)).toEqual(['secure-radar']);
    expect(view.supporting.map((line) => line.id)).toEqual(['convoy', 'sweep']);
    expect(view.headline).toBe('Secure the radar station');
    expect(view.summary).toBe('0/2 PRIMARY · 2 SUPPORT');
  });

  it('moves completed and failed objectives into the resolved list', () => {
    const game = gameFor();
    game.completeObjective('secure-radar');
    game.failObjective('convoy');
    const view = missionObjectiveView(game)!;
    expect(view.resolved.map((line) => [line.id, line.state])).toEqual([
      ['secure-radar', 'complete'],
      ['convoy', 'failed'],
    ]);
    expect(view.primary.map((line) => line.id)).toEqual(['hold-east']);
    expect(view.failedCount).toBe(1);
    // Only the surviving supporting objective is still active.
    expect(view.summary).toBe('1/2 PRIMARY · 1 SUPPORT · 1 FAILED');
  });

  it('renders a state marker and escapes authored titles', () => {
    const markup = missionObjectiveMarkup({
      id: 'x',
      title: 'Secure <the> ridge & hold',
      kind: 'secondary',
      state: 'failed',
    });
    expect(markup).toContain('✕');
    expect(markup).toContain('SECONDARY');
    expect(markup).toContain('&lt;the&gt;');
    expect(markup).toContain('&amp;');
    expect(markup).not.toContain('<the>');
  });

  it('returns no mission view for a skirmish', () => {
    const game = new Game(createIslandAssault(), { enableAI: false });
    expect(missionObjectiveView(game)).toBeNull();
  });

  it('builds a debrief from the captured result, omitting hidden objectives', () => {
    const game = gameFor();
    // Force-destruction defeat leaves the dependent objective hidden.
    for (const entity of game.state.entities) {
      if (entity.owner === 0) entity.hp = 0;
    }
    game.advance(1);
    const result = game.missionResult!;
    const markup = missionDebriefMarkup(result);
    expect(markup).toContain('MISSION DEBRIEF');
    expect(markup).toContain('Preserve the evacuation convoy');
    expect(markup).not.toContain('Hold the eastern approach');
    // Every friendly entity was destroyed, so both named assets are lost.
    expect(markup).toContain('LOST');
    expect(markup).toContain('MISSION TIME');
    const copy = missionOutcomeCopy(result);
    expect(copy.heading).toBe('Operation Failed');
    expect(copy.copy).toMatch(/force was destroyed/);
  });

  it('reports a survived named asset in a victory debrief', () => {
    const game = gameFor();
    winMission(game);
    const markup = missionDebriefMarkup(game.missionResult!);
    expect(markup).toContain('SURVIVED');
    expect(markup).toContain('Radar Team');
  });

  it('reports a lost primary objective in the outcome copy', () => {
    const game = gameFor();
    game.failObjective('secure-radar');
    game.advance(1);
    const copy = missionOutcomeCopy(game.missionResult!);
    expect(copy.heading).toBe('Operation Failed');
    expect(copy.copy).toMatch(/primary objective was lost/i);
    expect(missionDebriefMarkup(game.missionResult!)).toContain('✕');
  });
});

describe('mission objective validation', () => {
  it('requires at least one primary objective', () => {
    const raw = missionRaw({
      objectives: [
        { id: 'only-optional', title: 'Optional only', kind: 'secondary', dependsOn: [] },
      ],
    });
    expect(() => parseMission(raw)).toThrow(/primary objective/);
  });

  it('rejects a dependency cycle', () => {
    const raw = missionRaw({
      objectives: [
        { id: 'a', title: 'A', kind: 'primary', dependsOn: ['b'] },
        { id: 'b', title: 'B', kind: 'primary', dependsOn: ['a'] },
      ],
    });
    expect(() => parseMission(raw)).toThrow(/dependency cycle/);
  });

  it('rejects a self dependency', () => {
    const raw = missionRaw({
      objectives: [{ id: 'a', title: 'A', kind: 'primary', dependsOn: ['a'] }],
    });
    expect(() => parseMission(raw)).toThrow(/depends on itself/);
  });

  it('rejects an unsupported objective kind', () => {
    const raw = missionRaw({
      objectives: [{ id: 'a', title: 'A', kind: 'sidequest', dependsOn: [] }],
    });
    expect(() => parseMission(raw)).toThrow(/kind/);
  });

  it('rejects a protected entity the scenario does not place', () => {
    const base = createIslandAssault();
    const json = JSON.parse(JSON.stringify(base)) as Raw;
    json.mission = missionRaw({
      objectives: [
        {
          id: 'p',
          title: 'Protect',
          kind: 'primary',
          dependsOn: [],
          protectedEntities: ['missing-asset'],
        },
      ],
      entities: [],
    });
    expect(() => parseScenario(json)).toThrow(/not placed in this scenario/);
  });

  it('accepts the S1 `optional` spelling as a secondary objective', () => {
    const raw = missionRaw({
      objectives: [
        { id: 'p', title: 'Primary', kind: 'primary', dependsOn: [] },
        { id: 's', title: 'Optional', kind: 'optional', dependsOn: [] },
      ],
    });
    expect(parseMission(raw).objectives.find((o) => o.id === 's')?.kind).toBe('secondary');
  });

  it('keeps hidden objectives absent from the runtime view of a fresh mission', () => {
    const doc = parseMission(missionRaw());
    const runtime = MissionRuntime.fromDoc(doc);
    expect(runtime.objectiveState('hold-east')).toBe('hidden');
    expect(runtime.outcome).toBe('playing');
    expect(runtime.result).toBeNull();
  });
});

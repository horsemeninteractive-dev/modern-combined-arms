import { describe, expect, it } from 'vitest';
import { Game } from '../src/sim/game';
import { createEmptyScenario } from '../src/data/scenarios';
import { TICK_RATE } from '../src/sim/constants';
import { buildingFamily } from '../src/data/buildings';
import { BUILDING_MODULES, RESEARCH, techDef } from '../src/data/research';
import {
  AIController,
  aiProfile,
  initialAIState,
  researchOptionScore,
  type ResearchSignals,
} from '../src/sim/ai';
import { CommandGate } from '../src/multiplayer/commandGate';
import { createTeamSnapshot, createTeamState } from '../src/multiplayer/projection';
import { buildDelta, createBaseline } from '../src/multiplayer/teamDelta';
import { SnapshotAssembler } from '../src/multiplayer/snapshotAssembler';
import { moduleActions } from '../src/ui/moduleView';
import type { Scenario } from '../src/sim/scenario';
import type { Entity } from '../src/sim/types';

const MODULE = 'advancedTurbine';

interface ArenaOptions {
  technologies?: string[];
  structures?: Array<{ defId: string; owner: number; x: number; z: number }>;
  units?: Array<{ defId: string; owner: number; x: number; z: number }>;
  mats?: number;
  req?: number;
  ai?: boolean;
  fog?: boolean;
}

function arena(options: ArenaOptions = {}): Scenario {
  const scenario = createEmptyScenario(48, 48);
  scenario.meta.id = 'turbine-test';
  scenario.settings.seed = 41;
  scenario.settings.fog = options.fog ?? false;
  scenario.settings.startingMats = options.mats ?? 3000;
  scenario.settings.startingReq = options.req ?? 400;
  scenario.players[0].factionId = 'lithuania';
  scenario.players[0].startX = 20;
  scenario.players[0].startZ = 20;
  scenario.players[1].factionId = 'russia';
  scenario.players[1].startX = 44;
  scenario.players[1].startZ = 44;
  scenario.players[1].isAI = options.ai ?? false;
  if (options.technologies) scenario.players[0].technologies = [...options.technologies];
  scenario.structures.push(
    { defId: 'commandPost', owner: 0, x: 16, z: 16 },
    { defId: 'commandPost', owner: 1, x: 42, z: 42 },
  );
  for (const s of options.structures ?? []) scenario.structures.push({ ...s });
  for (const u of options.units ?? []) scenario.units.push({ ...u });
  return scenario;
}

function build(options: ArenaOptions = {}): Game {
  return new Game(arena(options), { enableAI: false });
}

function plantOf(game: Game, owner = 0): Entity {
  const plant = game.entitiesOf(owner, 'building').find((e) => e.defId === 'powerPlant');
  if (!plant) throw new Error('arena has no turbine plant');
  return plant;
}

function install(game: Game, building: Entity, team = 0): void {
  game.enqueueCommand({
    type: 'installModule',
    team,
    buildingId: building.id,
    moduleId: MODULE,
  });
  game.tick();
}

describe('advanced turbine definition', () => {
  it('matches the approved catalogue values', () => {
    const module = BUILDING_MODULES[MODULE];
    expect(module).toBeDefined();
    expect(module.eligibleSlots).toEqual(['powerPlant']);
    expect(module.cost).toEqual({ mats: 450, req: 25 });
    expect(module.capacity).toBe(1);
    expect(module.effects).toEqual([{ kind: 'power', amount: 30 }]);
    expect(buildingFamily('powerPlant')).toBe('powerPlant');
  });

  it('is granted by an approved technology that exists in the tree', () => {
    const grants = RESEARCH.techs.filter((tech) =>
      tech.effects.some((effect) => effect.kind === 'grantBuildingModule' && effect.module === MODULE),
    );
    expect(grants.map((tech) => tech.id)).toEqual(['manoeuvre1']);
  });
});

describe('advanced turbine availability', () => {
  it('is hidden until the granting technology completes', () => {
    const game = build({ structures: [{ defId: 'powerPlant', owner: 0, x: 20, z: 20 }] });
    const plant = plantOf(game);
    expect(game.availableModules(0, plant.id)).toEqual([]);
    expect(moduleActions(game, 0, plant.id)).toEqual([]);
    expect(game.moduleStatus(0, plant.id, MODULE).reason).toMatch(/has not been researched/);

    game.player(0)!.research.completed.push('manoeuvre1');
    expect(game.availableModules(0, plant.id).map((m) => m.id)).toEqual([MODULE]);
    expect(game.moduleStatus(0, plant.id, MODULE).ok).toBe(true);
  });

  it('never offers the module on an ineligible structure', () => {
    const game = build({
      technologies: ['manoeuvre1'],
      structures: [
        { defId: 'powerPlant', owner: 0, x: 20, z: 20 },
        { defId: 'barracks', owner: 0, x: 24, z: 20 },
      ],
    });
    const barracks = game.entitiesOf(0, 'building').find((e) => e.defId === 'barracks')!;
    expect(game.availableModules(0, barracks.id)).toEqual([]);
    expect(moduleActions(game, 0, barracks.id)).toEqual([]);
    expect(game.moduleStatus(0, barracks.id, MODULE).reason).toMatch(/cannot be fitted/);
  });

  it('offers the module on a structure completed after the research', () => {
    const game = build({
      technologies: ['manoeuvre1'],
      units: [{ defId: 'engineer', owner: 0, x: 23, z: 23 }],
    });
    let site: { x: number; z: number } | null = null;
    for (let z = 22; z <= 30 && !site; z++) {
      for (let x = 24; x <= 30 && !site; x++) {
        if (game.placementStatus(0, 'powerPlant', x, z).ok) site = { x, z };
      }
    }
    expect(site).not.toBeNull();
    game.enqueueCommand({ type: 'placeBuilding', team: 0, defId: 'powerPlant', tileX: site!.x, tileZ: site!.z });
    game.tick();
    const siteBuilding = game.entitiesOf(0, 'building').find((e) => e.defId === 'powerPlant')!;
    expect(siteBuilding.construction).toBe(true);
    // A foundation is not a structure yet: nothing to fit a module to.
    expect(game.availableModules(0, siteBuilding.id)).toEqual([]);
    for (let i = 0; i < TICK_RATE * 40 && siteBuilding.construction; i++) game.tick();
    expect(siteBuilding.construction).toBe(false);
    expect(game.availableModules(0, siteBuilding.id).map((m) => m.id)).toEqual([MODULE]);
  });

  it('reports the module as installed once it has been bought', () => {
    const game = build({
      technologies: ['manoeuvre1'],
      structures: [{ defId: 'powerPlant', owner: 0, x: 20, z: 20 }],
    });
    const plant = plantOf(game);
    install(game, plant);
    const views = moduleActions(game, 0, plant.id);
    expect(views).toHaveLength(1);
    expect(views[0]).toMatchObject({ moduleId: MODULE, installed: true, ready: false, label: 'INSTALLED' });
    expect(views[0].detail).toMatch(/\+30 power/);
    // Nothing further is offered, so the row cannot be bought twice.
    expect(game.availableModules(0, plant.id)).toEqual([]);
  });
});

describe('advanced turbine installation', () => {
  it('installs once, charges once and records it on that structure only', () => {
    const game = build({
      technologies: ['manoeuvre1'],
      structures: [
        { defId: 'powerPlant', owner: 0, x: 20, z: 20 },
        { defId: 'powerPlant', owner: 0, x: 24, z: 20 },
      ],
    });
    const [first, second] = game.entitiesOf(0, 'building').filter((e) => e.defId === 'powerPlant');
    const before = { mats: Math.round(game.player(0)!.mats), req: game.player(0)!.req };
    install(game, first);
    // The tick that processes the order also pays passive income, so compare
    // the rounded bank and the exact ticket separately.
    expect(Math.round(game.player(0)!.mats)).toBe(before.mats - 450);
    expect(game.player(0)!.req).toBeCloseTo(before.req - 25, 1);
    expect(first.modules).toEqual([MODULE]);
    expect(second.modules).toBeUndefined();
    expect(game.state.events.some((e) => e.type === 'orderAck' && e.code === 'moduleInstalled')).toBe(true);
    // A second attempt on the same structure is refused and costs nothing.
    const afterFirst = Math.round(game.player(0)!.mats);
    install(game, first);
    expect(Math.round(game.player(0)!.mats)).toBe(afterFirst);
    expect(first.modules).toEqual([MODULE]);
  });

  it('refuses an unaffordable purchase without changing anything', () => {
    const game = build({
      technologies: ['manoeuvre1'],
      structures: [{ defId: 'powerPlant', owner: 0, x: 20, z: 20 }],
      mats: 200,
    });
    const plant = plantOf(game);
    const status = game.moduleStatus(0, plant.id, MODULE);
    expect(status.ok).toBe(false);
    expect(status.reason).toMatch(/Insufficient materials/);
    const view = moduleActions(game, 0, plant.id)[0];
    expect(view).toMatchObject({ state: 'resources', ready: false, label: 'NEED FUNDS' });
    const mats = Math.round(game.player(0)!.mats);
    install(game, plant);
    expect(Math.round(game.player(0)!.mats)).toBe(mats);
    expect(plant.modules).toBeUndefined();
    expect(game.state.events.some((e) => e.type === 'orderFailed')).toBe(true);
  });

  it('refuses a structure the player does not own', () => {
    const game = build({
      technologies: ['manoeuvre1'],
      structures: [{ defId: 'powerPlant', owner: 1, x: 40, z: 40 }],
    });
    const enemyPlant = plantOf(game, 1);
    expect(game.moduleStatus(1, enemyPlant.id, MODULE).reason).toMatch(/has not been researched/);
    game.enqueueCommand({ type: 'installModule', team: 0, buildingId: enemyPlant.id, moduleId: MODULE });
    game.tick();
    expect(enemyPlant.modules).toBeUndefined();
    expect(game.state.events.some((e) => e.type === 'orderFailed')).toBe(true);
  });

  it('refuses a destroyed structure', () => {
    const game = build({
      technologies: ['manoeuvre1'],
      structures: [{ defId: 'powerPlant', owner: 0, x: 20, z: 20 }],
    });
    const plant = plantOf(game);
    plant.hp = 0;
    expect(game.moduleStatus(0, plant.id, MODULE).ok).toBe(false);
    install(game, plant);
    expect(plant.modules).toBeUndefined();
  });

  it('respects module capacity', () => {
    const game = build({
      technologies: ['manoeuvre1'],
      structures: [{ defId: 'powerPlant', owner: 0, x: 20, z: 20 }],
    });
    const plant = plantOf(game);
    // A hand-edited list at capacity is not topped up.
    plant.modules = [MODULE];
    expect(game.moduleStatus(0, plant.id, MODULE).reason).toMatch(/already installed/);
    expect(game.availableModules(0, plant.id)).toEqual([]);
  });
});

describe('advanced turbine on the grid', () => {
  it('adds its contribution to supply exactly once', () => {
    const game = build({
      technologies: ['manoeuvre1'],
      structures: [{ defId: 'powerPlant', owner: 0, x: 20, z: 20 }],
    });
    const plant = plantOf(game);
    const base = game.powerStatus(0).supply;
    install(game, plant);
    expect(game.powerStatus(0).supply).toBe(base + 30);
    // Ticking does not compound the contribution.
    game.advance(TICK_RATE * 5);
    expect(game.powerStatus(0).supply).toBe(base + 30);
  });

  it('counts a purchase per structure and removes it with the structure', () => {
    const game = build({
      technologies: ['manoeuvre1'],
      structures: [
        { defId: 'powerPlant', owner: 0, x: 20, z: 20 },
        { defId: 'powerPlant', owner: 0, x: 24, z: 20 },
      ],
    });
    const [first, second] = game.entitiesOf(0, 'building').filter((e) => e.defId === 'powerPlant');
    const base = game.powerStatus(0).supply;
    install(game, first);
    install(game, second);
    expect(game.powerStatus(0).supply).toBe(base + 60);
    // A dead plant takes its own output with it, not just its retrofit.
    first.hp = 0;
    expect(game.powerStatus(0).supply).toBe(base - 30);
    second.hp = 0;
    expect(game.powerStatus(0).supply).toBe(base - 120);
  });

  it('clears a brownout that the retrofit covers', () => {
    const game = build({
      technologies: ['manoeuvre1'],
      structures: [
        { defId: 'powerPlant', owner: 0, x: 20, z: 20 },
        { defId: 'factory', owner: 0, x: 24, z: 20 },
        { defId: 'researchCentre', owner: 0, x: 28, z: 20 },
        { defId: 'refinery', owner: 0, x: 32, z: 20 },
        { defId: 'airfield', owner: 0, x: 36, z: 20 },
        { defId: 'shipyard', owner: 0, x: 40, z: 20 },
        { defId: 'barracks', owner: 0, x: 24, z: 26 },
        { defId: 'barracks', owner: 0, x: 30, z: 26 },
      ],
    });
    const plant = plantOf(game);
    const before = game.powerStatus(0);
    expect(before.demand).toBeGreaterThan(before.supply);
    expect(before.brownout).toBe(true);
    install(game, plant);
    const after = game.powerStatus(0);
    expect(after.supply).toBe(before.supply + 30);
    expect(after.brownout).toBe(false);
    expect(game.powerSpeed(0)).toBe(1);
  });
});

describe('advanced turbine persistence', () => {
  it('survives save and load without charging or counting twice', () => {
    const game = build({
      technologies: ['manoeuvre1'],
      structures: [{ defId: 'powerPlant', owner: 0, x: 20, z: 20 }],
    });
    const plant = plantOf(game);
    install(game, plant);
    const supply = game.powerStatus(0).supply;
    const mats = game.player(0)!.mats;
    const save = JSON.parse(JSON.stringify(game.toSave()));
    const loaded = Game.fromSave(save, { enableAI: false });
    const restored = loaded.entitiesOf(0, 'building').find((e) => e.defId === 'powerPlant')!;
    expect(restored.modules).toEqual([MODULE]);
    expect(loaded.powerStatus(0).supply).toBe(supply);
    expect(loaded.player(0)!.mats).toBe(mats);
    expect(loaded.stateHash()).toBe(game.stateHash());
  });

  it('loads a save written before modules existed', () => {
    const game = build({
      technologies: ['manoeuvre1'],
      structures: [{ defId: 'powerPlant', owner: 0, x: 20, z: 20 }],
    });
    const plant = plantOf(game);
    install(game, plant);
    const supply = game.powerStatus(0).supply;
    const save = JSON.parse(JSON.stringify(game.toSave()));
    for (const entity of save.state.entities) delete entity.modules;
    const loaded = Game.fromSave(save, { enableAI: false });
    const restored = loaded.entitiesOf(0, 'building').find((e) => e.defId === 'powerPlant')!;
    expect(restored.modules).toBeUndefined();
    expect(loaded.powerStatus(0).supply).toBe(supply - 30);
  });

  it('drops a module the structure can no longer legally hold', () => {
    const game = build({
      technologies: ['manoeuvre1'],
      structures: [{ defId: 'powerPlant', owner: 0, x: 20, z: 20 }],
    });
    const plant = plantOf(game);
    const save = JSON.parse(JSON.stringify(game.toSave()));
    const row = save.state.entities.find((e: Entity) => e.id === plant.id);
    row.modules = ['advancedTurbine', 'advancedTurbine', 'notAModule'];
    const loaded = Game.fromSave(save, { enableAI: false });
    const restored = loaded.entitiesOf(0, 'building').find((e) => e.defId === 'powerPlant')!;
    expect(restored.modules).toEqual([MODULE]);
    expect(loaded.powerStatus(0).supply).toBe(game.powerStatus(0).supply + 30);
  });
});

describe('advanced turbine multiplayer', () => {
  function gateOf(game: Game): CommandGate {
    return new CommandGate(game, [
      { seatId: 0, playerId: 0, team: 0, active: true },
      { seatId: 1, playerId: 1, team: 1, active: true },
    ]);
  }
  const envelope = (command: unknown) => ({ v: 1, command });

  it('accepts an owned structure and rejects the rest', () => {
    const game = build({
      technologies: ['manoeuvre1'],
      structures: [{ defId: 'powerPlant', owner: 0, x: 20, z: 20 }],
    });
    const gate = gateOf(game);
    const plant = plantOf(game);
    expect(
      gate.submit(1, envelope({ type: 'installModule', buildingId: plant.id, moduleId: MODULE }), 1000),
    ).toMatchObject({ ok: false, code: 'not-your-entity' });
    expect(
      gate.submit(0, envelope({ type: 'installModule', buildingId: plant.id, moduleId: 'notAModule' }), 1200).ok,
    ).toBe(false);
    // Seat 1 has no research, and cannot buy a module on its own base either.
    const own = gate.submit(0, envelope({ type: 'installModule', buildingId: plant.id, moduleId: MODULE }), 1400);
    expect(own.ok).toBe(true);
  });

  it('replicates the installed module and keeps it off the opposing team', () => {
    const game = build({
      technologies: ['manoeuvre1'],
      structures: [{ defId: 'powerPlant', owner: 0, x: 20, z: 20 }],
    });
    const gate = gateOf(game);
    const plant = plantOf(game);
    const accepted = gate.submit(
      0,
      envelope({ type: 'installModule', buildingId: plant.id, moduleId: MODULE }),
      1000,
    );
    expect(accepted.ok).toBe(true);
    game.tick();

    const snapshot = createTeamSnapshot(game, 0);
    const own = createTeamState(game, 0, 0);
    expect(own.entities.find((e) => e.id === plant.id)!.modules).toEqual([MODULE]);
    // The opponent can see the plant in this fog-free arena, but not its fittings.
    const enemy = createTeamState(game, 1, 0);
    expect(enemy.entities.find((e) => e.id === plant.id)!.modules).toBeUndefined();

    const assembler = new SnapshotAssembler({ roomId: 'room-turbine', team: 0 });
    expect(
      assembler.apply({
        type: 'sync',
        v: 2,
        epoch: 1,
        seq: 1,
        tick: snapshot.tick,
        team: 0,
        roomId: 'room-turbine',
        checkpoint: true,
        state: snapshot,
      }).ok,
    ).toBe(true);
    expect(assembler.state()!.entities.find((e) => e.id === plant.id)!.modules).toEqual([MODULE]);
  });

  it('carries a retrofit installed after the baseline in the next delta', () => {
    const game = build({
      technologies: ['manoeuvre1'],
      structures: [{ defId: 'powerPlant', owner: 0, x: 20, z: 20 }],
    });
    const plant = plantOf(game);
    const snapshot = createTeamSnapshot(game, 0);
    const assembler = new SnapshotAssembler({ roomId: 'room-turbine', team: 0 });
    assembler.apply({
      type: 'sync',
      v: 2,
      epoch: 1,
      seq: 1,
      tick: snapshot.tick,
      team: 0,
      roomId: 'room-turbine',
      checkpoint: true,
      state: snapshot,
    });
    install(game, plant);
    const state = createTeamState(game, 0, game.state.eventSeq);
    const changes = buildDelta(createBaseline(snapshot), state, game.state.fog[0]);
    expect(changes.entities?.upsert.some((e) => e.modules?.includes(MODULE))).toBe(true);
    expect(
      assembler.apply({
        type: 'delta',
        v: 2,
        epoch: 1,
        seq: 2,
        base: 1,
        tick: state.tick,
        team: 0,
        roomId: 'room-turbine',
        changes,
      }).ok,
    ).toBe(true);
    expect(assembler.state()!.entities.find((e) => e.id === plant.id)!.modules).toEqual([MODULE]);
  });
});

describe('advanced turbine AI', () => {
  const strainedArena = (healthy: boolean, technologies = ['manoeuvre1']): ArenaOptions => ({
    ai: true,
    technologies,
    structures: [
      { defId: 'powerPlant', owner: 1, x: 40, z: 38 },
      ...(healthy
        ? []
        : [
            { defId: 'factory', owner: 1, x: 36, z: 38 },
            { defId: 'researchCentre', owner: 1, x: 32, z: 38 },
            { defId: 'refinery', owner: 1, x: 44, z: 38 },
            { defId: 'airfield', owner: 1, x: 44, z: 32 },
            { defId: 'shipyard', owner: 1, x: 36, z: 32 },
          ]),
    ],
    // Rifle sections are tier 0, so the army itself grants no technology: the
    // module in these tests is only available if the technology was granted
    // explicitly, which is exactly what the "not researched" case needs.
    units: Array.from({ length: 8 }, (_, i) => ({
      defId: 'rifle',
      owner: 1,
      x: 34 + (i % 4) * 2,
      z: 40 + Math.floor(i / 4) * 2,
    })),
  });

  function runAI(options: ArenaOptions): { game: Game; commands: string[] } {
    const scenario = arena(options);
    scenario.players[1].technologies = options.technologies ?? [];
    const game = new Game(scenario, { enableAI: false });
    const ai = new AIController();
    const state = initialAIState(11, 'veteran');
    game.advance(TICK_RATE);
    ai.update(game, 1, state);
    return { game, commands: game.pending.map((command) => command.type) };
  }

  it('buys the retrofit when the grid is short', () => {
    const { game, commands } = runAI(strainedArena(false));
    expect(commands).toContain('installModule');
    const command = game.pending.find((c) => c.type === 'installModule');
    expect(command).toMatchObject({ moduleId: MODULE });
  });

  it('leaves the bank alone when the grid is healthy', () => {
    const { commands } = runAI(strainedArena(true));
    expect(commands).not.toContain('installModule');
  });

  it('does not buy the retrofit it has not researched', () => {
    // The strained arena places an airfield and a shipyard, and a pre-placed
    // structure grants the technology that fields it — so this commander does
    // legitimately own those branch modules now that Phase 1 added them. The
    // question this test asks is narrower and unchanged: the turbine rides on
    // manoeuvre doctrine, which this commander has not studied.
    const { game } = runAI(strainedArena(false, []));
    const installed = game.pending.flatMap((command) =>
      command.type === 'installModule' ? [command.moduleId] : [],
    );
    expect(installed).not.toContain(MODULE);
  });

  it('never re-issues an installation it already made', () => {
    const { game } = runAI(strainedArena(false));
    game.tick();
    const plant = plantOf(game, 1);
    expect(plant.modules).toEqual([MODULE]);
    const ai = new AIController();
    const state = initialAIState(11, 'veteran');
    game.advance(TICK_RATE);
    ai.update(game, 1, state);
    // Phase 1 gave the same arena its own branch modules (the airfield's
    // flightline crew, the yard's sonar suite), so a later pass may spend on a
    // different structure. The invariant is one installation per position, not
    // one purchase per commander.
    const repeats = game.pending.filter(
      (c) => c.type === 'installModule' && (c.moduleId === MODULE || c.buildingId === plant.id),
    );
    expect(repeats).toEqual([]);
  });

  it('scores the technology higher when the grid is short', () => {
    const tech = techDef('manoeuvre1')!;
    const base: ResearchSignals = {
      seed: 5,
      tick: 0,
      timeLimitSec: null,
      completed: [],
      unitCounts: new Map([['tank', 0]]),
      buildingCounts: new Map([['powerPlant', 1]]),
      rosterUnits: new Set(['tank', 'ifv', 'recon', 'rifle', 'atgm', 'engineer', 'harvester']),
      exclusiveTechs: new Set(),
      profile: aiProfile(5, 'veteran'),
      strategy: 'armour',
      mix: { armour: 0, infantry: 0 },
      enemyAir: 0,
      enemyNaval: 0,
      fortified: 0,
      hasWater: false,
    };
    const healthy = researchOptionScore(tech, { ...base, gridStrain: false });
    const strained = researchOptionScore(tech, { ...base, gridStrain: true });
    expect(strained.score).toBeGreaterThan(healthy.score);
    // With no plant to fit it to, the retrofit is worth nothing either way.
    const noPlant = researchOptionScore(tech, {
      ...base,
      gridStrain: true,
      buildingCounts: new Map(),
    });
    expect(noPlant.score).toBeLessThan(strained.score);
  });
});

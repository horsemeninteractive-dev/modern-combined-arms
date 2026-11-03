import { describe, expect, it } from 'vitest';
import { RESEARCH, type ResearchCatalog, type TechDef } from '../src/data/research';
import { createScenario } from '../src/sim/scenario';
import { Game } from '../src/sim/game';
import { buildingFamily } from '../src/data/buildings';
import { TICK_RATE } from '../src/sim/constants';
import { CommandGate } from '../src/multiplayer/commandGate';
import { createTeamSnapshot, createTeamState } from '../src/multiplayer/projection';
import { buildDelta, createBaseline } from '../src/multiplayer/teamDelta';
import { SnapshotAssembler } from '../src/multiplayer/snapshotAssembler';

const TEST_TECH: TechDef = {
  id: 'testDoctrine',
  name: 'Test Doctrine',
  easternName: 'Test Doctrine',
  branch: 'manoeuvre',
  tier: 1,
  cost: { mats: 100, req: 20 },
  seconds: 2,
  requires: [],
  effects: [
    { kind: 'grantUnitUpgrade', upgrade: 'reconSmokescreen' },
    { kind: 'grantBuildingModule', module: 'advancedTurbine' },
  ],
  description: 'Fixture technology used to exercise individual purchases.',
  icon: 'research',
};

const CATALOG: ResearchCatalog = {
  techs: [...RESEARCH.techs, TEST_TECH],
  upgrades: RESEARCH.upgrades,
  modules: RESEARCH.modules,
};

function scenario() {
  const s = createScenario(32, 32, 'research authority');
  s.settings.startingMats = 6000;
  s.settings.startingReq = 800;
  s.settings.fog = false;
  s.players = [
    { id: 0, name: 'Player', factionId: 'lithuania', team: 0, isAI: false, startX: 4, startZ: 4 },
    { id: 1, name: 'Opponent', factionId: 'russia', team: 1, isAI: false, startX: 28, startZ: 28 },
  ];
  s.structures.push(
    { defId: 'commandPost', owner: 0, x: 2, z: 2 },
    { defId: 'researchCentre', owner: 0, x: 8, z: 2 },
    { defId: 'powerPlant', owner: 0, x: 14, z: 2 },
    { defId: 'commandPost', owner: 1, x: 26, z: 26 },
    { defId: 'researchCentre', owner: 1, x: 20, z: 26 },
    { defId: 'powerPlant', owner: 1, x: 26, z: 20 },
  );
  s.units.push(
    { defId: 'recon', owner: 0, x: 6, z: 10 },
    { defId: 'rifle', owner: 0, x: 8, z: 12 },
    { defId: 'rifle', owner: 1, x: 24, z: 18 },
  );
  return s;
}

function setup() {
  const game = new Game(scenario(), { enableAI: false, research: CATALOG });
  const gate = new CommandGate(game, [
    { seatId: 0, playerId: 0, team: 0, active: true },
    { seatId: 1, playerId: 1, team: 1, active: true },
  ]);
  const centre = (owner: number) =>
    game.state.entities.find(
      (e) => e.owner === owner && e.kind === 'building' && buildingFamily(e.defId) === 'researchCentre',
    )!;
  const plant = (owner: number) =>
    game.state.entities.find((e) => e.owner === owner && e.defId === 'powerPlant')!;
  const recon = () => game.state.entities.find((e) => e.owner === 0 && e.defId === 'recon')!;
  const enemyRifle = () =>
    game.state.entities.find((e) => e.owner === 1 && e.defId === 'rifle')!;
  return { game, gate, centre, plant, recon, enemyRifle };
}

const envelope = (command: unknown) => ({ v: 1, command });

describe('research command authority', () => {
  it('accepts a project on the seat’s own centre and queues it once', () => {
    const { game, gate, centre } = setup();
    const result = gate.submit(
      0,
      envelope({ type: 'research', buildingId: centre(0).id, techId: 'manoeuvre1' }),
      1000,
    );
    expect(result.ok).toBe(true);
    expect(game.pending).toHaveLength(1);
    expect(game.player(0)!.research.project).toBeNull();
  });

  it('cannot start or cancel research on an enemy centre', () => {
    const { game, gate, centre } = setup();
    const start = gate.submit(
      0,
      envelope({ type: 'research', buildingId: centre(1).id, techId: 'manoeuvre1' }),
      1000,
    );
    expect(start).toMatchObject({ ok: false, code: 'not-your-entity' });
    const cancel = gate.submit(
      0,
      envelope({ type: 'cancelResearch', buildingId: centre(1).id }),
      1200,
    );
    expect(cancel).toMatchObject({ ok: false, code: 'not-your-entity' });
    expect(game.pending).toHaveLength(0);
  });

  it('cannot install a module on an enemy structure or upgrade an enemy unit', () => {
    const { game, gate, plant, enemyRifle } = setup();
    const module = gate.submit(
      0,
      envelope({ type: 'installModule', buildingId: plant(1).id, moduleId: 'advancedTurbine' }),
      1000,
    );
    expect(module).toMatchObject({ ok: false, code: 'not-your-entity' });
    const upgrade = gate.submit(
      0,
      envelope({ type: 'activateUpgrade', unitId: enemyRifle().id, upgradeId: 'reconSmokescreen' }),
      1200,
    );
    expect(upgrade).toMatchObject({ ok: false, code: 'not-your-entity' });
    expect(game.pending).toHaveLength(0);
  });

  it('refuses a project the simulation has not unlocked or afforded', () => {
    const { game, gate, centre } = setup();
    const locked = gate.submit(
      0,
      envelope({ type: 'research', buildingId: centre(0).id, techId: 'manoeuvre2' }),
      1000,
    );
    expect(locked).toMatchObject({ ok: false, code: 'research-unavailable' });
    if (!locked.ok) expect(locked.detail).toMatch(/Requires/);

    game.player(0)!.mats = 0;
    const poor = gate.submit(
      0,
      envelope({ type: 'research', buildingId: centre(0).id, techId: 'manoeuvre1' }),
      1200,
    );
    expect(poor).toMatchObject({ ok: false, code: 'research-unavailable' });
    if (!poor.ok) expect(poor.detail).toMatch(/Insufficient materials/);
  });

  it('accepts a module and upgrade only after the project completes', () => {
    const { game, gate, centre, plant, recon } = setup();
    const start = gate.submit(
      0,
      envelope({ type: 'research', buildingId: centre(0).id, techId: 'testDoctrine' }),
      1000,
    );
    expect(start.ok).toBe(true);
    game.advance(TICK_RATE * 2);
    expect(game.completedTechnologies(0)).toContain('testDoctrine');

    const module = gate.submit(
      0,
      envelope({ type: 'installModule', buildingId: plant(0).id, moduleId: 'advancedTurbine' }),
      1200,
    );
    expect(module.ok).toBe(true);
    const upgrade = gate.submit(
      0,
      envelope({ type: 'activateUpgrade', unitId: recon().id, upgradeId: 'reconSmokescreen' }),
      1400,
    );
    expect(upgrade.ok).toBe(true);
    game.advance(5);
    expect(game.installedModules(plant(0).id)).toEqual(['advancedTurbine']);
    expect(game.appliedUpgrades(recon().id)).toEqual(['reconSmokescreen']);
  });
});

describe('research projection', () => {
  it('sends the seat’s own research and individual state, never the opponent’s', () => {
    const { game, plant, recon, enemyRifle } = setup();
    game.player(0)!.research.completed = ['testDoctrine'];
    game.player(1)!.research.completed = ['naval1'];
    game.player(0)!.research.project = { techId: 'manoeuvre1', remaining: 20, total: 45 };
    plant(0).modules = ['advancedTurbine'];
    recon().upgrades = ['reconSmokescreen'];
    enemyRifle().upgrades = ['reconSmokescreen'];

    const own = createTeamState(game, 0, 0);
    expect(own.players.map((player) => player.id)).toEqual([0]);
    expect(own.players[0].research).toEqual({
      completed: ['testDoctrine'],
      project: { techId: 'manoeuvre1', remaining: 20, total: 45 },
    });
    expect(own.entities.find((e) => e.id === plant(0).id)!.modules).toEqual(['advancedTurbine']);
    expect(own.entities.find((e) => e.id === recon().id)!.upgrades).toEqual(['reconSmokescreen']);
    // The enemy is visible, but its fitted upgrades are not in this seat's data.
    expect(own.entities.find((e) => e.id === enemyRifle().id)!.upgrades).toBeUndefined();

    const enemy = createTeamState(game, 1, 0);
    expect(enemy.players.map((player) => player.id)).toEqual([1]);
    expect(enemy.players[0].research).toEqual({
      completed: ['naval1'],
      project: null,
    });
  });

  it('carries research, modules and upgrades through a team delta', () => {
    const { game, plant, recon } = setup();
    const snapshot = createTeamSnapshot(game, 0);
    plant(0).modules = ['advancedTurbine'];
    recon().upgrades = ['reconSmokescreen'];
    game.player(0)!.research.completed = ['testDoctrine'];
    game.player(0)!.research.project = { techId: 'manoeuvre1', remaining: 10, total: 45 };

    const state = createTeamState(game, 0, game.state.eventSeq);
    const changes = buildDelta(createBaseline(snapshot), state, game.state.fog[0]);
    expect(changes.players?.upsert[0].research).toEqual({
      completed: ['testDoctrine'],
      project: { techId: 'manoeuvre1', remaining: 10, total: 45 },
    });
    expect(changes.entities?.upsert.find((entity) => entity.id === plant(0).id)?.modules).toEqual([
      'advancedTurbine',
    ]);
    expect(changes.entities?.upsert.find((entity) => entity.id === recon().id)?.upgrades).toEqual([
      'reconSmokescreen',
    ]);

    const assembler = new SnapshotAssembler({ roomId: 'room-research', team: 0 });
    expect(
      assembler.apply({
        type: 'sync',
        v: 2,
        epoch: 1,
        seq: 1,
        tick: snapshot.tick,
        team: 0,
        roomId: 'room-research',
        checkpoint: false,
        state: snapshot,
      }).ok,
    ).toBe(true);
    expect(
      assembler.apply({
        type: 'delta',
        v: 2,
        epoch: 1,
        seq: 2,
        base: 1,
        tick: state.tick,
        team: 0,
        roomId: 'room-research',
        changes,
      }).ok,
    ).toBe(true);
    expect(assembler.state()?.players[0].research?.project?.techId).toBe('manoeuvre1');
    expect(
      assembler.state()?.entities.find((entity) => entity.id === plant(0).id)?.modules,
    ).toEqual(['advancedTurbine']);
  });

  it('validates and applies a full snapshot carrying research and installed state', () => {
    const { game, plant } = setup();
    game.player(0)!.research.completed = ['testDoctrine'];
    plant(0).modules = ['advancedTurbine'];
    const snapshot = createTeamSnapshot(game, 0);
    const assembler = new SnapshotAssembler({ roomId: 'room-research', team: 0 });
    const result = assembler.apply({
      type: 'sync',
      v: 2,
      epoch: 1,
      seq: 1,
      tick: snapshot.tick,
      team: 0,
      roomId: 'room-research',
      checkpoint: false,
      state: snapshot,
    });
    expect(result.ok).toBe(true);
    const state = assembler.state()!;
    expect(state.players[0].research?.completed).toEqual(['testDoctrine']);
    expect(state.entities.find((entity) => entity.id === plant(0).id)!.modules).toEqual([
      'advancedTurbine',
    ]);
  });
});

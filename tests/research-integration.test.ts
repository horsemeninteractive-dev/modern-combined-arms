import { describe, expect, it } from 'vitest';
import { Game } from '../src/sim/game';
import { createScenario, type Scenario } from '../src/sim/scenario';
import { buildingFamily } from '../src/data/buildings';
import { RESEARCH, type ResearchCatalog, type TechDef } from '../src/data/research';
import { resolveRoster } from '../src/data/roster';
import { CommandGate } from '../src/multiplayer/commandGate';
import { RoomMatch, type RoomSeatDefinition, type RoomSocket } from '../src/multiplayer/roomMatch';
import { createTeamSnapshot } from '../src/multiplayer/projection';
import { TECHS } from '../src/data/research';
import { researchNodeState } from '../src/ui/researchView';

const TEST_TECH: TechDef = {
  id: 'testDoctrine',
  name: 'Test Doctrine',
  easternName: 'Test Doctrine',
  branch: 'manoeuvre',
  tier: 1,
  cost: { mats: 100, req: 20 },
  seconds: 2,
  requires: [],
  effects: [{ kind: 'unlockUnit', slot: 'tank' }],
  description: 'Short project used to exercise a live rejoin.',
  icon: 'research',
};

const ROOM_CATALOG: ResearchCatalog = {
  techs: [...RESEARCH.techs, TEST_TECH],
  upgrades: RESEARCH.upgrades,
  modules: RESEARCH.modules,
};

function rosterBuilding(nation: string, family: string): string {
  const id = resolveRoster(nation).buildings.find((entry) => buildingFamily(entry) === family);
  if (!id) throw new Error(`No ${family} for ${nation}`);
  return id;
}

function arena(nation = 'lithuania', technologies: string[] = []): Scenario {
  const scenario = createScenario(32, 32, 'research integration');
  scenario.settings.startingMats = 6000;
  scenario.settings.startingReq = 800;
  scenario.settings.fog = false;
  scenario.players = [
    {
      id: 0,
      name: 'Player',
      factionId: nation,
      team: 0,
      isAI: false,
      startX: 4,
      startZ: 4,
      technologies,
    },
    { id: 1, name: 'Opponent', factionId: 'russia', team: 1, isAI: false, startX: 28, startZ: 28 },
  ];
  scenario.structures.push(
    { defId: 'commandPost', owner: 0, x: 2, z: 2 },
    { defId: rosterBuilding(nation, 'researchCentre'), owner: 0, x: 8, z: 2 },
    { defId: rosterBuilding(nation, 'factory'), owner: 0, x: 14, z: 14 },
    { defId: 'powerPlant', owner: 0, x: 20, z: 2 },
    { defId: 'powerPlant', owner: 0, x: 24, z: 2 },
    { defId: 'commandPost', owner: 1, x: 26, z: 26 },
    { defId: 'powerPlant', owner: 1, x: 22, z: 26 },
    { defId: 'factory', owner: 1, x: 20, z: 20 },
  );
  scenario.units.push(
    { defId: 'engineer', owner: 0, x: 6, z: 8 },
    { defId: 'rifle', owner: 0, x: 8, z: 12 },
    { defId: 'rifle', owner: 1, x: 24, z: 18 },
  );
  return scenario;
}

function gameFor(nation = 'lithuania', technologies: string[] = []): Game {
  return new Game(arena(nation, technologies), { enableAI: false });
}

function buildingOf(game: Game, owner: number, family: string) {
  return game.entitiesOf(owner, 'building').find((e) => buildingFamily(e.defId) === family)!;
}

function findSite(game: Game, defId: string): { x: number; z: number } {
  for (let z = 4; z < 28; z++) {
    for (let x = 4; x < 28; x++) {
      if (game.placementStatus(0, defId, x, z, undefined, true).ok) return { x, z };
    }
  }
  throw new Error(`No valid site for ${defId}`);
}

describe('research production integration', () => {
  it('keeps tier-0 units available and refuses a research-gated unit before completion', () => {
    const game = gameFor();
    const factory = buildingOf(game, 0, 'factory');
    expect(game.productionStatus(0, factory.id, game.unitIdFor(0, 'engineer')!).ok).toBe(true);

    const tank = game.unitIdFor(0, 'tank')!;
    const blocked = game.productionStatus(0, factory.id, tank);
    expect(blocked.ok).toBe(false);
    expect(blocked.reason).toMatch(/Manoeuvre Doctrine research/);

    const p = game.player(0)!;
    const before = p.mats;
    game.enqueueCommand({ type: 'produce', team: 0, buildingId: factory.id, defId: tank });
    game.tick();
    expect(factory.queue).toHaveLength(0);
    expect(p.mats).toBeGreaterThan(before - 0.3);
  });

  it('unlocks the unit for queueing once the technology is complete', () => {
    const game = gameFor();
    const factory = buildingOf(game, 0, 'factory');
    const tank = game.unitIdFor(0, 'tank')!;
    game.player(0)!.research.completed.push('manoeuvre1');
    expect(game.productionStatus(0, factory.id, tank).ok).toBe(true);

    game.enqueueCommand({ type: 'produce', team: 0, buildingId: factory.id, defId: tank });
    game.tick();
    expect(factory.queue.map((item) => item.defId)).toEqual([tank]);
  });

  it('gates construction and rejects a placement command without spending', () => {
    const locked = gameFor();
    const unlocked = gameFor('lithuania', ['air1']);
    const site = findSite(unlocked, 'airfield');
    expect(locked.placementStatus(0, 'airfield', site.x, site.z).code).toBe('research');

    const p = locked.player(0)!;
    const before = p.mats;
    locked.enqueueCommand({
      type: 'placeBuilding',
      team: 0,
      defId: 'airfield',
      tileX: site.x,
      tileZ: site.z,
    });
    locked.tick();
    expect(locked.state.entities.some((e) => e.owner === 0 && e.defId === 'airfield')).toBe(false);
    expect(p.mats).toBeGreaterThan(before - 0.3);

    unlocked.enqueueCommand({
      type: 'placeBuilding',
      team: 0,
      defId: 'airfield',
      tileX: site.x,
      tileZ: site.z,
    });
    unlocked.tick();
    const siteEntity = unlocked.state.entities.find(
      (e) => e.owner === 0 && e.defId === 'airfield',
    );
    expect(siteEntity).toBeDefined();
    expect(siteEntity!.construction).toBe(true);
  });
});

describe('national research integration', () => {
  it('resolves a national replacement through its alliance slot and keeps exclusives national', () => {
    const game = gameFor('poland');
    const factory = buildingOf(game, 0, 'factory');
    const spearhead = game.unitIdFor(0, 'tank')!;
    expect(spearhead).toBe('spearhead');
    expect(game.productionStatus(0, factory.id, spearhead).ok).toBe(false);

    game.player(0)!.research.completed.push('manoeuvre1');
    expect(game.productionStatus(0, factory.id, spearhead).ok).toBe(true);
    expect(game.availableUnits(0)).toContain('spearhead');
    expect(game.availableUnits(0)).not.toContain('tank');

    expect(game.unitDefinitionUnlocked(0, 'wilk')).toBe(false);
    game.player(0)!.research.completed.push('manoeuvre2');
    expect(game.unitDefinitionUnlocked(0, 'wilk')).toBe(true);
    expect(game.availableUnits(0)).not.toContain('sprut');
    expect(game.canProduce(0, 'sprut')).toBe(false);
    expect(game.canProduce(1, 'spearhead')).toBe(false);
  });

  it('keeps a national research centre available at tier zero', () => {
    const game = gameFor('belarus');
    expect(game.availableBuildings(0)).toContain('signalsBureau');
    expect(game.hasResearchCentre(0)).toBe(true);
  });

  it('gates a national building on its canonical slot and keeps it national', () => {
    // The British strip occupies the airfield slot, so it inherits the air
    // branch's tier-1 gate rather than opening early because it is national.
    const unlocked = gameFor('uk', ['air1']);
    const site = findSite(unlocked, 'expeditionaryAirfield');
    const locked = gameFor('uk');
    expect(locked.placementStatus(0, 'expeditionaryAirfield', site.x, site.z).code).toBe(
      'research',
    );
    expect(unlocked.placementStatus(0, 'expeditionaryAirfield', site.x, site.z).ok).toBe(true);
    expect(locked.availableBuildings(0)).not.toContain('expeditionaryAirfield');

    const lithuania = gameFor('lithuania', ['air1']);
    expect(lithuania.canBuild(0, 'expeditionaryAirfield')).toBe(false);
    expect(lithuania.placementStatus(0, 'expeditionaryAirfield', site.x, site.z).code).toBe(
      'roster',
    );
    expect(lithuania.canBuild(0, 'signalsBureau')).toBe(false);
  });
});

describe('multiplayer research independence', () => {
  it('resolves each player from their own completed set and ships only that team', () => {
    const game = gameFor();
    const p0Factory = buildingOf(game, 0, 'factory');
    const p1Factory = buildingOf(game, 1, 'factory');
    const tank0 = game.unitIdFor(0, 'tank')!;
    const tank1 = game.unitIdFor(1, 'tank')!;

    game.player(1)!.research.completed.push('manoeuvre1');
    expect(game.productionStatus(1, p1Factory.id, tank1).ok).toBe(true);
    expect(game.productionStatus(0, p0Factory.id, tank0).ok).toBe(false);
    expect(game.availableUnits(0)).not.toContain(tank0);

    const teamZero = createTeamSnapshot(game, 0);
    expect(teamZero.players.map((player) => player.id)).toEqual([0]);
    expect(teamZero.players[0].research?.completed).toEqual([]);

    const teamOne = createTeamSnapshot(game, 1);
    expect(teamOne.players.map((player) => player.id)).toEqual([1]);
    expect(teamOne.players[0].research?.completed).toEqual(['manoeuvre1']);
  });

  it('rejects a production command from a player whose own research is incomplete', () => {
    const game = gameFor();
    const p0Factory = buildingOf(game, 0, 'factory');
    const tank0 = game.unitIdFor(0, 'tank')!;
    game.player(1)!.research.completed.push('manoeuvre1');
    const gate = new CommandGate(game, [
      { seatId: 0, playerId: 0, team: 0, active: true },
      { seatId: 1, playerId: 1, team: 1, active: true },
    ]);
    const denied = gate.submit(
      0,
      { v: 1, command: { type: 'produce', buildingId: p0Factory.id, defId: tank0 } },
      1000,
    );
    expect(denied).toMatchObject({ ok: false, code: 'production-unavailable' });
    expect(game.pending).toHaveLength(0);
  });
});

describe('scenario grants and completion state', () => {
  it('shows a scenario-granted technology as completed and closes its prerequisite', () => {
    const game = gameFor('lithuania', ['air1']);
    const completed = game.completedTechnologies(0);
    expect(completed).toEqual(['air1']);
    const base = {
      completed,
      project: null,
      mats: 0,
      req: 0,
      hasCentre: game.hasResearchCentre(0),
      allianceId: 'defender',
      factionId: 'lithuania',
    };
    expect(researchNodeState(TECHS.air1, base).status).toBe('completed');
    // The tier-2 node is no longer prerequisite-locked, only unaffordable.
    expect(researchNodeState(TECHS.air2, base).status).toBe('resources');
    // An unrelated branch is still locked behind its own tier-1 node.
    expect(researchNodeState(TECHS.fires2, base).status).toBe('prerequisite');
  });

  it('restores completed research and its availability after load', () => {
    const game = gameFor();
    game.player(0)!.research.completed.push('manoeuvre1');
    const save = JSON.parse(JSON.stringify(game.toSave()));
    const restored = Game.fromSave(save, { enableAI: false });
    expect(restored.completedTechnologies(0)).toEqual(['manoeuvre1']);
    const factory = buildingOf(restored, 0, 'factory');
    expect(restored.productionStatus(0, factory.id, restored.unitIdFor(0, 'tank')!).ok).toBe(true);
  });
});


describe('research command authority', () => {
  it('rejects a production command before research and accepts it after', () => {
    const game = gameFor();
    const factory = buildingOf(game, 0, 'factory');
    const tank = game.unitIdFor(0, 'tank')!;
    const gate = new CommandGate(game, [
      { seatId: 0, playerId: 0, team: 0, active: true },
      { seatId: 1, playerId: 1, team: 1, active: true },
    ]);
    const envelope = (body: unknown) => ({ v: 1, command: body });

    const denied = gate.submit(
      0,
      envelope({ type: 'produce', buildingId: factory.id, defId: tank }),
      1000,
    );
    expect(denied).toMatchObject({ ok: false, code: 'production-unavailable' });
    expect(game.pending).toHaveLength(0);

    game.player(0)!.research.completed.push('manoeuvre1');
    const allowed = gate.submit(
      0,
      envelope({ type: 'produce', buildingId: factory.id, defId: tank }),
      1200,
    );
    expect(allowed.ok).toBe(true);
    expect(game.pending).toHaveLength(1);
  });
});

describe('research save and rejoin integration', () => {
  it('restores an active project and the availability it has not yet unlocked', () => {
    const game = gameFor();
    const centre = buildingOf(game, 0, 'researchCentre');
    const factory = buildingOf(game, 0, 'factory');
    const tank = game.unitIdFor(0, 'tank')!;
    game.enqueueCommand({
      type: 'research',
      team: 0,
      buildingId: centre.id,
      techId: 'manoeuvre1',
    });
    game.advance(100);
    expect(game.player(0)!.research.project?.techId).toBe('manoeuvre1');

    const save = JSON.parse(JSON.stringify(game.toSave()));
    const restored = Game.fromSave(save, { enableAI: false });
    expect(restored.player(0)!.research.project?.techId).toBe('manoeuvre1');
    expect(restored.productionStatus(0, factory.id, tank).ok).toBe(false);

    restored.player(0)!.research.completed.push('manoeuvre1');
    restored.player(0)!.research.project = null;
    expect(restored.productionStatus(0, factory.id, tank).ok).toBe(true);
  });

  it('carries an active project and its completion across a live reconnect', () => {
    const game = new Game(arena(), {
      localPlayerId: -1,
      enableAI: false,
      research: ROOM_CATALOG,
    });
    const centre = buildingOf(game, 0, 'researchCentre');
    const seats: RoomSeatDefinition[] = [
      { seatId: 0, playerId: 0, team: 0, token: 'seat-zero-token-000000000000' },
      { seatId: 1, playerId: 1, team: 1, token: 'seat-one-token-0000000000000' },
    ];
    const room = new RoomMatch({
      roomId: 'research-rejoin',
      mode: '1v1',
      seats,
      matchDurationMs: 600_000,
      matchDeadlineAt: 1_000_000,
      now: 1000,
      promoteOnConnect: true,
      game,
    });
    class Socket implements RoomSocket {
      sent: string[] = [];
      bufferedAmount = 0;
      send(data: string): void {
        this.sent.push(data);
      }
      close(): void {}
    }
    const zero = new Socket();
    const one = new Socket();
    expect(room.connect(0, seats[0].token, zero, 1000).ok).toBe(true);
    expect(room.connect(1, seats[1].token, one, 1000).ok).toBe(true);
    expect(room.currentPhase).toBe('playing');

    room.receive(
      0,
      zero,
      JSON.stringify({
        type: 'command',
        v: 2,
        command: { type: 'research', buildingId: centre.id, techId: 'testDoctrine' },
      }),
      1100,
    );
    let now = 1100;
    for (let i = 0; i < 10; i++) {
      now += 50;
      room.tick(now);
    }
    expect(game.player(0)!.research.project?.techId).toBe('testDoctrine');
    const remainingBeforeDrop = game.player(0)!.research.project!.remaining;

    room.disconnect(0, zero, now);
    for (let i = 0; i < 10; i++) {
      now += 50;
      room.tick(now);
    }

    const replacement = new Socket();
    expect(room.connect(0, seats[0].token, replacement, now + 100).ok).toBe(true);
    const sync = replacement.sent
      .map((text) => JSON.parse(text) as Record<string, unknown>)
      .find((message) => message.type === 'sync');
    expect(sync).toBeDefined();
    const state = sync!.state as {
      players: Array<{ id: number; research?: { completed: string[]; project: { techId: string; remaining: number } | null } }>;
    };
    expect(state.players.map((player) => player.id)).toEqual([0]);
    expect(state.players[0].research?.project?.techId).toBe('testDoctrine');
    expect(state.players[0].research!.project!.remaining).toBeLessThan(remainingBeforeDrop);
    expect(state.players[0].research?.completed ?? []).not.toContain('testDoctrine');

    for (let i = 0; i < 60; i++) {
      now += 50;
      room.tick(now);
    }
    expect(game.player(0)!.research.completed).toContain('testDoctrine');
    expect(game.unitSlotUnlocked(0, 'tank')).toBe(true);

    room.disconnect(0, replacement, now);
    const afterCompletion = new Socket();
    expect(room.connect(0, seats[0].token, afterCompletion, now + 100).ok).toBe(true);
    const completedSync = afterCompletion.sent
      .map((text) => JSON.parse(text) as Record<string, unknown>)
      .find((message) => message.type === 'sync');
    const completedState = completedSync!.state as {
      players: Array<{ research?: { completed: string[]; project: unknown } }>;
    };
    expect(completedState.players[0].research?.completed).toContain('testDoctrine');
    expect(completedState.players[0].research?.project).toBeNull();
    expect(completedState.players).toHaveLength(1);
  });
});

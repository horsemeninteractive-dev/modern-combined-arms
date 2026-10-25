import { describe, expect, it } from 'vitest';
import { Game } from '../src/sim/game';
import { createEmptyScenario } from '../src/data/scenarios';
import { TILE_SIZE } from '../src/sim/constants';
import { Terrain, tileIndex } from '../src/sim/terrain';
import { contextOrderFor } from '../src/ui/orderIntent';
import type { Scenario } from '../src/sim/scenario';
import { BUILDINGS } from '../src/data/buildings';

type Structure = { defId: string; owner: number; x: number; z: number };
type Unit = { defId: string; owner: number; x: number; z: number };

function scenarioWith(structures: Structure[], units: Unit[], fog = true): Scenario {
  const scenario = createEmptyScenario(48, 40);
  scenario.settings.startingMats = 0;
  scenario.settings.startingReq = 0;
  scenario.settings.fog = fog;
  scenario.players[0].startX = 8;
  scenario.players[0].startZ = 8;
  scenario.players[1].startX = 38;
  scenario.players[1].startZ = 30;
  scenario.structures = [
    { defId: 'commandPost', owner: 0, x: 2, z: 2 },
    { defId: 'commandPost', owner: 1, x: 42, z: 34 },
    ...structures,
  ];
  scenario.units = units;
  return scenario;
}

function shelterGame(extraUnits: Unit[] = [], fog = true) {
  return new Game(
    scenarioWith([{ defId: 'tenement', owner: -1, x: 24, z: 12 }], extraUnits, fog),
    { enableAI: false },
  );
}

function building(game: Game, defId: string) {
  return game.state.entities.find((e) => e.kind === 'building' && e.defId === defId)!;
}

function rifles(game: Game, owner = 0) {
  return game.entitiesOf(owner, 'unit').filter((e) => e.defId === 'rifle');
}

describe('garrison entry, capacity and exit', () => {
  it('moves eligible infantry inside and represents them as occupants', () => {
    const game = shelterGame([{ defId: 'rifle', owner: 0, x: 22, z: 13 }]);
    const house = building(game, 'tenement');
    const rifle = rifles(game)[0];
    game.enqueueCommand({ type: 'garrison', team: 0, ids: [rifle.id], targetId: house.id });
    game.advance(20);

    expect(rifle.garrisonId).toBe(house.id);
    expect(rifle.state).toBe('garrisoned');
    expect(rifle.x).toBe(house.x);
    expect(rifle.z).toBe(house.z);
    expect(game.garrisonOccupants(house.id).map((u) => u.id)).toEqual([rifle.id]);
  });

  it('rejects vehicles and engineers rather than pretending they can occupy cover', () => {
    const game = shelterGame([
      { defId: 'tank', owner: 0, x: 22, z: 14 },
      { defId: 'engineer', owner: 0, x: 22, z: 16 },
    ]);
    const house = building(game, 'tenement');
    const tank = game.entitiesOf(0, 'unit').find((e) => e.defId === 'tank')!;
    const eng = game.entitiesOf(0, 'unit').find((e) => e.defId === 'engineer')!;
    for (const unit of [tank, eng]) {
      game.enqueueCommand({ type: 'garrison', team: 0, ids: [unit.id], targetId: house.id });
      game.advance(2);
      expect(unit.garrisonId).toBe(0);
    }
    expect(
      game.state.events.some(
        (e) => e.type === 'orderFailed' && /Only riflemen and ATGM teams/.test(e.text),
      ),
    ).toBe(true);
  });

  it('enforces capacity authoritatively and refuses a full shelter', () => {
    const units: Unit[] = [];
    for (let i = 0; i < 5; i++) units.push({ defId: 'rifle', owner: 0, x: 22, z: 11 + i });
    const game = shelterGame(units);
    const house = building(game, 'tenement');
    const all = rifles(game);
    game.enqueueCommand({
      type: 'garrison',
      team: 0,
      ids: all.map((u) => u.id),
      targetId: house.id,
    });
    game.advance(20 * 8);
    expect(game.garrisonOccupants(house.id)).toHaveLength(4);
    const outside = all.filter((u) => u.garrisonId === 0);
    expect(outside).toHaveLength(1);

    game.enqueueCommand({ type: 'garrison', team: 0, ids: [outside[0].id], targetId: house.id });
    game.advance(2);
    expect(outside[0].garrisonId).toBe(0);
    expect(
      game.state.events.some((e) => e.type === 'orderFailed' && /full/.test(e.text)),
    ).toBe(true);
  });

  it('exits occupants to distinct walkable tiles and lets them move again', () => {
    const units: Unit[] = [];
    for (let i = 0; i < 3; i++) units.push({ defId: 'rifle', owner: 0, x: 22, z: 12 + i });
    const game = shelterGame(units);
    const house = building(game, 'tenement');
    const all = rifles(game);
    game.enqueueCommand({
      type: 'garrison',
      team: 0,
      ids: all.map((u) => u.id),
      targetId: house.id,
    });
    game.advance(20);
    expect(game.garrisonOccupants(house.id)).toHaveLength(3);

    game.enqueueCommand({ type: 'ungarrison', team: 0, ids: [house.id] });
    game.advance(2);
    expect(game.garrisonOccupants(house.id)).toHaveLength(0);
    expect(all.every((u) => u.garrisonId === 0)).toBe(true);
    expect(new Set(all.map((u) => `${u.x.toFixed(2)},${u.z.toFixed(2)}`)).size).toBe(3);
    for (const unit of all) {
      const tx = Math.floor(unit.x / TILE_SIZE);
      const tz = Math.floor(unit.z / TILE_SIZE);
      expect(game.state.map.terrain[tileIndex(game.state.map.width, tx, tz)]).not.toBe(
        Terrain.DeepWater,
      );
    }

    const destination = { x: house.x - 10 * TILE_SIZE, z: house.z };
    game.enqueueCommand({ type: 'move', team: 0, ids: [all[0].id], x: destination.x, z: destination.z });
    game.advance(20 * 4);
    expect(Math.hypot(all[0].x - house.x, all[0].z - house.z)).toBeGreaterThan(4);
  });

  it('keeps occupants inside when no safe exit tile exists', () => {
    const game = shelterGame([{ defId: 'rifle', owner: 0, x: 22, z: 13 }]);
    const house = building(game, 'tenement');
    const rifle = rifles(game)[0];
    game.enqueueCommand({ type: 'garrison', team: 0, ids: [rifle.id], targetId: house.id });
    game.advance(20);
    expect(rifle.garrisonId).toBe(house.id);

    // Drown every exit ring without touching the footprint itself.
    for (let z = 2; z <= 30; z++) {
      for (let x = 6; x <= 42; x++) {
        const inside = x >= 24 && x < 28 && z >= 12 && z < 16;
        if (inside) continue;
        game.state.map.terrain[tileIndex(game.state.map.width, x, z)] = Terrain.DeepWater;
      }
    }
    game.enqueueCommand({ type: 'ungarrison', team: 0, ids: [house.id] });
    game.advance(2);
    expect(rifle.garrisonId).toBe(house.id);
    expect(game.garrisonOccupants(house.id)).toHaveLength(1);
    expect(
      game.state.events.some((e) => e.type === 'orderFailed' && /No safe exit/.test(e.text)),
    ).toBe(true);
  });

  it('cleans occupancy when an occupant dies or the shelter is destroyed', () => {
    const game = shelterGame([{ defId: 'rifle', owner: 0, x: 22, z: 13 }]);
    const house = building(game, 'tenement');
    const rifle = rifles(game)[0];
    game.enqueueCommand({ type: 'garrison', team: 0, ids: [rifle.id], targetId: house.id });
    game.advance(20);
    rifle.hp = 0;
    game.advance(2);
    expect(game.getEntity(rifle.id)).toBeUndefined();
    expect(game.garrisonOccupants(house.id)).toHaveLength(0);

    const second = shelterGame([{ defId: 'rifle', owner: 0, x: 22, z: 13 }]);
    const house2 = building(second, 'tenement');
    const occupant = rifles(second)[0];
    second.enqueueCommand({ type: 'garrison', team: 0, ids: [occupant.id], targetId: house2.id });
    second.advance(20);
    house2.hp = 0;
    second.advance(2);
    expect(second.getEntity(house2.id)).toBeUndefined();
    expect(second.getEntity(occupant.id)).toBeUndefined();
    expect(second.garrisonOccupants(house2.id)).toHaveLength(0);
    expect(
      second.state.events.some(
        (e) => e.team === 0 && e.type === 'notice' && /infantry lost/.test(e.text),
      ),
    ).toBe(true);
  });

  it('survives save/load without duplicating occupants or losing the order', () => {
    const game = shelterGame([{ defId: 'rifle', owner: 0, x: 22, z: 13 }]);
    const house = building(game, 'tenement');
    const rifle = rifles(game)[0];
    game.enqueueCommand({ type: 'garrison', team: 0, ids: [rifle.id], targetId: house.id });
    game.advance(20);
    const restored = Game.fromSave(JSON.parse(JSON.stringify(game.toSave())), {
      enableAI: false,
    });
    const restoredHouse = restored.state.entities.find((e) => e.defId === 'tenement')!;
    expect(restored.garrisonOccupants(restoredHouse.id)).toHaveLength(1);
    const restoredRifle = restored.state.entities.find(
      (e) => e.kind === 'unit' && e.owner === 0 && e.defId === 'rifle',
    )!;
    expect(restoredRifle.garrisonId).toBe(restoredHouse.id);
    game.advance(20 * 3);
    restored.advance(20 * 3);
    expect(restored.stateHash()).toBe(game.stateHash());
  });
});

describe('garrison approach', () => {
  /**
   * The door rule is measured from the wall, so a unit ordered in from any
   * clear side has to reach the building instead of reporting that the shelter
   * is unreachable or stalling a step outside it.
   */
  it('enters from any clear side of the shelter without a failed route', () => {
    const sides: Array<[number, number]> = [
      [18, 12],
      [30, 12],
      [24, 5],
      [24, 21],
      [18, 6],
      [30, 6],
      [18, 19],
      [30, 19],
      [15, 14],
      [33, 16],
    ];
    for (const [x, z] of sides) {
      const game = shelterGame([{ defId: 'rifle', owner: 0, x, z }]);
      const house = building(game, 'tenement');
      const rifle = rifles(game)[0];
      game.enqueueCommand({ type: 'garrison', team: 0, ids: [rifle.id], targetId: house.id });
      game.advance(20 * 20);
      const failure = game.state.events.find((e) => e.type === 'orderFailed');
      expect(failure?.text, `from (${x},${z})`).toBeUndefined();
      expect(rifle.garrisonId, `from (${x},${z})`).toBe(house.id);
    }
  });

  it('walks the last step to the wall instead of stopping short of it', () => {
    const game = shelterGame([{ defId: 'rifle', owner: 0, x: 33, z: 24 }]);
    const house = building(game, 'tenement');
    const rifle = rifles(game)[0];
    game.enqueueCommand({ type: 'garrison', team: 0, ids: [rifle.id], targetId: house.id });
    game.advance(2);
    // The waypoint has to sit inside the doorway gate the arrival check uses.
    const def = BUILDINGS.tenement;
    const left = house.x / TILE_SIZE - def.footprint.w / 2;
    const top = house.z / TILE_SIZE - def.footprint.h / 2;
    const dx = Math.max(left - rifle.destX / TILE_SIZE, 0, rifle.destX / TILE_SIZE - (left + def.footprint.w));
    const dz = Math.max(top - rifle.destZ / TILE_SIZE, 0, rifle.destZ / TILE_SIZE - (top + def.footprint.h));
    expect(Math.hypot(dx, dz)).toBeLessThanOrEqual(1.5);
    game.advance(20 * 20);
    expect(rifle.garrisonId).toBe(house.id);
    expect(game.state.events.some((e) => e.type === 'orderFailed')).toBe(false);
  });

  it('keeps looking for a door after the near side is blocked', () => {
    const game = shelterGame([{ defId: 'rifle', owner: 0, x: 33, z: 12 }]);
    const house = building(game, 'tenement');
    const rifle = rifles(game)[0];
    // Flood the eastern approach so the first door the unit tries is drowned and
    // the only way in is around the corner.
    for (let z = 10; z <= 18; z++) {
      for (let x = 28; x <= 31; x++) {
        game.state.map.terrain[tileIndex(game.state.map.width, x, z)] = Terrain.DeepWater;
      }
    }
    game.enqueueCommand({ type: 'garrison', team: 0, ids: [rifle.id], targetId: house.id });
    game.advance(20 * 20);
    expect(rifle.garrisonId).toBe(house.id);
    expect(game.state.events.some((e) => e.type === 'orderFailed')).toBe(false);
  });
});

describe('garrison combat and protection', () => {
  it('fires from the building at a valid ground target', () => {
    const game = shelterGame([
      { defId: 'rifle', owner: 0, x: 22, z: 13 },
      { defId: 'rifle', owner: 1, x: 31, z: 13 },
    ]);
    const house = building(game, 'tenement');
    const defender = rifles(game)[0];
    const attacker = rifles(game, 1)[0];
    attacker.maxHp = 100000;
    attacker.hp = 100000;
    game.enqueueCommand({ type: 'garrison', team: 0, ids: [defender.id], targetId: house.id });
    game.advance(20 * 4);
    expect(defender.garrisonId).toBe(house.id);
    expect(attacker.hp).toBeLessThan(attacker.maxHp);
  });

  it('does not fire at a target outside rifle range', () => {
    const game = shelterGame([
      { defId: 'rifle', owner: 0, x: 22, z: 13 },
      { defId: 'rifle', owner: 1, x: 40, z: 13 },
    ]);
    const house = building(game, 'tenement');
    const defender = rifles(game)[0];
    const attacker = rifles(game, 1)[0];
    attacker.maxHp = 100000;
    attacker.hp = 100000;
    game.enqueueCommand({ type: 'garrison', team: 0, ids: [defender.id], targetId: house.id });
    game.advance(20 * 4);
    expect(defender.garrisonId).toBe(house.id);
    expect(attacker.hp).toBe(attacker.maxHp);
  });

  it('reduces direct fire against occupants compared with identical exposed infantry', () => {
    const garrisoned = shelterGame([
      { defId: 'rifle', owner: 0, x: 22, z: 13 },
      { defId: 'atgm', owner: 1, x: 33, z: 13 },
    ], false);
    const exposedScenario = scenarioWith(
      [],
      [
        { defId: 'atgm', owner: 1, x: 33, z: 13 },
        { defId: 'rifle', owner: 0, x: 26, z: 13 },
      ],
      false,
    );
    const exposed = new Game(exposedScenario, { enableAI: false });

    const house = building(garrisoned, 'tenement');
    const inside = rifles(garrisoned)[0];
    const outside = rifles(exposed)[0];
    const atgmIn = garrisoned.entitiesOf(1, 'unit').find((e) => e.defId === 'atgm')!;
    const atgmOut = exposed.entitiesOf(1, 'unit').find((e) => e.defId === 'atgm')!;
    atgmIn.maxHp = 100000;
    atgmIn.hp = 100000;
    atgmOut.maxHp = 100000;
    atgmOut.hp = 100000;
    garrisoned.enqueueCommand({ type: 'garrison', team: 0, ids: [inside.id], targetId: house.id });
    garrisoned.advance(20);
    exposed.advance(20);
    const startIn = inside.hp;
    const startOut = outside.hp;
    garrisoned.advance(20 * 20);
    exposed.advance(20 * 20);

    expect(inside.garrisonId).toBe(house.id);
    expect(inside.hp).toBeLessThan(startIn);
    expect(outside.hp).toBeLessThan(startOut);
    // The exact hit cadence is deterministic but differs by target; the
    // protection rule must still leave the occupant with more health than the
    // exposed soldier under the same weapon and range.
    expect(inside.hp).toBeGreaterThan(outside.hp);
  });

  it('lets enemy infantry enter only after the occupants are cleared', () => {
    const game = shelterGame([
      { defId: 'rifle', owner: 0, x: 22, z: 13 },
      { defId: 'rifle', owner: 1, x: 31, z: 13 },
    ]);
    const house = building(game, 'tenement');
    const defender = rifles(game)[0];
    const attacker = rifles(game, 1)[0];
    game.enqueueCommand({ type: 'garrison', team: 0, ids: [defender.id], targetId: house.id });
    game.advance(20);
    expect(defender.garrisonId).toBe(house.id);

    game.enqueueCommand({ type: 'garrison', team: 1, ids: [attacker.id], targetId: house.id });
    game.advance(2);
    expect(attacker.garrisonId).toBe(0);
    expect(
      game.state.events.some((e) => e.type === 'orderFailed' && /hostile infantry/i.test(e.text)),
    ).toBe(true);

    defender.hp = 0;
    game.advance(2);
    game.enqueueCommand({ type: 'garrison', team: 1, ids: [attacker.id], targetId: house.id });
    game.advance(20 * 8);
    expect(attacker.garrisonId).toBe(house.id);
  });
});

describe('garrison structure damage and collapse', () => {
  /** A defended tenement owned by team 1 with a team 0 tank shelling it. */
  function contestedShelter() {
    return new Game(
      scenarioWith(
        [{ defId: 'tenement', owner: 1, x: 30, z: 12 }],
        [
          { defId: 'rifle', owner: 1, x: 32, z: 15 },
          { defId: 'tank', owner: 0, x: 38, z: 14 },
        ],
        false,
      ),
      { enableAI: false },
    );
  }

  it('damages the shelter itself while it is occupied', () => {
    const game = contestedShelter();
    const house = building(game, 'tenement');
    const occupant = game.entitiesOf(1, 'unit').find((e) => e.defId === 'rifle')!;
    game.enqueueCommand({ type: 'garrison', team: 1, ids: [occupant.id], targetId: house.id });
    game.advance(20);
    expect(occupant.garrisonId).toBe(house.id);

    game.advance(20 * 12);
    expect(house.hp).toBeLessThan(house.maxHp);
    expect(house.hp).toBeGreaterThan(0);
  });

  it('drives the occupants out once the shelter falls to a quarter integrity', () => {
    const game = contestedShelter();
    const house = building(game, 'tenement');
    const occupant = game.entitiesOf(1, 'unit').find((e) => e.defId === 'rifle')!;
    game.enqueueCommand({ type: 'garrison', team: 1, ids: [occupant.id], targetId: house.id });
    game.advance(20);
    expect(occupant.garrisonId).toBe(house.id);

    house.hp = Math.ceil(house.maxHp * 0.26);
    for (let i = 0; i < 20 * 30 && game.garrisonOccupants(house.id).length > 0; i++) game.tick();

    expect(house.hp).toBeGreaterThan(0);
    expect(house.hp / house.maxHp).toBeLessThanOrEqual(0.25);
    expect(game.garrisonOccupants(house.id)).toHaveLength(0);
    expect(occupant.garrisonId).toBe(0);
    expect(game.state.events.some((e) => /collapsing/i.test(e.text))).toBe(true);

    // A collapsing shelter cannot be re-entered until it is repaired.
    game.enqueueCommand({ type: 'garrison', team: 1, ids: [occupant.id], targetId: house.id });
    game.advance(4);
    expect(occupant.garrisonId).toBe(0);
  });
});

describe('right-click orders on a shelter', () => {
  it('sends selected infantry to garrison it instead of moving onto it', () => {
    const game = shelterGame([{ defId: 'rifle', owner: 0, x: 22, z: 13 }]);
    const house = building(game, 'tenement');
    const rifle = rifles(game)[0];
    expect(contextOrderFor(house, [rifle], 0, false)).toBe('garrison');
  });

  it('falls back to a move order when nothing selected can occupy it', () => {
    const game = shelterGame([{ defId: 'engineer', owner: 0, x: 22, z: 13 }]);
    const house = building(game, 'tenement');
    const engineer = game.entitiesOf(0, 'unit').find((e) => e.defId === 'engineer')!;
    expect(contextOrderFor(house, [engineer], 0, false)).toBe('move');
  });
});

describe('shelters and the fog of war', () => {
  it('keeps a neutral shelter unknown until a friendly unit can see it', () => {
    const game = shelterGame();
    const house = building(game, 'tenement');
    expect(game.isVisibleTo(0, house.id)).toBe(false);
    expect(game.isVisibleTo(1, house.id)).toBe(false);
  });

  it('reveals the shelter to the side that has line of sight on it', () => {
    const game = shelterGame([{ defId: 'rifle', owner: 0, x: 22, z: 13 }]);
    const house = building(game, 'tenement');
    expect(game.isVisibleTo(0, house.id)).toBe(true);
    expect(game.isVisibleTo(1, house.id)).toBe(false);
  });

  it('still charts neutral strategic objectives for both sides', () => {
    const game = new Game(
      scenarioWith([{ defId: 'relay', owner: -1, x: 40, z: 8 }], []),
      { enableAI: false },
    );
    const relay = building(game, 'relay');
    expect(game.isVisibleTo(0, relay.id)).toBe(true);
    expect(game.isVisibleTo(1, relay.id)).toBe(true);
  });
});

describe('AI garrison awareness', () => {
  it('uses a nearby neutral shelter when its base is threatened', () => {
    const scenario = scenarioWith(
      [{ defId: 'tenement', owner: -1, x: 34, z: 20 }],
      [
        { defId: 'rifle', owner: 1, x: 34, z: 22 },
        { defId: 'tank', owner: 0, x: 34, z: 14 },
      ],
      false,
    );
    scenario.players[1].isAI = true;
    const game = new Game(scenario, { enableAI: true });
    game.advance(20 * 4);
    const house = game.state.entities.find((e) => e.defId === 'tenement')!;
    expect(game.garrisonOccupants(house.id).length).toBeGreaterThan(0);
    expect(game.garrisonOccupants(house.id).every((u) => u.owner === 1)).toBe(true);
  });
});

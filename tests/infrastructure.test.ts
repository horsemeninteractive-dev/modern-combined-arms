import { describe, expect, it } from 'vitest';
import { Game } from '../src/sim/game';
import { createEmptyScenario, createIslandAssault } from '../src/data/scenarios';
import { BUILDINGS, BUILDABLE_BY_PLAYER } from '../src/data/buildings';
import { TILE_SIZE } from '../src/sim/constants';
import { checkPlacement, parseScenario, scenarioToJson, validateScenario } from '../src/sim/scenario';
import { Terrain, inBounds, tileIndex } from '../src/sim/terrain';
import { objectiveMeterState } from '../src/ui/relayMeter';

type Structure = { defId: string; owner: number; x: number; z: number };
type Unit = { defId: string; owner: number; x: number; z: number };

/** Minimal battlefield: two Command Posts, no AI, optional objectives and units. */
function arena(structures: Structure[] = [], units: Unit[] = []) {
  const scenario = createEmptyScenario(48, 40);
  scenario.settings.startingMats = 0;
  scenario.settings.startingReq = 0;
  scenario.players[0].startX = 4;
  scenario.players[0].startZ = 4;
  scenario.players[1].startX = 42;
  scenario.players[1].startZ = 34;
  scenario.structures = [
    { defId: 'commandPost', owner: 0, x: 2, z: 2 },
    { defId: 'commandPost', owner: 1, x: 42, z: 34 },
    ...structures,
  ];
  scenario.units = units;
  return scenario;
}

function game(structures: Structure[] = [], units: Unit[] = []) {
  return new Game(arena(structures, units), { enableAI: false });
}

function at(game: Game, defId: string, owner?: number) {
  return game.state.entities.find(
    (e) => e.defId === defId && (owner === undefined || e.owner === owner),
  )!;
}

function engineer(game: Game): ReturnType<typeof at> {
  return game.entitiesOf(0, 'unit').find((e) => e.defId === 'engineer')!;
}

function tier(game: Game, defId: string) {
  const e = at(game, defId);
  return e;
}

describe('strategic infrastructure capture', () => {
  it('captures a neutral supply depot with an engineer and starts its income', () => {
    const g = game([{ defId: 'supplyDepot', owner: -1, x: 16, z: 8 }], [
      { defId: 'engineer', owner: 0, x: 12, z: 8 },
    ]);
    const depot = tier(g, 'supplyDepot');
    const eng = engineer(g);
    expect(depot.owner).toBe(-1);
    // A bare Command Post is not an economy. No materials plant stands, so the
    // headquarters pays nothing and the depot is the side's first income.
    expect(g.passiveMatsRate(0)).toBe(0);

    // Put the engineer inside capture range: the order is still the public
    // capture command, not a direct ownership write.
    eng.x = depot.x - 3 * TILE_SIZE;
    eng.z = depot.z;
    g.enqueueCommand({ type: 'capture', team: 0, ids: [eng.id], targetId: depot.id });
    g.advance(20 * 6);

    expect(depot.owner).toBe(0);
    expect(g.passiveMatsRate(0)).toBe(2);
    const p = g.player(0)!;
    p.mats = 0;
    p.stats.matsGathered = 0;
    g.advance(20 * 10);
    expect(p.mats).toBeCloseTo(20, 4);

    // The HUD rate is a per-minute figure over the rolling 30-second window.
    g.advance(20 * 30);
    expect(g.matsPerMinute(0)).toBe(120);
  });

  it('does not pay a neutral or enemy-owned depot', () => {
    const g = game([{ defId: 'supplyDepot', owner: -1, x: 16, z: 8 }]);
    const depot = tier(g, 'supplyDepot');
    g.advance(20 * 5);
    expect(g.passiveMatsRate(0)).toBe(0);
    expect(g.passiveMatsRate(1)).toBe(0);

    depot.owner = 1;
    g.advance(20 * 5);
    expect(g.passiveMatsRate(0)).toBe(0);
    expect(g.passiveMatsRate(1)).toBe(2);
    expect(g.player(0)!.mats).toBeCloseTo(0, 4);
    expect(g.player(1)!.mats).toBeCloseTo(10, 4);
  });

  it('stops income while a depot is a construction site or destroyed', () => {
    const g = game([{ defId: 'supplyDepot', owner: 0, x: 16, z: 8 }]);
    const depot = tier(g, 'supplyDepot');
    g.advance(20 * 3);
    expect(g.passiveMatsRate(0)).toBe(2);

    depot.construction = true;
    depot.buildProgress = 0.5;
    const before = g.player(0)!.mats;
    g.advance(20 * 4);
    expect(g.passiveMatsRate(0)).toBe(0);
    // The site pays nothing, and with no materials plant yet the headquarters
    // trickle is not running either: the bank is exactly where it was.
    expect(g.player(0)!.mats).toBeCloseTo(before, 4);

    depot.construction = false;
    depot.buildProgress = 1;
    g.advance(20 * 2);
    expect(g.passiveMatsRate(0)).toBe(2);
    expect(g.player(0)!.mats).toBeGreaterThan(before + 3);

    depot.hp = 0;
    g.advance(2);
    expect(g.passiveMatsRate(0)).toBe(0);
    expect(g.getEntity(depot.id)).toBeUndefined();
  });

  it('adds multiple depots independently and never double-counts an ownership change', () => {
    const g = game([
      { defId: 'supplyDepot', owner: 0, x: 16, z: 8 },
      { defId: 'supplyDepot', owner: 0, x: 22, z: 8 },
    ]);
    const [a, b] = g.entitiesOf(0, 'building').filter((e) => e.defId === 'supplyDepot');
    expect(g.passiveMatsRate(0)).toBe(4);
    const p = g.player(0)!;
    p.mats = 0;
    g.advance(20 * 5);
    expect(p.mats).toBeCloseTo(20, 4);

    // Losing one depot must remove exactly its own contribution. The other
    // keeps paying without a duplicate tick from the old source.
    a.owner = 1;
    expect(g.passiveMatsRate(0)).toBe(2);
    // The enemy's own captured depot, nothing else.
    expect(g.passiveMatsRate(1)).toBe(2);
    const mine = p.mats;
    const enemy = g.player(1)!.mats;
    g.advance(20 * 5);
    expect(p.mats).toBeCloseTo(mine + 10, 4);
    expect(g.player(1)!.mats).toBeCloseTo(enemy + 10, 4);
    expect(b.owner).toBe(0);
  });

  it('restores a damaged depot by ordinary engineer repair without interrupting its benefit', () => {
    const g = game([{ defId: 'supplyDepot', owner: 0, x: 16, z: 8 }], [
      { defId: 'engineer', owner: 0, x: 14, z: 8 },
    ]);
    const depot = tier(g, 'supplyDepot');
    const eng = engineer(g);
    depot.hp = depot.maxHp * 0.3;
    eng.x = depot.x - 2 * TILE_SIZE;
    eng.z = depot.z;
    expect(g.passiveMatsRate(0)).toBe(2);
    g.enqueueCommand({ type: 'repair', team: 0, ids: [eng.id], targetId: depot.id });
    g.advance(20 * 5);
    expect(depot.hp).toBeGreaterThan(depot.maxHp * 0.3);
    expect(g.passiveMatsRate(0)).toBe(2);
  });

  it('keeps depot state and income through save/load', () => {
    const g = game([{ defId: 'supplyDepot', owner: 0, x: 16, z: 8 }]);
    g.advance(20 * 4);
    const saved = JSON.parse(JSON.stringify(g.toSave()));
    const restored = Game.fromSave(saved, { enableAI: false });
    const restoredDepot = restored.state.entities.find((e) => e.defId === 'supplyDepot')!;
    expect(restoredDepot.owner).toBe(0);
    expect(restored.passiveMatsRate(0)).toBe(2);
    g.advance(20 * 10);
    restored.advance(20 * 10);
    expect(restored.player(0)!.mats).toBeCloseTo(g.player(0)!.mats, 6);
  });

  it('produces identical income in two identical runs', () => {
    const a = game([{ defId: 'supplyDepot', owner: 0, x: 16, z: 8 }]);
    const b = game([{ defId: 'supplyDepot', owner: 0, x: 16, z: 8 }]);
    a.advance(20 * 7);
    b.advance(20 * 7);
    expect(a.player(0)!.mats).toBeCloseTo(b.player(0)!.mats, 9);
    expect(a.player(0)!.stats.matsGathered).toBeCloseTo(b.player(0)!.stats.matsGathered, 9);
  });

  it('clamps passive storage at the resource cap', () => {
    const g = game([{ defId: 'supplyDepot', owner: 0, x: 16, z: 8 }]);
    g.player(0)!.mats = 99998;
    g.advance(20 * 10);
    expect(g.player(0)!.mats).toBe(99999);
  });

  it('pays the headquarters trickle only once a materials plant stands', () => {
    // A match opens with a Command Post and nothing else. Paying a trickle there
    // is an opening subsidy, so the bare headquarters pays nothing at all.
    const opening = game();
    opening.advance(20 * 10);
    expect(opening.passiveMatsRate(0)).toBe(0);
    expect(opening.player(0)!.mats).toBeCloseTo(0, 3);

    // A base that has lost its whole hauling economy keeps its lifeline: with a
    // refinery standing but no hauler and no production line, the headquarters
    // pays the stripped rate instead of leaving the side at zero forever.
    const g = game([{ defId: 'refinery', owner: 0, x: 8, z: 8 }]);
    g.advance(20 * 10);
    expect(g.passiveMatsRate(0)).toBe(4);
    expect(g.player(0)!.mats).toBeCloseTo(40, 3);

    // A plant still going up already counts as committing to the economy.
    const site = game([{ defId: 'refinery', owner: 0, x: 8, z: 8 }]);
    const plant = at(site, 'refinery', 0);
    plant.construction = true;
    plant.buildProgress = 0.4;
    expect(site.passiveMatsRate(0)).toBe(4);

    // The lifeline is for a base with no hauling left: a hauler working a
    // drop-off replaces it.
    const hauling = game(
      [{ defId: 'refinery', owner: 0, x: 8, z: 8 }],
      [{ defId: 'harvester', owner: 0, x: 8, z: 8 }],
    );
    expect(hauling.passiveMatsRate(0)).toBe(0);

    // A hauler with no plant at all is not an economy yet: nothing stands to
    // bank against, so the headquarters still pays nothing.
    const stranded = game([], [{ defId: 'harvester', owner: 0, x: 8, z: 8 }]);
    expect(stranded.passiveMatsRate(0)).toBe(0);

    // A half-built headquarters pays nothing; only a standing one trickles.
    const hq = at(g, 'commandPost', 0);
    hq.construction = true;
    hq.buildProgress = 0.5;
    const banked = g.player(0)!.mats;
    g.advance(20 * 5);
    expect(g.passiveMatsRate(0)).toBe(0);
    expect(g.player(0)!.mats).toBeCloseTo(banked, 4);

    // Lose it and the trickle goes with it.
    hq.construction = false;
    hq.hp = 0;
    g.advance(2);
    expect(g.passiveMatsRate(0)).toBe(0);
  });

  it('stacks captured depot income on the headquarters trickle without an opening subsidy', () => {
    // A captured depot is income in its own right, so it pays beside the
    // headquarters trickle rather than replacing it — but only once the
    // trickle's own condition holds. A depot on a bare headquarters is the
    // side's whole economy, never a top-up on an opening allowance.
    const depotOnly = game([{ defId: 'supplyDepot', owner: 0, x: 16, z: 8 }]);
    expect(depotOnly.passiveMatsRate(0)).toBe(2);

    // With a refinery standing but no hauler left, the headquarters pays its
    // stripped lifeline (4/s) and the depot keeps its own 2/s on top.
    const ruined = game([
      { defId: 'supplyDepot', owner: 0, x: 16, z: 8 },
      { defId: 'refinery', owner: 0, x: 8, z: 8 },
    ]);
    expect(ruined.passiveMatsRate(0)).toBe(6);
    const banked = ruined.player(0)!.mats;
    ruined.advance(20 * 5);
    expect(ruined.player(0)!.mats).toBeCloseTo(banked + 30, 4);

    // Losing the plant drops the side back to the depot alone: the trickle and
    // the depot are separate sources, and the gate closes with the plant.
    const plant = at(ruined, 'refinery', 0);
    plant.hp = 0;
    ruined.advance(2);
    expect(ruined.passiveMatsRate(0)).toBe(2);
  });
});

describe('radar station reconnaissance', () => {
  it('reveals a distant hostile unit only while captured and powered', () => {
    const g = game(
      [{ defId: 'radarStation', owner: -1, x: 16, z: 16 }],
      [{ defId: 'rifle', owner: 1, x: 30, z: 16 }],
    );
    const station = tier(g, 'radarStation');
    const target = g.state.entities.find((e) => e.owner === 1 && e.kind === 'unit')!;
    g.advance(20);
    expect(g.radarNetwork(0).stations).toBe(0);
    expect(g.visibleEnemies(0).some((e) => e.id === target.id)).toBe(false);

    station.owner = 0;
    g.advance(20);
    expect(g.radarNetwork(0)).toMatchObject({ stations: 1, online: 1, radius: 22 });
    expect(g.radarNetwork(0).contacts).toBeGreaterThanOrEqual(1);
    expect(g.visibleEnemies(0).some((e) => e.id === target.id)).toBe(true);

    // A broken grid blanks the feed even if the station survives.
    for (let i = 0; i < 6; i++) {
      g.state.entities.push({
        ...g.state.entities[0],
        id: 10000 + i,
        defId: 'factory',
        kind: 'building',
        owner: 0,
        x: (4 + i * 4) * TILE_SIZE,
        z: 26 * TILE_SIZE,
        hp: 1200,
        maxHp: 1200,
        construction: false,
        queue: [],
      });
    }
    expect(g.powerStatus(0).brownout).toBe(true);
    g.advance(20);
    expect(g.radarNetwork(0).online).toBe(0);
    expect(g.visibleEnemies(0).some((e) => e.id === target.id)).toBe(false);

    // Restore the grid and the station comes back without a fresh capture.
    g.state.entities = g.state.entities.filter((e) => e.id < 10000);
    g.advance(20);
    expect(g.radarNetwork(0).online).toBe(1);
    expect(g.visibleEnemies(0).some((e) => e.id === target.id)).toBe(true);

    station.hp = 0;
    g.advance(2);
    expect(g.radarNetwork(0).stations).toBe(0);
    expect(g.getEntity(station.id)).toBeUndefined();
  });
});

describe('capture-only objectives are not targets', () => {
  it('rejects an attack order against a forward supply depot and leaves it intact', () => {
    const g = game([{ defId: 'supplyDepot', owner: -1, x: 16, z: 8 }], [
      { defId: 'tank', owner: 0, x: 12, z: 8 },
    ]);
    const depot = tier(g, 'supplyDepot');
    const tank = g.entitiesOf(0, 'unit').find((e) => e.defId === 'tank')!;
    g.enqueueCommand({ type: 'attack', team: 0, ids: [tank.id], targetId: depot.id });
    g.advance(20 * 6);

    expect(BUILDINGS.supplyDepot.indestructible).toBe(true);
    expect(depot.hp).toBe(depot.maxHp);
    expect(tank.targetId).not.toBe(depot.id);
    expect(
      g.state.events.some(
        (e) => e.type === 'orderFailed' && /cannot be destroyed/.test(e.text),
      ),
    ).toBe(true);
  });

  it('never auto-engages a hostile depot sitting next to a tank', () => {
    const g = game([{ defId: 'supplyDepot', owner: 1, x: 16, z: 8 }], [
      { defId: 'tank', owner: 0, x: 12, z: 8 },
    ]);
    const depot = tier(g, 'supplyDepot');
    const tank = g.entitiesOf(0, 'unit').find((e) => e.defId === 'tank')!;
    tank.order = null;
    g.advance(20 * 8);

    expect(depot.hp).toBe(depot.maxHp);
    expect(tank.targetId).not.toBe(depot.id);
  });

  it('reads the same capture meter as a relay while an engineer works the depot', () => {
    const g = game([{ defId: 'supplyDepot', owner: -1, x: 16, z: 8 }], [
      { defId: 'engineer', owner: 0, x: 12, z: 8 },
    ]);
    const depot = tier(g, 'supplyDepot');
    const eng = engineer(g);
    expect(objectiveMeterState(g, depot).caption).toBe('NEUTRAL · UNCLAIMED');

    eng.captureTargetId = depot.id;
    eng.captureProgress = 0.35;
    const meter = objectiveMeterState(g, depot);
    expect(meter.progress).toBeCloseTo(0.35, 6);
    expect(meter.capturer).toBe(0);
    expect(meter.caption).toBe('NEUTRAL · 35% CAPTURED');
  });
});

describe('crossings and capture approach', () => {
  it('does not level a bridge without a deliberate order', () => {
    const g = game(
      [{ defId: 'bridge', owner: 1, x: 20, z: 14 }],
      [{ defId: 'tank', owner: 0, x: 14, z: 16 }],
    );
    const bridge = at(g, 'bridge');
    const tank = g.entitiesOf(0, 'unit').find((e) => e.defId === 'tank')!;
    tank.order = null;
    g.advance(20 * 10);

    // Crossing infrastructure is not a target of opportunity: the crew would
    // rather hold fire than drop the span it may have to drive across.
    expect(BUILDINGS.bridge.walkable).toBe(true);
    expect(bridge.hp).toBe(bridge.maxHp);
    expect(tank.targetId).not.toBe(bridge.id);

    // An explicit order still brings it down.
    g.enqueueCommand({ type: 'attack', team: 0, ids: [tank.id], targetId: bridge.id });
    g.advance(20 * 40);
    expect(bridge.hp).toBeLessThan(bridge.maxHp);
  });

  it('re-approaches a capture target when its path empties on the way', () => {
    const g = game([{ defId: 'relay', owner: -1, x: 30, z: 20 }], [
      { defId: 'engineer', owner: 0, x: 8, z: 20 },
    ]);
    const relay = at(g, 'relay');
    const eng = engineer(g);
    g.enqueueCommand({ type: 'capture', team: 0, ids: [eng.id], targetId: relay.id });
    g.advance(20 * 2);
    expect(eng.path.length).toBeGreaterThan(0);

    // Separation, a closed crossing or a reroute can empty the queue well short
    // of the objective; the engineer has to plan the rest of the way instead of
    // standing there while the relay is never taken.
    eng.path = [];
    g.advance(20 * 60);
    expect(relay.owner).toBe(0);
  });
});

describe('scenario authoring and editor data', () => {
  it('offers every objective and shelter in the palette but not as player-buildable structures', () => {
    for (const id of ['relay', 'supplyDepot', 'radarStation', 'tenement', 'ruin']) {
      expect(BUILDINGS[id], id).toBeTruthy();
      expect(BUILDINGS[id].authoredOnly, id).toBe(true);
      expect(BUILDABLE_BY_PLAYER.some((b) => b.id === id), id).toBe(false);
    }
    expect(BUILDINGS.supplyDepot.matsPerSec).toBe(2);
    expect(BUILDINGS.radarStation.scanRadius).toBe(22);
    expect(BUILDINGS.tenement.garrison).toEqual({
      capacity: 4,
      protection: 0.55,
      exposure: 0.45,
      firingSlots: 2,
    });
  });

  it('round-trips authored objectives and shelters through the scenario format', () => {
    const scenario = arena(
      [
        { defId: 'supplyDepot', owner: -1, x: 16, z: 8 },
        { defId: 'radarStation', owner: -1, x: 20, z: 16 },
        { defId: 'tenement', owner: -1, x: 28, z: 16 },
      ],
      [],
    );
    const parsed = parseScenario(JSON.parse(scenarioToJson(scenario)));
    expect(parsed.structures).toEqual(scenario.structures);
    expect(validateScenario(parsed).filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('rejects a colliding shelter footprint through the shared placement check', () => {
    const scenario = arena([{ defId: 'tenement', owner: -1, x: 24, z: 12 }]);
    // The editor supplies the occupancy grid it built from the authored scene.
    const occupied = new Uint8Array(scenario.width * scenario.height);
    for (let z = 12; z < 16; z++) {
      for (let x = 24; x < 28; x++) {
        occupied[tileIndex(scenario.width, x, z)] = 1;
      }
    }
    const blocked = checkPlacement(scenario, 'tenement', 25, 13, occupied);
    expect(blocked.ok).toBe(false);
    expect(blocked.code).toBe('occupied');
    const clear = checkPlacement(scenario, 'tenement', 32, 12, occupied);
    expect(clear.ok, clear.reason).toBe(true);
  });

  it('warns when a shelter footprint covers a route', () => {
    const scenario = arena([{ defId: 'tenement', owner: -1, x: 24, z: 12 }]);
    scenario.tiles[tileIndex(scenario.width, 25, 14)] = { t: Terrain.Road, e: 1, o: 0 };
    expect(validateScenario(scenario).some((i) => i.code === 'garrison-blocks-road')).toBe(true);
  });

  it('warns when a shelter has no reachable infantry entrance', () => {
    const scenario = arena([{ defId: 'tenement', owner: -1, x: 24, z: 12 }]);
    // Wall the building in with deep water while leaving the footprint dry.
    for (let z = 8; z <= 18; z++) {
      for (let x = 20; x <= 30; x++) {
        if (!inBounds(scenario.width, scenario.height, x, z)) continue;
        const inside = x >= 24 && x < 28 && z >= 12 && z < 16;
        if (inside) continue;
        scenario.tiles[tileIndex(scenario.width, x, z)] = { t: Terrain.DeepWater, e: 0, o: 0 };
      }
    }
    expect(validateScenario(scenario).some((i) => i.code === 'garrison-inaccessible')).toBe(true);
  });

  it('ships Kestrel Island with the central depot and the two authored shelters', () => {
    const scenario = createIslandAssault();
    expect(scenario.structures).toContainEqual({ defId: 'supplyDepot', owner: -1, x: 44, z: 32 });
    expect(scenario.structures).toContainEqual({ defId: 'tenement', owner: -1, x: 39, z: 29 });
    expect(scenario.structures).toContainEqual({ defId: 'ruin', owner: -1, x: 62, z: 33 });
    expect(validateScenario(scenario).filter((i) => i.severity === 'error')).toEqual([]);
  });
});

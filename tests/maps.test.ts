import { describe, expect, it } from 'vitest';
import { SCENARIOS } from '../src/data/scenarioCatalog';
import { BUILDINGS } from '../src/data/buildings';
import { canLaunch, reachableFrom, validateScenario, type Scenario } from '../src/sim/scenario';
import { TERRAIN, Terrain, tileIndex } from '../src/sim/terrain';
import { Game } from '../src/sim/game';

/**
 * The three legacy theatres are mirror-symmetric: every tile, deposit, objective
 * and starting unit has an identical twin across the vertical centre line, so
 * neither commander is dealt better ground. The competitive roster is four-way
 * symmetric instead and is verified in `map-roster.test.ts`, so this file names
 * its three maps explicitly rather than filtering "everything but the island".
 */
const LEGACY_IDS = ['rust-valley', 'kestrel-straits', 'foundry-district'] as const;
const MAPS = SCENARIOS.filter((s) => (LEGACY_IDS as readonly string[]).includes(s.id));

const mirrorX = (scenario: Scenario, x: number): number => scenario.width - 1 - x;
const mirrorOrigin = (scenario: Scenario, x: number, width: number): number =>
  scenario.width - (x + width);

function mirrorIssues(scenario: Scenario): string[] {
  const issues: string[] = [];
  for (let z = 0; z < scenario.height; z++) {
    for (let x = 0; x < scenario.width; x++) {
      const a = scenario.tiles[tileIndex(scenario.width, x, z)];
      const b = scenario.tiles[tileIndex(scenario.width, mirrorX(scenario, x), z)];
      if (a.t !== b.t || a.e !== b.e || a.o !== b.o) {
        issues.push(`tile ${x},${z} differs from its mirror`);
        if (issues.length > 6) return issues;
      }
    }
  }
  for (const s of scenario.structures) {
    const w = BUILDINGS[s.defId]?.footprint.w ?? 1;
    const counterpart = scenario.structures.find(
      (o) =>
        o.defId === s.defId &&
        o.z === s.z &&
        o.x === mirrorOrigin(scenario, s.x, w) &&
        (s.owner === -1 ? o.owner === -1 : o.owner === 1 - s.owner),
    );
    if (!counterpart) issues.push(`structure ${s.defId}@${s.x},${s.z} has no mirror twin`);
  }
  for (const u of scenario.units) {
    const counterpart = scenario.units.find(
      (o) => o.defId === u.defId && o.z === u.z && o.x === mirrorX(scenario, u.x) && o.owner === 1 - u.owner,
    );
    if (!counterpart) issues.push(`unit ${u.defId}@${u.x},${u.z} has no mirror twin`);
  }
  const [blue, red] = scenario.players;
  if (blue.startX !== mirrorX(scenario, red.startX) || blue.startZ !== red.startZ) {
    issues.push('starts are not mirrored');
  }
  return issues;
}

describe.each(MAPS.map((entry) => [entry.name, entry] as const))('%s', (_name, entry) => {
  const scenario = entry.create();

  it('is perfectly mirrored for both commanders', () => {
    expect(scenario.width).toBeGreaterThanOrEqual(64);
    expect(scenario.width % 2).toBe(0);
    expect(mirrorIssues(scenario)).toEqual([]);
  });

  it('passes validation and can launch', () => {
    const errors = validateScenario(scenario).filter((i) => i.severity === 'error');
    if (errors.length) console.log(entry.id, errors);
    expect(errors).toEqual([]);
    expect(canLaunch(scenario)).toBe(true);
  });

  it('fields a mirrored landing force and a Command Post each', () => {
    for (const owner of [0, 1]) {
      expect(scenario.structures.some((s) => s.owner === owner && s.defId === 'commandPost')).toBe(true);
      const units = scenario.units.filter((u) => u.owner === owner);
      expect(units.length).toBe(8);
      expect(units.filter((u) => u.defId === 'engineer').length).toBe(1);
      expect(units.filter((u) => u.defId === 'tank').length).toBe(2);
    }
  });

  it('gives both sides ore within harvester reach of their Command Post', () => {
    for (const owner of [0, 1]) {
      const post = scenario.structures.find((s) => s.owner === owner && s.defId === 'commandPost')!;
      const reach = reachableFrom(scenario, [{ x: post.x, z: post.z }], 'tracked');
      let deposits = 0;
      for (let z = 0; z < scenario.height; z++) {
        for (let x = 0; x < scenario.width; x++) {
          const tile = scenario.tiles[tileIndex(scenario.width, x, z)];
          if (tile.o > 0 && reach[tileIndex(scenario.width, x, z)]) deposits++;
        }
      }
      expect(deposits, `owner ${owner}`).toBeGreaterThan(12);
    }
  });

  it('keeps the two starts far apart and connected by ground', () => {
    const [blue, red] = scenario.players;
    expect(Math.hypot(blue.startX - red.startX, blue.startZ - red.startZ)).toBeGreaterThan(25);
    const reach = reachableFrom(scenario, [{ x: blue.startX, z: blue.startZ }], 'tracked');
    expect(reach[tileIndex(scenario.width, red.startX, red.startZ)]).toBe(1);
  });

  it('runs a live simulation on the map without errors', () => {
    const game = new Game(entry.create(), { enableAI: true, aiSeed: 4242 });
    for (let i = 0; i < 120; i++) game.tick();
    expect(game.state.tick).toBe(120);
    expect(game.state.entities.length).toBeGreaterThan(10);
    expect(game.state.players[0].mats).toBeGreaterThanOrEqual(0);
    expect(game.state.victory).toBe('playing');
  });

  it('leaves level foundations at both bases', () => {
    for (const owner of [0, 1]) {
      const post = scenario.structures.find((s) => s.owner === owner && s.defId === 'commandPost')!;
      for (let dz = 0; dz < 4; dz++) {
        for (let dx = 0; dx < 4; dx++) {
          const tile = scenario.tiles[tileIndex(scenario.width, post.x + dx, post.z + dz)];
          expect(tile.t, `${post.x + dx},${post.z + dz}`).not.toBe(Terrain.DeepWater);
          expect(tile.t).not.toBe(Terrain.ShallowWater);
          expect(tile.t).not.toBe(Terrain.Forest);
          expect(tile.t).not.toBe(Terrain.Rock);
        }
      }
    }
  });
});

describe('theatre variety', () => {
  it('gives each new map its own footprint', () => {
    const sizes = new Set(MAPS.map((m) => `${m.create().width}x${m.create().height}`));
    expect(sizes.size).toBe(MAPS.length);
  });

  it('builds the urban map out of streets and garrisonable blocks', () => {
    const scenario = SCENARIOS.find((s) => s.id === 'foundry-district')!.create();
    let road = 0;
    let urban = 0;
    for (const tile of scenario.tiles) {
      if (tile.t === Terrain.Road) road++;
      if (tile.t === Terrain.Urban) urban++;
    }
    const land = scenario.width * scenario.height - 4 * scenario.width - 4 * scenario.height;
    expect(road / land).toBeGreaterThan(0.12);
    expect(urban).toBeGreaterThan(road);

    const shelters = scenario.structures.filter((s) => (BUILDINGS[s.defId]?.garrison?.capacity ?? 0) > 0);
    const kinds = new Set(shelters.map((s) => s.defId));
    expect(shelters.length).toBeGreaterThanOrEqual(24);
    // Not the same two shelters everywhere: the city uses the full set.
    expect(kinds.has('warehouse')).toBe(true);
    expect(kinds.has('officeBlock')).toBe(true);
    expect(kinds.size).toBeGreaterThanOrEqual(4);

    // The civic strongpoints introduced for authored maps are part of the
    // city's normal garrison roster, mirrored once for each side.
    for (const id of ['fireStation', 'clinic', 'marketHall']) {
      expect(scenario.structures.filter((s) => s.defId === id).length, id).toBe(2);
    }
  });

  it('puts a mirrored landmark pair in the central square', () => {
    const scenario = SCENARIOS.find((s) => s.id === 'foundry-district')!.create();
    for (const id of ['civicHall', 'foundryWorks']) {
      const def = BUILDINGS[id];
      const placed = scenario.structures.filter((s) => s.defId === id);
      expect(placed.length, id).toBe(2);
      expect(def.garrison?.capacity ?? 0, id).toBeGreaterThanOrEqual(5);
      for (const s of placed) {
        const centre = s.x + def.footprint.w / 2;
        expect(Math.abs(centre - scenario.width / 2), `${id}@${s.x}`).toBeLessThan(8);
        for (let dz = 0; dz < def.footprint.h; dz++) {
          for (let dx = 0; dx < def.footprint.w; dx++) {
            const tile = scenario.tiles[tileIndex(scenario.width, s.x + dx, s.z + dz)];
            expect(tile.t, `${id}@${s.x + dx},${s.z + dz}`).toBe(Terrain.Grass);
          }
        }
      }
    }
  });

  it('leaves each side a clear yard to build in, outside the city core', () => {
    const scenario = SCENARIOS.find((s) => s.id === 'foundry-district')!.create();
    const occupied = new Set<string>();
    for (const s of scenario.structures) {
      const def = BUILDINGS[s.defId];
      for (let dz = 0; dz < def.footprint.h; dz++) {
        for (let dx = 0; dx < def.footprint.w; dx++) occupied.add(`${s.x + dx},${s.z + dz}`);
      }
    }
    for (const owner of [0, 1]) {
      const post = scenario.structures.find((s) => s.owner === owner && s.defId === 'commandPost')!;
      // The yard between the map edge and the ring road, mirrored for owner 1.
      const x0 = owner === 0 ? 2 : scenario.width - 21;
      let free = 0;
      for (let z = 2; z < scenario.height - 2; z++) {
        for (let x = x0; x < x0 + 19; x++) {
          const tile = scenario.tiles[tileIndex(scenario.width, x, z)];
          if (!TERRAIN[tile.t as keyof typeof TERRAIN].buildable) continue;
          if (occupied.has(`${x},${z}`)) continue;
          free++;
        }
      }
      expect(free, `owner ${owner} yard`).toBeGreaterThanOrEqual(400);
      expect(post.x).toBeGreaterThanOrEqual(x0 - 4);
      expect(post.x).toBeLessThan(x0 + 19);
    }
    // The outskirts are open ground and the middle is the city.
    for (const [x, z] of [[6, 20], [6, 50], [scenario.width - 7, 20]]) {
      expect(scenario.tiles[tileIndex(scenario.width, x, z)].t, `${x},${z}`).not.toBe(Terrain.Urban);
    }
    for (const [x, z] of [[30, 20], [38, 50], [scenario.width - 31, 20]]) {
      expect(scenario.tiles[tileIndex(scenario.width, x, z)].t, `${x},${z}`).toBe(Terrain.Urban);
    }
  });
});

describe('naval theatre', () => {
  it('gives both coasts a navigable strait for shipyards and corvettes', () => {
    const entry = SCENARIOS.find((s) => s.id === 'kestrel-straits')!;
    const scenario = entry.create();
    const water: Array<{ x: number; z: number }> = [];
    for (let z = 0; z < scenario.height; z++) {
      for (let x = 0; x < scenario.width; x++) {
        const t = scenario.tiles[tileIndex(scenario.width, x, z)].t;
        if (t === Terrain.DeepWater) water.push({ x, z });
      }
    }
    expect(water.length).toBeGreaterThan(400);
    const reach = reachableFrom(scenario, [water[0]], 'naval');
    let reachableWater = 0;
    for (const v of reach) if (v) reachableWater++;
    // The strait has to join both shores: a fragmented sea cannot be fought over.
    expect(reachableWater).toBeGreaterThan(water.length * 0.9);
    // A corvette leaving one coast can reach the opposite shelf.
    const farSide = water.find((p) => p.x > scenario.width / 2)!;
    expect(reach[tileIndex(scenario.width, farSide.x, farSide.z)]).toBe(1);
  });

  it('leaves the armour and urban theatres without a navigable navy', () => {
    for (const id of ['rust-valley', 'foundry-district']) {
      const scenario = SCENARIOS.find((s) => s.id === id)!.create();
      let deep = 0;
      for (const tile of scenario.tiles) if (tile.t === Terrain.DeepWater) deep++;
      expect(deep, id).toBe(0);
    }
  });
});

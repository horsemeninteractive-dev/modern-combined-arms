import { describe, expect, it } from 'vitest';
import { createIslandAssault } from '../src/data/scenarios';
import { canLaunch, reachableFrom, validateScenario } from '../src/sim/scenario';
import { TERRAIN, Terrain, inBounds, tileIndex, type TerrainId } from '../src/sim/terrain';

function census() {
  const scenario = createIslandAssault();
  const out = new Map<string, number>();
  for (const tile of scenario.tiles) {
    const name = TERRAIN[tile.t as TerrainId].name;
    out.set(name, (out.get(name) ?? 0) + 1);
  }
  return { scenario, out };
}

describe('Kestrel Bay ground composition', () => {
  it('keeps the authored inland cover instead of turning every land tile to sand', () => {
    const { out } = census();
    expect(out.get('Open ground')).toBe(2103);
    expect(out.get('Beach')).toBe(264);
    expect(out.get('Forest')).toBe(475);
    expect(out.get('Ridge')).toBe(247);
    // The old classifier produced 2728 beach tiles and no open ground at all.
    expect(out.get('Beach')!).toBeLessThan(out.get('Open ground')!);
  });

  it('keeps the buildable area and ore layout intact', () => {
    const { scenario } = census();
    let buildable = 0;
    let oreTiles = 0;
    let oreTotal = 0;
    for (const tile of scenario.tiles) {
      const props = TERRAIN[tile.t as TerrainId];
      if (!props.water && props.buildable) buildable++;
      if (tile.o > 0) {
        oreTiles++;
        oreTotal += tile.o;
      }
    }
    expect(buildable).toBe(2625);
    expect(oreTiles).toBe(127);
    expect(oreTotal).toBe(38940);
  });

  it('places beach only where land meets water', () => {
    const { scenario } = census();
    const isWater = (x: number, z: number): boolean => {
      if (!inBounds(scenario.width, scenario.height, x, z)) return false;
      return TERRAIN[scenario.tiles[tileIndex(scenario.width, x, z)].t as TerrainId].water;
    };
    let sand = 0;
    for (let z = 0; z < scenario.height; z++) {
      for (let x = 0; x < scenario.width; x++) {
        const tile = scenario.tiles[tileIndex(scenario.width, x, z)];
        if (tile.t !== Terrain.Sand) continue;
        sand++;
        let touchesWater = false;
        for (let dz = -1; dz <= 1 && !touchesWater; dz++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dz === 0) continue;
            if (isWater(x + dx, z + dz)) {
              touchesWater = true;
              break;
            }
          }
        }
        expect(touchesWater, `beach at ${x},${z}`).toBe(true);
      }
    }
    expect(sand).toBe(264);
  });

  it('restores the northern forest belt and its flanking route', () => {
    const { scenario } = census();
    let northernForest = 0;
    for (let z = 8; z <= 20; z++) {
      for (let x = 27; x <= 59; x++) {
        if (scenario.tiles[tileIndex(scenario.width, x, z)].t === Terrain.Forest) {
          northernForest++;
        }
      }
    }
    // The buggy map had no forest in this belt: only the two later screens held trees.
    expect(northernForest).toBeGreaterThan(100);
  });

  it('still validates, launches and connects the opposing starts by ground', () => {
    const { scenario } = census();
    expect(validateScenario(scenario).filter((i) => i.severity === 'error')).toEqual([]);
    expect(canLaunch(scenario)).toBe(true);

    const [blue, red] = scenario.players;
    const reach = reachableFrom(scenario, [{ x: blue.startX, z: blue.startZ }], 'tracked');
    expect(reach[tileIndex(scenario.width, red.startX, red.startZ)]).toBe(1);

    // The ridge remains a wall except for the authored pass and northern flank.
    expect(reach[tileIndex(scenario.width, 53, 30)]).toBe(0);
  });

  it('is deterministic', () => {
    const a = createIslandAssault();
    const b = createIslandAssault();
    expect(b.tiles).toEqual(a.tiles);
    expect(b.structures).toEqual(a.structures);
    expect(b.units).toEqual(a.units);
  });
});

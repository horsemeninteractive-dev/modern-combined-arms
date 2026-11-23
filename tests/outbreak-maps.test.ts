import { describe, expect, it } from 'vitest';
import { BUILDINGS } from '../src/data/buildings';
import { tileIndex } from '../src/sim/terrain';
import { Terrain } from '../src/sim/terrain';
import { validateScenario } from '../src/sim/scenario';
import {
  DEFAULT_OUTBREAK_MAP_ID,
  OUTBREAK_MAPS,
  isOutbreakMapId,
  outbreakMap,
} from '../src/outbreak/scenario';
import { createOutbreakScenario } from '../src/outbreak/scenario';
import { OUTBREAK_BOARD_MAPS } from '../src/accounts/outbreakBoard';

const SETUP = { difficulty: 'normal' as const, mode: 'solo' as const, nationId: 'lithuania' };

function built(mapId: string) {
  return createOutbreakScenario({ ...SETUP, mapId });
}

describe('Outbreak map catalogue', () => {
  it('offers exactly one leaderboard per theatre, in catalogue order', () => {
    // The board ids are duplicated in the account service so that Worker does
    // not import the simulation's data graph. Duplication is only safe while it
    // is asserted: a map added here without a board would otherwise be silent.
    expect(OUTBREAK_BOARD_MAPS).toEqual(OUTBREAK_MAPS.map((map) => map.id));
  });

  it('ships four theatres with unique ids, the basin first', () => {
    expect(OUTBREAK_MAPS).toHaveLength(4);
    const ids = OUTBREAK_MAPS.map((map) => map.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids[0]).toBe(DEFAULT_OUTBREAK_MAP_ID);
    for (const id of ids) {
      expect(isOutbreakMapId(id)).toBe(true);
      expect(isOutbreakMapId('outbreak-nowhere')).toBe(false);
      // An unknown id resolves to the basin rather than throwing mid-deploy.
      expect(outbreakMap('outbreak-nowhere').id).toBe(DEFAULT_OUTBREAK_MAP_ID);
    }
  });

  it('builds every map as its own scenario, named and themed by the catalogue', () => {
    for (const map of OUTBREAK_MAPS) {
      const scenario = built(map.id);
      expect(scenario.meta.id).toBe(map.id);
      expect(scenario.meta.name).toBe(map.name);
      expect(scenario.width).toBe(map.size);
      expect(scenario.height).toBe(map.size);
      expect(scenario.settings.timeOfDay).toBe(map.timeOfDay);
      expect(scenario.settings.weather).toBe(map.weather);
      expect(scenario.meta.outbreak?.entryRegions.length).toBeGreaterThan(0);
      expect(scenario.settings.victory).toBe('destroyHQ');
      expect(scenario.settings.fog).toBe(true);
    }
  });

  it('places every entry region on walkable ground inside the map', () => {
    for (const map of OUTBREAK_MAPS) {
      const scenario = built(map.id);
      for (const region of scenario.meta.outbreak!.entryRegions) {
        const x = Math.floor(region.x);
        const z = Math.floor(region.z);
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThan(map.size);
        expect(z).toBeGreaterThanOrEqual(0);
        expect(z).toBeLessThan(map.size);
        const tile = scenario.tiles[tileIndex(map.size, x, z)]!;
        expect(tile.t, `${map.id}:${region.id}`).not.toBe(Terrain.DeepWater);
        expect(tile.t, `${map.id}:${region.id}`).not.toBe(Terrain.Rock);
      }
    }
  });

  it('centres the Command Post and gives every map a first defensive pair', () => {
    for (const map of OUTBREAK_MAPS) {
      const scenario = built(map.id);
      const post = scenario.structures.find((structure) => structure.defId === 'commandPost');
      expect(post, map.id).toBeTruthy();
      const footprint = BUILDINGS.commandPost.footprint;
      expect(post!.x + footprint.w / 2).toBe(map.size / 2);
      expect(post!.z + footprint.h / 2).toBe(map.size / 2);
      expect(scenario.structures.filter((s) => s.defId === 'mgNest').length).toBeGreaterThanOrEqual(2);
      expect(scenario.units.filter((unit) => unit.owner === 0).length).toBeGreaterThanOrEqual(6);
    }
  });

  it('never overlaps two structures or drops one on a road or in water', () => {
    for (const map of OUTBREAK_MAPS) {
      const scenario = built(map.id);
      const claimed = new Map<string, string>();
      for (const structure of scenario.structures) {
        const footprint = BUILDINGS[structure.defId]?.footprint;
        expect(footprint, `${map.id}: ${structure.defId}`).toBeTruthy();
        for (let dz = 0; dz < footprint!.h; dz++) {
          for (let dx = 0; dx < footprint!.w; dx++) {
            const x = structure.x + dx;
            const z = structure.z + dz;
            const key = `${x},${z}`;
            expect(claimed.get(key), `${map.id}: ${structure.defId} overlaps ${claimed.get(key)}`).toBeUndefined();
            claimed.set(key, `${structure.defId}@${structure.x},${structure.z}`);
            const tile = scenario.tiles[tileIndex(map.size, x, z)]!;
            expect(tile.t, `${map.id}: ${structure.defId} on water`).not.toBe(Terrain.DeepWater);
            expect(tile.t, `${map.id}: ${structure.defId} on a road`).not.toBe(Terrain.Road);
          }
        }
      }
    }
  });

  it('carries validation errors from none of the maps', () => {
    for (const map of OUTBREAK_MAPS) {
      const errors = validateScenario(built(map.id)).filter((issue) => issue.severity === 'error');
      expect(errors.map((issue) => `${map.id}: ${issue.code} ${issue.message}`)).toEqual([]);
    }
  });

  it('makes the city map a clear compound ringed by garrisonable blocks', () => {
    const map = outbreakMap('outbreak-civic-square');
    expect(map.tag).toBe('City');
    const scenario = built(map.id);
    // The compound the map exists for: 28×28 of built ground with nothing the
    // map authored standing in it.
    for (const structure of scenario.structures) {
      if (structure.defId === 'commandPost' || structure.defId === 'mgNest') continue;
      const footprint = BUILDINGS[structure.defId].footprint;
      const inside =
        structure.x >= 34 &&
        structure.z >= 34 &&
        structure.x + footprint.w <= 62 &&
        structure.z + footprint.h <= 62;
      expect(inside, `${structure.defId} at ${structure.x},${structure.z} blocks the compound`).toBe(false);
    }
    const garrisonable = scenario.structures.filter((s) => BUILDINGS[s.defId]?.garrison);
    expect(garrisonable.length).toBeGreaterThanOrEqual(20);
    const capturable = scenario.structures.filter((s) => BUILDINGS[s.defId]?.capturable);
    expect(capturable.length).toBeGreaterThanOrEqual(4);
  });

  it('gives every map capturable objectives and garrisonable cover', () => {
    for (const map of OUTBREAK_MAPS) {
      const scenario = built(map.id);
      const capturable = scenario.structures.filter((s) => BUILDINGS[s.defId]?.capturable);
      const garrisonable = scenario.structures.filter((s) => BUILDINGS[s.defId]?.garrison);
      expect(capturable.length, `${map.id} capturable`).toBeGreaterThanOrEqual(2);
      expect(garrisonable.length, `${map.id} garrisonable`).toBeGreaterThanOrEqual(2);
    }
  });

  it('builds byte-identical ground for the same setup and different ground per map', () => {
    const hash = (mapId: string): string => {
      const scenario = built(mapId);
      let value = 0;
      for (const tile of scenario.tiles) value = (value * 31 + tile.t * 7 + tile.e * 13 + tile.o) >>> 0;
      value = (value * 31 + scenario.structures.length) >>> 0;
      for (const structure of scenario.structures) {
        value = (value * 31 + structure.x * 96 + structure.z + structure.defId.length) >>> 0;
      }
      return value.toString(16);
    };
    const hashes = new Map(OUTBREAK_MAPS.map((map) => [map.id, hash(map.id)]));
    expect(new Set(hashes.values()).size).toBe(OUTBREAK_MAPS.length);
    for (const map of OUTBREAK_MAPS) expect(hash(map.id)).toBe(hashes.get(map.id));
  });
});

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { BUILDINGS } from '../src/data/buildings';
import { FACTIONS, NATION_LIST } from '../src/data/factions';
import { FALLBACK_BUILDING, buildingStyle } from '../src/render/buildingMeshes';
import { MESH_VS } from '../src/render/shaders';
import {
  BUILDING_FLAG_ANCHORS,
  FLAG_NATIONS,
  allianceFlagColor,
  buildFlagRig,
  flagAnchorFor,
  flagMountFor,
  flagNationForFaction,
  flagOwnerForBuilding,
  flagTextureUrl,
  flagWindYaw,
} from '../src/render/flags';

const CLOTH_VERTICES = 12 * 6 * 4;

/** Official width-to-height ratios: 5:3, 8:5, 2:1, 3:2, 2:1, 2:1. */
const OFFICIAL_RATIO = {
  lithuania: 5 / 3,
  poland: 8 / 5,
  uk: 2,
  russia: 3 / 2,
  belarus: 2,
  hungary: 2,
} as const;

describe('flag identity', () => {
  it('maps every playable nation to itself and legacy presets to an alliance nation', () => {
    expect(FLAG_NATIONS).toHaveLength(6);
    expect(new Set(FLAG_NATIONS).size).toBe(6);
    for (const nation of NATION_LIST) {
      expect(flagNationForFaction(nation.id)).toBe(nation.id);
    }
    expect(flagNationForFaction('baltic')).toBe('lithuania');
    expect(flagNationForFaction('expeditionary')).toBe('russia');
    expect(flagNationForFaction('atlantis')).toBeUndefined();
  });

  it('uses blue for the defender nations and red for the eastern nations', () => {
    const blue = allianceFlagColor('lithuania');
    const red = allianceFlagColor('russia');
    expect(blue[2]).toBeGreaterThan(blue[0]);
    expect(red[0]).toBeGreaterThan(red[2]);
    for (const nation of ['lithuania', 'poland', 'uk']) {
      expect(allianceFlagColor(nation)).toEqual(blue);
    }
    for (const nation of ['russia', 'belarus', 'hungary']) {
      expect(allianceFlagColor(nation)).toEqual(red);
    }
    expect(allianceFlagColor('baltic')).toEqual(blue);
    expect(allianceFlagColor('expeditionary')).toEqual(red);
    expect(allianceFlagColor(undefined)).toEqual([0.45, 0.47, 0.44]);
    expect(allianceFlagColor('atlantis')).toEqual([0.45, 0.47, 0.44]);
  });

  it('gives a neutral building the flag of whoever is garrisoned inside', () => {
    expect(flagOwnerForBuilding(-1, null)).toBe(-1);
    expect(flagOwnerForBuilding(-1, 0)).toBe(0);
    expect(flagOwnerForBuilding(1, 0)).toBe(0);
    expect(flagOwnerForBuilding(1, null)).toBe(1);
  });
});

describe('real flag assets', () => {
  it('ships a real PNG at the official proportions for every launch nation', () => {
    for (const nation of FLAG_NATIONS) {
      expect(flagTextureUrl(nation)).toBe(`/flags/${nation}.png`);
      const png = readFileSync(new URL(`../public/flags/${nation}.png`, import.meta.url));
      const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
      // PNG magic, not a renamed placeholder.
      expect(view.getUint32(0), nation).toBe(0x89504e47);
      expect(view.getUint32(4), nation).toBe(0x0d0a1a0a);
      const width = view.getUint32(16);
      const height = view.getUint32(20);
      expect(width, nation).toBeGreaterThanOrEqual(640);
      expect(
        Math.abs(width / height - OFFICIAL_RATIO[nation as keyof typeof OFFICIAL_RATIO]),
        `${nation} is ${width}x${height}`,
      ).toBeLessThan(0.01);
    }
  });

  it('keeps legacy presets on the same six real flag textures', () => {
    for (const preset of Object.values(FACTIONS)) {
      const nation = flagNationForFaction(preset.id)!;
      expect(FLAG_NATIONS).toContain(nation);
    }
  });
});

describe('flag rig', () => {
  it('builds a pole, an alliance cloth and a textured national cloth', () => {
    for (const nation of FLAG_NATIONS) {
      const rig = buildFlagRig(nation);
      const vertices = rig.positions.length / 3;
      expect(rig.wind.length, nation).toBe(vertices);
      expect(rig.uv.length, nation).toBe(vertices * 2);
      expect(rig.texMask.length, nation).toBe(vertices);
      expect(Math.max(...rig.wind)).toBe(1);
      expect(Math.min(...rig.wind)).toBe(0);
      // The national cloth is the only textured part; the alliance cloth and
      // pole stay solid team/vertex colours.
      expect(rig.texMask.filter((mask) => mask === 1)).toHaveLength(CLOTH_VERTICES);
      expect(rig.texMask.filter((mask) => mask === 0).length).toBeGreaterThan(CLOTH_VERTICES);
      expect(Math.max(...rig.uv)).toBe(1);
    }
  });

  it('keeps every cloth wider than it is tall and in official order', () => {
    const width = (nation: (typeof FLAG_NATIONS)[number]): number => {
      const rig = buildFlagRig(nation);
      let max = 0;
      for (let i = 0; i < rig.positions.length; i += 3) max = Math.max(max, rig.positions[i]);
      return max;
    };
    for (const nation of FLAG_NATIONS) {
      // A horizontal flag, never a vertical banner.
      expect(width(nation), nation).toBeGreaterThan(1);
    }
    // UK, Belarus and Hungary are 1:2; Lithuania 5:3; Poland 8:5; Russia 3:2.
    expect(width('uk')).toBeGreaterThan(width('lithuania'));
    expect(width('lithuania')).toBeGreaterThan(width('poland'));
    expect(width('poland')).toBeGreaterThan(width('russia'));
    expect(width('uk')).toBeCloseTo(width('belarus'), 5);
    expect(width('uk')).toBeCloseTo(width('hungary'), 5);
  });

  it('turns the cloth toward the fixed tactical camera', () => {
    expect(flagWindYaw()).toBeCloseTo(Math.PI / 4, 5);
  });

  it('waves the cloth over time in the shared mesh shader', () => {
    expect(MESH_VS).toContain('uniform float uTime');
    expect(MESH_VS).toMatch(/p\.z \+= sin\(phase\) \* 0\.22 \* wind/);
    expect(MESH_VS).toMatch(/p\.x \+= sin\(phase \* 0\.5/);
  });

  it('mounts a flag on every registered structure, including national bunkers', () => {
    expect(Object.keys(BUILDING_FLAG_ANCHORS).sort()).toEqual(Object.keys(BUILDINGS).sort());
    for (const def of Object.values(BUILDINGS)) {
      const body = buildingStyle(def.id)?.body ?? FALLBACK_BUILDING;
      const anchor = flagAnchorFor(def.id)!;
      const mount = flagMountFor(def.footprint, body, def.id);
      expect(Number.isFinite(mount.x), def.id).toBe(true);
      expect(Number.isFinite(mount.y), def.id).toBe(true);
      expect(Number.isFinite(mount.z), def.id).toBe(true);
      expect(mount.x, def.id).toBe(anchor.x);
      expect(mount.y, def.id).toBe(anchor.y);
      expect(mount.z, def.id).toBe(anchor.z);
      // The mount is inside the authored footprint, not out on the plinth.
      expect(Math.abs(mount.x), def.id).toBeLessThan(def.footprint.w * 2);
      expect(Math.abs(mount.z), def.id).toBeLessThan(def.footprint.h * 2);
      expect(mount.y, def.id).toBeGreaterThanOrEqual(0);
    }
    expect(FLAG_NATIONS.length).toBe(6);
  });

  it('puts solid structures on a roof and keeps only the two open yards on an apron', () => {
    for (const [id, anchor] of Object.entries(BUILDING_FLAG_ANCHORS)) {
      if (anchor.apron) expect(['airfield', 'shipyard'], id).toContain(id);
      else expect(anchor.apron, id).toBeUndefined();
    }
    expect(BUILDING_FLAG_ANCHORS.airfield.apron).toBe(true);
    expect(BUILDING_FLAG_ANCHORS.shipyard.apron).toBe(true);
    // Tall structures must not inherit the old plinth-level flag.
    expect(BUILDING_FLAG_ANCHORS.commandPost.y).toBeGreaterThan(6);
    expect(BUILDING_FLAG_ANCHORS.officeBlock.y).toBeGreaterThan(12);
    expect(BUILDING_FLAG_ANCHORS.civicHall.y).toBeGreaterThan(9);
    expect(BUILDING_FLAG_ANCHORS.tenement.y).toBeGreaterThan(8);
    expect(BUILDING_FLAG_ANCHORS.airfield.y).toBeLessThan(1);
    expect(BUILDING_FLAG_ANCHORS.shipyard.y).toBeLessThan(1.2);
  });
});

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { BUILDINGS } from '../src/data/buildings';
import { FACTIONS, NATION_LIST } from '../src/data/factions';
import { FALLBACK_BUILDING, buildingStyle } from '../src/render/buildingMeshes';
import { MESH_VS } from '../src/render/shaders';
import { teamColorForOwner } from '../src/render/teamColor';
import { hexToRgb } from '../src/render/math';
import {
  BUILDING_FLAG_ANCHORS,
  FLAG_NATIONS,
  allianceFlagColor,
  buildCommandFlagCloth,
  buildFlagRig,
  commandFlagWidthScale,
  flagAnchorFor,
  flagColorForOwner,
  flagMountFor,
  flagNationForFaction,
  flagOwnerForBuilding,
  flagTextureUrl,
  flagWindYaw,
} from '../src/render/flags';

const CLOTH_VERTICES = 12 * 6 * 4;

/** Official width-to-height ratios of every playable nation's flag. */
const OFFICIAL_RATIO = {
  lithuania: 5 / 3,
  poland: 8 / 5,
  uk: 2,
  finland: 18 / 11,
  sweden: 8 / 5,
  russia: 3 / 2,
  belarus: 2,
  hungary: 2,
  iran: 7 / 4,
  northKorea: 2,
} as const;

describe('flag identity', () => {
  it('maps every playable nation to itself and legacy presets to an alliance nation', () => {
    expect(FLAG_NATIONS).toHaveLength(10);
    expect(new Set(FLAG_NATIONS).size).toBe(10);
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
    for (const nation of ['lithuania', 'poland', 'uk', 'finland', 'sweden']) {
      expect(allianceFlagColor(nation)).toEqual(blue);
    }
    for (const nation of ['russia', 'belarus', 'hungary', 'iran', 'northKorea']) {
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
  it('ships a real PNG at the official proportions for every playable nation', () => {
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

  it('keeps legacy presets on the same real flag textures', () => {
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
    // Expansion nations: Iran is the widest (7:4), North Korea is 1:2 like the
    // other square flags, and the two Nordic crosses sit between them.
    expect(width('iran')).toBeGreaterThan(width('finland'));
    expect(width('finland')).toBeGreaterThan(width('sweden'));
    expect(width('sweden')).toBeGreaterThan(width('russia'));
    expect(width('northKorea')).toBeCloseTo(width('uk'), 5);
  });

  it('adds a third textured cloth for the commander flag, hanging below the other two', () => {
    const cloth = buildCommandFlagCloth();
    const vertices = cloth.positions.length / 3;
    expect(vertices).toBe(CLOTH_VERTICES);
    expect(cloth.wind).toHaveLength(vertices);
    expect(cloth.uv).toHaveLength(vertices * 2);
    expect(cloth.texMask.every((mask) => mask === 1)).toBe(true);
    expect(Math.max(...cloth.uv)).toBe(1);
    expect(Math.min(...cloth.wind)).toBe(0);
    expect(Math.max(...cloth.wind)).toBe(1);
    // Geometry only: the cloth hangs from the shared mast, with no second pole.
    let minY = Infinity;
    for (let i = 1; i < cloth.positions.length; i += 3) minY = Math.min(minY, cloth.positions[i]);
    expect(minY).toBeGreaterThan(1);
    // Scaled to the national cloth's width, so all three cloths match.
    expect(commandFlagWidthScale('russia')).toBeCloseTo(1, 5);
    expect(commandFlagWidthScale('uk')).toBeCloseTo(2 / 1.5, 5);
    expect(commandFlagWidthScale('lithuania')).toBeCloseTo(5 / 3 / 1.5, 5);
    for (const nation of FLAG_NATIONS) {
      expect(commandFlagWidthScale(nation), nation).toBeGreaterThanOrEqual(1);
    }
    // Its lower edge sits under the national cloth of every nation's rig.
    for (const nation of FLAG_NATIONS) {
      const rig = buildFlagRig(nation);
      let nationalMinY = Infinity;
      for (let i = 0; i < rig.texMask.length; i++) {
        if (rig.texMask[i] === 1) nationalMinY = Math.min(nationalMinY, rig.positions[i * 3 + 1]);
      }
      expect(minY, nation).toBeLessThan(nationalMinY);
    }
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
    expect(FLAG_NATIONS.length).toBe(10);
  });

  it('puts solid structures on a roof and keeps only the open yards on an apron', () => {
    for (const [id, anchor] of Object.entries(BUILDING_FLAG_ANCHORS)) {
      // The open yards and the national airfields are apron sites: their
      // operations read from ground level, not a roof.
      if (anchor.apron) {
        expect(['airfield', 'expeditionaryAirfield', 'shipyard', 'kockumsYard'], id).toContain(id);
      } else expect(anchor.apron, id).toBeUndefined();
    }
    expect(BUILDING_FLAG_ANCHORS.airfield.apron).toBe(true);
    expect(BUILDING_FLAG_ANCHORS.shipyard.apron).toBe(true);
    expect(BUILDING_FLAG_ANCHORS.kockumsYard.apron).toBe(true);
    expect(BUILDING_FLAG_ANCHORS.garrisonBarracks.apron).toBeUndefined();
    // Tall structures must not inherit the old plinth-level flag.
    expect(BUILDING_FLAG_ANCHORS.commandPost.y).toBeGreaterThan(6);
    expect(BUILDING_FLAG_ANCHORS.officeBlock.y).toBeGreaterThan(12);
    expect(BUILDING_FLAG_ANCHORS.civicHall.y).toBeGreaterThan(9);
    expect(BUILDING_FLAG_ANCHORS.tenement.y).toBeGreaterThan(8);
    expect(BUILDING_FLAG_ANCHORS.airfield.y).toBeLessThan(1);
    expect(BUILDING_FLAG_ANCHORS.shipyard.y).toBeLessThan(1.2);
  });
});

describe('skirmish team tint', () => {
  it('prefers the chosen colour over the faction palette', () => {
    expect(teamColorForOwner(0, 'uk', '#7fbf6a')).toEqual(hexToRgb('#7fbf6a'));
    expect(teamColorForOwner(0, 'uk')).toEqual(hexToRgb('#6f8fce'));
    // Neutral structures stay neutral whatever the override is.
    expect(teamColorForOwner(-1, 'uk', '#7fbf6a')).toEqual([0.55, 0.6, 0.58]);
  });

  it('gives a garrisoned structure its own colour band', () => {
    // A neutral shell occupied by player 1: the flag owner is the garrison,
    // and the upper cloth must use that player's chosen skirmish colour.
    const flagOwner = flagOwnerForBuilding(-1, 1);
    expect(flagOwner).toBe(1);
    expect(flagColorForOwner('russia', '#7fbf6a')).toEqual(hexToRgb('#7fbf6a'));
    // Without an override it still follows the alliance colour, not a faction
    // palette, because the cloth is a side marker rather than a nation decal.
    expect(flagColorForOwner('russia', undefined)).toEqual(allianceFlagColor('russia'));

    const renderer = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');
    expect(renderer).toContain('this.flagColorFor(flagOwner, factionId)');
  });
});

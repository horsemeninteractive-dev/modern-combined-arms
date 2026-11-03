import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { BUILDABLE_BY_PLAYER, BUILDINGS, buildingFamily } from '../src/data/buildings';
import {
  buildingBannerAnchor,
  buildingBannerPoints,
  buildingMesh,
  buildingStyle,
  buildingTopHeight,
} from '../src/render/buildingMeshes';
import { BUILDING_FLAG_ANCHORS } from '../src/render/flags';

function teamCoverage(positions: Float32Array, teamMask: Float32Array): number[] {
  return [Math.round(positions.length / 3), teamMask.filter((v) => v > 0).length];
}

describe('building ownership surfaces', () => {
  it('gives every player-buildable structure a substantial team-masked surface', () => {
    // Twelve shared structures plus one national variant per nation. Every
    // national variant is player-buildable for its own nation, so it has to
    // carry the same ownership surface as the shared building it replaces.
    expect(BUILDABLE_BY_PLAYER).toHaveLength(23);
    for (const def of BUILDABLE_BY_PLAYER) {
      const mesh = buildingMesh(def.id);
      expect(mesh, def.id).toBeDefined();
      const [vertices, teamVertices] = teamCoverage(mesh!.positions, mesh!.teamMask);
      // One ownership panel is two boxes; 24 vertices is the minimum useful
      // roof plate. Anything less is a token stripe that disappears at zoom 36.
      expect(teamVertices, def.id).toBeGreaterThanOrEqual(24);
      expect(teamVertices / vertices, def.id).toBeGreaterThan(0.015);
      for (const mask of mesh!.teamMask) {
        expect(mask, def.id).toBeGreaterThanOrEqual(0);
        expect(mask, def.id).toBeLessThanOrEqual(1);
      }
    }
  });

  it('gives capturable objectives a neutral ownership surface, not a fixed faction panel', () => {
    // Capture objectives carry a team mask so the renderer can show grey when
    // neutral and the owner's colour after capture. The mask is not a faction
    // colour by itself; it resolves from the live owner.
    for (const id of ['relay', 'radarStation', 'supplyDepot']) {
      const body = buildingStyle(id)!.body;
      const masked = body.teamMask.filter((v) => v > 0).length;
      expect(masked, id).toBeGreaterThan(0);
      for (const mask of body.teamMask) {
        expect(mask, id).toBeGreaterThanOrEqual(0);
        expect(mask, id).toBeLessThanOrEqual(1);
      }
    }
    // Garrisonable shelters and landmark strongpoints remain unpainted: their
    // ownership reads from the flag and health-bar edge, not a body panel.
    for (const id of [
      'tenement',
      'warehouse',
      'civicHall',
      'foundryWorks',
      'ruin',
    ]) {
      const body = buildingStyle(id)!.body;
      expect(body.teamMask.filter((v) => v > 0).length, id).toBe(0);
    }
  });
});

describe('building banner anchors', () => {
  it('uses the authored mesh top rather than the data footprint', () => {
    expect(buildingTopHeight('mgNest')).toBeLessThan(3);
    expect(buildingTopHeight('commandPost')).toBeGreaterThan(8);
    expect(buildingTopHeight('civicHall')).toBeGreaterThan(15);
    expect(buildingTopHeight('officeBlock')).toBeGreaterThan(17);
    expect(buildingTopHeight('officeBlock')).toBeGreaterThan(
      BUILDINGS.officeBlock.footprint.h * 4 * 0.45,
    );
    expect(buildingTopHeight('civicHall')).toBeGreaterThan(
      BUILDINGS.civicHall.footprint.h * 4 * 0.45,
    );
  });

  it('clears the highest visible surface by at least 0.4 world units', () => {
    for (const def of Object.values(BUILDINGS)) {
      const top = buildingTopHeight(def.id);
      const anchor = buildingBannerAnchor(def.id);
      expect(Number.isFinite(top), def.id).toBe(true);
      expect(top, def.id).toBeGreaterThan(0);
      expect(anchor.y, def.id).toBeGreaterThanOrEqual(top + 0.4);
      expect(Number.isFinite(anchor.x), def.id).toBe(true);
      expect(Number.isFinite(anchor.z), def.id).toBe(true);
      expect(Math.abs(anchor.x), def.id).toBeLessThan(def.footprint.w * 2);
      expect(Math.abs(anchor.z), def.id).toBeLessThan(def.footprint.h * 2);
      const points = buildingBannerPoints(def.id);
      expect(points.length, def.id).toBeGreaterThan(0);
      for (const point of points) {
        expect(Number.isFinite(point.x), def.id).toBe(true);
        expect(point.y, def.id).toBeGreaterThanOrEqual(top - 0.5);
      }
    }
    // Rear stacks and silos need an off-centre anchor so the bar clears the
    // tallest silhouette instead of crossing it.
    expect(buildingBannerAnchor('refinery').z).toBeLessThan(0);
    expect(buildingBannerAnchor('foundryWorks').z).toBeLessThan(0);
    const overlay = readFileSync(new URL('../src/ui/overlay.ts', import.meta.url), 'utf8');
    expect(overlay).toContain('buildingBannerAnchor(e.defId)');
    expect(overlay).toContain('buildingBannerPoints(e.defId)');
    expect(overlay).not.toContain("(BUILDINGS[e.defId]?.footprint.h ?? 2) * TILE_SIZE * 0.45");
    // Unit banners keep their own contract.
    expect(overlay).toContain('unitBannerHeight(e.defId)');
  });
});

describe('MG Nest and Reinforced Bunker identities', () => {
  it('uses separate body geometry while preserving the Hungarian roster slot', () => {
    const nest = buildingStyle('mgNest')!;
    const bunker = buildingStyle('bunker')!;
    expect(Array.from(bunker.body.positions)).not.toEqual(Array.from(nest.body.positions));
    expect(Array.from(bunker.body.indices)).not.toEqual(Array.from(nest.body.indices));
    // Same weapon and hardpoint contract, deliberately.
    expect(Array.from(bunker.turret!.positions)).toEqual(Array.from(nest.turret!.positions));
    expect(bunker.turretOffset).toEqual(nest.turretOffset);
    expect(BUILDINGS.bunker.variantOf).toBe('mgNest');
    expect(buildingFamily('bunker')).toBe('mgNest');
    expect(BUILDINGS.bunker.footprint).toEqual(BUILDINGS.mgNest.footprint);
  });

  it('keeps the bunker a low, heavy casemate rather than a taller tank-like box', () => {
    const bunker = buildingTopHeight('bunker');
    const nest = buildingTopHeight('mgNest');
    expect(bunker).toBeGreaterThan(nest);
    expect(bunker).toBeLessThan(4.2);
    const body = buildingStyle('bunker')!.body;
    let maxY = 0;
    for (let i = 1; i < body.positions.length; i += 3) maxY = Math.max(maxY, body.positions[i]);
    expect(maxY).toBeLessThan(4.1);
  });
});

describe('building presentation contracts', () => {
  it('keeps a deterministic roof mount for every registered structure', () => {
    for (const def of Object.values(BUILDINGS)) {
      const anchor = BUILDING_FLAG_ANCHORS[def.id];
      expect(anchor, def.id).toBeDefined();
      expect(Math.abs(anchor.x), def.id).toBeLessThan(def.footprint.w * 2);
      expect(Math.abs(anchor.z), def.id).toBeLessThan(def.footprint.h * 2);
    }
  });

  it('keeps all thumbnail meshes available and finite', () => {
    for (const def of Object.values(BUILDINGS)) {
      const mesh = buildingMesh(def.id);
      expect(mesh, def.id).toBeDefined();
      expect(mesh!.indices.length, def.id).toBeGreaterThan(0);
      for (const v of mesh!.positions) expect(Number.isFinite(v), def.id).toBe(true);
    }
  });

  it('draws the research centres across the ground they occupy', () => {
    // Both the shared Applied Research Centre and the Belarusian Signals Bureau
    // are drawn against their own footprints. The centre used to be authored at
    // roughly two tiles by two, so it sat as a small block in the middle of a
    // four-by-three pad.
    const TILE = 4;
    for (const id of ['researchCentre', 'signalsBureau'] as const) {
      const def = BUILDINGS[id];
      const positions = buildingStyle(id)!.body.positions;
      let minX = Infinity;
      let maxX = -Infinity;
      let minZ = Infinity;
      let maxZ = -Infinity;
      for (let i = 0; i < positions.length; i += 3) {
        minX = Math.min(minX, positions[i]);
        maxX = Math.max(maxX, positions[i]);
        minZ = Math.min(minZ, positions[i + 2]);
        maxZ = Math.max(maxZ, positions[i + 2]);
      }
      const width = maxX - minX;
      const depth = maxZ - minZ;
      expect(width, id).toBeGreaterThanOrEqual(def.footprint.w * TILE * 0.8);
      expect(depth, id).toBeGreaterThanOrEqual(def.footprint.h * TILE * 0.8);
      // and never spills outside the tiles the player can place it on
      expect(width, id).toBeLessThanOrEqual(def.footprint.w * TILE);
      expect(depth, id).toBeLessThanOrEqual(def.footprint.h * TILE);
    }
  });
});

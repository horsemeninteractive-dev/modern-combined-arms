import { describe, expect, it } from 'vitest';
import { unitStyle } from '../src/render/unitMeshes';
import { ZOMBIE_DEF_IDS } from '../src/data/zombies';

/**
 * The horde is modelled at the roster's own 1:1 scale. A zombie is a body, not
 * a marker: it carries the same layered anatomy a rifleman does (pelvis, waist,
 * ribcage, shoulders, neck, skull, jaw, limbs with joints and hands) rather
 * than the four boxes the archetypes used to be. These floors are the guard
 * against the models drifting back to placeholders.
 */

const IDS = Object.values(ZOMBIE_DEF_IDS);

function triangles(mesh: { indices: ArrayLike<number> }): number {
  return mesh.indices.length / 3;
}

describe('infected mesh detail', () => {
  it('builds every archetype at the detail level of a trooper', () => {
    for (const id of IDS) {
      const style = unitStyle(id);
      expect(style, id).toBeDefined();
      // A rifleman's body is a little over 600 triangles and the medic's 422;
      // every archetype now sits in that band rather than at a box-and-a-half.
      expect(triangles(style!.body), `${id} body`).toBeGreaterThanOrEqual(280);
      expect(triangles(style!.body), `${id} body`).toBeLessThanOrEqual(1200);
      if (id === ZOMBIE_DEF_IDS.flyer) {
        // A flyer has nothing to walk on: its legs trail behind it in the body
        // mesh, so the archetype carries no hip-pivot limb at all.
        expect(style!.infantry, `${id} rig`).toBeUndefined();
        continue;
      }
      // Legs keep the roster's own rig and carry knees, ankles and feet.
      expect(triangles(style!.infantry!.leg), `${id} limb`).toBeGreaterThanOrEqual(60);
    }
  });

  it('gives each archetype its own silhouette', () => {
    const seen = new Map<string, string>();
    for (const id of IDS) {
      const body = unitStyle(id)!.body;
      // A cheap deterministic signature: vertex count plus the extent the
      // body occupies. Two archetypes sharing both would read as one model.
      let minX = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (let i = 0; i < body.positions.length; i += 3) {
        minX = Math.min(minX, body.positions[i]);
        maxX = Math.max(maxX, body.positions[i]);
        maxY = Math.max(maxY, body.positions[i + 1]);
      }
      const signature = `${body.positions.length}:${(maxX - minX).toFixed(2)}:${maxY.toFixed(2)}`;
      expect(seen.get(signature), `${id} duplicates ${seen.get(signature)}`).toBeUndefined();
      seen.set(signature, id);
    }
    expect(seen.size).toBe(IDS.length);
  });

  it('holds the horde under the health-bar anchors they were authored for', () => {
    // The crawler hugs the ground; the brute is the tallest body on the field.
    const tops = IDS.map((id) => {
      const body = unitStyle(id)!.body.positions;
      let maxY = 0;
      for (let i = 1; i < body.length; i += 3) maxY = Math.max(maxY, body[i]);
      return { id, maxY };
    });
    for (const { id, maxY } of tops) {
      expect(maxY, id).toBeGreaterThan(0.3);
      expect(maxY, id).toBeLessThan(1.6);
    }
    const crawler = tops.find((entry) => entry.id === 'zombieCrawler')!;
    const brute = tops.find((entry) => entry.id === 'zombieBrute')!;
    expect(crawler.maxY).toBeLessThan(0.5);
    expect(brute.maxY).toBeGreaterThan(1.2);
  });
});

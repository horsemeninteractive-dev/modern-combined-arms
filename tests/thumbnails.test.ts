import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { Vec3 } from '../src/render/math';
import { portraitFrame, thumbnailKey } from '../src/render/thumbnailFrame';
import { buildingMesh, buildingStyle } from '../src/render/buildingMeshes';

function boxPoints(width: number, height: number, depth: number): Vec3[] {
  const points: Vec3[] = [];
  for (const x of [-width / 2, width / 2]) {
    for (const y of [0, height]) {
      for (const z of [-depth / 2, depth / 2]) points.push([x, y, z]);
    }
  }
  return points;
}

function projected(points: Vec3[], width: number, height: number) {
  const frame = portraitFrame(points, width, height);
  expect(frame).not.toBeNull();
  if (!frame) throw new Error('missing frame');
  const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const values = points.map((p) => {
    const rel: Vec3 = [p[0] - frame.eye[0], p[1] - frame.eye[1], p[2] - frame.eye[2]];
    return [dot(rel, frame.right) / frame.halfW, dot(rel, frame.up) / frame.halfH] as const;
  });
  return { frame, values };
}

describe('thumbnail framing', () => {
  it('keeps every vertex inside the orthographic viewport', () => {
    const points = boxPoints(6, 4, 3);
    for (const [width, height] of [[192, 144], [160, 160]]) {
      const { values } = projected(points, width, height);
      for (const [x, y] of values) {
        expect(Math.abs(x)).toBeLessThanOrEqual(1.0001);
        expect(Math.abs(y)).toBeLessThanOrEqual(1.0001);
      }
    }
  });

  it('centres the projected bounds and preserves the requested aspect ratio', () => {
    const { frame, values } = projected(boxPoints(12, 3, 5), 192, 144);
    const xs = values.map(([x]) => x);
    const ys = values.map(([, y]) => y);
    expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeCloseTo(0, 5);
    expect((Math.min(...ys) + Math.max(...ys)) / 2).toBeCloseTo(0, 5);
    expect(frame.halfW / frame.halfH).toBeCloseTo(192 / 144, 6);
  });

  it('fits both tall structures and wide vehicles', () => {
    const tall = projected(boxPoints(4, 16, 4), 160, 160);
    const wide = projected(boxPoints(24, 3, 10), 160, 160);
    for (const { values } of [tall, wide]) {
      const ys = values.map(([, y]) => y);
      expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(0.8);
      expect(Math.max(...ys)).toBeLessThanOrEqual(1.0001);
    }
  });

  it('rejects empty geometry and invalid viewports', () => {
    expect(portraitFrame([], 192, 144)).toBeNull();
    expect(portraitFrame(boxPoints(1, 1, 1), 0, 144)).toBeNull();
  });
});

describe('thumbnail building art', () => {
  it('bakes a traversing gun onto its pintle instead of the ground', () => {
    for (const id of ['mgNest', 'atTurret']) {
      const style = buildingStyle(id);
      expect(style?.turret).toBeDefined();
      const merged = buildingMesh(id);
      expect(merged).toBeDefined();
      if (!style?.turret || !merged) continue;
      const offset = style.turretOffset ?? [0, 0, 0];
      const at = style.body.positions.length;
      expect(merged.positions[at]).toBeCloseTo(style.turret.positions[0] + offset[0], 5);
      expect(merged.positions[at + 1]).toBeCloseTo(style.turret.positions[1] + offset[1], 5);
      expect(merged.positions[at + 2]).toBeCloseTo(style.turret.positions[2] + offset[2], 5);
      expect(offset[1]).toBeGreaterThan(1);
    }
  });
});

describe('occupied shelter models', () => {
  const extent = (mesh: NonNullable<ReturnType<typeof buildingStyle>>['body']) => {
    let max = 0;
    for (let i = 0; i < mesh.positions.length; i += 3) {
      max = Math.max(max, Math.abs(mesh.positions[i]), Math.abs(mesh.positions[i + 2]));
    }
    return max;
  };

  it('dresses both shelters only while they are occupied', () => {
    for (const id of ['tenement', 'ruin']) {
      const style = buildingStyle(id);
      expect(style?.garrisoned, id).toBeDefined();
      const body = style!.body;
      const dressed = style!.garrisoned!;

      // An empty shelter uses the plain model, so the dressed one adds geometry
      // and carries the team mask that recolours flag and trim per occupant.
      expect(dressed.positions.length).toBeGreaterThan(body.positions.length);
      expect(dressed.indices.length).toBeGreaterThan(body.indices.length);
      expect(dressed.teamMask.some((v) => v > 0.5)).toBe(true);
      expect(body.teamMask.every((v) => v === 0)).toBe(true);

      // The wire ring and firing positions sit outside the walls, so the
      // occupied state is legible from the tactical camera.
      expect(extent(dressed)).toBeGreaterThan(extent(body));
    }
  });
});

describe('thumbnail program uniforms', () => {
  const source = readFileSync(new URL('../src/render/thumbnails.ts', import.meta.url), 'utf8');

  it('sets the grade uniforms that otherwise render every card black', () => {
    // A mesh program leaves an unset uniform at zero, and the shared mesh shader
    // multiplies the whole lit colour by uTone. Forgetting it here is what turned
    // every production card into a flat silhouette, so the studio shot must pin
    // its own neutral grade instead of inheriting the battle's.
    expect(source).toContain("'uTone'");
    expect(source).toContain('gl.uniform3fv(u.uTone ?? null, [1, 1, 1])');
    for (const name of ['uNightGlow', 'uSilhouette', 'uUseFog']) {
      expect(source).toContain(`gl.uniform1f(u.${name} ?? null, 0)`);
    }
  });
});

describe('thumbnail cache keys', () => {
  const base = { kind: 'unit', defId: 'tank', color: '#52C5E6' } as const;

  it('normalises colour and defaults to the card shape', () => {
    expect(thumbnailKey(base)).toBe('unit:tank:card:#52c5e6');
    expect(thumbnailKey({ ...base, shape: 'card' })).toBe(thumbnailKey(base));
  });

  it('separates kind, definition, shape, and team colour', () => {
    expect(thumbnailKey({ ...base, kind: 'building' })).not.toBe(thumbnailKey(base));
    expect(thumbnailKey({ ...base, defId: 'recon' })).not.toBe(thumbnailKey(base));
    expect(thumbnailKey({ ...base, shape: 'portrait' })).not.toBe(thumbnailKey(base));
    expect(thumbnailKey({ ...base, color: '#ef6c4d' })).not.toBe(thumbnailKey(base));
  });
});

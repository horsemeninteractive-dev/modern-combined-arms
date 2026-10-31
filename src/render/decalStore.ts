/**
 * Presentation-only ground decals: fading track and tyre marks, short-lived
 * scorch and small impact craters.
 *
 * These are deliberately not entities. They have no collision, picking, save
 * entry or gameplay effect, and the store is bounded so a long match cannot
 * accumulate an unbounded effect list.
 */

export type GroundDecalKind = 'track' | 'tyre' | 'scorch' | 'crater';

export interface GroundDecal {
  kind: GroundDecalKind;
  x: number;
  y: number;
  z: number;
  /** World XZ rotation of the decal's local X axis. */
  rotation: number;
  /** Half-extent along local X. */
  rx: number;
  /** Half-extent along local Z. */
  rz: number;
  age: number;
  life: number;
  alpha: number;
  color: [number, number, number];
}

/** Hard ceiling shared by every decal kind so the effect list stays bounded. */
export const MAX_GROUND_DECALS = 512;
/** Long enough to read as a track, short enough to fade from the battlefield. */
export const TRACK_DECAL_LIFE = 6;
/** Rubber marks are lighter and shorter-lived than steel tracks. */
export const TYRE_DECAL_LIFE = 4.5;
/** A scorch is a little more persistent than a track, but never permanent. */
export const SCORCH_DECAL_LIFE = 10;
/** A crater is a small ground scar; it fades, but more slowly than soot. */
export const CRATER_DECAL_LIFE = 14;

const TRACK_COLOR: [number, number, number] = [0.095, 0.086, 0.068];
const TYRE_COLOR: [number, number, number] = [0.085, 0.078, 0.064];
const SCORCH_COLOR: [number, number, number] = [0.055, 0.048, 0.039];
const CRATER_COLOR: [number, number, number] = [0.05, 0.043, 0.034];
const TRACK_ALPHA = 0.34;
const TYRE_ALPHA = 0.28;
const SCORCH_ALPHA = 0.5;
const CRATER_ALPHA = 0.62;

/**
 * Opacity at the current age. Linear fade keeps the mark visible for most of
 * its life instead of disappearing abruptly at the end.
 */
export function decalAlpha(decal: GroundDecal): number {
  if (!(decal.life > 0) || !(decal.age >= 0)) return 0;
  const remaining = 1 - decal.age / decal.life;
  if (remaining <= 0) return 0;
  return decal.alpha * remaining;
}

export class DecalStore {
  private list: GroundDecal[] = [];

  get decals(): readonly GroundDecal[] {
    return this.list;
  }

  get length(): number {
    return this.list.length;
  }

  /** One pair of longitudinal bands for a tracked vehicle's last segment. */
  addTrack(
    x: number,
    y: number,
    z: number,
    rotation: number,
    rx: number,
    rz: number,
  ): void {
    this.push({
      kind: 'track',
      x,
      y,
      z,
      rotation,
      rx: Math.max(0.1, rx),
      rz: Math.max(0.1, rz),
      age: 0,
      life: TRACK_DECAL_LIFE,
      alpha: TRACK_ALPHA,
      color: TRACK_COLOR,
    });
  }

  /** Two narrow rubber bands for a wheeled vehicle's last segment. */
  addTyreTrack(
    x: number,
    y: number,
    z: number,
    rotation: number,
    rx: number,
    rz: number,
  ): void {
    this.push({
      kind: 'tyre',
      x,
      y,
      z,
      rotation,
      rx: Math.max(0.1, rx),
      rz: Math.max(0.1, rz),
      age: 0,
      life: TYRE_DECAL_LIFE,
      alpha: TYRE_ALPHA,
      color: TYRE_COLOR,
    });
  }

  /** A soft, irregular burn mark under a ground explosion. */
  addScorch(x: number, y: number, z: number, radius: number): void {
    const r = Math.max(0.25, radius);
    this.push({
      kind: 'scorch',
      x,
      y,
      z,
      rotation: 0,
      rx: r,
      rz: r,
      age: 0,
      life: SCORCH_DECAL_LIFE,
      alpha: SCORCH_ALPHA,
      color: SCORCH_COLOR,
    });
  }

  /** A small, irregular ground-impact bowl with a disturbed-earth rim. */
  addCrater(x: number, y: number, z: number, radius: number): void {
    const r = Math.max(0.22, radius);
    this.push({
      kind: 'crater',
      x,
      y,
      z,
      rotation: 0,
      rx: r,
      rz: r,
      age: 0,
      life: CRATER_DECAL_LIFE,
      alpha: CRATER_ALPHA,
      color: CRATER_COLOR,
    });
  }

  update(dt: number): void {
    if (!(dt > 0)) return;
    let write = 0;
    for (let i = 0; i < this.list.length; i++) {
      const decal = this.list[i];
      decal.age += dt;
      if (decal.age < decal.life) this.list[write++] = decal;
    }
    this.list.length = write;
  }

  clear(): void {
    this.list.length = 0;
  }

  private push(decal: GroundDecal): void {
    this.list.push(decal);
    while (this.list.length > MAX_GROUND_DECALS) this.list.shift();
  }
}

/**
 * Uniform-grid broadphase for the simulation's proximity work.
 *
 * Targeting, local avoidance, traffic and separation all ask the same question
 * — "what is near this point?" — and every one of them used to answer it by
 * walking the whole entity list. That is O(entities) per unit per tick, so a
 * 500-hull battle spent most of its budget on scans that found nothing.
 *
 * The index is rebuilt once per simulation tick (a linear pass that inserts
 * each living entity into exactly one bucket), then queried with a world-space
 * radius. A query returns the entities in every bucket the circle's bounding
 * box touches: the caller still applies its own exact distance test, because
 * the grid is a filter, not a source of truth.
 *
 * Ordering is deterministic — buckets are filled in entity order and visited
 * row by row — so two peers, a replay and a restored save all see the same
 * candidates. Callers that depend on a tie-break between equidistant
 * candidates sort what they get back.
 */
import type { Entity } from './types';

export class SpatialIndex {
  private readonly cellSize: number;
  private readonly cols: number;
  private readonly rows: number;
  /** Buckets are allocated on first use and emptied in place, never re-made. */
  private readonly cells: Array<Entity[] | undefined>;
  /** Indices of the buckets that currently hold entities, for a cheap clear. */
  private readonly filled: number[] = [];

  constructor(worldWidth: number, worldHeight: number, cellSize: number) {
    this.cellSize = Math.max(1, cellSize);
    this.cols = Math.max(1, Math.ceil(worldWidth / this.cellSize));
    this.rows = Math.max(1, Math.ceil(worldHeight / this.cellSize));
    this.cells = new Array(this.cols * this.rows);
  }

  /** Drop every entity, keeping the bucket arrays for reuse. */
  clear(): void {
    for (const index of this.filled) this.cells[index]!.length = 0;
    this.filled.length = 0;
  }

  /** Place one entity in the bucket that contains its position. */
  insert(e: Entity): void {
    const cx = Math.floor(e.x / this.cellSize);
    const cz = Math.floor(e.z / this.cellSize);
    if (cx < 0 || cz < 0 || cx >= this.cols || cz >= this.rows) return;
    const index = cz * this.cols + cx;
    const bucket = this.cells[index];
    if (bucket) {
      // A reused bucket has to be re-registered with this generation or the
      // next clear would leave its entities behind, and every tick would scan
      // the ones from every tick before it.
      if (bucket.length === 0) this.filled.push(index);
      bucket.push(e);
      return;
    }
    this.cells[index] = [e];
    this.filled.push(index);
  }

  /**
   * Every entity in the buckets overlapping a circle, written into `out`.
   *
   * The result is a superset: a candidate in a corner bucket can sit outside
   * the radius, so the caller keeps its distance test. `out` is cleared first
   * and returned for convenience.
   */
  query(x: number, z: number, radius: number, out: Entity[]): Entity[] {
    out.length = 0;
    const r = Math.max(0, radius);
    let x0 = Math.floor((x - r) / this.cellSize);
    let z0 = Math.floor((z - r) / this.cellSize);
    let x1 = Math.floor((x + r) / this.cellSize);
    let z1 = Math.floor((z + r) / this.cellSize);
    if (x1 < 0 || z1 < 0 || x0 >= this.cols || z0 >= this.rows) return out;
    if (x0 < 0) x0 = 0;
    if (z0 < 0) z0 = 0;
    if (x1 > this.cols - 1) x1 = this.cols - 1;
    if (z1 > this.rows - 1) z1 = this.rows - 1;
    for (let cz = z0; cz <= z1; cz++) {
      const row = cz * this.cols;
      for (let cx = x0; cx <= x1; cx++) {
        const bucket = this.cells[row + cx];
        if (!bucket) continue;
        for (let i = 0; i < bucket.length; i++) out.push(bucket[i]);
      }
    }
    return out;
  }
}

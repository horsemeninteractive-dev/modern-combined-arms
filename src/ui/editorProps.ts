import type { PropKind } from '../data/props';
import type { ScenarioProp } from '../sim/scenario';

/**
 * Prop authoring helpers for the Scenario Forge.
 *
 * The eyedropper and the multi-select are pointer gestures, but everything that
 * *decides* something — which prop is under the cursor, which ones a marquee
 * caught, what settings an adopted prop carries, where a duplicate would land —
 * is pure and lives here. The editor then only has to route a gesture to one of
 * these calls, which is what makes the behaviour testable without a canvas.
 */

/** An inclusive tile rectangle, normalised so `x0 <= x1` and `z0 <= z1`. */
export interface TileBox {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

/** Normalise two dragged corners into an inclusive box. */
export function propBox(ax: number, az: number, bx: number, bz: number): TileBox {
  return {
    x0: Math.min(ax, bx),
    z0: Math.min(az, bz),
    x1: Math.max(ax, bx),
    z1: Math.max(az, bz),
  };
}

/**
 * The prop under a tile, or null.
 *
 * Later entries win: props are drawn in list order, so the last one authored on
 * a tile is the one an author sees on top and the one a click should pick.
 */
export function propAt(
  props: readonly ScenarioProp[],
  x: number,
  z: number,
): ScenarioProp | null {
  for (let i = props.length - 1; i >= 0; i--) {
    const prop = props[i];
    if (prop.x === x && prop.z === z) return prop;
  }
  return null;
}

/** Every prop whose tile falls inside an inclusive box. */
export function propsInBox(props: readonly ScenarioProp[], box: TileBox): ScenarioProp[] {
  return props.filter(
    (prop) =>
      prop.x >= box.x0 && prop.x <= box.x1 && prop.z >= box.z0 && prop.z <= box.z1,
  );
}

/**
 * One compass step for an authored prop: a full turn is eight of these, and
 * every prop therefore faces a direction an author can name (N, NE, E…) rather
 * than an arbitrary angle nobody can reproduce twice.
 */
export const PROP_ROTATION_STEP = Math.PI / 4;

/** One nudge moves a prop an eighth of its tile. */
export const PROP_NUDGE_STEP = 0.125;

/** Keep a sub-tile offset inside the prop's own tile. */
function clampOffset(value: number): number {
  const rounded = Math.round(Math.max(-0.5, Math.min(0.5, value)) * 1000) / 1000;
  return Object.is(rounded, -0) ? 0 : rounded;
}

/**
 * The prop turned by one compass step.
 *
 * Rotation is stored in radians and may come from an older file at any angle,
 * so the turn starts from the nearest of the eight directions: two clicks on a
 * prop authored at 17° put it at 90°, not at 107°. The result is wrapped into
 * (-180°, 180°] so a prop never carries a full turn.
 */
export function rotateProp(prop: ScenarioProp, direction: 1 | -1): ScenarioProp {
  const step = PROP_ROTATION_STEP;
  const current = Math.round((prop.rotation ?? 0) / step) * step;
  let next = current + direction * step;
  if (next > Math.PI) next -= Math.PI * 2;
  if (next <= -Math.PI) next += Math.PI * 2;
  return { ...prop, rotation: next };
}

/**
 * The prop moved by whole nudges inside its tile.
 *
 * The offset is clamped to half a tile in each direction, so a prop can be
 * pushed to the edge of its cell but never crosses into a neighbour's ground:
 * the authored tile stays the record of which cell the prop belongs to.
 */
export function nudgeProp(
  prop: ScenarioProp,
  dx: number,
  dz: number,
  step = PROP_NUDGE_STEP,
): ScenarioProp {
  const next: ScenarioProp = { ...prop };
  const offsetX = clampOffset((prop.offsetX ?? 0) + dx * step);
  const offsetZ = clampOffset((prop.offsetZ ?? 0) + dz * step);
  if (offsetX === 0) delete next.offsetX;
  else next.offsetX = offsetX;
  if (offsetZ === 0) delete next.offsetZ;
  else next.offsetZ = offsetZ;
  return next;
}

/** The prop back in the middle of its tile, as if it had just been placed. */
export function centreProp(prop: ScenarioProp): ScenarioProp {
  const next: ScenarioProp = { ...prop };
  delete next.offsetX;
  delete next.offsetZ;
  return next;
}

export interface PropSettings {
  kind: PropKind;
  /** Yaw in degrees, rounded the way the Forge's rotate slider reads it. */
  rotation: number;
  /** Size multiplier, rounded to the slider's own precision. */
  scale: number;
}

/**
 * The authoring settings behind a placed prop.
 *
 * The format stores radians and an optional multiplier; the Forge's controls are
 * a degree slider and a tenth-step scale slider. Adopting a prop therefore has
 * to convert and round, or the sliders would show one value and stamp another.
 */
export function propSettings(prop: ScenarioProp): PropSettings {
  const degrees = ((prop.rotation ?? 0) * 180) / Math.PI;
  return {
    kind: prop.kind,
    rotation: Math.max(-180, Math.min(180, Math.round(degrees))),
    scale: Math.max(0.5, Math.min(2, Math.round((prop.scale ?? 1) * 10) / 10)),
  };
}

/** Tile keys of a prop list, for duplicate collision checks. */
export function propTiles(props: readonly ScenarioProp[]): Set<string> {
  return new Set(props.map((prop) => `${prop.x},${prop.z}`));
}

/**
 * Copies of the selection one tile down and to the right.
 *
 * A copy is refused where it would leave the map or land on a tile that already
 * holds a prop or a structure, and the selection's own tiles are not obstacles —
 * a copy of a stack duplicates the stack, it does not refuse to exist. Settings
 * travel with each copy, which is the point of multi-select: ten lamps become
 * twenty without re-picking the yaw.
 */
export function duplicateProps(
  selection: readonly ScenarioProp[],
  options: {
    width: number;
    height: number;
    /** Tiles already holding a prop and/or a structure, keyed `x,z`. */
    occupied?: ReadonlySet<string>;
    dx?: number;
    dz?: number;
  },
): ScenarioProp[] {
  const dx = options.dx ?? 1;
  const dz = options.dz ?? 1;
  const own = propTiles(selection);
  const taken = new Set(options.occupied ?? []);
  for (const key of own) taken.delete(key);
  const copies: ScenarioProp[] = [];
  for (const prop of selection) {
    const x = prop.x + dx;
    const z = prop.z + dz;
    if (x < 0 || z < 0 || x >= options.width || z >= options.height) continue;
    const key = `${x},${z}`;
    if (taken.has(key)) continue;
    copies.push({
      kind: prop.kind,
      x,
      z,
      ...(prop.rotation === undefined ? {} : { rotation: prop.rotation }),
      ...(prop.scale === undefined ? {} : { scale: prop.scale }),
      ...(prop.offsetX === undefined ? {} : { offsetX: prop.offsetX }),
      ...(prop.offsetZ === undefined ? {} : { offsetZ: prop.offsetZ }),
    });
  }
  return copies;
}

/**
 * The selection with anything that no longer exists dropped.
 *
 * A delete, an undo, a reload or a scenario swap replaces the prop list; holding
 * stale object references would let the Forge highlight props that are gone and
 * duplicate ones that are not there.
 */
export function pruneSelection(
  props: readonly ScenarioProp[],
  selection: readonly ScenarioProp[],
): ScenarioProp[] {
  if (selection.length === 0) return [];
  const live = new Set(props);
  return selection.filter((prop) => live.has(prop));
}

/** The prop list with the selection removed. */
export function deleteProps(
  props: readonly ScenarioProp[],
  selection: readonly ScenarioProp[],
): ScenarioProp[] {
  if (selection.length === 0) return [...props];
  const doomed = new Set(selection);
  return props.filter((prop) => !doomed.has(prop));
}

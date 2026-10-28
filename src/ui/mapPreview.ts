import { BUILDINGS } from '../data/buildings';
import type { Scenario } from '../sim/scenario';
import { TERRAIN, Terrain, tileIndex, type TerrainId } from '../sim/terrain';

/**
 * The briefing panel used to draw a decorative sketch of the island. It now
 * shows the real scenario: a top-down raster of the authored terrain, so the
 * picture in the menu is the map that actually deploys.
 */

/** A named point on the briefing map, in percentages of the map frame. */
export interface BriefMapLabel {
  side: 'friend' | 'enemy';
  /** Horizontal centre of the marker, as a percentage of the map width. */
  x: number;
  /** Vertical centre of the marker, as a percentage of the map height. */
  z: number;
}

/** Rasters are pure functions of the scenario, so each is baked once. */
const rasters = new WeakMap<Scenario, HTMLCanvasElement>();

function clampPercent(value: number): number {
  return Math.max(5, Math.min(95, value));
}

/**
 * Where the two command posts sit on the map. The labels follow the authored
 * structures instead of fixed pixels, so an edited island keeps its callouts on
 * the bases.
 */
export function briefMapLabels(scenario: Scenario): BriefMapLabel[] {
  const marker = (owner: number, side: BriefMapLabel['side'], fallback: [number, number]): BriefMapLabel => {
    const post = scenario.structures.find((s) => s.defId === 'commandPost' && s.owner === owner);
    if (!post) {
      return { side, x: clampPercent(fallback[0] * 100), z: clampPercent(fallback[1] * 100) };
    }
    const footprint = BUILDINGS[post.defId]?.footprint ?? { w: 3, h: 3 };
    return {
      side,
      x: clampPercent(((post.x + footprint.w / 2) / scenario.width) * 100),
      z: clampPercent(((post.z + footprint.h / 2) / scenario.height) * 100),
    };
  };
  return [marker(0, 'friend', [0.18, 0.48]), marker(1, 'enemy', [0.78, 0.35])];
}

/** One pixel per tile, lit from the north-west so hills read without shading work. */
function terrainRaster(scenario: Scenario): HTMLCanvasElement | null {
  const cached = rasters.get(scenario);
  if (cached) return cached;
  const canvas = document.createElement('canvas');
  canvas.width = scenario.width;
  canvas.height = scenario.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const image = ctx.createImageData(scenario.width, scenario.height);
  const { width: w, height: h, tiles } = scenario;

  let low = Infinity;
  let high = -Infinity;
  for (const tile of tiles) {
    if (tile.e < low) low = tile.e;
    if (tile.e > high) high = tile.e;
  }
  const span = Math.max(1, high - low);

  for (let z = 0; z < h; z++) {
    for (let x = 0; x < w; x++) {
      const i = tileIndex(w, x, z);
      const tile = tiles[i];
      const terrain = TERRAIN[tile.t as TerrainId] ?? TERRAIN[Terrain.Grass];
      // Slopes facing the light brighten, slopes turning away darken, and
      // higher ground sits lighter than the flats.
      const north = tiles[z > 0 ? i - w : i].e;
      const west = tiles[x > 0 ? i - 1 : i].e;
      const relief = 1 + (((north - tile.e) + (west - tile.e)) / span) * 0.5;
      const altitude = 0.84 + ((tile.e - low) / span) * 0.3;
      const grain = 1 + hash(x, z) * 0.05;
      const shade = Math.max(0.5, Math.min(1.4, relief * altitude * grain));
      const o = i * 4;
      image.data[o] = Math.round(Math.min(255, terrain.color[0] * 255 * shade));
      image.data[o + 1] = Math.round(Math.min(255, terrain.color[1] * 255 * shade));
      image.data[o + 2] = Math.round(Math.min(255, terrain.color[2] * 255 * shade));
      image.data[o + 3] = 255;
    }
  }

  ctx.putImageData(image, 0, 0);
  rasters.set(scenario, canvas);
  return canvas;
}

/** Deterministic per-tile grain, so the raster looks surveyed rather than flat. */
function hash(x: number, z: number): number {
  const n = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

/** Paint the scenario into the briefing canvas at the element's pixel size. */
export function drawBriefMap(canvas: HTMLCanvasElement, scenario: Scenario): void {
  const cssWidth = canvas.clientWidth;
  const cssHeight = canvas.clientHeight;
  if (cssWidth < 4 || cssHeight < 4) return;
  // Never below 1: a zoomed-out browser would otherwise render the raster
  // smaller than its box and blur it.
  const density = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  const width = Math.round(cssWidth * density);
  const height = Math.round(cssHeight * density);
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const raster = terrainRaster(scenario);
  if (!raster) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = '#071012';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(raster, 0, 0, width, height);
}

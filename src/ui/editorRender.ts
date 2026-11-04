import type { Editor } from './editor';
import { BUILDINGS } from '../data/buildings';
import { UNITS } from '../data/units';
import { tryIdentityDef } from '../data/factions';
import { TILE_SIZE } from '../sim/constants';
import {
  OVERLAYS,
  TERRAIN,
  inBounds,
  overlayIdOf,
  overlayLabel,
  tileIndex,
  type TerrainId,
} from '../sim/terrain';
import { terrainVisualHeight } from '../render/terrainSurface';
import { REGION_HANDLES, type RegionHandle, type TileRect } from '../mission/regions';

export function drawEditorOverlay(editor: Editor): void {
  const ctx = editor.ctx;
  const scenario = editor.scenario;
  const camera = editor.app.renderer.camera;
  const width = editor.overlayWidth;
  const height = editor.overlayHeight;
  ctx.clearRect(0, 0, width, height);
  if (!scenario) return;

  const project = (x: number, z: number) =>
    camera.worldToScreen(
      x * TILE_SIZE,
      terrainVisualHeight(scenario, x * TILE_SIZE, z * TILE_SIZE) + 0.15,
      z * TILE_SIZE,
    );

  // Reachability preview.
  if (editor.reach && editor.reachMode !== 'off') {
    ctx.fillStyle = editor.reachMode === 'naval' ? 'rgba(82,197,230,0.20)' : 'rgba(134,199,145,0.20)';
    const step = camera.zoom > 70 ? 2 : 1;
    for (let z = 0; z < scenario.height; z += step) {
      for (let x = 0; x < scenario.width; x += step) {
        const i = tileIndex(scenario.width, x, z);
        if (!editor.reach[i]) continue;
        const p = project(x + 0.5, z + 0.5);
        if (!p.visible) continue;
        ctx.fillRect(p.x - 2, p.y - 1, 4, 2);
      }
    }
  }

  // Tile grid, split per tile so each edge follows the sloped surface.
  ctx.strokeStyle = 'rgba(196,216,209,0.075)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let z = 0; z < scenario.height; z++) {
    for (let x = 0; x < scenario.width; x++) {
      const a = project(x, z);
      const east = project(x + 1, z);
      const south = project(x, z + 1);
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(east.x, east.y);
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(south.x, south.y);
    }
  }
  ctx.stroke();

  // Map border.
  const c0 = project(0, 0);
  const c1 = project(scenario.width, 0);
  const c2 = project(scenario.width, scenario.height);
  const c3 = project(0, scenario.height);
  ctx.strokeStyle = 'rgba(224,163,74,0.55)';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(c0.x, c0.y);
  ctx.lineTo(c1.x, c1.y);
  ctx.lineTo(c2.x, c2.y);
  ctx.lineTo(c3.x, c3.y);
  ctx.closePath();
  ctx.stroke();

  // Mission regions. The workbench toggles this layer; it uses the same tile
  // projection as every other authoring marker, so bounds cannot drift from the
  // rectangle the mission document stores.
  if (editor.showRegions && scenario.mission) {
    const dragTarget = editor.regionEditTargetId;
    scenario.mission.regions.forEach((region) => {
      const selected = region.id === editor.selectedRegionId;
      // The region being dragged is drawn from the draft, not the document:
      // until the gesture commits, the document still holds the old bounds.
      const rect = dragTarget === region.id && editor.regionDraft ? editor.regionDraft : region;
      drawRegionRect(ctx, project, rect, selected);
    });
    // A brand-new rectangle has no document entry yet.
    if (editor.regionDraft && !dragTarget) {
      drawRegionRect(ctx, project, editor.regionDraft, true, true);
    }
    const selected = scenario.mission.regions.find((entry) => entry.id === editor.selectedRegionId);
    if (selected) {
      const points = regionHandleScreenPoints(editor, selected);
      for (const handle of REGION_HANDLES) {
        const point = points[handle];
        ctx.fillStyle = 'rgba(8,13,15,0.9)';
        ctx.strokeStyle = 'rgba(241,194,126,0.95)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.rect(point.x - 3.5, point.y - 3.5, 7, 7);
        ctx.fill();
        ctx.stroke();
      }
    }
  }

  // The authored placement a reference field points at. Drawn above regions so
  // an entity inside a region is never hidden by it.
  if (editor.highlightEntityKey) {
    const point = entityScreenPoint(editor, editor.highlightEntityKey);
    if (point) {
      ctx.save();
      ctx.strokeStyle = 'rgba(127,208,232,0.95)';
      ctx.lineWidth = 1.8;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.arc(point.x, point.y, 15, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  // Player starts.
  scenario.players.forEach((player, index) => {
    const color = tryIdentityDef(player.factionId)?.color ?? '#d8e2dd';
    const p = project(player.startX + 0.5, player.startZ + 0.5);
    if (!p.visible) return;
    ctx.strokeStyle = color;
    ctx.fillStyle = 'rgba(7,12,14,0.72)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 16, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(p.x - 22, p.y);
    ctx.lineTo(p.x + 22, p.y);
    ctx.moveTo(p.x, p.y - 22);
    ctx.lineTo(p.x, p.y + 22);
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.font = '600 9px SFMono-Regular, Consolas, monospace';
    const label = `P${index + 1}${player.isAI ? ' AI' : ''}`;
    ctx.fillText(label, p.x - ctx.measureText(label).width / 2, p.y - 22);
  });

  // Validation markers.
  editor.issues.filter((issue) => issue.x !== undefined && issue.z !== undefined).slice(0, 40).forEach((issue, i) => {
    if (issue.x === undefined || issue.z === undefined) return;
    if (!inBounds(scenario.width, scenario.height, issue.x, issue.z)) return;
    const p = project(issue.x + 0.5, issue.z + 0.5);
    if (!p.visible) return;
    ctx.fillStyle = issue.severity === 'error' ? 'rgba(239,108,77,0.95)' : 'rgba(224,163,74,0.9)';
    ctx.beginPath();
    ctx.moveTo(p.x, p.y - 7);
    ctx.lineTo(p.x + 7, p.y);
    ctx.lineTo(p.x, p.y + 7);
    ctx.lineTo(p.x - 7, p.y);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#0b1012';
    ctx.font = '600 7px SFMono-Regular, Consolas, monospace';
    const num = String(i + 1);
    ctx.fillText(num, p.x - ctx.measureText(num).width / 2, p.y + 2.5);
  });

  // Hover brush / placement preview. Region and entity modes replace it: a
  // brush silhouette under a drawing cursor would promise terrain edits the
  // author has not asked for.
  if (editor.hover && !editor.mapToolActive) {
    const { x: hx, z: hz } = editor.hover;
    if (editor.tool === 'structure' && editor.structureDef) {
      const def = BUILDINGS[editor.structureDef];
      if (def) {
        const tx = hx - Math.floor(def.footprint.w / 2);
        const tz = hz - Math.floor(def.footprint.h / 2);
        for (let dz = 0; dz < def.footprint.h; dz++) {
          for (let dx = 0; dx < def.footprint.w; dx++) {
            drawCell(ctx, scenario, project, tx + dx, tz + dz, 'rgba(82,197,230,0.28)', 'rgba(166,232,248,0.8)');
          }
        }
      }
    } else if (editor.tool === 'unit' && editor.unitDef) {
      drawCell(ctx, scenario, project, hx, hz, 'rgba(82,197,230,0.3)', 'rgba(166,232,248,0.9)');
    } else if (editor.tool === 'start') {
      drawCell(ctx, scenario, project, hx, hz, 'rgba(224,163,74,0.3)', 'rgba(241,194,126,0.95)');
    } else {
      const r = editor.brush;
      // The overlay brush previews in its own layer colour, so a crop pass and a
      // terrain pass never look like the same stroke.
      const overlayTint = OVERLAYS[overlayIdOf(editor.overlayId * 4 + editor.overlayDensity)].tint;
      const color = editor.tool === 'ore'
        ? 'rgba(224,163,74,0.32)'
        : editor.tool === 'erase' || editor.tool === 'overlayClear'
          ? 'rgba(239,108,77,0.3)'
          : editor.tool === 'raise' || editor.tool === 'lower'
            ? 'rgba(166,232,248,0.26)'
            : editor.tool === 'overlay'
              ? `rgba(${overlayTint.map((c) => Math.round(c * 255)).join(',')},0.34)`
              : 'rgba(134,199,145,0.26)';
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (dx * dx + dz * dz > r * r + 1) continue;
          drawCell(ctx, scenario, project, hx + dx, hz + dz, color, 'rgba(255,255,255,0.09)');
        }
      }
    }

    const info = editor.hoverInfo();
    ctx.font = '9px SFMono-Regular, Consolas, monospace';
    const text = info;
    const tw = ctx.measureText(text).width;
    const px = editor.hoverScreen.x;
    const py = editor.hoverScreen.y;
    ctx.fillStyle = 'rgba(7,12,14,0.86)';
    ctx.fillRect(px + 16, py + 16, tw + 14, 21);
    ctx.strokeStyle = 'rgba(167,190,184,0.25)';
    ctx.strokeRect(px + 16.5, py + 16.5, tw + 14, 21);
    ctx.fillStyle = '#d8e2dd';
    ctx.fillText(text, px + 23, py + 30);
  }

  // Tool hint strip.
  ctx.font = '9px SFMono-Regular, Consolas, monospace';
  const hint = editor.toolHint();
  ctx.fillStyle = 'rgba(7,12,14,0.82)';
  ctx.fillRect(16, height - 42, ctx.measureText(hint).width + 20, 26);
  ctx.strokeStyle = 'rgba(167,190,184,0.2)';
  ctx.strokeRect(16.5, height - 41.5, ctx.measureText(hint).width + 20, 26);
  ctx.fillStyle = '#8d9d98';
  ctx.fillText(hint, 26, height - 24);
}

/** Screen position of one tile corner, using the same projection as the map. */
function projectTile(
  editor: Editor,
  x: number,
  z: number,
): { x: number; y: number; visible: boolean } {
  const scenario = editor.scenario;
  return editor.app.renderer.camera.worldToScreen(
    x * TILE_SIZE,
    terrainVisualHeight(scenario, x * TILE_SIZE, z * TILE_SIZE) + 0.15,
    z * TILE_SIZE,
  );
}

/** The eight drag grips of a rectangle, in authoring-overlay pixels. */
export function regionHandleScreenPoints(
  editor: Editor,
  rect: TileRect,
): Record<RegionHandle, { x: number; y: number }> {
  const left = rect.x;
  const top = rect.z;
  const right = rect.x + Math.max(1, rect.width);
  const bottom = rect.z + Math.max(1, rect.height);
  const midX = left + (right - left) / 2;
  const midZ = top + (bottom - top) / 2;
  const at = (x: number, z: number) => {
    const point = projectTile(editor, x, z);
    return { x: point.x, y: point.y };
  };
  return {
    nw: at(left, top),
    n: at(midX, top),
    ne: at(right, top),
    e: at(right, midZ),
    se: at(right, bottom),
    s: at(midX, bottom),
    sw: at(left, bottom),
    w: at(left, midZ),
  };
}

/** Centre of an authored placement: footprint centre, or unit tile centre. */
function entityScreenPoint(editor: Editor, key: string): { x: number; y: number } | null {
  const scenario = editor.scenario;
  const structure = scenario.structures.find((entry) => entry.key === key);
  if (structure) {
    const def = BUILDINGS[structure.defId];
    if (!def) return null;
    return projectTile(
      editor,
      structure.x + def.footprint.w / 2,
      structure.z + def.footprint.h / 2,
    );
  }
  const unit = scenario.units.find((entry) => entry.key === key);
  if (!unit) return null;
  return projectTile(editor, unit.x + 0.5, unit.z + 0.5);
}

/** One mission rectangle, with its id and bounds labelled at the top-left. */
function drawRegionRect(
  ctx: CanvasRenderingContext2D,
  project: (x: number, z: number) => { x: number; y: number; visible: boolean },
  rect: TileRect,
  selected: boolean,
  pending = false,
): void {
  const a = project(rect.x, rect.z);
  const b = project(rect.x + rect.width, rect.z);
  const c = project(rect.x + rect.width, rect.z + rect.height);
  const d = project(rect.x, rect.z + rect.height);
  ctx.save();
  ctx.setLineDash(pending ? [3, 3] : selected ? [] : [6, 4]);
  ctx.strokeStyle = selected
    ? 'rgba(241,194,126,0.98)'
    : pending
      ? 'rgba(127,208,232,0.95)'
      : 'rgba(224,163,74,0.75)';
  ctx.fillStyle = selected
    ? 'rgba(241,194,126,0.16)'
    : pending
      ? 'rgba(127,208,232,0.14)'
      : 'rgba(224,163,74,0.07)';
  ctx.lineWidth = selected ? 2.2 : 1.6;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.lineTo(c.x, c.y);
  ctx.lineTo(d.x, d.y);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.setLineDash([]);
  const label = `${rect.width}×${rect.height} @ ${rect.x},${rect.z}`;
  ctx.font = '600 8px SFMono-Regular, Consolas, monospace';
  const width = ctx.measureText(label).width;
  ctx.fillStyle = 'rgba(8,13,15,0.86)';
  ctx.fillRect(a.x, a.y - 14, width + 8, 13);
  ctx.fillStyle = selected ? 'rgba(255,224,178,0.98)' : 'rgba(241,194,126,0.9)';
  ctx.fillText(label, a.x + 4, a.y - 4);
  ctx.restore();
}

function drawCell(
  ctx: CanvasRenderingContext2D,
  scenario: { width: number; height: number; tiles: Array<{ e: number }> },
  project: (x: number, z: number) => { x: number; y: number; visible: boolean },
  x: number,
  z: number,
  fill: string,
  stroke: string,
): void {
  if (x < 0 || z < 0 || x >= scenario.width || z >= scenario.height) return;
  const a = project(x, z);
  const b = project(x + 1, z);
  const c = project(x + 1, z + 1);
  const d = project(x, z + 1);
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.lineTo(c.x, c.y);
  ctx.lineTo(d.x, d.y);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 1;
  ctx.stroke();
}

export function terrainNameAt(editor: Editor, x: number, z: number): string {
  const scenario = editor.scenario;
  if (!scenario || !inBounds(scenario.width, scenario.height, x, z)) return 'Out of bounds';
  const tile = scenario.tiles[tileIndex(scenario.width, x, z)];
  const t = TERRAIN[tile.t as TerrainId];
  return `${t?.name ?? 'Unknown'}${overlayLabel(tile.v)} · E${tile.e}${tile.o > 0 ? ` · ore ${tile.o}` : ''}`;
}

export function unitPaletteName(id: string): string {
  return UNITS[id]?.name ?? id;
}

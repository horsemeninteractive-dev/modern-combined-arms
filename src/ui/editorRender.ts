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

  // Hover brush / placement preview.
  if (editor.hover) {
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

import type { App } from '../app';
import { BUILDINGS, isIndestructibleStructure } from '../data/buildings';
import { UNITS } from '../data/units';
import { FACTIONS } from '../data/factions';
import { TILE_SIZE } from '../sim/constants';
import type { Entity, GameState } from '../sim/types';
import { terrainVisualHeight } from '../render/terrainSurface';
import { relayMeterState } from './relayMeter';

const BLUE = '#52c5e6';
const RED = '#ef6c4d';
const AMBER = '#f1c27e';
const NEUTRAL = '#b9c6c1';

export class Overlay {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  width = 1;
  height = 1;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D overlay context unavailable.');
    this.ctx = ctx;
    this.resize();
  }

  resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.width = Math.max(1, Math.floor(rect.width));
    this.height = Math.max(1, Math.floor(rect.height));
    this.canvas.width = Math.floor(this.width * dpr);
    this.canvas.height = Math.floor(this.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  clear(): void {
    this.ctx.clearRect(0, 0, this.width, this.height);
  }

  draw(app: App): void {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.width, this.height);
    if (app.screen !== 'battle' || !app.game) return;
    const game = app.game;
    const state = game.state;
    const camera = app.renderer.camera;
    const rect = document.getElementById('gl')!.getBoundingClientRect();
    const hovered = app.pointer.over && app.mode === 'none' ? app.pickAt(app.pointer.x, app.pointer.y) : null;

    ctx.save();
    ctx.lineJoin = 'round';

    // Paths and destinations.
    for (const e of app.selectedEntities()) {
      if (e.owner !== app.localPlayerId || e.kind !== 'unit') continue;
      if (e.path.length > e.pathIndex) {
        ctx.beginPath();
        let started = false;
        for (let i = e.pathIndex; i < e.path.length; i++) {
          const p = e.path[i];
          const s = camera.worldToScreen(p.x, terrainVisualHeight(game.state.scenario, p.x, p.z) + 0.3, p.z);
          if (!started) {
            ctx.moveTo(s.x, s.y);
            started = true;
          } else {
            ctx.lineTo(s.x, s.y);
          }
        }
        ctx.strokeStyle = 'rgba(241,194,126,0.45)';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      const dest = e.path[e.path.length - 1];
      if (dest && e.state === 'moving') {
        const s = camera.worldToScreen(dest.x, terrainVisualHeight(game.state.scenario, dest.x, dest.z) + 0.3, dest.z);
        ctx.strokeStyle = 'rgba(241,194,126,0.8)';
        ctx.beginPath();
        ctx.arc(s.x, s.y, 7, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(s.x - 4, s.y);
        ctx.lineTo(s.x + 4, s.y);
        ctx.moveTo(s.x, s.y - 4);
        ctx.lineTo(s.x, s.y + 4);
        ctx.stroke();
      }
      if (e.targetId) {
        const target = game.getEntity(e.targetId);
        if (target) {
          const s = camera.worldToScreen(target.x, terrainVisualHeight(game.state.scenario, target.x, target.z) + 2, target.z);
          ctx.strokeStyle = 'rgba(239,108,77,0.85)';
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.arc(s.x, s.y, 10, 0, Math.PI * 2);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(s.x - 6, s.y);
          ctx.lineTo(s.x + 6, s.y);
          ctx.moveTo(s.x, s.y - 6);
          ctx.lineTo(s.x, s.y + 6);
          ctx.stroke();
        }
      }
    }

    // Selection rings under units and around structures.
    for (const e of app.selectedEntities()) {
      if (e.hp <= 0) continue;
      this.drawSelectionRing(app, e, state);
    }

    // A selected production structure shows where its output is headed.
    this.drawRallyMarkers(app);

    // Health and status.
    for (const e of state.entities) {
      if (e.hp <= 0 || isIndestructibleStructure(e.defId)) continue;
      const visible = e.owner === app.localPlayerId || game.isVisibleTo(app.localPlayerId, e.id);
      if (!visible) continue;
      const selected = app.selected.includes(e.id);
      if (!selected && hovered?.id !== e.id && e.hp >= e.maxHp && e.kind !== 'building') continue;
      if (!selected && hovered?.id !== e.id && e.kind === 'building' && e.hp >= e.maxHp) continue;
      this.drawHealth(app, e, state, selected);
    }

    // Capture-only objectives (signals relays, forward supply depots) always
    // carry an ownership/capture meter: they cannot be destroyed, so the
    // contest over them must be readable at a glance.
    this.drawRelayMeters(app);

    if (hovered) this.drawHoverLabel(app, hovered, rect);

    // Placement ghost.
    if (app.mode === 'place' && app.placeDefId) {
      const site = app.placementAtScreen(app.pointer.x, app.pointer.y);
      if (site) this.drawPlacement(app, app.placeDefId, site.tileX, site.tileZ, site.ok, site.reason);
    }

    // Box selection.
    if (app.dragBox.active) {
      const b = app.dragBox;
      const x = Math.min(b.x0, b.x1) - rect.left;
      const y = Math.min(b.y0, b.y1) - rect.top;
      const w = Math.abs(b.x1 - b.x0);
      const h = Math.abs(b.y1 - b.y0);
      ctx.fillStyle = 'rgba(82,197,230,0.09)';
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = 'rgba(166,232,248,0.9)';
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 3]);
      ctx.strokeRect(x + 0.5, y + 0.5, w, h);
      ctx.setLineDash([]);
    }

    // Gamepad virtual cursor.
    if (app.padCursor.active) {
      const x = app.padCursor.x;
      const y = app.padCursor.y;
      ctx.strokeStyle = 'rgba(241,194,126,0.9)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(x, y, 10, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x - 16, y);
      ctx.lineTo(x - 4, y);
      ctx.moveTo(x + 4, y);
      ctx.lineTo(x + 16, y);
      ctx.moveTo(x, y - 16);
      ctx.lineTo(x, y - 4);
      ctx.moveTo(x, y + 4);
      ctx.lineTo(x, y + 16);
      ctx.stroke();
      ctx.fillStyle = AMBER;
      ctx.beginPath();
      ctx.arc(x, y, 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private drawRelayMeters(app: App): void {
    const game = app.game;
    if (!game) return;
    const camera = app.renderer.camera;
    const ctx = this.ctx;
    const width = 68;
    ctx.textAlign = 'center';
    for (const relay of game.state.entities) {
      if (!isIndestructibleStructure(relay.defId) || !BUILDINGS[relay.defId]?.capturable) continue;
      if (relay.hp <= 0) continue;
      if (relay.owner !== app.localPlayerId && !game.isVisibleTo(app.localPlayerId, relay.id)) continue;
      const def = BUILDINGS[relay.defId];
      const p = camera.worldToScreen(
        relay.x,
        terrainVisualHeight(game.state.scenario, relay.x, relay.z) +
          (def?.footprint.h ?? 2) * TILE_SIZE * 0.42 +
          2.2,
        relay.z,
      );
      if (!p.visible) continue;
      const meter = relayMeterState(game, relay);
      const x = p.x - width / 2;
      const y = p.y - 6;
      ctx.font = '600 8px SFMono-Regular, Consolas, monospace';
      const labelWidth = ctx.measureText(meter.caption).width;
      ctx.fillStyle = 'rgba(7,12,14,0.78)';
      ctx.fillRect(p.x - labelWidth / 2 - 3, y - 12, labelWidth + 6, 10);
      ctx.fillStyle =
        meter.owner === app.localPlayerId ? '#a6e8f8' : meter.owner === -1 ? '#d8e2dd' : '#ffb29b';
      ctx.fillText(meter.caption, p.x, y - 4);
      ctx.fillStyle = 'rgba(4,8,9,0.82)';
      ctx.fillRect(x - 1, y - 1, width + 2, 7);
      // Ownership tint, then the engineer's live capture progress over it.
      ctx.globalAlpha = meter.owner === -1 ? 0.22 : 0.5;
      ctx.fillStyle = meter.ownerColor;
      ctx.fillRect(x, y, width, 5);
      ctx.globalAlpha = 1;
      if (meter.progress > 0) {
        ctx.fillStyle = meter.capturerColor;
        ctx.fillRect(x, y, width * Math.max(0, Math.min(1, meter.progress)), 5);
      }
      ctx.strokeStyle = 'rgba(167,190,184,0.5)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, width - 1, 4);
    }
    ctx.textAlign = 'left';
  }

  /**
   * Rally point for every selected facility that produces units: a dashed
   * tether from the building and a small flag at the destination. Units are
   * built on the apron and walk here, so the marker has to be legible before
   * the next unit finishes.
   */
  private drawRallyMarkers(app: App): void {
    const game = app.game;
    if (!game) return;
    const camera = app.renderer.camera;
    const ctx = this.ctx;
    for (const e of app.selectedEntities()) {
      if (e.owner !== app.localPlayerId || e.kind !== 'building') continue;
      if (!BUILDINGS[e.defId]?.produces) continue;
      if (!Number.isFinite(e.rallyX) || !Number.isFinite(e.rallyZ)) continue;
      const from = camera.worldToScreen(
        e.x,
        terrainVisualHeight(game.state.scenario, e.x, e.z) + 2.4,
        e.z,
      );
      const to = camera.worldToScreen(
        e.rallyX,
        terrainVisualHeight(game.state.scenario, e.rallyX, e.rallyZ) + 0.35,
        e.rallyZ,
      );
      if (!from.visible || !to.visible) continue;
      ctx.strokeStyle = 'rgba(241,194,126,0.5)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.strokeStyle = 'rgba(241,194,126,0.95)';
      ctx.beginPath();
      ctx.moveTo(to.x, to.y);
      ctx.lineTo(to.x, to.y - 13);
      ctx.stroke();
      ctx.fillStyle = 'rgba(241,194,126,0.92)';
      ctx.beginPath();
      ctx.moveTo(to.x, to.y - 13);
      ctx.lineTo(to.x + 8, to.y - 10.5);
      ctx.lineTo(to.x, to.y - 8);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.arc(to.x, to.y, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawSelectionRing(app: App, e: Entity, state: GameState): void {
    const game = app.game;
    if (!game) return;
    const camera = app.renderer.camera;
    const ctx = this.ctx;
    const def = e.kind === 'unit' ? UNITS[e.defId] : BUILDINGS[e.defId];
    if (!def) return;
    const color = e.owner === app.localPlayerId ? BLUE : e.owner === -1 ? NEUTRAL : RED;
    if (e.kind === 'unit') {
      const altitude = UNITS[e.defId]?.domain === 'air' ? 13 : 0;
      const p = camera.worldToScreen(e.x, terrainVisualHeight(game.state.scenario, e.x, e.z) + altitude + 0.15, e.z);
      if (!p.visible) return;
      const scale = camera.width / (camera.halfW * 2);
      const r = ('radius' in def ? def.radius : 2) * scale;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, Math.max(7, r), Math.max(4, r * 0.55), 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = 'rgba(82,197,230,0.12)';
      ctx.fill();
      if (e.kind === 'unit' && UNITS[e.defId]?.domain === 'air') {
        const ground = camera.worldToScreen(e.x, terrainVisualHeight(game.state.scenario, e.x, e.z), e.z);
        ctx.strokeStyle = 'rgba(166,232,248,0.24)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(ground.x, ground.y);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
      }
    } else {
      const fw = BUILDINGS[e.defId]?.footprint.w ?? 2;
      const fh = BUILDINGS[e.defId]?.footprint.h ?? 2;
      const x0 = e.x - (fw * TILE_SIZE) / 2;
      const z0 = e.z - (fh * TILE_SIZE) / 2;
      const pts = [
        camera.worldToScreen(x0, terrainVisualHeight(game.state.scenario, x0, z0) + 0.1, z0),
        camera.worldToScreen(x0 + fw * TILE_SIZE, terrainVisualHeight(game.state.scenario, x0 + fw * TILE_SIZE, z0) + 0.1, z0),
        camera.worldToScreen(x0 + fw * TILE_SIZE, terrainVisualHeight(game.state.scenario, x0 + fw * TILE_SIZE, z0 + fh * TILE_SIZE) + 0.1, z0 + fh * TILE_SIZE),
        camera.worldToScreen(x0, terrainVisualHeight(game.state.scenario, x0, z0 + fh * TILE_SIZE) + 0.1, z0 + fh * TILE_SIZE),
      ];
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.closePath();
      ctx.stroke();
      ctx.fillStyle = 'rgba(82,197,230,0.08)';
      ctx.fill();
    }
    void state;
  }

  private drawHealth(app: App, e: Entity, state: GameState, selected: boolean): void {
    const game = app.game;
    if (!game) return;
    const camera = app.renderer.camera;
    const ctx = this.ctx;
    const def = e.kind === 'unit' ? UNITS[e.defId] : BUILDINGS[e.defId];
    if (!def) return;
    const altitude = e.kind === 'unit' && UNITS[e.defId]?.domain === 'air' ? 13 : 0;
    const worldH = e.kind === 'building' ? (BUILDINGS[e.defId]?.footprint.h ?? 2) * TILE_SIZE * 0.45 : 5;
    const p = camera.worldToScreen(e.x, terrainVisualHeight(game.state.scenario, e.x, e.z) + altitude + worldH, e.z);
    if (!p.visible) return;
    const width = e.kind === 'building' ? Math.min(58, 16 + (BUILDINGS[e.defId]?.footprint.w ?? 2) * 7) : selected ? 30 : 24;
    const frac = Math.max(0, Math.min(1, e.hp / e.maxHp));
    const color = frac > 0.6 ? '#86c791' : frac > 0.3 ? '#e0a34a' : '#ef6c4d';
    const x = p.x - width / 2;
    const y = p.y - 8;
    ctx.fillStyle = 'rgba(4,8,9,0.72)';
    ctx.fillRect(x - 1, y - 1, width + 2, 6);
    ctx.fillStyle = color;
    ctx.fillRect(x, y, width * frac, 4);
    const team = e.owner === -1 ? NEUTRAL : app.game?.player(e.owner)?.factionId === 'expeditionary' ? RED : BLUE;
    ctx.fillStyle = team;
    ctx.fillRect(x - 1, y - 1, 2, 6);
    if (selected && e.suppression > 0.2) {
      ctx.fillStyle = 'rgba(224,163,74,0.8)';
      ctx.fillRect(x, y + 5, width * Math.min(1, e.suppression), 2);
    }
    void state;
  }

  private drawHoverLabel(app: App, e: Entity, rect: DOMRect): void {
    const game = app.game;
    if (!game) return;
    const def = e.kind === 'unit' ? UNITS[e.defId] : BUILDINGS[e.defId];
    if (!def) return;
    const ctx = this.ctx;
    const x = app.pointer.x - rect.left + 16;
    const y = app.pointer.y - rect.top + 16;
    const p = game.player(e.owner);
    const faction = p ? FACTIONS[p.factionId]?.shortName ?? p.name : 'NEUTRAL';
    const title = def.name;
    // A charted structure outside vision reports no live integrity: the player
    // only remembers that it is there.
    const remembered = game.visionStateOf(game.teamOf(app.localPlayerId), e.id) === 'remembered';
    const sub = remembered
      ? `${faction} · LAST KNOWN POSITION`
      : `${faction} · ${Math.ceil(e.hp)}/${Math.ceil(e.maxHp)}${e.construction ? ' · UNDER CONSTRUCTION' : ''}`;
    ctx.font = '600 11px Inter, Segoe UI, sans-serif';
    const w = Math.max(ctx.measureText(title).width, ctx.measureText(sub).width) + 18;
    ctx.fillStyle = 'rgba(7,12,14,0.9)';
    ctx.strokeStyle = 'rgba(167,190,184,0.3)';
    ctx.lineWidth = 1;
    ctx.fillRect(x, y, w, 38);
    ctx.strokeRect(x + 0.5, y + 0.5, w, 38);
    ctx.fillStyle = e.owner === app.localPlayerId ? '#a6e8f8' : e.owner === -1 ? '#d8e2dd' : '#ffb29b';
    ctx.fillText(title, x + 9, y + 15);
    ctx.font = '9px SFMono-Regular, Consolas, monospace';
    ctx.fillStyle = 'rgba(141,157,152,0.9)';
    ctx.fillText(sub, x + 9, y + 28);
  }

  private drawPlacement(app: App, defId: string, tileX: number, tileZ: number, ok: boolean, reason: string): void {
    const game = app.game;
    if (!game) return;
    const def = BUILDINGS[defId];
    const camera = app.renderer.camera;
    const ctx = this.ctx;
    const color = ok ? 'rgba(134,199,145,0.9)' : 'rgba(239,108,77,0.9)';
    const fill = ok ? 'rgba(134,199,145,0.16)' : 'rgba(239,108,77,0.14)';
    const corners = [
      [tileX, tileZ],
      [tileX + def.footprint.w, tileZ],
      [tileX + def.footprint.w, tileZ + def.footprint.h],
      [tileX, tileZ + def.footprint.h],
    ].map(([tx, tz]) => {
      const wx = tx * TILE_SIZE;
      const wz = tz * TILE_SIZE;
      return camera.worldToScreen(wx, terrainVisualHeight(game.state.scenario, wx, wz) + 0.3, wz);
    });
    ctx.beginPath();
    ctx.moveTo(corners[0].x, corners[0].y);
    for (let i = 1; i < corners.length; i++) ctx.lineTo(corners[i].x, corners[i].y);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.6;
    ctx.stroke();
    const c = camera.worldToScreen(
      (tileX + def.footprint.w / 2) * TILE_SIZE,
      terrainVisualHeight(
        game.state.scenario,
        (tileX + def.footprint.w / 2) * TILE_SIZE,
        (tileZ + def.footprint.h / 2) * TILE_SIZE,
      ) + 1,
      (tileZ + def.footprint.h / 2) * TILE_SIZE,
    );
    ctx.font = '600 10px SFMono-Regular, Consolas, monospace';
    ctx.fillStyle = color;
    const label = ok ? def.shortName : reason;
    ctx.fillText(label, c.x - ctx.measureText(label).width / 2, c.y - 6);
  }
}

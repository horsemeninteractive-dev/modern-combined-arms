import type { App } from '../app';
import { BUILDINGS, isIndestructibleStructure } from '../data/buildings';
import { UNITS } from '../data/units';
import { tryIdentityDef } from '../data/factions';
import { TILE_SIZE } from '../sim/constants';
import type { Entity, GameState } from '../sim/types';
import { terrainVisualHeight } from '../render/terrainSurface';
import { AIR_UNIT_ALTITUDE, unitBannerHeight } from '../render/unitMeshes';
import { buildingBannerAnchor, buildingBannerPoints, buildingTopHeight } from '../render/buildingMeshes';
import { buildingWireframe } from '../render/buildingWireframe';
import { relayMeterState } from './relayMeter';
import {
  HEALTH_COLORS,
  HEALTH_SEGMENTS,
  HEALTH_SOFT_COLORS,
  SERVICE_ROW_HEIGHT,
  ammoPips,
  clampFraction,
  fuelFraction,
  hasServiceStrip,
  healthPercent,
  healthPulse,
  healthSegments,
  healthTone,
  serviceStripLayout,
  supplyTone,
} from './bars';
import { experienceOf, rankForXp } from '../sim/veterancy';
import { drawOrderGhostGlyph } from './cursors';
import {
  GHOST_ECHOES,
  GHOST_ECHO_STAGGER_MS,
  ORDER_GHOST_LIFE_MS,
  ghostOpacity,
  ghostProgress,
  ghostRise,
  ghostScale,
  pruneOrderGhosts,
} from './orderGhosts';

const BLUE = '#52c5e6';
const RED = '#ef6c4d';
const AMBER = '#f1c27e';
const NEUTRAL = '#b9c6c1';

export class Overlay {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  width = 1;
  height = 1;
  /** Continuous reticle motion is suppressed for reduced-motion players. */
  private reducedMotion =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

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

    // A site under construction keeps its building's own outline for the whole
    // build: the growing model fills in a frame that is always the real shape.
    for (const e of state.entities) {
      if (e.kind !== 'building' || !e.construction || e.hp <= 0) continue;
      if (e.owner !== app.localPlayerId && !game.isVisibleTo(app.localPlayerId, e.id)) continue;
      this.drawConstructionOutline(app, e, state);
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

    // The training director's current ground marker. It sits above selection
    // rings and paths so the next lane is never mistaken for an order.
    this.drawTutorialMarker(app);

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
    const now = performance.now();
    this.drawOrderGhosts(app, now, rect.left, rect.top);
    ctx.restore();
  }

  /**
   * Fading impressions of accepted right-click orders. Each click leaves three
   * staggered echoes that grow, drift up and fade, plus a ring that spreads
   * from the point: the mark confirms *where* the order landed without
   * lingering long enough to clutter a fight.
   */
  private drawOrderGhosts(app: App, now: number, offsetX: number, offsetY: number): void {
    const ghosts = pruneOrderGhosts(app.orderGhosts, now);
    const ctx = this.ctx;
    for (const ghost of ghosts) {
      const progress = ghostProgress(ghost.born, now);
      const x = ghost.x - offsetX;
      const y = ghost.y - offsetY;
      const color = ghost.kind === 'attack' ? RED : AMBER;
      for (let echo = 0; echo < GHOST_ECHOES; echo += 1) {
        // Each echo starts a beat later, so the trail reads as a quick smear
        // rather than three pointers stacked on one pixel.
        const delayed = Math.max(0, progress - (echo * GHOST_ECHO_STAGGER_MS) / ORDER_GHOST_LIFE_MS);
        if (delayed <= 0) continue;
        drawOrderGhostGlyph(
          ctx,
          ghost.kind,
          x,
          y,
          ghostScale(delayed) + echo * 0.08,
          ghostOpacity(delayed) * (1 - echo * 0.26),
          ghostRise(delayed),
        );
      }
      const spread = Math.min(1, Math.max(0, progress));
      ctx.save();
      ctx.globalAlpha = Math.pow(1 - spread, 1.5) * 0.55;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(x, y, 6 + spread * 18, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  /**
   * Amber ring and label for the active training lane. The marker is a
   * presentation aid, not an entity: it never collides, picks or reaches the
   * simulation, and it follows the same fog gate as every other overlay.
   */
  private drawTutorialMarker(app: App): void {
    const marker = app.tutorial?.marker();
    const game = app.game;
    if (!marker || !game) return;
    const camera = app.renderer.camera;
    const ctx = this.ctx;
    let x = marker.x ?? 0;
    let z = marker.z ?? 0;
    if (marker.entityId) {
      const entity = game.getEntity(marker.entityId);
      if (!entity || entity.hp <= 0) return;
      if (
        entity.owner !== app.localPlayerId &&
        !game.isVisibleTo(app.localPlayerId, entity.id)
      ) return;
      x = entity.x;
      z = entity.z;
    }
    const ground = terrainVisualHeight(game.state.scenario, x, z);
    const center = camera.worldToScreen(x, ground + 0.35, z);
    const pulse = 0.72 + 0.28 * Math.sin(performance.now() / 320);

    ctx.save();
    ctx.lineJoin = 'round';
    ctx.strokeStyle = marker.color;
    ctx.fillStyle = marker.color;
    ctx.setLineDash([5, 4]);
    ctx.lineWidth = 1.6;
    ctx.globalAlpha = 0.3 + 0.35 * pulse;
    ctx.beginPath();
    for (let i = 0; i <= 32; i++) {
      const angle = (i / 32) * Math.PI * 2;
      const px = x + Math.cos(angle) * marker.radius;
      const pz = z + Math.sin(angle) * marker.radius;
      const point = camera.worldToScreen(
        px,
        terrainVisualHeight(game.state.scenario, px, pz) + 0.3,
        pz,
      );
      if (i === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    // A short vertical stake anchors the ring to its label on a crowded map.
    const top = camera.worldToScreen(x, ground + 3.4, z);
    ctx.globalAlpha = 0.65;
    ctx.beginPath();
    ctx.moveTo(center.x, center.y);
    ctx.lineTo(top.x, top.y);
    ctx.stroke();

    ctx.font = '700 9px SFMono-Regular, Consolas, monospace';
    ctx.textAlign = 'center';
    const labelWidth = ctx.measureText(marker.label).width;
    let labelX = center.x;
    let labelY = Math.min(center.y, top.y) - 9;
    if (center.visible) {
      labelX = Math.max(labelWidth / 2 + 8, Math.min(this.width - labelWidth / 2 - 8, labelX));
      labelY = Math.max(24, labelY);
    } else {
      // Off-screen lanes become a clamped chevron at the edge of the view, so a
      // player who panned away still knows which way the next order lies.
      const cx = this.width / 2;
      const cy = this.height / 2;
      const dx = center.x - cx;
      const dy = center.y - cy;
      const length = Math.hypot(dx, dy);
      if (length < 1) {
        ctx.restore();
        return;
      }
      const scale = Math.min(
        (this.width / 2 - 44) / Math.abs(dx || 1),
        (this.height / 2 - 44) / Math.abs(dy || 1),
        1,
      );
      const ax = cx + dx * scale;
      const ay = cy + dy * scale;
      const angle = Math.atan2(dy, dx);
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      ctx.moveTo(ax + Math.cos(angle) * 10, ay + Math.sin(angle) * 10);
      ctx.lineTo(ax + Math.cos(angle + 2.5) * 9, ay + Math.sin(angle + 2.5) * 9);
      ctx.lineTo(ax + Math.cos(angle - 2.5) * 9, ay + Math.sin(angle - 2.5) * 9);
      ctx.closePath();
      ctx.fill();
      labelX = Math.max(labelWidth / 2 + 8, Math.min(this.width - labelWidth / 2 - 8, ax));
      labelY = Math.max(24, Math.min(this.height - 12, ay - 14));
    }
    ctx.globalAlpha = 0.92;
    ctx.fillStyle = 'rgba(7,12,14,0.88)';
    ctx.fillRect(labelX - labelWidth / 2 - 6, labelY - 10, labelWidth + 12, 13);
    ctx.globalAlpha = 0.55;
    ctx.strokeStyle = marker.color;
    ctx.lineWidth = 1;
    ctx.strokeRect(labelX - labelWidth / 2 - 5.5, labelY - 9.5, labelWidth + 11, 12);
    ctx.globalAlpha = 1;
    ctx.fillStyle = marker.color;
    ctx.fillText(marker.label, labelX, labelY);
    ctx.restore();
  }

  private drawRelayMeters(app: App): void {
    const game = app.game;
    if (!game) return;
    const camera = app.renderer.camera;
    const ctx = this.ctx;
    const width = 68;
    ctx.textAlign = 'center';
    const team = game.teamOf(app.localPlayerId);
    for (const relay of game.state.entities) {
      // Every strategic objective carries its control meter, destructible or
      // not. A radar station changes hands by capture exactly like a relay, so
      // it cannot be the one objective with no readable owner.
      if (!BUILDINGS[relay.defId]?.capturable) continue;
      if (relay.hp <= 0) continue;
      // Remembered ground still names the holder: a charted objective keeps its
      // owner label, but not live capture progress nobody is watching.
      const state = game.visionStateOf(team, relay.id);
      if (state === 'hidden') continue;
      const remembered = state !== 'visible';
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
      const caption = remembered ? meter.ownerLabel : meter.caption;
      const progress = remembered ? 0 : meter.progress;
      const x = p.x - width / 2;
      const y = p.y - 6;
      ctx.font = '600 8px SFMono-Regular, Consolas, monospace';
      const labelWidth = ctx.measureText(caption).width;
      ctx.fillStyle = 'rgba(7,12,14,0.78)';
      ctx.fillRect(p.x - labelWidth / 2 - 3, y - 12, labelWidth + 6, 10);
      ctx.fillStyle =
        meter.owner === app.localPlayerId ? '#a6e8f8' : meter.owner === -1 ? '#d8e2dd' : '#ffb29b';
      ctx.fillText(caption, p.x, y - 4);
      ctx.fillStyle = 'rgba(4,8,9,0.82)';
      ctx.fillRect(x - 1, y - 1, width + 2, 7);
      // Ownership tint, then the engineer's live capture progress over it.
      ctx.globalAlpha = (meter.owner === -1 ? 0.22 : 0.5) * (remembered ? 0.6 : 1);
      ctx.fillStyle = meter.ownerColor;
      ctx.fillRect(x, y, width, 5);
      ctx.globalAlpha = 1;
      if (progress > 0) {
        ctx.fillStyle = meter.capturerColor;
        ctx.fillRect(x, y, width * Math.max(0, Math.min(1, progress)), 5);
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
      const altitude =
        UNITS[e.defId]?.domain === 'air' && !e.aircraft?.landed ? AIR_UNIT_ALTITUDE : 0;
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

  /** The building's own feature-edge outline, projected into the overlay. */
  private strokeBuildingOutline(
    app: App,
    defId: string,
    centerX: number,
    baseY: number,
    centerZ: number,
    facing: number,
    color: string,
    alpha: number,
    width: number,
  ): void {
    const edges = buildingWireframe(defId);
    if (edges.length === 0) return;
    const camera = app.renderer.camera;
    const ctx = this.ctx;
    // The renderer draws buildings with `modelFor(..., -facing, ...)`.
    const cos = Math.cos(-facing);
    const sin = Math.sin(-facing);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    for (let i = 0; i < edges.length; i += 6) {
      const ax = edges[i];
      const ay = edges[i + 1];
      const az = edges[i + 2];
      const bx = edges[i + 3];
      const by = edges[i + 4];
      const bz = edges[i + 5];
      const from = camera.worldToScreen(
        centerX + ax * cos + az * sin,
        baseY + ay,
        centerZ - ax * sin + az * cos,
      );
      const to = camera.worldToScreen(
        centerX + bx * cos + bz * sin,
        baseY + by,
        centerZ - bx * sin + bz * cos,
      );
      if (!from.visible && !to.visible) continue;
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
    }
    ctx.stroke();
    ctx.restore();
  }

  private drawConstructionOutline(app: App, e: Entity, state: GameState): void {
    const player = state.scenario.players.find((entry) => entry.id === e.owner);
    const colour = player?.color ?? tryIdentityDef(player?.factionId ?? '')?.color ?? BLUE;
    // The frame hands over to the built structure: strongest on a bare site,
    // gone by the time the model has filled it.
    const fade = Math.max(0, 1 - e.buildProgress);
    this.strokeBuildingOutline(
      app,
      e.defId,
      e.x,
      terrainVisualHeight(state.scenario, e.x, e.z),
      e.z,
      e.facing,
      colour,
      0.34 * fade,
      0.9,
    );
  }

  private drawHealth(app: App, e: Entity, state: GameState, selected: boolean): void {
    const game = app.game;
    if (!game) return;
    const camera = app.renderer.camera;
    const ctx = this.ctx;
    const def = e.kind === 'unit' ? UNITS[e.defId] : BUILDINGS[e.defId];
    if (!def) return;
    const altitude =
      e.kind === 'unit' && UNITS[e.defId]?.domain === 'air' && !e.aircraft?.landed
        ? AIR_UNIT_ALTITUDE
        : 0;
    // Structures anchor above the highest projected point of their top band.
    // A single world height cannot guarantee that after rotation: the local
    // top can swing toward the camera while a lower central roof projects
    // higher on screen. Project every top-band point, then centre the bar on
    // that screen edge. Units keep their own banner contract untouched.
    let p: { x: number; y: number; visible: boolean };
    if (e.kind === 'building') {
      const anchor = buildingBannerAnchor(e.defId);
      const c = Math.cos(e.facing);
      const s = Math.sin(e.facing);
      const center = camera.worldToScreen(
        e.x,
        terrainVisualHeight(game.state.scenario, e.x, e.z) + anchor.y,
        e.z,
      );
      let topScreenY = Infinity;
      let anyVisible = false;
      for (const point of buildingBannerPoints(e.defId)) {
        const px = e.x + c * point.x - s * point.z;
        const pz = e.z + s * point.x + c * point.z;
        const projected = camera.worldToScreen(
          px,
          terrainVisualHeight(game.state.scenario, px, pz) + point.y,
          pz,
        );
        if (!projected.visible) continue;
        anyVisible = true;
        topScreenY = Math.min(topScreenY, projected.y);
      }
      p = {
        x: center.x,
        y: Number.isFinite(topScreenY) ? topScreenY - 2 : center.y,
        visible: anyVisible || center.visible,
      };
    } else {
      p = camera.worldToScreen(
        e.x,
        terrainVisualHeight(game.state.scenario, e.x, e.z) + altitude + unitBannerHeight(e.defId),
        e.z,
      );
    }
    if (!p.visible) return;
    const isBuilding = e.kind === 'building';
    const width = isBuilding ? Math.min(58, 16 + (BUILDINGS[e.defId]?.footprint.w ?? 2) * 7) : selected ? 30 : 24;
    const height = 5;
    const frac = clampFraction(e.hp / e.maxHp);
    const tone = healthTone(frac);
    const color = HEALTH_COLORS[tone];
    const x = Math.round(p.x - width / 2);
    const y = Math.round(p.y - 9);
    const team =
      e.owner === -1
        ? NEUTRAL
        : game.teamOf(e.owner) === game.teamOf(app.localPlayerId)
          ? BLUE
          : RED;
    const pulse = healthPulse(frac, performance.now(), this.reducedMotion);

    // A notched dark plate frames the bar, so health reads as an instrument on
    // the battlefield rather than a floating colour stripe. The notch matches
    // the command rail's clipped corners; the team rule uses the plate's full
    // height so ownership is legible even at 10% health.
    const plateX = x - 3;
    const plateY = y - 3;
    const plateW = width + 6;
    const plateH = height + 6;
    const notch = 3;
    ctx.beginPath();
    ctx.moveTo(plateX, plateY + notch);
    ctx.lineTo(plateX + notch, plateY);
    ctx.lineTo(plateX + plateW, plateY);
    ctx.lineTo(plateX + plateW, plateY + plateH);
    ctx.lineTo(plateX, plateY + plateH);
    ctx.closePath();
    ctx.fillStyle = 'rgba(4,8,9,0.82)';
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle =
      tone === 'critical'
        ? `rgba(239,108,77,${0.45 + 0.35 * pulse})`
        : 'rgba(167,190,184,0.3)';
    ctx.stroke();

    // The empty channel keeps its scale visible: a hull at 10% still shows the
    // ten cells it used to fill, hatched red so the loss reads as damage rather
    // than as a bar that was always that short.
    ctx.fillStyle = 'rgba(255,255,255,0.07)';
    ctx.fillRect(x, y, width, height);
    if (tone === 'critical') {
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, width, height);
      ctx.clip();
      ctx.strokeStyle = 'rgba(239,108,77,0.32)';
      ctx.lineWidth = 1;
      for (let hx = -height; hx < width + height; hx += 4) {
        ctx.beginPath();
        ctx.moveTo(x + hx, y + height);
        ctx.lineTo(x + hx + height, y);
        ctx.stroke();
      }
      ctx.restore();
    }
    // Fill snaps to the drawn cells so the bar reads as counted segments, not a
    // continuous smear: ten cells, each one a tenth of the hull's condition.
    const lit = (healthSegments(frac, HEALTH_SEGMENTS) / HEALTH_SEGMENTS) * width;
    ctx.fillStyle = color;
    ctx.fillRect(x, y, lit, height);
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.fillRect(x, y, lit, 1);
    ctx.fillStyle = 'rgba(4,8,9,0.6)';
    for (let i = 1; i < HEALTH_SEGMENTS; i++) {
      ctx.fillRect(x + Math.round((width * i) / HEALTH_SEGMENTS), y, 1, height);
    }
    ctx.fillStyle = team;
    ctx.fillRect(plateX, plateY + notch, 2, plateH - notch);

    // Rank chevrons ride above the plate: one for a Veteran crew, two for
    // Elite. They are the only battlefield cue that a hull is worth more than
    // its armour, and they read at the same glance as the health below them.
    const rank = e.kind === 'unit' ? rankForXp(experienceOf(e)) : 0;
    if (rank > 0) {
      ctx.fillStyle = 'rgba(240,196,110,0.95)';
      for (let i = 0; i < rank; i++) {
        const cy = plateY - 2 - i * 3.5;
        ctx.beginPath();
        ctx.moveTo(x + 1, cy);
        ctx.lineTo(x + 4, cy - 2.5);
        ctx.lineTo(x + 7, cy);
        ctx.lineTo(x + 7, cy + 1.4);
        ctx.lineTo(x + 4, cy - 1.1);
        ctx.lineTo(x + 1, cy + 1.4);
        ctx.closePath();
        ctx.fill();
      }
    }

    let bottom = plateY + plateH;
    if (selected) {
      // The exact percentage is a decision aid, not battle noise: it only
      // appears on the hull the player is actually looking at.
      ctx.font = '700 9px SFMono-Regular, Consolas, monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = HEALTH_SOFT_COLORS[tone];
      ctx.fillText(`${healthPercent(frac)}%`, plateX + plateW + 4, y + height);
    }
    if (selected && e.kind === 'unit' && hasServiceStrip(UNITS[e.defId]?.domain)) {
      bottom += this.drawServiceStrip(e, plateX, bottom + 5, plateW) + 4;
    }
    if (selected && e.suppression > 0.2) {
      ctx.fillStyle = 'rgba(224,163,74,0.8)';
      ctx.fillRect(x, bottom + 2, width * Math.min(1, e.suppression), 2);
    }
    void state;
  }

  /**
   * Fuel and ammunition beneath a selected aircraft's or ship's health bar.
   *
   * These are the two consumables that force an aircraft home or a ship to a
   * yard, so they belong beside the hull's condition rather than behind a panel:
   * a blue rail that turns amber then red as endurance runs out, and one pale
   * pip per remaining round. The selection panel carries the labelled figures.
   */
  private drawServiceStrip(e: Entity, x: number, y: number, width: number): number {
    const ctx = this.ctx;
    const fuel = e.maxFuel > 0 ? fuelFraction(e.fuel, e.maxFuel) : null;
    const pips = ammoPips(e.ammo, e.maxAmmo);
    const layout = serviceStripLayout(e.ammo, e.maxAmmo, e.maxFuel, width);
    const rowH = SERVICE_ROW_HEIGHT;
    const contentH = layout.contentHeight;
    if (contentH <= 0) return 0;
    const top = Math.round(y);

    // The backing is exactly the plate's width, so the strip reads as a second
    // instrument hung below the hull bar instead of a wider panel under it.
    ctx.fillStyle = 'rgba(4,8,9,0.8)';
    ctx.fillRect(x, top - 1, width, contentH + 2);
    ctx.strokeStyle = 'rgba(167,190,184,0.2)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, top - 0.5, width - 1, contentH + 1);

    let rowY = top;
    if (fuel !== null) {
      const tone = supplyTone(fuel);
      const colour =
        tone === 'ok' ? '#52c5e6' : tone === 'low' ? '#e0a34a' : '#ef6c4d';
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.fillRect(x, rowY, width, layout.fuelRow);
      ctx.fillStyle = colour;
      ctx.fillRect(x, rowY, Math.max(fuel > 0 ? 1 : 0, width * fuel), layout.fuelRow);
      // Six ticks give the rail a scale; the DOM meter repeats the same cadence.
      ctx.fillStyle = 'rgba(4,8,9,0.55)';
      for (let i = 1; i < 6; i++) {
        ctx.fillRect(x + Math.round((width * i) / 6), rowY, 1, layout.fuelRow);
      }
      rowY += layout.fuelRow + layout.rowGap;
    }
    const pipX = Math.round(x + (width - layout.ammoWidth) / 2);
    for (let i = 0; i < pips.length; i++) {
      ctx.fillStyle = pips[i] ? '#f1c27e' : 'rgba(255,255,255,0.12)';
      ctx.fillRect(pipX + i * (layout.pipWidth + layout.pipGap), rowY, layout.pipWidth, rowH);
    }
    return contentH + 2;
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
    const faction = p ? tryIdentityDef(p.factionId)?.shortName || p.name : 'NEUTRAL';
    const title = def.name;
    // A charted structure outside vision reports no live integrity: the player
    // only remembers that it is there.
    const remembered = game.visionStateOf(game.teamOf(app.localPlayerId), e.id) === 'remembered';
    const sub = remembered
      ? `${faction} · LAST KNOWN POSITION`
      : `${faction} · ${Math.ceil(e.hp)}/${Math.ceil(e.maxHp)}${e.construction ? ' · UNDER CONSTRUCTION' : ''}`;
    // A charted objective is a legal order even with nobody looking at it. The
    // ghost is dim by design, so the label has to carry the invitation: without
    // it there is nothing on screen to tell the player the silhouette can still
    // be taken from memory.
    const capturable = !!BUILDINGS[e.defId]?.capturable && e.owner !== app.localPlayerId;
    const engineerReady =
      capturable &&
      app.ownSelected().some((u) => UNITS[u.defId]?.canCapture && !u.garrisonId);
    const action = engineerReady
      ? remembered
        ? 'RIGHT-CLICK · CAPTURE FROM MEMORY'
        : 'RIGHT-CLICK · CAPTURE'
      : '';
    ctx.font = '600 11px Inter, Segoe UI, sans-serif';
    let w = Math.max(ctx.measureText(title).width, ctx.measureText(sub).width) + 18;
    if (action) {
      ctx.font = '9px SFMono-Regular, Consolas, monospace';
      w = Math.max(w, ctx.measureText(action).width + 18);
    }
    const h = action ? 50 : 38;
    ctx.fillStyle = 'rgba(7,12,14,0.9)';
    ctx.strokeStyle = 'rgba(167,190,184,0.3)';
    ctx.lineWidth = 1;
    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x + 0.5, y + 0.5, w, h);
    ctx.font = '600 11px Inter, Segoe UI, sans-serif';
    ctx.fillStyle = e.owner === app.localPlayerId ? '#a6e8f8' : e.owner === -1 ? '#d8e2dd' : '#ffb29b';
    ctx.fillText(title, x + 9, y + 15);
    ctx.font = '9px SFMono-Regular, Consolas, monospace';
    ctx.fillStyle = 'rgba(141,157,152,0.9)';
    ctx.fillText(sub, x + 9, y + 28);
    if (action) {
      ctx.fillStyle = 'rgba(224,163,74,0.95)';
      ctx.fillText(action, x + 9, y + 42);
    }
  }

  private drawPlacement(app: App, defId: string, tileX: number, tileZ: number, ok: boolean, reason: string): void {
    const game = app.game;
    if (!game) return;
    const def = BUILDINGS[defId];
    const camera = app.renderer.camera;
    const ctx = this.ctx;
    const color = ok ? 'rgba(134,199,145,0.92)' : 'rgba(239,108,77,0.92)';
    const fill = ok ? 'rgba(134,199,145,0.09)' : 'rgba(239,108,77,0.08)';
    const w = def.footprint.w;
    const h = def.footprint.h;
    const groundAt = (tx: number, tz: number): number =>
      terrainVisualHeight(game.state.scenario, tx * TILE_SIZE, tz * TILE_SIZE);
    // Terrain is sampled at each corner, so the frame follows a slope instead of
    // hovering as one flat plane.
    const corners = [
      { x: tileX, z: tileZ },
      { x: tileX + w, z: tileZ },
      { x: tileX + w, z: tileZ + h },
      { x: tileX, z: tileZ + h },
    ].map((corner) => ({
      x: corner.x * TILE_SIZE,
      z: corner.z * TILE_SIZE,
      y: groundAt(corner.x, corner.z),
    }));
    const project = (x: number, y: number, z: number) => camera.worldToScreen(x, y, z);
    // Ground plate: the footprint the building will occupy.
    ctx.beginPath();
    for (let i = 0; i < corners.length; i++) {
      const point = project(corners[i].x, corners[i].y + 0.25, corners[i].z);
      if (i === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    }
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.4;
    ctx.stroke();
    // The actual building silhouette, drawn from its own crease edges, so the
    // preview is the structure that is about to be built rather than a box.
    const centerX = (tileX + w / 2) * TILE_SIZE;
    const centerZ = (tileZ + h / 2) * TILE_SIZE;
    const centerY = groundAt(tileX + w / 2, tileZ + h / 2);
    this.strokeBuildingOutline(app, defId, centerX, centerY, centerZ, 0, color, 0.5, 1);
    const height = Math.max(1, buildingTopHeight(defId));
    const labelPoint = project(centerX, centerY + height + 0.5, centerZ);
    ctx.font = '600 10px SFMono-Regular, Consolas, monospace';
    ctx.fillStyle = color;
    const label = ok ? def.shortName : reason;
    ctx.fillText(label, labelPoint.x - ctx.measureText(label).width / 2, labelPoint.y - 6);
  }
}

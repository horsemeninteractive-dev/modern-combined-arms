import type { Domain, PowerStatus, QueueItem } from '../sim/types';

export type HudLayout = 'desktop' | 'mobile';
export type HudPanel = 'none' | 'production' | 'objective' | 'selection' | 'groups' | 'map';

/**
 * Production is one panel per force type. There is deliberately no catch-all
 * "overview": a facility or structure only ever appears under the category it
 * belongs to, so the rail labels stay honest.
 */
export type ProductionTab = 'base' | 'defence' | 'land' | 'air' | 'sea';

export const PRODUCTION_TABS: ReadonlyArray<{ id: ProductionTab; label: string; icon: string }> = [
  { id: 'base', label: 'BASE', icon: 'command' },
  { id: 'defence', label: 'DEFENCE', icon: 'sam' },
  { id: 'land', label: 'LAND', icon: 'tank' },
  { id: 'air', label: 'AIR', icon: 'fighter' },
  { id: 'sea', label: 'SEA', icon: 'corvette' },
];

/** Buildable structures with weapons are sited from DEFENCE; the rest from BASE. */
export function structureTab(hasWeapons: boolean): 'base' | 'defence' {
  return hasWeapons ? 'defence' : 'base';
}

/**
 * Unit tabs are named for the force and facilities for the domain, so SEA has
 * to be read as `naval` before it can match a shipyard's definition.
 */
export function productionDomain(tab: ProductionTab): Domain | null {
  if (tab === 'base' || tab === 'defence') return null;
  return tab === 'sea' ? 'naval' : tab;
}

/**
 * Desktop and mobile are separate compositions, not one breakpoint-shrunk
 * layout. Width alone is not enough: a coarse-pointer tablet in landscape gets
 * the touch composition even when it is wider than a phone.
 */
export function resolveHudLayout(width: number, height: number, coarsePointer: boolean): HudLayout {
  if (width < 900) return 'mobile';
  if (coarsePointer && width < 1200) return 'mobile';
  if (height < 480) return 'mobile';
  return 'desktop';
}

/** Screen rectangle the edge-pan cursor can actually reach. */
export interface PanViewport {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface PanVector {
  dx: number;
  dz: number;
}

/**
 * Edge pan against the visible battlefield rather than the raw canvas. The
 * command rail, production sidebar and battle console cover three of the four
 * canvas edges, so a canvas-edge test only ever fired along the top. A pointer
 * outside the battlefield rectangle — over a panel — never pans the camera.
 */
export function edgePanVector(
  px: number,
  py: number,
  view: PanViewport,
  margin: number,
  speed: number,
): PanVector {
  if (px < view.left || px > view.right || py < view.top || py > view.bottom) {
    return { dx: 0, dz: 0 };
  }
  let dx = 0;
  let dz = 0;
  if (px < view.left + margin) dx -= speed;
  if (px > view.right - margin) dx += speed;
  if (py < view.top + margin) dz -= speed;
  if (py > view.bottom - margin) dz += speed;
  return { dx, dz };
}

/** A second tap on the active panel closes it; another panel replaces it. */
export function toggleHudPanel(current: HudPanel, requested: Exclude<HudPanel, 'none'>): HudPanel {
  return current === requested ? 'none' : requested;
}

/**
 * The tactical minimap needs an operational Radar Array and a balanced grid.
 * Without either it holds a dim dead-screen grain and rejects interaction.
 */
export function minimapStatus(
  hasRadar: boolean,
  brownout: boolean,
): { online: boolean; reason: 'no-radar' | 'brownout' | null } {
  if (!hasRadar) return { online: false, reason: 'no-radar' };
  if (brownout) return { online: false, reason: 'brownout' };
  return { online: true, reason: null };
}

/**
 * Backing-store size for the tactical map. The canvas must be sized in device
 * pixels so terrain, markers and especially the offline caption are not scaled
 * up from a 96x72 source. The density cap keeps a 4K display from allocating a
 * needlessly large map buffer.
 */
export function minimapBackingSize(
  cssWidth: number,
  cssHeight: number,
  devicePixelRatio: number,
): { width: number; height: number } {
  const density = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0
    ? Math.max(1, Math.min(devicePixelRatio, 2))
    : 1;
  return {
    width: Math.max(1, Math.round(cssWidth * density)),
    height: Math.max(1, Math.round(cssHeight * density)),
  };
}

/**
 * Per-card production state for a single unit type. The queue is ordered: only
 * its head trains, so only that copy contributes progress. Every copy of the
 * same type counts toward the Red Alert-style badge, including the head.
 */
export interface ProductionCardState {
  queued: number;
  active: boolean;
  progress: number;
}

export function productionCardState(
  queue: readonly QueueItem[],
  defId: string,
): ProductionCardState {
  const queued = queue.reduce((n, item) => n + (item.defId === defId ? 1 : 0), 0);
  const head = queue[0];
  const active = head?.defId === defId;
  const progress = active && head.total > 0
    ? Math.max(0, Math.min(1, 1 - head.remaining / head.total))
    : 0;
  return { queued, active, progress };
}

/**
 * Above this many selected entities the roster collapses identical unit types
 * into one card with a count. Individual hulls stay reachable by inspecting; a
 * thirty-rifle selection must not become a horizontal strip of thirty cards.
 */
export const SELECTION_GROUP_THRESHOLD = 8;

export interface SelectionChipView {
  /** Stable DOM key: the entity id, or `type:<defId>` for a group. */
  key: string;
  kind: 'entity' | 'group';
  defId: string;
  ids: number[];
  count: number;
  hp: number;
  maxHp: number;
}

/**
 * Reduce a selection to roster cards. Below the threshold every entity keeps
 * its own card; above it identical unit types share one card, while structures
 * always stay individual so a base is never summarised into a single chip.
 */
export function selectionChips(
  entities: ReadonlyArray<{ id: number; kind: string; defId: string; hp: number; maxHp: number }>,
  threshold = SELECTION_GROUP_THRESHOLD,
): SelectionChipView[] {
  if (entities.length <= threshold) {
    return entities.map((e) => ({
      key: String(e.id),
      kind: 'entity',
      defId: e.defId,
      ids: [e.id],
      count: 1,
      hp: e.hp,
      maxHp: e.maxHp,
    }));
  }
  const chips: SelectionChipView[] = [];
  const groups = new Map<string, SelectionChipView>();
  for (const e of entities) {
    if (e.kind !== 'unit') {
      chips.push({ key: String(e.id), kind: 'entity', defId: e.defId, ids: [e.id], count: 1, hp: e.hp, maxHp: e.maxHp });
      continue;
    }
    const existing = groups.get(e.defId);
    if (existing) {
      existing.ids.push(e.id);
      existing.count += 1;
      existing.hp += e.hp;
      existing.maxHp += e.maxHp;
      continue;
    }
    const chip: SelectionChipView = {
      key: `type:${e.defId}`,
      kind: 'group',
      defId: e.defId,
      ids: [e.id],
      count: 1,
      hp: e.hp,
      maxHp: e.maxHp,
    };
    groups.set(e.defId, chip);
    chips.push(chip);
  }
  return chips;
}

/**
 * Why a production card is unavailable, reduced to a short on-card label.
 * The simulation owns the authoritative sentence; the HUD only classifies it
 * so the reason is visible without hover and the tone is consistent.
 */
export type ProductionBlockTone = 'materials' | 'requisition' | 'queue' | 'tech' | 'research' | 'other';

export interface ProductionBlockReason {
  text: string;
  tone: ProductionBlockTone;
}

export function productionBlockReason(reason: string): ProductionBlockReason {
  const text = reason.toLowerCase();
  if (text.includes('materials')) return { text: 'NO MATERIALS', tone: 'materials' };
  if (text.includes('requisition')) return { text: 'NO REQUISITION', tone: 'requisition' };
  if (text.includes('queue is full')) return { text: 'QUEUE FULL', tone: 'queue' };
  if (text.includes('research')) return { text: 'RESEARCH REQUIRED', tone: 'research' };
  if (text.includes('airfield')) return { text: 'NEEDS AIRFIELD', tone: 'tech' };
  if (text.includes('shipyard')) return { text: 'NEEDS SHIPYARD', tone: 'tech' };
  if (text.includes('factory')) return { text: 'NEEDS VEHICLE FACTORY', tone: 'tech' };
  if (text.includes('under construction')) return { text: 'UNDER CONSTRUCTION', tone: 'tech' };
  if (text.includes('cannot produce')) return { text: 'WRONG FACILITY', tone: 'tech' };
  if (text.includes('roster')) return { text: 'NOT IN ROSTER', tone: 'tech' };
  if (text.includes('unavailable')) return { text: 'FACILITY OFFLINE', tone: 'tech' };
  return { text: 'UNAVAILABLE', tone: 'other' };
}

/**
 * Vertical auto-scroll velocity in px/s for a pointer inside a scrollable
 * panel. The top and bottom bands are `edge` pixels deep; speed ramps from 0 at
 * the inner boundary to `maxSpeed` at (and beyond) the panel edge. Negative
 * values scroll up. Returns 0 outside the bands or for a degenerate panel.
 */
export function edgeAutoScrollVelocity(
  pointerY: number,
  top: number,
  bottom: number,
  edge: number,
  maxSpeed: number,
): number {
  const height = bottom - top;
  if (!(height > 0) || !(edge > 0) || !(maxSpeed > 0)) return 0;
  // A short panel shrinks both bands until they meet at the midpoint rather
  // than letting the top band overlap the bottom band.
  const band = Math.min(edge, height / 2);
  const fromTop = pointerY - top;
  const fromBottom = bottom - pointerY;
  if (fromTop < band) {
    const depth = Math.max(0, Math.min(band, band - fromTop));
    return -maxSpeed * (depth / band);
  }
  if (fromBottom < band) {
    const depth = Math.max(0, Math.min(band, band - fromBottom));
    return maxSpeed * (depth / band);
  }
  return 0;
}

/**
 * How a production or build card's model art is presented. A card the player
 * can buy right now shows the full model, one that is unlocked but unaffordable
 * goes grey, and one still missing its prerequisite is a black silhouette so the
 * progression reads at a glance.
 */
export type ThumbnailArtState = 'ready' | 'short' | 'locked';

export function cardArtState(unlocked: boolean, affordable: boolean): ThumbnailArtState {
  if (!unlocked) return 'locked';
  return affordable ? 'ready' : 'short';
}

/**
 * Copy for the production sidebar's low-power strip. `null` means the grid is
 * balanced and the strip stays hidden; the caller never formats power itself.
 */
export function gridAlertCopy(status: PowerStatus): string | null {
  if (!status.brownout) return null;
  return `GRID DEFICIT · ${status.supply} SUPPLY / ${status.demand} DEMAND · PRODUCTION AT ${Math.round(
    status.ratio * 100,
  )}%`;
}

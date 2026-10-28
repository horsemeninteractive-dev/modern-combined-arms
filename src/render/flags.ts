import type { MeshBuffers } from './gl';
import { MeshBuilder, PALETTE, type Color } from './geometry';
import { NATION_LIST, defaultNationFor, tryIdentityDef } from '../data/factions';

/**
 * The six launch nations have real flag textures in `public/flags`, sourced
 * from the public-domain flag artwork at flagcdn.com. Legacy alliance presets
 * have no national flag of their own, so they borrow the default nation of
 * their alliance rather than inventing a seventh flag.
 */
export const FLAG_NATIONS = NATION_LIST.map((nation) => nation.id);
export type FlagNation = (typeof FLAG_NATIONS)[number];

/** Width divided by height, matching the official proportions of each flag. */
const FLAG_ASPECT: Readonly<Record<FlagNation, number>> = {
  lithuania: 5 / 3,
  poland: 8 / 5,
  uk: 2,
  russia: 3 / 2,
  belarus: 2,
  hungary: 2,
};

/** Blue for the defender coalition, red for the eastern coalition. */
const ALLIANCE_BLUE: Color = [0.08, 0.3, 0.78];
const ALLIANCE_RED: Color = [0.78, 0.12, 0.14];
const NEUTRAL: Color = [0.45, 0.47, 0.44];

// The tactical camera has a fixed 45° yaw, so the cloth faces it directly.
// Flags are the one intentional exception to world-space orientation: their
// job is to be readable as identity from the normal play view.
const FLAG_WIND_YAW = Math.PI / 4;
const POLE_HEIGHT = 5.6;
const CLOTH_HEIGHT = 0.82;
const CLOTH_SEGMENTS_X = 12;
const CLOTH_SEGMENTS_Y = 6;

export interface FlagMount {
  x: number;
  z: number;
  y: number;
}

export interface FlagRig extends MeshBuffers {
  wind: Float32Array;
  uv: Float32Array;
  texMask: Float32Array;
}

export function flagTextureUrl(nation: FlagNation): string {
  return `/flags/${nation}.png`;
}

/** A garrison flies its own flag even while the structure is neutral. */
export function flagOwnerForBuilding(owner: number, garrisonOwner: number | null): number {
  return garrisonOwner !== null ? garrisonOwner : owner;
}

/**
 * The nation whose real flag belongs on a building. Every playable nation maps
 * to itself; a legacy preset borrows its alliance's default nation.
 */
export function flagNationForFaction(factionId: string): FlagNation | undefined {
  const identity = tryIdentityDef(factionId);
  if (!identity) return undefined;
  if (identity.playable && FLAG_NATIONS.includes(identity.id as FlagNation)) {
    return identity.id as FlagNation;
  }
  return defaultNationFor(identity.allianceId).id as FlagNation;
}

/**
 * The first flag is the alliance colour, not the nation's palette colour, so
 * all three defender nations read blue and all three eastern nations red.
 */
export function allianceFlagColor(factionId: string | undefined): Color {
  if (!factionId) return NEUTRAL;
  const identity = tryIdentityDef(factionId);
  if (!identity) return NEUTRAL;
  return identity.allianceId === 'eastern' ? ALLIANCE_RED : ALLIANCE_BLUE;
}

export function flagWindYaw(): number {
  return FLAG_WIND_YAW;
}

export interface FlagAnchor extends FlagMount {
  /**
   * Open yards deliberately fly the flag from the apron rather than a roof.
   * Every other structure must mount it on its highest relevant roof.
   */
  apron?: boolean;
}

/**
 * Explicit, deterministic flag mounts in building-local space. The old
 * footprint-corner search found the plinth on every tall or inset structure,
 * and vertex heuristics cannot distinguish a roof from a mast or a nearby
 * prop. Keeping the anchors in one table makes the contract testable and makes
 * a geometry change update the flag in the same edit.
 *
 * Airfield and Shipyard are the only apron exceptions: they are open yards
 * whose operations read from ground level, so their flags stand beside the
 * working apron rather than on a hangar or gantry roof.
 */
export const BUILDING_FLAG_ANCHORS: Record<string, FlagAnchor> = {
  commandPost: { x: -0.8, y: 7.75, z: -0.7 },
  barracks: { x: -0.4, y: 5.65, z: -1.6 },
  factory: { x: 0, y: 6.55, z: 1.2 },
  refinery: { x: 4.0, y: 6.05, z: -2.6 },
  airfield: { x: 0, y: 0.45, z: 8.8, apron: true },
  shipyard: { x: -7.0, y: 0.95, z: 8.6, apron: true },
  powerPlant: { x: -1.4, y: 4.25, z: -1.0 },
  radar: { x: -2.6, y: 3.12, z: 1.2 },
  samBattery: { x: -0.4, y: 2.65, z: 0 },
  mgNest: { x: -1.9, y: 1.67, z: 2.1 },
  atTurret: { x: 3.15, y: 0.53, z: -3.05 },
  coastalBattery: { x: -3.0, y: 1.61, z: -2.2 },
  bunker: { x: -0.5, y: 3.0, z: -2.45 },
  relay: { x: -2.9, y: 3.56, z: 0.2 },
  supplyDepot: { x: 3.0, y: 3.95, z: -2.6 },
  radarStation: { x: -3.9, y: 4.44, z: -2.4 },
  tenement: { x: -3.6, y: 8.62, z: 3.2 },
  ruin: { x: -4.4, y: 3.75, z: -4.2 },
  warehouse: { x: 3.8, y: 7.15, z: -2.0 },
  officeBlock: { x: 2.0, y: 12.9, z: 4.6 },
  civicHall: { x: 4.6, y: 9.35, z: 3.6 },
  foundryWorks: { x: 4.8, y: 8.76, z: 3.2 },
};

export function flagAnchorFor(defId: string | undefined): FlagAnchor | undefined {
  return defId ? BUILDING_FLAG_ANCHORS[defId] : undefined;
}

/**
 * Return the authored roof mount for a known structure. Unknown definitions
 * fall back to the original corner search so a future prototype still gets a
 * finite mount instead of silently losing its flag.
 */
export function flagMountFor(
  footprint: { w: number; h: number },
  body: MeshBuffers,
  defId?: string,
): FlagMount {
  const anchor = flagAnchorFor(defId);
  if (anchor) return { x: anchor.x, y: anchor.y, z: anchor.z };

  const x = Math.max(1.1, footprint.w * 1.95 - 0.9);
  const z = Math.max(1.1, footprint.h * 1.95 - 0.9);
  let y = 0;
  let found = false;
  for (let i = 0; i < body.positions.length; i += 3) {
    const px = body.positions[i];
    const py = body.positions[i + 1];
    const pz = body.positions[i + 2];
    if (Math.abs(px - x) > 1.5 || Math.abs(pz - z) > 1.5) continue;
    y = found ? Math.max(y, py) : py;
    found = true;
  }
  return { x, z, y: Math.max(0, y) + 0.02 };
}

/**
 * One pole carrying the alliance flag above the national flag. The national
 * cloth is a real texture; the alliance cloth is a solid white quad that the
 * shader recolours through the team mask.
 */
export function buildFlagRig(nation: FlagNation): FlagRig {
  const b = new MeshBuilder();
  // Pole, base and finial.
  b.box(0, 0.06, 0, 0.42, 0.12, 0.42, PALETTE.concreteDark);
  b.box(0, POLE_HEIGHT / 2 + 0.12, 0, 0.12, POLE_HEIGHT, 0.12, PALETTE.metal);
  b.box(0, POLE_HEIGHT + 0.2, 0, 0.2, 0.16, 0.2, PALETTE.warning);
  const wind: number[] = new Array(b.positions.length / 3).fill(0);
  const uv: number[] = new Array((b.positions.length / 3) * 2).fill(0);
  const texMask: number[] = new Array(b.positions.length / 3).fill(0);

  const aspect = FLAG_ASPECT[nation] ?? 1.5;
  const width = CLOTH_HEIGHT * aspect;
  const hoist = 0.07;

  const cloth = (
    top: number,
    team: number,
    textured: boolean,
  ): void => {
    const y0 = top - CLOTH_HEIGHT;
    for (let iy = 0; iy < CLOTH_SEGMENTS_Y; iy++) {
      const v0 = iy / CLOTH_SEGMENTS_Y;
      const v1 = (iy + 1) / CLOTH_SEGMENTS_Y;
      for (let ix = 0; ix < CLOTH_SEGMENTS_X; ix++) {
        const u0 = ix / CLOTH_SEGMENTS_X;
        const u1 = (ix + 1) / CLOTH_SEGMENTS_X;
        const x0 = hoist + u0 * width;
        const x1 = hoist + u1 * width;
        const py0 = y0 + v0 * CLOTH_HEIGHT;
        const py1 = y0 + v1 * CLOTH_HEIGHT;
        // A small static ripple gives the flat cloth readable shading even
        // before the shader starts moving it.
        const z0 = Math.sin((u0 + u1) * Math.PI) * 0.035;
        b.addQuad(
          [x0, py0, z0],
          [x1, py0, z0],
          [x1, py1, z0],
          [x0, py1, z0],
          textured ? PALETTE.white : [0.94, 0.94, 0.9],
          team,
        );
        wind.push(u0, u1, u1, u0);
        uv.push(u0, v0, u1, v0, u1, v1, u0, v1);
        const mask = textured ? 1 : 0;
        texMask.push(mask, mask, mask, mask);
        // addQuad pushes four vertices in the same order as wind/uv above.
      }
    }
  };

  // Alliance flag above, national flag below.
  cloth(POLE_HEIGHT + 0.02, 1, false);
  cloth(POLE_HEIGHT - 1.12, 0, true);

  return {
    ...b.build(),
    wind: new Float32Array(wind),
    uv: new Float32Array(uv),
    texMask: new Float32Array(texMask),
  };
}

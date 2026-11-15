import { tryIdentityDef } from '../data/factions';
import { colorVisionTokens, type ColorVisionPalette } from '../colorVision';
import { hexToRgb, type Vec3 } from './math';

/** Neutral objective grey, shared by mesh tint and capture effects. */
export const NEUTRAL_TEAM_COLOR: Vec3 = [0.55, 0.6, 0.58];

/**
 * Resolve the tint applied to team-masked vertices. Neutral structures keep a
 * grey ownership surface; captured ones take the owning faction's colour. The
 * fallback for a live player with no faction identity is the renderer's legacy
 * slate, not neutral grey, so this cannot accidentally make an owned building
 * look unowned.
 */
export function teamColorForOwner(
  owner: number,
  factionId: string | undefined,
  override?: string,
  palette: ColorVisionPalette = 'standard',
  friendly = false,
): Vec3 {
  if (owner < 0) return [...NEUTRAL_TEAM_COLOR];
  // A colour-vision preset deliberately replaces the chosen tint: the pair is
  // chosen for separability, not for faction flavour. Shape, flags and panels
  // still carry identity when the palette is active.
  if (palette !== 'standard') {
    const tokens = colorVisionTokens(palette);
    return hexToRgb(friendly ? tokens.friendly : tokens.hostile);
  }
  // A skirmish colour choice outranks the faction palette; a map or save that
  // carries no override still reads its nation's identity colour.
  if (override) return hexToRgb(override);
  const faction = factionId ? tryIdentityDef(factionId) : undefined;
  return hexToRgb(faction?.color ?? '#7a8b80');
}

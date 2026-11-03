/**
 * Runtime abilities granted by researched unit upgrades.
 *
 * Stage 4A defined what research *unlocks*; this module defines what an
 * unlocked upgrade actually *does* when a unit uses it. An upgrade listed here
 * is playable: the selection box can offer it, the simulation can resolve it and
 * the AI may pay to research it. An upgrade absent from here is still only a
 * catalogue entry, which is why `upgradePlayable` exists — the research
 * evaluator asks that same question instead of keeping its own list.
 *
 * Balance numbers live here rather than in the simulation so a smoke cloud's
 * geometry has one home. Cost, duration and cooldown stay on the upgrade
 * definition in `research.ts`: research already publishes them, and a second
 * copy would let the panel and the simulation disagree.
 */
import { unitUpgradeDef } from './research';

export interface SmokeAbilityDef {
  readonly kind: 'smoke';
  /** Researched upgrade that makes this ability available. */
  readonly upgradeId: string;
  /** Cloud radius in tiles. */
  readonly radius: number;
  /** How long the cloud persists, in seconds. */
  readonly durationSeconds: number;
  /** Minimum time before the same hull may fire again. */
  readonly cooldownSeconds: number;
}

export type UnitAbilityDef = SmokeAbilityDef;

/**
 * Smoke geometry.
 *
 * A recon vehicle sees 12.5 tiles, so a 5-tile cloud blanks roughly a fifth of
 * that hull's own reach: enough to break a sight line and cover a withdrawal,
 * not enough to be an area denial field. Because the same radius is what the
 * vision refresh tests, the visual cloud and the gameplay obstruction are the
 * same size by construction.
 */
export const SMOKE_RADIUS_TILES = 5;

function smokeDef(): SmokeAbilityDef | null {
  const upgrade = unitUpgradeDef('reconSmokescreen');
  if (!upgrade) return null;
  return {
    kind: 'smoke',
    upgradeId: upgrade.id,
    radius: SMOKE_RADIUS_TILES,
    durationSeconds: upgrade.durationSeconds ?? 8,
    cooldownSeconds: upgrade.cooldownSeconds ?? 45,
  };
}

const SMOKE = smokeDef();

/** Every upgrade with a working gameplay pathway, keyed by upgrade id. */
export const UNIT_ABILITIES: Readonly<Record<string, UnitAbilityDef>> = Object.freeze(
  SMOKE ? { [SMOKE.upgradeId]: SMOKE } : {},
);

/** The runtime ability an upgrade grants, or undefined when it is not playable. */
export function abilityForUpgrade(upgradeId: string): UnitAbilityDef | undefined {
  return UNIT_ABILITIES[upgradeId];
}

/**
 * Whether a researched upgrade has anything a unit could actually do with it.
 * The AI and the selection box must answer this from the same place.
 */
export function upgradePlayable(upgradeId: string): boolean {
  return UNIT_ABILITIES[upgradeId] !== undefined;
}

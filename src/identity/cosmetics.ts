/**
 * The cosmetic catalogue.
 *
 * Small and expandable on purpose: every item here is rendered by an existing
 * component, so nothing is sold that the interface cannot show. Items are
 * identity presentation only; none of them changes a unit, a building or a rule.
 *
 * Ownership is *derived*, not granted: an item is owned when the player meets
 * the unlock rule, evaluated against career progress the account service already
 * owns (XP, matches, wins). There is no claimable inventory row a client could
 * forge, and nothing to migrate when the catalogue grows.
 */
import { FLAG_EMBLEM_IDS } from './flag';

export type CosmeticCategory = 'emblem' | 'frame' | 'background' | 'camo';
export type CosmeticTier = 'standard' | 'veteran' | 'elite';

export type UnlockRule =
  /** Available to everyone, including guests. */
  | { kind: 'free' }
  | { kind: 'xp'; xp: number }
  | { kind: 'matches'; matches: number }
  | { kind: 'wins'; wins: number }
  /** An earned commendation. Only an account service can vouch for it. */
  | { kind: 'achievement'; achievementId: string };

export interface CosmeticItem {
  id: string;
  name: string;
  category: CosmeticCategory;
  description: string;
  tier: CosmeticTier;
  /** Rendering reference: an emblem id, a frame style, or a background style. */
  render: string;
  unlock: UnlockRule;
  version: 1;
}

export interface CosmeticProgress {
  xp: number;
  matches: number;
  wins: number;
  /** Earned achievement ids. Guests generally have none. */
  achievements?: readonly string[];
}

export const EMPTY_PROGRESS: CosmeticProgress = { xp: 0, matches: 0, wins: 0, achievements: [] };

/** Frames drawn around the profile avatar by `commandFlag.ts`/CSS. */
export const PROFILE_FRAMES = ['brass', 'steel', 'laurel', 'signal', 'commendation'] as const;
export type ProfileFrame = (typeof PROFILE_FRAMES)[number];

/** Background washes behind the profile header. */
export const PROFILE_BACKGROUNDS = ['dawn', 'dusk', 'deep', 'parade', 'frontline'] as const;
export type ProfileBackground = (typeof PROFILE_BACKGROUNDS)[number];

/**
 * Hull paint schemes for the commander's own units. Each one is a small tint
 * multiplier applied to the team colour on unit panels only, so ownership still
 * reads at battle zoom and a camo can never change what a unit is.
 */
export const UNIT_CAMOS = ['woodland', 'desert', 'winter', 'urban', 'naval', 'night'] as const;
export type UnitCamo = (typeof UNIT_CAMOS)[number];

/**
 * The initial catalogue: three emblems that are free (so a new player can make
 * a distinctive flag immediately), then one per meaningful career step. Frames
 * and backgrounds follow the same ladder.
 */
export const COSMETICS: readonly CosmeticItem[] = Object.freeze([
  {
    id: 'emblem-star',
    name: 'Star',
    category: 'emblem',
    description: 'The standard command star. Available to every commander.',
    tier: 'standard',
    render: 'star',
    unlock: { kind: 'free' },
    version: 1,
  },
  {
    id: 'emblem-chevron',
    name: 'Chevron',
    category: 'emblem',
    description: 'A section leader’s chevron. Available to every commander.',
    tier: 'standard',
    render: 'chevron',
    unlock: { kind: 'free' },
    version: 1,
  },
  {
    id: 'emblem-shield',
    name: 'Shield',
    category: 'emblem',
    description: 'A defensive mark. Available to every commander.',
    tier: 'standard',
    render: 'shield',
    unlock: { kind: 'free' },
    version: 1,
  },
  {
    id: 'emblem-eagle',
    name: 'Eagle',
    category: 'emblem',
    description: 'The command eagle. Available to every commander.',
    tier: 'standard',
    render: 'eagle',
    unlock: { kind: 'free' },
    version: 1,
  },
  {
    id: 'emblem-anchor',
    name: 'Anchor',
    category: 'emblem',
    description: 'Earned with 500 career XP, from any mode.',
    tier: 'standard',
    render: 'anchor',
    unlock: { kind: 'xp', xp: 500 },
    version: 1,
  },
  {
    id: 'emblem-bolt',
    name: 'Bolt',
    category: 'emblem',
    description: 'Earned with 1,500 career XP.',
    tier: 'veteran',
    render: 'bolt',
    unlock: { kind: 'xp', xp: 1500 },
    version: 1,
  },
  {
    id: 'emblem-compass',
    name: 'Compass',
    category: 'emblem',
    description: 'Earned after 10 recorded matches.',
    tier: 'veteran',
    render: 'compass',
    unlock: { kind: 'matches', matches: 10 },
    version: 1,
  },
  {
    id: 'emblem-crown',
    name: 'Crown',
    category: 'emblem',
    description: 'Earned with 25 career victories.',
    tier: 'elite',
    render: 'crown',
    unlock: { kind: 'wins', wins: 25 },
    version: 1,
  },
  {
    id: 'emblem-laurel',
    name: 'Laurel',
    category: 'emblem',
    description: 'Earned with 6,000 career XP.',
    tier: 'elite',
    render: 'laurel',
    unlock: { kind: 'xp', xp: 6000 },
    version: 1,
  },
  {
    id: 'emblem-wing',
    name: 'Wing',
    category: 'emblem',
    description: 'Earned with 50 career victories.',
    tier: 'elite',
    render: 'wing',
    unlock: { kind: 'wins', wins: 50 },
    version: 1,
  },
  {
    id: 'frame-steel',
    name: 'Steel frame',
    category: 'frame',
    description: 'A plain steel frame around your portrait.',
    tier: 'standard',
    render: 'steel',
    unlock: { kind: 'free' },
    version: 1,
  },
  {
    id: 'frame-brass',
    name: 'Brass frame',
    category: 'frame',
    description: 'Earned after 5 recorded matches.',
    tier: 'veteran',
    render: 'brass',
    unlock: { kind: 'matches', matches: 5 },
    version: 1,
  },
  {
    id: 'frame-laurel',
    name: 'Laurel frame',
    category: 'frame',
    description: 'Earned after 10 career victories.',
    tier: 'elite',
    render: 'laurel',
    unlock: { kind: 'wins', wins: 10 },
    version: 1,
  },
  {
    id: 'frame-signal',
    name: 'Signal frame',
    category: 'frame',
    description: 'Earned with 3,000 career XP.',
    tier: 'elite',
    render: 'signal',
    unlock: { kind: 'xp', xp: 3000 },
    version: 1,
  },
  {
    id: 'bg-deep',
    name: 'Deep water',
    category: 'background',
    description: 'A dark blue wash behind your profile header.',
    tier: 'standard',
    render: 'deep',
    unlock: { kind: 'free' },
    version: 1,
  },
  {
    id: 'bg-dawn',
    name: 'Dawn watch',
    category: 'background',
    description: 'Earned with 1,000 career XP.',
    tier: 'standard',
    render: 'dawn',
    unlock: { kind: 'xp', xp: 1000 },
    version: 1,
  },
  {
    id: 'bg-dusk',
    name: 'Dusk patrol',
    category: 'background',
    description: 'Earned after 15 recorded matches.',
    tier: 'veteran',
    render: 'dusk',
    unlock: { kind: 'matches', matches: 15 },
    version: 1,
  },
  {
    id: 'bg-parade',
    name: 'Parade colours',
    category: 'background',
    description: 'Earned with 20 career victories.',
    tier: 'elite',
    render: 'parade',
    unlock: { kind: 'wins', wins: 20 },
    version: 1,
  },
  {
    id: 'frame-commendation',
    name: 'Commendation frame',
    category: 'frame',
    description: 'Awarded for reaching service level 25 in Career Command.',
    tier: 'elite',
    render: 'commendation',
    unlock: { kind: 'achievement', achievementId: 'career-command' },
    version: 1,
  },
  {
    id: 'bg-frontline',
    name: 'Frontline wash',
    category: 'background',
    description: 'Awarded for completing your first multiplayer match (Coalition Service).',
    tier: 'veteran',
    render: 'frontline',
    unlock: { kind: 'achievement', achievementId: 'multiplayer-first' },
    version: 1,
  },
  {
    id: 'camo-woodland',
    name: 'Woodland mottle',
    category: 'camo',
    description: 'Three-tone woodland paint over your own vehicles. Unlocked by playing.',
    tier: 'standard',
    render: 'woodland',
    unlock: { kind: 'matches', matches: 3 },
    version: 1,
  },
  {
    id: 'camo-desert',
    name: 'Desert sand',
    category: 'camo',
    description: 'A sun-bleached sand scheme for your own vehicles. Unlocked by winning.',
    tier: 'standard',
    render: 'desert',
    unlock: { kind: 'wins', wins: 5 },
    version: 1,
  },
  {
    id: 'camo-winter',
    name: 'Winter wash',
    category: 'camo',
    description: 'A pale winter wash for your own vehicles, earned through service.',
    tier: 'veteran',
    render: 'winter',
    unlock: { kind: 'xp', xp: 2000 },
    version: 1,
  },
  {
    id: 'camo-urban',
    name: 'Urban drab',
    category: 'camo',
    description: 'Grey-brown urban drab for your own vehicles. Earned after 20 matches.',
    tier: 'veteran',
    render: 'urban',
    unlock: { kind: 'matches', matches: 20 },
    version: 1,
  },
  {
    id: 'camo-naval',
    name: 'Coastal grey',
    category: 'camo',
    description: 'A naval grey scheme. Awarded for completing a campaign.',
    tier: 'elite',
    render: 'naval',
    unlock: { kind: 'achievement', achievementId: 'campaign-complete' },
    version: 1,
  },
  {
    id: 'camo-night',
    name: 'Night ops',
    category: 'camo',
    description: 'A low-contrast night scheme for your own vehicles. Earned with 15 victories.',
    tier: 'elite',
    render: 'night',
    unlock: { kind: 'wins', wins: 15 },
    version: 1,
  },
]);

/**
 * Hull paint multipliers, one per camo. The shader applies them to every hull
 * panel that is not team-coloured, so they carry real contrast: a scheme has to
 * read across a battlefield at default zoom without touching the alliance
 * markings. Applied by the renderer, never by the simulation.
 */
export const CAMO_TINTS: Record<UnitCamo, [number, number, number]> = {
  woodland: [0.6, 0.76, 0.54],
  desert: [1.24, 1.02, 0.7],
  winter: [1.08, 1.12, 1.22],
  urban: [0.78, 0.8, 0.9],
  naval: [0.72, 0.86, 1.06],
  night: [0.48, 0.54, 0.66],
};

/** The tint for an equipped camo id, or null when nothing (valid) is equipped. */
export function camoTintFor(id: string | null | undefined): [number, number, number] | null {
  const item = cosmeticById(id);
  if (!item || item.category !== 'camo') return null;
  return CAMO_TINTS[item.render as UnitCamo] ?? null;
}

/** Section order and copy for the inventory page. */
export const COSMETIC_SECTIONS: ReadonlyArray<{
  id: CosmeticCategory;
  title: string;
  blurb: string;
}> = Object.freeze([
  {
    id: 'frame',
    title: 'Avatar frames',
    blurb: 'The ring around your portrait in the profile, the lobby and the after-action card.',
  },
  {
    id: 'background',
    title: 'Player card backgrounds',
    blurb: 'The wash behind your name and portrait wherever your card is shown.',
  },
  {
    id: 'camo',
    title: 'Unit camos',
    blurb: 'Paint for your own units. Presentation only — no stat, cost or rule changes.',
  },
  {
    id: 'emblem',
    title: 'Flag emblems',
    blurb: 'Emblems you may use in a command flag. Applied in the flag editor, not equipped here.',
  },
]);

export function cosmeticById(id: string | null | undefined): CosmeticItem | null {
  if (!id) return null;
  return COSMETICS.find((item) => item.id === id) ?? null;
}

export function cosmeticsByCategory(category: CosmeticCategory): CosmeticItem[] {
  return COSMETICS.filter((item) => item.category === category);
}

export function unlockRequirementText(rule: UnlockRule): string {
  switch (rule.kind) {
    case 'free':
      return 'Available immediately';
    case 'xp':
      return `${rule.xp.toLocaleString()} career XP`;
    case 'matches':
      return `${rule.matches} recorded matches`;
    case 'wins':
      return `${rule.wins} career victories`;
    case 'achievement':
      return 'Earn the associated commendation';
  }
}

export function cosmeticCategoryTitle(category: CosmeticCategory): string {
  return COSMETIC_SECTIONS.find((section) => section.id === category)?.title ?? 'Cosmetics';
}

export function unlockProgressText(rule: UnlockRule, progress: CosmeticProgress): string {
  switch (rule.kind) {
    case 'free':
      return 'Unlocked';
    case 'xp':
      return `${Math.min(progress.xp, rule.xp).toLocaleString()} / ${rule.xp.toLocaleString()} XP`;
    case 'matches':
      return `${Math.min(progress.matches, rule.matches)} / ${rule.matches} matches`;
    case 'wins':
      return `${Math.min(progress.wins, rule.wins)} / ${rule.wins} wins`;
    case 'achievement':
      return progress.achievements?.includes(rule.achievementId)
        ? 'Commendation earned'
        : 'Commendation not yet earned';
  }
}

export function isCosmeticUnlocked(item: CosmeticItem, progress: CosmeticProgress): boolean {
  switch (item.unlock.kind) {
    case 'free':
      return true;
    case 'xp':
      return progress.xp >= item.unlock.xp;
    case 'matches':
      return progress.matches >= item.unlock.matches;
    case 'wins':
      return progress.wins >= item.unlock.wins;
    case 'achievement':
      return progress.achievements?.includes(item.unlock.achievementId) === true;
  }
}

export function ownedCosmetics(progress: CosmeticProgress): CosmeticItem[] {
  return COSMETICS.filter((item) => isCosmeticUnlocked(item, progress));
}

/**
 * Emblems a player may currently use in a flag, as ids. The flag editor offers
 * exactly this list; a composition saved earlier still renders its emblem even
 * if the unlock was later raised, because rendering is presentation and history
 * should not silently change appearance.
 */
export function unlockedEmblemIds(progress: CosmeticProgress): string[] {
  const ids = COSMETICS.filter(
    (item) => item.category === 'emblem' && isCosmeticUnlocked(item, progress),
  ).map((item) => item.render);
  return FLAG_EMBLEM_IDS.filter((id) => ids.includes(id));
}

/**
 * Validate an equip request. Returns null when the item may be equipped, or a
 * reason when it may not — the account service and the local UI share this, so
 * neither can drift from the other.
 */
export function validateEquip(
  category: CosmeticCategory,
  id: string | null,
  progress: CosmeticProgress,
): string | null {
  if (id === null) return null;
  const item = cosmeticById(id);
  if (!item) return 'Unknown cosmetic.';
  if (item.category !== category) return 'That cosmetic does not belong to this slot.';
  if (!isCosmeticUnlocked(item, progress)) return 'That cosmetic has not been unlocked.';
  return null;
}

/** A granted default, used when an equipped item is no longer owned. */
export function defaultEquipped(): { frame: string | null; background: string | null } {
  return { frame: null, background: null };
}

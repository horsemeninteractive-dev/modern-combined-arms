/**
 * Unit veterancy.
 *
 * A crew that survives contact and does the work gets better at its job. Rank
 * is earned by *fighting*: experience is awarded for damage the unit itself
 * inflicts, scaled by how much of the target it destroyed, so a rifleman that
 * grinds down a hull earns the same as a tank gunner that one-shots it. Units
 * that never fire — engineers, harvesters, medics — never promote, which is the
 * point: veterancy is a record of combat, not of existing.
 *
 * The bonuses are multiplicative on quantities the simulation already computes:
 * hit probability, damage and reload time. Range, armour, vision and mobility
 * are untouched, so a Veteran tank is the same tank with a better crew inside
 * it rather than a different unit. This keeps the counter-play intact: a
 * better-aimed shot still bounces off the armour class it always bounced off.
 *
 * Nothing here reads the clock or the RNG, and experience is integer-valued, so
 * both peers of a multiplayer match agree on it by construction and it survives
 * a save round-trip exactly.
 */

/** 0 Recruit, 1 Veteran, 2 Elite. Buildings are always Recruit. */
export type Rank = 0 | 1 | 2;

export interface RankDef {
  rank: Rank;
  id: 'recruit' | 'veteran' | 'elite';
  name: string;
  /** Three-letter form for tight HUD cells. */
  short: string;
  /** Experience needed to hold this rank. */
  xp: number;
  /** Added straight to a weapon's hit probability. */
  accuracy: number;
  /** Multiplier on damage the unit inflicts. */
  damage: number;
  /** Multiplier on reload time between shots; below 1 is quicker. */
  cooldown: number;
  hint: string;
}

/**
 * Experience for destroying one full-health target, whatever its size. Damage
 * is scaled against the target's own integrity, so a light vehicle and a heavy
 * one are worth the same to the crew that kills them — what is rewarded is the
 * engagement, not the tonnage.
 */
export const XP_PER_WOUND = 100;

export const RANKS: readonly RankDef[] = [
  {
    rank: 0,
    id: 'recruit',
    name: 'Recruit',
    short: 'REC',
    xp: 0,
    accuracy: 0,
    damage: 1,
    cooldown: 1,
    hint: 'A crew straight from the depot. No bonus.',
  },
  {
    rank: 1,
    id: 'veteran',
    name: 'Veteran',
    short: 'VET',
    xp: 100,
    accuracy: 0.05,
    damage: 1.08,
    cooldown: 0.94,
    hint: 'Blooded crew: +5% hit chance, +8% damage, quicker reload.',
  },
  {
    rank: 2,
    id: 'elite',
    name: 'Elite',
    short: 'ELT',
    xp: 320,
    accuracy: 0.1,
    damage: 1.16,
    cooldown: 0.88,
    hint: 'Veterans of several actions: +10% hit chance, +16% damage, fastest reload.',
  },
];

export const MAX_RANK: Rank = 2;

/** Clamp so a long match cannot overflow the saved field or the state hash. */
export const MAX_XP = 4000;

/** Structural so a snapshot replica and a saved entity read the same way. */
export interface RankedEntity {
  kind?: string;
  xp?: number;
}

/** Experience of an entity, clamped. Buildings never carry veterancy. */
export function experienceOf(entity: RankedEntity): number {
  if (entity.kind === 'building') return 0;
  const xp = entity.xp;
  if (typeof xp !== 'number' || !Number.isFinite(xp)) return 0;
  return Math.max(0, Math.min(MAX_XP, Math.round(xp)));
}

export function rankForXp(xp: number): Rank {
  if (xp >= RANKS[2].xp) return 2;
  if (xp >= RANKS[1].xp) return 1;
  return 0;
}

/** The rank definition an entity currently holds. */
export function rankOf(entity: RankedEntity): RankDef {
  return RANKS[rankForXp(experienceOf(entity))];
}

/**
 * Progress toward the next rank, for the unit inspector and the world pips.
 * `fraction` is 0 at the start of the current rank and 1 at the next one; it
 * stays 0 at the top rank, where `next` is null and the label is MAX.
 */
export function veterancyProgress(entity: RankedEntity): {
  rank: RankDef;
  xp: number;
  into: number;
  span: number;
  next: RankDef | null;
  fraction: number;
} {
  const xp = experienceOf(entity);
  const rank = RANKS[rankForXp(xp)];
  const next = rank.rank < MAX_RANK ? RANKS[rank.rank + 1] : null;
  const span = next ? next.xp - rank.xp : 0;
  const into = Math.max(0, xp - rank.xp);
  const fraction = next && span > 0 ? Math.max(0, Math.min(1, into / span)) : 0;
  return { rank, xp, into, span, next, fraction };
}

/**
 * Experience for one hit, scaled against the target's own integrity. Integer,
 * because a fractional experience field would make a save round-trip depend on
 * floating-point formatting.
 */
export function experienceForDamage(dealt: number, targetMaxHp: number): number {
  if (!(dealt > 0) || !(targetMaxHp > 0)) return 0;
  return Math.max(0, Math.round((dealt / targetMaxHp) * XP_PER_WOUND));
}

/**
 * Credit a unit for damage it inflicted. Mutates the entity and returns the new
 * rank when the hit promoted it, so the caller can announce the promotion;
 * returns null when nothing changed.
 */
export function awardCombatXp(
  entity: RankedEntity & { xp?: number },
  dealt: number,
  targetMaxHp: number,
): RankDef | null {
  if (entity.kind === 'building') return null;
  const gain = experienceForDamage(dealt, targetMaxHp);
  if (gain <= 0) return null;
  const before = rankForXp(experienceOf(entity));
  entity.xp = Math.min(MAX_XP, experienceOf(entity) + gain);
  const after = rankForXp(entity.xp);
  return after > before ? RANKS[after] : null;
}

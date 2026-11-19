/**
 * The infected: Outbreak's hostile faction.
 *
 * They are ordinary MCA units — same entity type, same weapons, same armour and
 * damage rules — with their own definitions and one hostile owner. That is what
 * lets them pathfind, be shot, be suppressed, be seen through fog and be
 * replicated by the existing simulation without a second combat engine.
 *
 * The archetypes differ in a way a player can read at a glance:
 *   shambler — the mass. Slow, cheap, dangerous only in numbers.
 *   runner   — fast and fragile. Punishes a gap and isolated infantry.
 *   brute    — a slow wrecking ball that goes through walls and structures.
 *   bloater  — a close-range area attack aimed at clustered infantry.
 *   crawler  — low, quick and hard to spot, built to slip past a firing line.
 *   flyer    — a winged body that attacks from above, which is what gives
 *              anti-aircraft fire and interceptors something to do.
 *
 * They carry no cost, are produced by nothing and appear in no roster: the wave
 * director is the only source of an infected unit.
 */
import type { UnitDef, WeaponDef } from '../sim/types';
import type { ZombieKind } from '../outbreak/types';

/** Marker for a hostile owner that fields the horde. */
export const INFECTED_FACTION_ID = 'infected';

export const ZOMBIE_DEF_IDS: Readonly<Record<ZombieKind, string>> = Object.freeze({
  shambler: 'zombieShambler',
  runner: 'zombieRunner',
  brute: 'zombieBrute',
  bloater: 'zombieBloater',
  crawler: 'zombieCrawler',
  flyer: 'zombieFlyer',
});

/** Reverse lookup for the director's statistics and the HUD's kill feed. */
export function zombieKindOf(defId: string): ZombieKind | null {
  for (const kind of Object.keys(ZOMBIE_DEF_IDS) as ZombieKind[]) {
    if (ZOMBIE_DEF_IDS[kind] === defId) return kind;
  }
  return null;
}

export function zombieDefId(kind: ZombieKind): string {
  return ZOMBIE_DEF_IDS[kind];
}

/**
 * Melee, expressed in the engine's own terms.
 *
 * A claw is a short-range weapon with a fast projectile and no ammunition: the
 * simulation already knows how to fire it, how armour multiplies it and how to
 * stop it at a wall. Structures are on every target list — a horde that cannot
 * hit a wall stands on the wrong side of it forever.
 */
export const ZOMBIE_WEAPONS: Record<string, WeaponDef> = {
  zombieClaw: {
    id: 'zombieClaw',
    name: 'Rending claws',
    damage: 7,
    range: 0.9,
    cooldown: 1.15,
    accuracy: 0.95,
    projectile: 'bullet',
    speed: 40,
    targets: ['ground', 'structure'],
    melee: true,
    multipliers: {
      infantry: 0.85,
      light: 0.28,
      heavy: 0.06,
      support: 0.4,
      structure: 0.7,
      naval: 0.05,
      air: 0,
    },
    suppression: 0.05,
  },
  zombieSprintClaw: {
    id: 'zombieSprintClaw',
    name: 'Flailing strikes',
    damage: 5,
    range: 0.9,
    cooldown: 0.75,
    accuracy: 0.9,
    projectile: 'bullet',
    speed: 45,
    targets: ['ground', 'structure'],
    melee: true,
    multipliers: {
      infantry: 0.9,
      light: 0.16,
      heavy: 0.03,
      support: 0.3,
      structure: 0.45,
      naval: 0.03,
      air: 0,
    },
    suppression: 0.04,
  },
  zombieSmash: {
    id: 'zombieSmash',
    name: 'Bone hammer',
    damage: 58,
    range: 1.3,
    cooldown: 2.6,
    accuracy: 0.85,
    projectile: 'cannon',
    speed: 30,
    splash: 1.1,
    targets: ['ground', 'structure'],
    melee: true,
    multipliers: {
      infantry: 1.0,
      light: 1.15,
      heavy: 0.5,
      support: 1.4,
      structure: 2.4,
      naval: 0.2,
      air: 0,
    },
    suppression: 0.35,
  },
  zombieBurst: {
    id: 'zombieBurst',
    name: 'Ruptured sac',
    damage: 26,
    range: 1.6,
    cooldown: 3.6,
    accuracy: 0.8,
    projectile: 'shell',
    speed: 16,
    splash: 2.0,
    targets: ['ground', 'structure'],
    melee: true,
    multipliers: {
      infantry: 1.9,
      light: 0.3,
      heavy: 0.05,
      support: 0.5,
      structure: 0.35,
      naval: 0.05,
      air: 0,
    },
    suppression: 0.5,
  },
  /**
   * The flyer's attack.
   *
   * It is a thrown rake rather than a melee: three metres of reach means a
   * flying mutant can work on a hull or a squad from above the reach of the
   * claws below it, which is the whole point of the archetype. It carries an
   * air multiplier so a fighter that comes up to meet it is a real engagement,
   * and so anti-air fire is answering something that can answer back.
   */
  zombieTalon: {
    id: 'zombieTalon',
    name: 'Talon rake',
    damage: 15,
    range: 3.4,
    cooldown: 1.5,
    accuracy: 0.88,
    projectile: 'bullet',
    speed: 55,
    targets: ['ground', 'structure', 'air'],
    multipliers: {
      infantry: 1.15,
      light: 0.45,
      heavy: 0.12,
      support: 0.7,
      structure: 0.55,
      naval: 0.2,
      air: 0.85,
    },
    suppression: 0.12,
  },
  zombieBite: {
    id: 'zombieBite',
    name: 'Bite',
    damage: 4,
    range: 0.7,
    cooldown: 0.7,
    accuracy: 0.92,
    projectile: 'bullet',
    speed: 35,
    targets: ['ground', 'structure'],
    melee: true,
    multipliers: {
      infantry: 0.8,
      light: 0.1,
      heavy: 0.02,
      support: 0.25,
      structure: 0.35,
      naval: 0.02,
      air: 0,
    },
    suppression: 0.02,
  },
};

function zombie(
  id: string,
  name: string,
  shortName: string,
  role: string,
  speed: number,
  hp: number,
  radius: number,
  vision: number,
  weapons: string[],
  icon: string,
  description: string,
  lowProfile = false,
): UnitDef {
  return {
    id,
    name,
    shortName,
    role,
    domain: 'land',
    moveClass: 'foot',
    speed,
    turnRate: 5.2,
    radius,
    vision,
    hp,
    armour: 'infantry',
    // Nothing builds them: the director spawns them, so a cost would only be a
    // number nobody spends.
    cost: { mats: 0, req: 0 },
    buildTime: 1,
    producedBy: [],
    weapons,
    description,
    icon,
    targetClass: 'ground',
    muzzle: { forward: 0.4, height: 0.9 },
    ...(lowProfile ? { lowProfile: true } : {}),
  };
}

/**
 * A body that walks on nothing.
 *
 * Flight here is not an airframe: `domain: 'air'` is what the targeting rules
 * read (anti-air fire can reach it, claws cannot), `moveClass: 'air'` lets it
 * cross any ground, and `flier: true` tells the simulation there is no berth,
 * fuel clock or recovery cycle attached. Nothing in the roster produces one.
 */
function flyer(
  id: string,
  name: string,
  shortName: string,
  role: string,
  speed: number,
  hp: number,
  radius: number,
  vision: number,
  weapons: string[],
  icon: string,
  description: string,
): UnitDef {
  return {
    id,
    name,
    shortName,
    role,
    domain: 'air',
    moveClass: 'air',
    speed,
    turnRate: 3.4,
    radius,
    vision,
    hp,
    armour: 'light',
    flier: true,
    cost: { mats: 0, req: 0 },
    buildTime: 1,
    producedBy: [],
    weapons,
    description,
    icon,
    targetClass: 'air',
    muzzle: { forward: 0.6, height: 0.1 },
  };
}

export const ZOMBIE_UNITS: readonly UnitDef[] = Object.freeze([
  zombie(
    ZOMBIE_DEF_IDS.shambler,
    'Shambler',
    'SHAMBLER',
    'Infected mass',
    0.72,
    70,
    1.5,
    6.5,
    ['zombieClaw'],
    'rifle',
    'A slow body in a ruined uniform. Harmless alone; the wave is the weapon.',
  ),
  zombie(
    ZOMBIE_DEF_IDS.runner,
    'Runner',
    'RUNNER',
    'Infected skirmisher',
    1.95,
    55,
    1.5,
    8,
    ['zombieSprintClaw'],
    'rifle',
    'Fast, thin and relentless. It goes around a defended line rather than through it.',
  ),
  zombie(
    ZOMBIE_DEF_IDS.brute,
    'Brute',
    'BRUTE',
    'Infected breaker',
    0.56,
    820,
    3.0,
    7,
    ['zombieSmash'],
    'tank',
    'A mass of fused tissue that hits like a wrecking ball. Bunkers and walls are its food.',
  ),
  zombie(
    ZOMBIE_DEF_IDS.bloater,
    'Bloater',
    'BLOATER',
    'Infected area threat',
    0.6,
    300,
    2.0,
    6,
    ['zombieBurst'],
    'medic',
    'Swollen and unstable. It punishes infantry that stand shoulder to shoulder.',
  ),
  flyer(
    ZOMBIE_DEF_IDS.flyer,
    'Screamer',
    'SCREAMER',
    'Infected flyer',
    2.5,
    150,
    1.6,
    9,
    ['zombieTalon'],
    'fighter',
    'A body that grew wings and kept the appetite. It comes in above the wire, out of reach of anything with claws, and rakes what it finds from the air.',
  ),
  zombie(
    ZOMBIE_DEF_IDS.crawler,
    'Crawler',
    'CRAWLER',
    'Infected lurker',
    1.3,
    45,
    1.0,
    5.5,
    ['zombieBite'],
    'engineer',
    'Low to the ground and hard to pick out of cover. It finds the gap the firing line forgot.',
    // It crawls under the sight line: shots at it lose accuracy with range,
    // which is why a firing line has to be covered up close rather than only
    // out-ranged.
    true,
  ),
]);

export const ZOMBIE_UNIT_IDS: readonly string[] = Object.freeze(
  ZOMBIE_UNITS.map((def) => def.id),
);

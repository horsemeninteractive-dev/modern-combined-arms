/**
 * Outbreak tuning.
 *
 * Every number a match reads lives here, so balance is a data question rather
 * than a hunt through the director. Difficulty changes the shape of the attack —
 * how many bodies, how many directions, how often, and how long the players get
 * to breathe — not the hit points of a zombie, so a Nightmare shambler still
 * dies to the same burst as an Easy one.
 */
import type { OutbreakDifficulty } from '../sim/scenario';
import { ZOMBIE_KINDS, type WavePlan, type ZombieKind } from './types';

export interface OutbreakDifficultyConfig {
  id: OutbreakDifficulty;
  name: string;
  blurb: string;
  /** Materials and requisition the shared base starts with. */
  startingMats: number;
  startingReq: number;
  /** Preparation before wave 1, and the floor it decays to. */
  firstPrepSeconds: number;
  minPrepSeconds: number;
  /** Seconds shaved off preparation per completed wave. */
  prepStepSeconds: number;
  warningSeconds: number;
  /** Bodies in wave 1, extra bodies per wave, and the plan ceiling. */
  populationBase: number;
  populationPerWave: number;
  populationCap: number;
  /** Assault groups (approach directions), and how fast more are added. */
  groupsBase: number;
  groupsEveryWaves: number;
  groupsMax: number;
  /** Seconds between spawn batches at wave 1, and the floor. */
  spawnIntervalSeconds: number;
  minSpawnIntervalSeconds: number;
  /** Simultaneous living zombies allowed for wave 1, growth, and the ceiling. */
  maxAliveBase: number;
  maxAlivePerWave: number;
  maxAliveCap: number;
  /** Wave at which each archetype first appears. */
  firstWave: Record<ZombieKind, number>;
  /** Share of the horde each archetype reaches at high waves. */
  share: Record<ZombieKind, number>;
  /** How much of the apex share is reached by wave 30. */
  shareRampWaves: number;
}

const SHAMBLER_SHARE: Record<ZombieKind, number> = {
  shambler: 1,
  runner: 0.45,
  brute: 0.08,
  bloater: 0.08,
  crawler: 0.22,
  // Flyers stay a scouting party rather than a flock: a wave that is half
  // aircraft stops being a horde and becomes an air battle nothing on the field
  // was bought for.
  flyer: 0.16,
};

function difficulty(
  id: OutbreakDifficulty,
  name: string,
  blurb: string,
  values: Omit<OutbreakDifficultyConfig, 'id' | 'name' | 'blurb' | 'firstWave' | 'share' | 'shareRampWaves'> &
    Partial<Pick<OutbreakDifficultyConfig, 'firstWave' | 'share' | 'shareRampWaves'>>,
): OutbreakDifficultyConfig {
  return {
    id,
    name,
    blurb,
    firstWave: { shambler: 1, runner: 6, crawler: 9, brute: 12, bloater: 16, flyer: 9 },
    share: SHAMBLER_SHARE,
    shareRampWaves: 30,
    ...values,
  };
}

export const OUTBREAK_DIFFICULTIES: Readonly<Record<OutbreakDifficulty, OutbreakDifficultyConfig>> =
  Object.freeze({
    easy: difficulty('easy', 'Easy', 'A long opening and small hordes: room to learn the base.', {
      startingMats: 3600,
      startingReq: 200,
      firstPrepSeconds: 105,
      minPrepSeconds: 45,
      prepStepSeconds: 2.4,
      warningSeconds: 8,
      populationBase: 6,
      populationPerWave: 3.2,
      populationCap: 260,
      groupsBase: 1,
      groupsEveryWaves: 5,
      groupsMax: 3,
      spawnIntervalSeconds: 3.6,
      minSpawnIntervalSeconds: 2.0,
      maxAliveBase: 14,
      maxAlivePerWave: 2,
      maxAliveCap: 90,
      firstWave: { shambler: 1, runner: 8, crawler: 12, brute: 15, bloater: 18, flyer: 12 },
    }),
    normal: difficulty('normal', 'Normal', 'The intended rhythm: pressure builds, recovery shortens.', {
      startingMats: 3000,
      startingReq: 160,
      firstPrepSeconds: 85,
      minPrepSeconds: 30,
      prepStepSeconds: 2.2,
      warningSeconds: 7,
      populationBase: 7,
      populationPerWave: 4.0,
      populationCap: 320,
      groupsBase: 1,
      groupsEveryWaves: 4,
      groupsMax: 4,
      spawnIntervalSeconds: 3.2,
      minSpawnIntervalSeconds: 1.6,
      maxAliveBase: 16,
      maxAlivePerWave: 2.4,
      maxAliveCap: 110,
      firstWave: { shambler: 1, runner: 6, crawler: 9, brute: 12, bloater: 16, flyer: 9 },
    }),
    hard: difficulty('hard', 'Hard', 'Early runners, tighter recovery, several approach axes.', {
      startingMats: 2600,
      startingReq: 140,
      firstPrepSeconds: 70,
      minPrepSeconds: 24,
      prepStepSeconds: 2.0,
      warningSeconds: 6,
      populationBase: 8,
      populationPerWave: 4.8,
      populationCap: 380,
      groupsBase: 2,
      groupsEveryWaves: 3,
      groupsMax: 5,
      spawnIntervalSeconds: 2.8,
      minSpawnIntervalSeconds: 1.3,
      maxAliveBase: 18,
      maxAlivePerWave: 2.8,
      maxAliveCap: 130,
      firstWave: { shambler: 1, runner: 4, crawler: 7, brute: 10, bloater: 13, flyer: 8 },
      share: { shambler: 1, runner: 0.55, brute: 0.11, bloater: 0.1, crawler: 0.28, flyer: 0.2 },
      shareRampWaves: 24,
    }),
    nightmare: difficulty(
      'nightmare',
      'Nightmare',
      'Specials from the opening waves, little recovery, and the base pressured from every side.',
      {
        startingMats: 2200,
        startingReq: 120,
        firstPrepSeconds: 55,
        minPrepSeconds: 18,
        prepStepSeconds: 1.8,
        warningSeconds: 5,
        populationBase: 9,
        populationPerWave: 5.6,
        populationCap: 440,
        groupsBase: 2,
        groupsEveryWaves: 2,
        groupsMax: 6,
        spawnIntervalSeconds: 2.4,
        minSpawnIntervalSeconds: 1.0,
        maxAliveBase: 20,
        maxAlivePerWave: 3.2,
        maxAliveCap: 150,
        firstWave: { shambler: 1, runner: 3, crawler: 5, brute: 8, bloater: 10, flyer: 6 },
        share: { shambler: 1, runner: 0.65, brute: 0.14, bloater: 0.12, crawler: 0.34, flyer: 0.24 },
        shareRampWaves: 20,
      },
    ),
  });

export function outbreakDifficulty(id: string | undefined): OutbreakDifficultyConfig {
  return OUTBREAK_DIFFICULTIES[(id as OutbreakDifficulty) ?? 'normal'] ?? OUTBREAK_DIFFICULTIES.normal;
}

/** Difficulties in presentation order. */
export const OUTBREAK_DIFFICULTY_ORDER: readonly OutbreakDifficulty[] = Object.freeze([
  'easy',
  'normal',
  'hard',
  'nightmare',
]);

/** Growing but sub-linear: wave 40 is harder than wave 20 without exploding. */
function populationFor(wave: number, config: OutbreakDifficultyConfig): number {
  const base = config.populationBase + config.populationPerWave * (wave - 1);
  const ramp = Math.pow(Math.max(0, wave - 1), 1.22) * 0.55;
  return Math.min(config.populationCap, Math.round(base + ramp));
}

/**
 * Composition for a wave.
 *
 * Shares ramp from the archetype's first wave to its apex share over
 * `shareRampWaves`, so the second half of the horde changes character instead of
 * only getting longer. Specials stay a minority: a wave of nothing but brutes is
 * not more interesting than a mixed one.
 */
export function waveComposition(
  wave: number,
  config: OutbreakDifficultyConfig,
  total: number,
): Record<ZombieKind, number> {
  const weights: Record<ZombieKind, number> = {
    shambler: 1,
    runner: 0,
    brute: 0,
    bloater: 0,
    crawler: 0,
    flyer: 0,
  };
  let sum = 1;
  for (const kind of ZOMBIE_KINDS) {
    if (kind === 'shambler') continue;
    const first = config.firstWave[kind];
    if (wave < first) continue;
    const progress = Math.min(1, (wave - first + 1) / Math.max(1, config.shareRampWaves - first + 1));
    const weight = config.share[kind] * progress;
    weights[kind] = weight;
    sum += weight;
  }
  const composition: Record<ZombieKind, number> = {
    shambler: 0,
    runner: 0,
    brute: 0,
    bloater: 0,
    crawler: 0,
    flyer: 0,
  };
  let assigned = 0;
  for (const kind of ZOMBIE_KINDS) {
    if (kind === 'shambler') continue;
    const count = Math.floor((total * weights[kind]) / sum);
    composition[kind] = count;
    assigned += count;
  }
  // The shambler is the backbone: whatever the specialists did not take.
  composition.shambler = Math.max(0, total - assigned);
  return composition;
}

/**
 * Plan one wave.
 *
 * `rng` is the director's own seeded stream (not `Math.random`), so both peers
 * of a co-op match and a replayed save agree on what is coming. The plan is
 * derived only from (wave, difficulty, rng), never from wall-clock time.
 */
export function planWave(
  wave: number,
  config: OutbreakDifficultyConfig,
  rng: { next: () => number; int: (min: number, max: number) => number },
): WavePlan {
  const total = populationFor(wave, config);
  const groups = Math.min(
    config.groupsMax,
    config.groupsBase + Math.floor((wave - 1) / Math.max(1, config.groupsEveryWaves)),
  );
  const spawnInterval = Math.max(
    config.minSpawnIntervalSeconds,
    config.spawnIntervalSeconds - (wave - 1) * 0.06,
  );
  const prep = Math.max(
    config.minPrepSeconds,
    config.firstPrepSeconds - (wave - 1) * config.prepStepSeconds,
  );
  const maxAlive = Math.min(
    config.maxAliveCap,
    Math.round(config.maxAliveBase + (wave - 1) * config.maxAlivePerWave),
  );
  // A little wave-to-wave variance keeps two runs at the same wave distinct
  // without making the difficulty curve unreadable.
  const jitter = 1 + (rng.next() - 0.5) * 0.12;
  const tuned = Math.max(1, Math.round(total * jitter));
  const tunedComposition = waveComposition(wave, config, tuned);
  return {
    wave,
    total: tuned,
    composition: tunedComposition,
    groups,
    spawnIntervalSeconds: Math.round(spawnInterval * 10) / 10,
    prepSeconds: Math.round(prep),
    maxAlive,
  };
}

/** Flatten a plan into a deterministic spawn order, cycling entry regions. */
export function spawnOrder(
  plan: WavePlan,
  regionIds: readonly string[],
  rng: { next: () => number; pick: <T>(items: readonly T[]) => T },
): Array<{ kind: ZombieKind; regionId: string }> {
  const queue: Array<{ kind: ZombieKind; regionId: string }> = [];
  for (const kind of ZOMBIE_KINDS) {
    for (let i = 0; i < plan.composition[kind]; i++) queue.push({ kind, regionId: '' });
  }
  // Specials are spread through the wave rather than dumped in one batch: a
  // runner that arrives alone is a scout, ten at once are a breakthrough.
  for (let i = queue.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [queue[i], queue[j]] = [queue[j], queue[i]];
  }
  const pool = regionIds.length > 0 ? regionIds : ['default'];
  for (let i = 0; i < queue.length; i++) {
    queue[i] = { kind: queue[i].kind, regionId: pool[i % pool.length] ?? rng.pick(pool) };
  }
  return queue;
}

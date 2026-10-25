import type { Game } from './game';
import { BUILDINGS } from '../data/buildings';
import { UNITS } from '../data/units';
import { TILE_SIZE } from './constants';
import { dist } from '../core/math';
import { Terrain, canStandOn, tileIndex } from './terrain';
import type { AIControlState, AIDifficulty, AIStrategy, Entity, PlayerState } from './types';

export interface ScoutedForceMix {
  /** Armed land vehicles, including light scouts and AA carriers. */
  armour: number;
  /** Armed foot units. */
  infantry: number;
}

export type DefenceKind = 'atTurret' | 'mgNest';
export type DefenceCounts = Record<DefenceKind, number>;

/** Count the hostile land units the AI has actually seen or remembers. */
export function scoutedForceMix(game: Game, aiId: number): ScoutedForceMix {
  const mix: ScoutedForceMix = { armour: 0, infantry: 0 };
  const seen = new Set<number>();
  const count = (entityId: number, defId: string): void => {
    if (seen.has(entityId)) return;
    seen.add(entityId);
    const def = UNITS[defId];
    // Unarmed engineers and harvesters do not change which perimeter gun is
    // useful, and aircraft/naval units are outside the MG/AT remit.
    if (!def || def.domain !== 'land' || def.weapons.length === 0) return;
    if (def.armour === 'infantry') mix.infantry++;
    else if (def.armour === 'heavy' || def.armour === 'light') mix.armour++;
  };
  for (const e of game.visibleEnemies(aiId)) {
    if (e.kind === 'unit') count(e.id, e.defId);
  }
  for (const c of game.contactsFor(aiId)) {
    if (c.kind === 'unit') count(c.entityId, c.defId);
  }
  return mix;
}

/**
 * Two of the scouted force's dominant arm, one answer to the other. With no
 * scouting report the balanced pair is retained, anti-armour first.
 */
export function defenceTargets(mix: ScoutedForceMix): DefenceCounts {
  return {
    atTurret: mix.armour > mix.infantry ? 2 : 1,
    mgNest: mix.infantry > mix.armour ? 2 : 1,
  };
}

/** Next emplacement to site, or null once the scouted mix is answered. */
export function nextDefenceBuild(
  mix: ScoutedForceMix,
  counts: DefenceCounts,
): DefenceKind | null {
  const targets = defenceTargets(mix);
  const needAt = counts.atTurret < targets.atTurret;
  const needMg = counts.mgNest < targets.mgNest;
  // Build the answer to the larger scouted force first. A tie, or no contact,
  // keeps the original anti-armour opening.
  if (mix.armour > mix.infantry && needAt) return 'atTurret';
  if (mix.infantry > mix.armour && needMg) return 'mgNest';
  if (needAt) return 'atTurret';
  if (needMg) return 'mgNest';
  return null;
}

/* -------------------------------------------------------------------------- */
/* Personality and force planning                                             */
/* -------------------------------------------------------------------------- */

export interface AIProfile {
  /** Selected opponent strength, fixed for the match. */
  difficulty: AIDifficulty;
  /** The opening this commander is trying to execute. */
  strategy: AIStrategy;
  /** Higher commits earlier and keeps a smaller reserve. */
  aggression: number;
  /** Higher values refineries, harvesters and power headroom. */
  economy: number;
  /** Higher values air/naval branches. */
  tech: number;
  /** Higher sites more static defences and answers threats sooner. */
  defence: number;
  /** Relative size of the army it plans and commits. */
  armyScale: number;
  /** Ticks between decisions. A slower commander reacts later to everything. */
  reactionTicks: number;
  /** How far it bends its fixed doctrine toward the force it has scouted. */
  responseWeight: number;
  /**
   * Share of the desired army a commander insists on before it attacks. A low
   * share means units are fed in as they finish; a high share means one
   * concentrated wave.
   */
  commitShare: number;
  /** Combat units kept at home while a wave is away. */
  reserve: number;
}

/** Every commander picks one of these from the match seed. */
export const AI_STRATEGIES: AIStrategy[] = [
  'armour',
  'infantry',
  'air',
  'economy',
  'pressure',
];

const STRATEGY_BIAS: Record<
  AIStrategy,
  { aggression: number; economy: number; tech: number; defence: number }
> = {
  armour: { aggression: 0.07, economy: -0.02, tech: 0.02, defence: 0.02 },
  infantry: { aggression: 0.02, economy: -0.04, tech: -0.06, defence: 0.05 },
  air: { aggression: -0.02, economy: 0.02, tech: 0.18, defence: 0.02 },
  economy: { aggression: -0.12, economy: 0.16, tech: 0.04, defence: 0.06 },
  pressure: { aggression: 0.2, economy: -0.08, tech: -0.04, defence: -0.04 },
};

/** Opening weights, not a fixed sequence: utility decides what is built next. */
const STRATEGY_OPENING: Record<
  AIStrategy,
  { factory: number; refinery: number; barracks: number; air: number; naval: number }
> = {
  armour: { factory: 225, refinery: 190, barracks: 140, air: 8, naval: 4 },
  infantry: { factory: 200, refinery: 180, barracks: 225, air: 2, naval: 0 },
  air: { factory: 218, refinery: 184, barracks: 144, air: 34, naval: 10 },
  economy: { factory: 205, refinery: 235, barracks: 150, air: 4, naval: 8 },
  pressure: { factory: 205, refinery: 180, barracks: 230, air: 0, naval: 0 },
};

/** Army composition the commander naturally favours. */
const STRATEGY_ARMY: Record<AIStrategy, ArmyWeights> = {
  armour: { armour: 0.52, antiArmour: 0.28, infantry: 0.2 },
  infantry: { armour: 0.18, antiArmour: 0.24, infantry: 0.58 },
  air: { armour: 0.36, antiArmour: 0.3, infantry: 0.34 },
  economy: { armour: 0.38, antiArmour: 0.3, infantry: 0.32 },
  pressure: { armour: 0.3, antiArmour: 0.26, infantry: 0.44 },
};

const clamp01 = (value: number): number => Math.max(0.05, Math.min(0.95, value));

function mix32(value: number): number {
  let h = value >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return h >>> 0;
}

function unitHash(...values: number[]): number {
  let h = 0x9e3779b9;
  for (const value of values) h = mix32(h ^ (value | 0));
  return h / 0xffffffff;
}

const DIFFICULTY_BIAS: Record<
  AIDifficulty,
  {
    aggression: number;
    economy: number;
    tech: number;
    defence: number;
    armyScale: number;
    reactionTicks: number;
    responseWeight: number;
    commitShare: number;
    reserve: number;
  }
> = {
  // Same planner, same resources and vision: a level changes judgement, never
  // income. A recruit decides every three seconds, runs the thinnest economy,
  // presses early with a small army that ignores what it scouted. An elite
  // decides more than twice a second, builds the broadest economy, counters the
  // force it actually saw and masses a supported wave instead of dribbling
  // units in. Its army scale and reaction were re-measured after units learned
  // to walk around each other, which compressed the margin over veteran.
  recruit: {
    aggression: 0.16,
    economy: -0.4,
    tech: -0.24,
    defence: -0.12,
    armyScale: 0.65,
    reactionTicks: 60,
    responseWeight: 0.15,
    commitShare: 0.35,
    reserve: 0,
  },
  veteran: {
    aggression: 0,
    economy: 0,
    tech: 0,
    defence: 0,
    armyScale: 1,
    reactionTicks: 20,
    responseWeight: 0.55,
    commitShare: 1,
    reserve: 0,
  },
  elite: {
    aggression: -0.04,
    economy: 0.4,
    tech: 0.2,
    defence: 0.15,
    armyScale: 1.3,
    reactionTicks: 8,
    responseWeight: 0.95,
    commitShare: 1.1,
    reserve: 2,
  },
};

/** Seeded personality: a different match seed fields a different commander. */
export function aiProfile(seed: number, difficulty: AIDifficulty = 'veteran'): AIProfile {
  const h = mix32(seed ^ 0x51ed270b);
  const strategy = AI_STRATEGIES[mix32(seed ^ 0x2b7e1516) % AI_STRATEGIES.length];
  const bias = STRATEGY_BIAS[strategy];
  const level = DIFFICULTY_BIAS[difficulty] ?? DIFFICULTY_BIAS.veteran;
  return {
    difficulty,
    strategy,
    aggression: clamp01(
      0.36 + ((h & 0xff) / 255) * 0.46 + bias.aggression + level.aggression,
    ),
    economy: clamp01(
      0.36 + (((h >>> 8) & 0xff) / 255) * 0.46 + bias.economy + level.economy,
    ),
    tech: clamp01(
      0.34 + (((h >>> 16) & 0xff) / 255) * 0.46 + bias.tech + level.tech,
    ),
    defence: clamp01(
      0.32 + (((h >>> 24) & 0xff) / 255) * 0.46 + bias.defence + level.defence,
    ),
    armyScale: level.armyScale,
    reactionTicks: level.reactionTicks,
    responseWeight: level.responseWeight,
    commitShare: level.commitShare,
    reserve: level.reserve,
  };
}

/** Opposing army size raises the reserve; aggression lowers the gate. */
export function desiredArmySize(
  enemyMilitary: number,
  wave: number,
  aggression: number,
  armyScale = 1,
): number {
  const threat = Math.min(10, enemyMilitary * 0.5);
  const drive = (Math.max(0, Math.min(1, aggression)) - 0.5) * 6;
  const base = 6 + threat + Math.min(4, wave * 0.5) - drive;
  return Math.max(4, Math.min(20, Math.round(base * Math.max(0.5, Math.min(1.25, armyScale)))));
}

export interface ArmyWeights {
  armour: number;
  antiArmour: number;
  infantry: number;
}

/** Responsive composition floor rather than fixed unit counts. */
export function armyWeights(mix: ScoutedForceMix): ArmyWeights {
  const total = mix.armour + mix.infantry;
  if (total <= 0) return { armour: 0.34, antiArmour: 0.28, infantry: 0.38 };
  const armourShare = mix.armour / total;
  const infantryShare = mix.infantry / total;
  const raw = {
    armour: 0.26 + armourShare * 0.28,
    antiArmour: 0.2 + armourShare * 0.38,
    infantry: 0.22 + infantryShare * 0.34,
  };
  const sum = raw.armour + raw.antiArmour + raw.infantry;
  return {
    armour: raw.armour / sum,
    antiArmour: raw.antiArmour / sum,
    infantry: raw.infantry / sum,
  };
}

/** Blend the commander's preference with the force actually being scouted. */
function blendWeights(base: ArmyWeights, response: ArmyWeights, responseWeight = 0.55): ArmyWeights {
  const w = Math.max(0, Math.min(1, responseWeight));
  const raw = {
    armour: base.armour * (1 - w) + response.armour * w,
    antiArmour: base.antiArmour * (1 - w) + response.antiArmour * w,
    infantry: base.infantry * (1 - w) + response.infantry * w,
  };
  const sum = raw.armour + raw.antiArmour + raw.infantry || 1;
  return {
    armour: raw.armour / sum,
    antiArmour: raw.antiArmour / sum,
    infantry: raw.infantry / sum,
  };
}

/* -------------------------------------------------------------------------- */
/* Controller                                                                 */
/* -------------------------------------------------------------------------- */

/** Fresh controller state for one AI player; shared by Game and matchups. */
export function initialAIState(
  aiSeed: number,
  difficulty: AIDifficulty = 'veteran',
): AIControlState {
  return {
    nextThinkTick: 10,
    phase: 'opening',
    attackWave: 0,
    lastWaveTick: 0,
    targetBaseX: 0,
    targetBaseZ: 0,
    targetKnown: false,
    groupCounter: 1,
    desiredArmy: 4,
    lastDecision: 'initialising',
    nextBuildTick: 0,
    scouted: false,
    aiSeed,
    aiRng: aiSeed,
    strategy: aiProfile(aiSeed, difficulty).strategy,
    difficulty,
    lastContactTick: 0,
    lastScoutTick: 0,
    activeSiteId: 0,
    activeSiteProgress: 0,
    activeSiteTick: 0,
  };
}

interface KnownEnemy {
  id: number;
  kind: Entity['kind'];
  defId: string;
  x: number;
  z: number;
  visible: boolean;
  tick: number;
}

interface BuildOption {
  defId: string;
  score: number;
  reason: string;
  /** Essential options may pause unit spending while the AI saves. */
  essential: boolean;
}

interface AIContext {
  game: Game;
  aiId: number;
  player: PlayerState;
  st: AIControlState;
  team: number;
  own: Entity[];
  buildings: Entity[];
  complete: Entity[];
  counts: Map<string, number>;
  unitCounts: Map<string, number>;
  engineer?: Entity;
  baseX: number;
  baseZ: number;
  visible: Entity[];
  known: KnownEnemy[];
  threats: Entity[];
  mix: ScoutedForceMix;
  profile: AIProfile;
  strategy: AIStrategy;
  power: ReturnType<Game['powerStatus']>;
  hasWater: boolean;
  combat: Entity[];
  enemyAir: number;
}

/**
 * A state-driven skirmish opponent. It is given a match seed, never the
 * opponent's position: every target comes from vision or from a remembered
 * contact. The seed selects a commander temperament (armour, infantry, air,
 * economy or pressure) and the planner scores the legal options against its
 * own economy, power grid, scouting report, damage and terrain each second.
 *
 * There is no build-order list. Two matches with different seeds open
 * differently, and the same seed replays exactly because the AI's random
 * stream is part of saved state.
 */
export class AIController {
  private claimed = new Set<number>();
  private waterCache: boolean | null = null;

  update(game: Game, ownerId?: number, controlState?: AIControlState): void {
    this.claimed.clear();
    const ai =
      ownerId === undefined
        ? game.state.players.find((p) => p.isAI && !p.defeated)
        : game.player(ownerId);
    if (!ai || ai.defeated || game.state.victory !== 'playing') return;
    const st = controlState ?? game.state.ai;
    // Older saves do not carry the AI's own seed or strategy. Adopt the match
    // seed once, then keep it in state so save/load replays the same commander.
    st.aiSeed = st.aiSeed ?? game.state.seed;
    st.aiRng = st.aiRng || mix32(st.aiSeed ^ 0x9e3779b9);
    const difficulty: AIDifficulty = DIFFICULTY_BIAS[st.difficulty]
      ? st.difficulty
      : 'veteran';
    st.difficulty = difficulty;
    const profile = aiProfile(st.aiSeed, difficulty);
    // Reaction time is the controller's, not the caller's: the battle loop and
    // the matchup harness both hand it every tick and it decides when to think.
    // A recruit therefore recognises a raid or an empty factory queue later.
    if (game.state.tick < st.nextThinkTick) return;
    const strategy: AIStrategy = STRATEGY_OPENING[st.strategy] ? st.strategy : profile.strategy;
    st.strategy = strategy;

    const own = game.entitiesOf(ai.id).filter((e) => e.hp > 0);
    const buildings = own.filter((e) => e.kind === 'building');
    const complete = buildings.filter((e) => !e.construction);
    const hq = complete.find((e) => BUILDINGS[e.defId]?.commandPost);
    const scenarioPlayer = game.state.scenario.players.find((p) => p.id === ai.id);
    const baseX = hq?.x ?? (scenarioPlayer ? (scenarioPlayer.startX + 0.5) * TILE_SIZE : 0);
    const baseZ = hq?.z ?? (scenarioPlayer ? (scenarioPlayer.startZ + 0.5) * TILE_SIZE : 0);

    const counts = new Map<string, number>();
    for (const b of complete) counts.set(b.defId, (counts.get(b.defId) ?? 0) + 1);
    const unitCounts = new Map<string, number>();
    for (const u of own) {
      if (u.kind === 'unit') unitCounts.set(u.defId, (unitCounts.get(u.defId) ?? 0) + 1);
    }

    const visible = game
      .visibleEnemies(ai.id)
      .filter((e) => e.defId !== 'relay' && !(e.kind === 'unit' && e.garrisonId));
    const known = this.knownEnemies(game, ai.id, visible);
    const threats = visible.filter((e) => dist(e.x, e.z, baseX, baseZ) < 34 * TILE_SIZE);
    const engineer = own.find((e) => e.kind === 'unit' && e.defId === 'engineer');
    if (this.waterCache === null) {
      this.waterCache = game.state.scenario.tiles.some(
        (t) => t.t === Terrain.DeepWater || t.t === Terrain.ShallowWater,
      );
    }

    const combat = own.filter((e) => {
      if (e.kind !== 'unit' || e.hp <= 0) return false;
      if (e.defId === 'harvester' || e.defId === 'engineer' || e.defId === 'medic') return false;
      return (UNITS[e.defId]?.weapons.length ?? 0) > 0;
    });

    const ctx: AIContext = {
      game,
      aiId: ai.id,
      player: ai,
      st,
      team: game.teamOf(ai.id),
      own,
      buildings,
      complete,
      counts,
      unitCounts,
      engineer,
      baseX,
      baseZ,
      visible,
      known,
      threats,
      mix: scoutedForceMix(game, ai.id),
      profile,
      strategy,
      power: game.powerStatus(ai.id),
      hasWater: this.waterCache,
      combat,
      enemyAir: known.filter((e) => UNITS[e.defId]?.domain === 'air').length,
    };

    this.updateTarget(ctx);
    // Reserve a few infantry for nearby cover before general defence tasking
    // claims every combat unit for a direct counter-attack.
    this.manageGarrison(ctx);
    this.defend(ctx);
    this.scout(ctx);
    const budget = this.manageConstruction(ctx);
    this.manageProduction(ctx, budget);
    this.manageNaval(ctx);
    this.manageAir(ctx);
    this.captureObjective(ctx);
    this.offensive(ctx);
    // Scheduled after the think so the decision sees the same clock state that
    // the old fixed-cadence loop exposed.
    st.nextThinkTick = game.state.tick + profile.reactionTicks;
  }

  /* ---------------------------------------------------------------------- */
  /* Intelligence                                                           */
  /* ---------------------------------------------------------------------- */

  private knownEnemies(game: Game, aiId: number, visible: Entity[]): KnownEnemy[] {
    const known: KnownEnemy[] = [];
    const seen = new Set<number>();
    for (const e of visible) {
      if (e.owner < 0 || e.defId === 'relay') continue;
      seen.add(e.id);
      known.push({
        id: e.id,
        kind: e.kind,
        defId: e.defId,
        x: e.x,
        z: e.z,
        visible: true,
        tick: game.state.tick,
      });
    }
    for (const c of game.contactsFor(aiId)) {
      if (seen.has(c.entityId) || c.defId === 'relay') continue;
      seen.add(c.entityId);
      known.push({
        id: c.entityId,
        kind: c.kind,
        defId: c.defId,
        x: c.x,
        z: c.z,
        visible: false,
        tick: c.tick,
      });
    }
    return known;
  }

  /** Next pseudorandom draw in the AI's saved stream. */
  private random(ctx: AIContext): number {
    const st = ctx.st;
    const current = st.aiRng || mix32(st.aiSeed ^ 0x9e3779b9);
    const next = (Math.imul(current, 1664525) + 1013904223) >>> 0;
    st.aiRng = next;
    return next / 4294967296;
  }

  private contactValue(enemy: KnownEnemy, baseX: number, baseZ: number): number {
    let value = 30;
    if (enemy.kind === 'building') {
      const def = BUILDINGS[enemy.defId];
      if (def?.commandPost) value = 160;
      else if (def?.produces) value = 100;
      else if (def?.refinery) value = 95;
      else value = 70;
      if (def?.airfield || def?.shipyard) value += 20;
    } else {
      const def = UNITS[enemy.defId];
      if (def?.weapons.length) value = 42;
      if (enemy.defId === 'harvester') value = 58;
      if (enemy.defId === 'engineer') value = 34;
      if (def?.domain === 'air') value = 64;
      if (def?.domain === 'naval') value = 54;
    }
    return value - dist(enemy.x, enemy.z, baseX, baseZ) / TILE_SIZE * 0.35;
  }

  private updateTarget(ctx: AIContext): void {
    const st = ctx.st;
    // Remembered contacts are the only source of enemy coordinates. At tick
    // zero the AI has no idea where the human landing force is.
    if (ctx.known.length === 0) {
      if (st.targetKnown && ctx.game.state.tick - (st.lastContactTick ?? 0) > 20 * 40) {
        // The trail is cold. Stop assaulting a remembered point and scout again.
        st.targetKnown = false;
        st.scouted = false;
        st.phase = 'build';
        st.lastDecision = 'contact lost — resuming reconnaissance';
      }
      return;
    }
    st.lastContactTick = ctx.game.state.tick;
    const best = [...ctx.known].sort(
      (a, b) =>
        this.contactValue(b, ctx.baseX, ctx.baseZ) - this.contactValue(a, ctx.baseX, ctx.baseZ) ||
        a.id - b.id,
    )[0];
    if (!best) return;
    st.targetKnown = true;
    st.scouted = true;
    st.targetBaseX = best.x;
    st.targetBaseZ = best.z;
  }

  private claim(entity: Entity): void {
    this.claimed.add(entity.id);
  }

  private free(entity: Entity): boolean {
    // Occupants are not free line units: they must be ordered out first.
    return !entity.order && !entity.garrisonId && !this.claimed.has(entity.id);
  }

  private order(ctx: AIContext, unit: Entity, command: Parameters<Game['enqueueCommand']>[0]): boolean {
    if (!this.free(unit)) return false;
    this.claim(unit);
    ctx.game.enqueueCommand(command);
    return true;
  }

  /* ---------------------------------------------------------------------- */
  /* Defence and scouting                                                   */
  /* ---------------------------------------------------------------------- */

  private defend(ctx: AIContext): void {
    if (ctx.threats.length === 0) return;
    const target = ctx.threats.reduce((best, e) =>
      dist(e.x, e.z, ctx.baseX, ctx.baseZ) < dist(best.x, best.z, ctx.baseX, ctx.baseZ) ? e : best,
    );
    ctx.st.phase = 'defend';
    let ordered = 0;
    const targetDomain = UNITS[target.defId]?.domain;
    for (const unit of ctx.own) {
      if (unit.kind !== 'unit' || !this.free(unit)) continue;
      if (unit.defId === 'harvester' || unit.defId === 'engineer' || unit.defId === 'medic') continue;
      if (UNITS[unit.defId]?.weapons.length === 0) continue;
      if (dist(unit.x, unit.z, ctx.baseX, ctx.baseZ) > 60 * TILE_SIZE) continue;
      // Ground units cannot answer aircraft; leave that to AA and fighters.
      if (targetDomain === 'air' && unit.defId !== 'aa' && UNITS[unit.defId]?.domain !== 'air') {
        continue;
      }
      if (unit.order?.type === 'attack' && unit.order.targetId === target.id) continue;
      if (
        this.order(ctx, unit, {
          type: 'attack',
          team: ctx.aiId,
          ids: [unit.id],
          targetId: target.id,
        })
      ) {
        ordered++;
      }
    }
    if (ordered > 0) ctx.st.lastDecision = `defending base against ${target.defId}`;
  }

  private scout(ctx: AIContext): void {
    const recon = ctx.own.find((e) => e.kind === 'unit' && e.defId === 'recon' && this.free(e));
    if (!recon) return;
    const tick = ctx.game.state.tick;
    // A fresh report does not need a new patrol every second.
    if (tick - (ctx.st.lastScoutTick ?? 0) < 20 * 6) return;
    let point: { x: number; z: number } | null = null;
    if (ctx.st.targetKnown) {
      // Sweep around the last contact to keep it fresh without walking into it.
      const angle = this.random(ctx) * Math.PI * 2;
      const radius = (10 + this.random(ctx) * 8) * TILE_SIZE;
      point = {
        x: ctx.st.targetBaseX + Math.cos(angle) * radius,
        z: ctx.st.targetBaseZ + Math.sin(angle) * radius,
      };
      if (!this.standable(ctx, point.x, point.z)) point = null;
    }
    if (!point) point = this.chooseScoutPoint(ctx);
    if (!point) return;
    if (
      this.order(ctx, recon, {
        type: 'move',
        team: ctx.aiId,
        ids: [recon.id],
        x: point.x,
        z: point.z,
      })
    ) {
      ctx.st.lastScoutTick = tick;
      ctx.st.lastDecision = ctx.st.targetKnown
        ? 'reconnaissance sweep around last contact'
        : 'reconnaissance push into uncharted ground';
    }
  }

  private standable(ctx: AIContext, x: number, z: number): boolean {
    const map = ctx.game.state.map;
    const tx = Math.floor(x / TILE_SIZE);
    const tz = Math.floor(z / TILE_SIZE);
    if (tx < 1 || tz < 1 || tx >= map.width - 1 || tz >= map.height - 1) return false;
    const idx = tileIndex(map.width, tx, tz);
    return canStandOn(map.width, map.height, map.terrain, idx, 'wheeled');
  }

  private chooseScoutPoint(ctx: AIContext): { x: number; z: number } | null {
    const map = ctx.game.state.map;
    const centerX = (map.width * TILE_SIZE) / 2;
    const centerZ = (map.height * TILE_SIZE) / 2;
    let best: { x: number; z: number; score: number } | null = null;
    for (let z = 2; z < map.height - 2; z += 3) {
      for (let x = 2; x < map.width - 2; x += 3) {
        const fog = ctx.game.fogAt(ctx.team, x, z);
        if (fog === 2) continue;
        const idx = tileIndex(map.width, x, z);
        if (!canStandOn(map.width, map.height, map.terrain, idx, 'wheeled')) continue;
        const wx = (x + 0.5) * TILE_SIZE;
        const wz = (z + 0.5) * TILE_SIZE;
        const d = dist(wx, wz, ctx.baseX, ctx.baseZ) / TILE_SIZE;
        if (d < 10 || d > 72) continue;
        const towardCenter = dist(wx, wz, centerX, centerZ) / TILE_SIZE;
        const score =
          (fog === 0 ? 18 : 6) -
          Math.abs(d - 30) * 0.5 -
          towardCenter * 0.2 +
          unitHash(ctx.game.state.seed, ctx.st.nextThinkTick, x, z) * 8 +
          this.random(ctx) * 4;
        if (!best || score > best.score) best = { x: wx, z: wz, score };
      }
    }
    if (best) return { x: best.x, z: best.z };
    return null;
  }

  /* ---------------------------------------------------------------------- */
  /* Economy and construction                                               */
  /* ---------------------------------------------------------------------- */

  private buildOptions(ctx: AIContext): BuildOption[] {
    const options: BuildOption[] = [];
    const add = (defId: string, score: number, reason: string, essential = false): void => {
      options.push({ defId, score, reason, essential });
    };
    const counts = ctx.counts;
    const factory = counts.get('factory') ?? 0;
    const refinery = counts.get('refinery') ?? 0;
    const barracks = counts.get('barracks') ?? 0;
    const airfield = counts.get('airfield') ?? 0;
    const shipyard = counts.get('shipyard') ?? 0;
    const harvesters = ctx.unitCounts.get('harvester') ?? 0;
    const bank = ctx.player.mats;
    const powerGap = ctx.power.supply - ctx.power.demand;
    const threat = ctx.threats.length > 0;
    const damaged = ctx.complete.some((b) => b.hp < b.maxHp * 0.85);
    const opening = STRATEGY_OPENING[ctx.strategy];
    const jitter = (): number => this.random(ctx) * 12;

    // Structural prerequisites are scored, not scheduled. A brownout outranks
    // a new facility because every later construction is slowed by it.
    if (ctx.power.brownout) {
      add('powerPlant', 260 + jitter(), 'grid deficit', true);
    } else if (powerGap < 24 && powerGap >= 0) {
      add('powerPlant', 96 + ctx.profile.economy * 24 + jitter(), 'grid headroom');
    }

    if (!factory) add('factory', opening.factory + jitter(), 'vehicle production', true);
    else if (factory < 2 && ctx.profile.economy > 0.68 && bank > 2400) {
      add('factory', 52 + ctx.profile.economy * 26 + jitter(), 'second production line');
    }

    if (!refinery) add('refinery', opening.refinery + jitter(), 'material drop-off', true);
    else {
      const saturation = harvesters / Math.max(1, refinery);
      if (refinery < 3 && saturation >= 1.75 && bank > 550) {
        add('refinery', 58 + ctx.profile.economy * 30 + jitter(), 'saturated harvester round trips');
      }
    }

    if (!barracks) add('barracks', opening.barracks + jitter(), 'infantry production', true);
    else if (barracks < 2 && ctx.strategy === 'infantry' && bank > 1600) {
      add('barracks', 48 + jitter(), 'second infantry queue');
    }

    const defenceNeed = nextDefenceBuild(ctx.mix, {
      atTurret: counts.get('atTurret') ?? 0,
      mgNest: counts.get('mgNest') ?? 0,
    });
    if (defenceNeed) {
      const scouted = ctx.mix.armour + ctx.mix.infantry > 0;
      const pressure =
        (scouted ? 38 : 0) +
        (threat ? 55 : 0) +
        (damaged ? 35 : 0) +
        ctx.profile.defence * 28;
      // While the core is incomplete, the perimeter waits unless something has
      // actually been seen or hit.
      const coreReady = factory > 0 && refinery > 0 && barracks > 0;
      if (coreReady || scouted || threat || damaged) {
        add(
          defenceNeed,
          (coreReady ? 78 : 40) + pressure + jitter(),
          defenceNeed === 'atTurret'
            ? `anti-armour perimeter (${ctx.mix.armour} vehicles scouted)`
            : `anti-infantry perimeter (${ctx.mix.infantry} foot scouted)`,
        );
      }
    }

    if (!airfield) {
      const score =
        (ctx.strategy === 'air' ? 148 : ctx.profile.tech > 0.58 ? 52 + ctx.profile.tech * 50 : 0) +
        opening.air +
        (ctx.enemyAir > 0 ? 24 : 0);
      if (score > 0) {
        add('airfield', score + jitter(), 'air operations', false);
      }
    }
    if (!shipyard && ctx.hasWater) {
      const score =
        44 + ctx.profile.tech * 34 + opening.naval +
        (ctx.known.some((e) => UNITS[e.defId]?.domain === 'naval') ? 36 : 0) +
        (ctx.strategy === 'economy' ? 10 : 0);
      if (bank > 900) add('shipyard', score + jitter(), 'coastal production');
    }
    if ((counts.get('samBattery') ?? 0) === 0) {
      if (ctx.enemyAir > 0) add('samBattery', 178 + jitter(), 'hostile air contact');
      else if (bank > 2800 && ctx.profile.tech > 0.55) add('samBattery', 38 + jitter(), 'air defence hedge');
    }
    if ((counts.get('radar') ?? 0) === 0 && bank > 1400 && ctx.profile.economy > 0.55) {
      // Vision is an economy: a radar keeps contacts fresh so the army is not
      // repeatedly sent at stale coordinates.
      add('radar', 34 + ctx.profile.economy * 22 + jitter(), 'battlefield surveillance');
    }

    return options.sort((a, b) => b.score - a.score || a.defId.localeCompare(b.defId));
  }

  private manageConstruction(ctx: AIContext): { mats: number; req: number } {
    const site = ctx.buildings.find((e) => e.construction);
    if (site) {
      this.watchConstruction(ctx, site);
      return { mats: ctx.player.mats, req: ctx.player.req };
    }
    ctx.st.activeSiteId = 0;
    ctx.st.activeSiteProgress = 0;

    if (!ctx.engineer) {
      ctx.st.lastDecision = 'no engineer — scheduling replacement';
      return { mats: ctx.player.mats, req: ctx.player.req };
    }
    if (ctx.engineer.order) return { mats: ctx.player.mats, req: ctx.player.req };

    // A structure below 60% is a liability: patch it before laying new concrete.
    if (this.repairStructures(ctx, 0.6)) {
      return { mats: ctx.player.mats, req: ctx.player.req };
    }

    const options = this.buildOptions(ctx);
    if (options.length === 0) return { mats: ctx.player.mats, req: ctx.player.req };
    const affordable = options.filter((option) => {
      const def = BUILDINGS[option.defId];
      return !!def && ctx.player.mats >= def.cost.mats && ctx.player.req >= def.cost.req;
    });
    const top = options[0];

    if (affordable.length === 0) {
      // Nothing can be built. Put the engineer to work patching the base while
      // the bank recovers instead of idling next to a damaged structure.
      if (this.repairStructures(ctx)) return { mats: ctx.player.mats, req: ctx.player.req };
      if (top?.essential) {
        const def = BUILDINGS[top.defId];
        const reserve = def ? Math.max(0, def.cost.mats - ctx.player.mats) : 0;
        ctx.st.lastDecision = `saving for ${top.defId} — ${top.reason}`;
        return {
          mats: Math.max(0, ctx.player.mats - reserve),
          req: ctx.player.req,
        };
      }
      return { mats: ctx.player.mats, req: ctx.player.req };
    }

    // Do not spend the bank on a cheap optional building while an essential
    // one is close to affordable.
    if (top?.essential && !affordable.some((o) => o.defId === top.defId)) {
      if (this.repairStructures(ctx)) return { mats: ctx.player.mats, req: ctx.player.req };
      const def = BUILDINGS[top.defId];
      const reserve = def ? Math.max(0, def.cost.mats - ctx.player.mats) : 0;
      ctx.st.lastDecision = `saving for ${top.defId} — ${top.reason}`;
      return {
        mats: Math.max(0, ctx.player.mats - reserve),
        req: ctx.player.req,
      };
    }

    for (const option of affordable) {
      const siteChoice = this.findBuildSite(ctx, ctx.engineer, option.defId);
      if (!siteChoice) continue;
      const def = BUILDINGS[option.defId];
      if (!def) continue;
      const issued = this.order(ctx, ctx.engineer, {
        type: 'placeBuilding',
        team: ctx.aiId,
        builderId: ctx.engineer.id,
        defId: option.defId,
        tileX: siteChoice.x,
        tileZ: siteChoice.z,
      });
      if (!issued) return { mats: ctx.player.mats, req: ctx.player.req };
      ctx.st.activeSiteId = 0;
      ctx.st.activeSiteTick = ctx.game.state.tick;
      ctx.st.lastDecision = `building ${option.defId} — ${option.reason}`;
      return {
        mats: Math.max(0, ctx.player.mats - def.cost.mats),
        req: Math.max(0, ctx.player.req - def.cost.req),
      };
    }
    return { mats: ctx.player.mats, req: ctx.player.req };
  }

  /** Repair the worst local damage while construction is not the priority. */
  private repairStructures(ctx: AIContext, threshold = 0.85): boolean {
    const engineer = ctx.engineer;
    if (!engineer || !this.free(engineer)) return false;
    const worst = ctx.complete
      .filter(
        (b) =>
          b.hp < b.maxHp * threshold &&
          dist(b.x, b.z, engineer.x, engineer.z) < 70 * TILE_SIZE,
      )
      .sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0];
    if (!worst) return false;
    const issued = this.order(ctx, engineer, {
      type: 'repair',
      team: ctx.aiId,
      ids: [engineer.id],
      targetId: worst.id,
    });
    if (issued) ctx.st.lastDecision = `repairing ${worst.defId} at ${Math.round((worst.hp / worst.maxHp) * 100)}%`;
    return issued;
  }

  /**
   * One stalled site is enough to freeze an opening. Watch measurable progress,
   * release the site after 45 seconds, and let the planner choose a different
   * site instead of retrying the same unreachable approach forever.
   */
  private watchConstruction(ctx: AIContext, site: Entity): void {
    const st = ctx.st;
    if (st.activeSiteId !== site.id) {
      st.activeSiteId = site.id;
      st.activeSiteProgress = site.buildProgress;
      st.activeSiteTick = ctx.game.state.tick;
      return;
    }
    if (site.buildProgress > st.activeSiteProgress + 0.0005) {
      st.activeSiteProgress = site.buildProgress;
      st.activeSiteTick = ctx.game.state.tick;
      return;
    }
    if (ctx.game.state.tick - st.activeSiteTick <= 20 * 45) return;
    const abandoned = ctx.game.abandonConstruction(ctx.aiId, site.id, 0.5);
    st.activeSiteId = 0;
    st.activeSiteProgress = 0;
    if (abandoned) {
      st.lastDecision = `abandoned stalled ${site.defId}; reclaiming half the cost`;
    }
  }

  private findBuildSite(
    ctx: AIContext,
    engineer: Entity,
    defId: string,
  ): { x: number; z: number } | null {
    const def = BUILDINGS[defId];
    if (!def) return null;
    const map = ctx.game.state.map;
    const cx = Math.floor(ctx.baseX / TILE_SIZE);
    const cz = Math.floor(ctx.baseZ / TILE_SIZE);
    const preferred = def.weapons?.length
      ? 9
      : def.airfield
        ? 11
        : def.shipyard
          ? 12
          : def.refinery
            ? 6
            : 6.5;
    let best: { x: number; z: number; score: number } | null = null;
    for (let radius = 2; radius <= 16; radius++) {
      for (let dz = -radius; dz <= radius; dz++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== radius) continue;
          const x = cx + dx;
          const z = cz + dz;
          if (!ctx.game.placementStatus(ctx.aiId, defId, x, z, engineer.id, true).ok) continue;
          const wx = (x + def.footprint.w / 2) * TILE_SIZE;
          const wz = (z + def.footprint.h / 2) * TILE_SIZE;
          const fromBase = dist(wx, wz, ctx.baseX, ctx.baseZ) / TILE_SIZE;
          let score = -Math.abs(fromBase - preferred) * 1.4;
          score -= dist(wx, wz, engineer.x, engineer.z) / TILE_SIZE * 0.8;
          if (def.refinery) {
            let ore = 0;
            for (let oz = -7; oz <= 7; oz++) {
              for (let ox = -7; ox <= 7; ox++) {
                const tx = x + ox;
                const tz = z + oz;
                if (tx < 0 || tz < 0 || tx >= map.width || tz >= map.height) continue;
                const amount = map.ore[tileIndex(map.width, tx, tz)];
                if (amount > 0) ore += 1 + (7 - Math.max(Math.abs(ox), Math.abs(oz))) * 0.2;
              }
            }
            score += Math.min(40, ore) * (0.7 + ctx.profile.economy * 0.5);
          }
          if (def.weapons?.length) {
            // Site the perimeter between the base and the reported threat,
            // otherwise spread it around the base rather than stacking it.
            const threat = ctx.threats[0];
            if (threat) {
              const toThreat = dist(wx, wz, threat.x, threat.z) / TILE_SIZE;
              score += Math.max(0, 14 - Math.abs(toThreat - 9)) * 1.1;
              score -= dist(wx, wz, threat.x, threat.z) / TILE_SIZE * 0.05;
            } else {
              const angle = Math.atan2(wz - ctx.baseZ, wx - ctx.baseX);
              score += Math.abs(Math.sin(angle * 2)) * 2.5;
            }
          }
          if (def.shipyard) score += 4;
          if (def.airfield) score += 3;
          // Avoid crowding the same approach with units and structures.
          let crowd = 0;
          for (const e of ctx.game.state.entities) {
            if (e.hp <= 0) continue;
            if (dist(wx, wz, e.x, e.z) < (Math.max(def.footprint.w, def.footprint.h) * TILE_SIZE) / 2 + 3 * TILE_SIZE) {
              crowd++;
            }
          }
          score -= crowd * 1.1;
          score += this.random(ctx) * 2.2;
          if (!best || score > best.score) best = { x, z, score };
        }
      }
    }
    return best ? { x: best.x, z: best.z } : null;
  }

  /* ---------------------------------------------------------------------- */
  /* Production                                                             */
  /* ---------------------------------------------------------------------- */

  private queuedCounts(ctx: AIContext): Map<string, number> {
    const queued = new Map<string, number>();
    for (const building of ctx.complete) {
      for (const item of building.queue) {
        queued.set(item.defId, (queued.get(item.defId) ?? 0) + 1);
      }
    }
    return queued;
  }

  private desiredUnits(ctx: AIContext): Array<{ defId: string; priority: number; deficit: number }> {
    const queued = this.queuedCounts(ctx);
    const current = (defId: string): number => (ctx.unitCounts.get(defId) ?? 0) + (queued.get(defId) ?? 0);
    const entries: Array<{ defId: string; priority: number; deficit: number }> = [];
    const need = (defId: string, target: number, priority: number): void => {
      const count = current(defId);
      if (count < target) entries.push({ defId, priority, deficit: (target - count) / Math.max(1, target) });
    };

    const refineries = ctx.counts.get('refinery') ?? 0;
    if (!ctx.engineer) need('engineer', 1, 240);
    if (refineries > 0) {
      // Economy difficulty is a crewing decision, not a resource multiplier:
      // a recruit keeps one hauler per refinery, elite saturates the drop-offs.
      const haulerTarget =
        ctx.profile.difficulty === 'recruit'
          ? Math.min(2, refineries)
          : ctx.profile.difficulty === 'elite'
            ? Math.min(5, refineries + 2)
            : Math.min(3, refineries + 1);
      need('harvester', haulerTarget, 190);
    }

    // Scouting is a requirement while the enemy is missing, not a fixed two.
    const reconTarget = ctx.st.targetKnown ? 1 : 3;
    need('recon', reconTarget, 168);

    if (ctx.enemyAir > 0) need('aa', Math.min(3, 1 + ctx.enemyAir), 152);
    if ((ctx.counts.get('airfield') ?? 0) > 0) need('fighter', 1, 142);
    if ((ctx.counts.get('shipyard') ?? 0) > 0) need('corvette', 1, 136);
    if ((ctx.counts.get('barracks') ?? 0) > 0 && (ctx.unitCounts.get('rifle') ?? 0) >= 4) {
      need('medic', 1, 84);
    }

    const enemyMilitary = ctx.known.filter(
      (e) =>
        e.kind === 'unit' &&
        UNITS[e.defId]?.domain === 'land' &&
        (UNITS[e.defId]?.weapons.length ?? 0) > 0,
    ).length;
    const targetArmy = desiredArmySize(
      enemyMilitary,
      ctx.st.attackWave,
      ctx.profile.aggression,
      ctx.profile.armyScale,
    );
    const weights = blendWeights(
      STRATEGY_ARMY[ctx.strategy],
      armyWeights(ctx.mix),
      ctx.profile.responseWeight,
    );
    // Support is counted in the target: a 6-unit army with two harvesters is
    // not six bayonets. The floor keeps at least one of each arm.
    need('tank', Math.max(1, Math.round(targetArmy * weights.armour)), 104);
    need('atgm', Math.max(1, Math.round(targetArmy * weights.antiArmour)), 108);
    need('rifle', Math.max(1, Math.round(targetArmy * weights.infantry)), 100);
    return entries.sort(
      (a, b) => b.priority - a.priority || b.deficit - a.deficit || a.defId.localeCompare(b.defId),
    );
  }

  private manageProduction(ctx: AIContext, budget: { mats: number; req: number }): void {
    const desired = this.desiredUnits(ctx);
    for (const item of desired) {
      const def = UNITS[item.defId];
      if (!def) continue;
      if (def.cost.mats > budget.mats || def.cost.req > budget.req) continue;
      const facility = ctx.complete.find(
        (b) => ctx.game.productionStatus(ctx.aiId, b.id, item.defId).ok,
      );
      if (!facility) continue;
      ctx.game.enqueueCommand({
        type: 'produce',
        team: ctx.aiId,
        buildingId: facility.id,
        defId: item.defId,
      });
      ctx.st.lastDecision = `producing ${item.defId} (${ctx.strategy} plan)`;
      return;
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Air, naval, relays and the ground offensive                            */
  /* ---------------------------------------------------------------------- */

  private visibleTargets(ctx: AIContext, kinds: Array<(e: Entity) => boolean>): Entity[] {
    return ctx.visible.filter((e) => kinds.some((kind) => kind(e)));
  }

  private manageAir(ctx: AIContext): void {
    const fighter = ctx.own.find(
      (e) => e.kind === 'unit' && e.defId === 'fighter' && e.hp > 0 && this.free(e),
    );
    if (!fighter || fighter.aircraft?.returningHome) return;
    const landed = fighter.aircraft?.landed ?? false;
    if (!landed && fighter.ammo <= 0) return;
    const target = this.visibleTargets(ctx, [
      (e) => e.kind === 'building',
      (e) => e.defId === 'tank',
      (e) => e.defId === 'harvester',
      (e) => UNITS[e.defId]?.domain === 'air',
    ]).sort(
      (a, b) =>
        this.contactValue(this.toKnown(a), ctx.baseX, ctx.baseZ) -
        this.contactValue(this.toKnown(b), ctx.baseX, ctx.baseZ) ||
        a.id - b.id,
    )[0];
    if (!target) return;
    if (
      this.order(ctx, fighter, {
        type: 'attack',
        team: ctx.aiId,
        ids: [fighter.id],
        targetId: target.id,
      })
    ) {
      ctx.st.lastDecision = `fighter sortie against ${target.defId}`;
    }
  }

  private manageNaval(ctx: AIContext): void {
    for (const ship of ctx.own) {
      if (ship.kind !== 'unit' || UNITS[ship.defId]?.domain !== 'naval' || !this.free(ship)) continue;
      const target = ctx.visible
        .filter((e) => e.owner !== -1)
        .find(
          (e) =>
            (UNITS[e.defId]?.domain === 'naval' || BUILDINGS[e.defId]?.commandPost) &&
            dist(ship.x, ship.z, e.x, e.z) < 34 * TILE_SIZE,
        );
      if (!target) continue;
      if (
        this.order(ctx, ship, { type: 'attack', team: ctx.aiId, ids: [ship.id], targetId: target.id })
      ) {
        ctx.st.lastDecision = `corvette engaging ${target.defId}`;
      }
    }
  }

  /**
   * Seize neutral or enemy-held strategic infrastructure when the engineer is
   * free and the base is not under threat. The commander values the objective
   * that answers its current shortage rather than following a fixed list.
   */
  private captureObjective(ctx: AIContext): void {
    const engineer = ctx.engineer;
    if (!engineer || !this.free(engineer)) return;
    // A construction push is more valuable than a long capture walk; threats
    // keep the engineer at home. Both checks are cheap and state-driven.
    if (ctx.buildings.some((e) => e.construction)) return;
    if (ctx.threats.length > 0) return;
    const tick = ctx.game.state.tick;
    if (tick < (ctx.st.lastObjectiveTick ?? 0) + 20 * 15) return;
    const candidates = ctx.game.state.entities.filter(
      (e) =>
        e.kind === 'building' &&
        e.hp > 0 &&
        !e.construction &&
        !!BUILDINGS[e.defId]?.capturable &&
        e.owner !== ctx.aiId &&
        dist(engineer.x, engineer.z, e.x, e.z) < 48 * TILE_SIZE,
    );
    if (candidates.length === 0) return;
    const owned = ctx.complete.filter((e) => !!BUILDINGS[e.defId]?.capturable);
    const owns = (defId: string): boolean => owned.some((e) => e.defId === defId);
    const harvesters = ctx.unitCounts.get('harvester') ?? 0;
    const passiveMats = ctx.game.passiveMatsRate(ctx.aiId);
    const reqRate = ctx.game.reqRate(ctx.aiId);
    const score = (e: Entity): number => {
      const def = BUILDINGS[e.defId];
      let value = 30;
      if (def?.reqPerSec) value = reqRate < 2 ? 120 : 45;
      if (def?.matsPerSec) value = harvesters < 2 || passiveMats < 1.5 ? 140 : 55;
      if (def?.scanRadius) value = tick > 20 * 90 && !owns('radarStation') ? 85 : 25;
      return value - dist(engineer.x, engineer.z, e.x, e.z) / TILE_SIZE;
    };
    const target = [...candidates].sort((a, b) => score(b) - score(a) || a.id - b.id)[0];
    if (!target) return;
    if (
      this.order(ctx, engineer, {
        type: 'capture',
        team: ctx.aiId,
        ids: [engineer.id],
        targetId: target.id,
      })
    ) {
      ctx.st.lastObjectiveTick = tick;
      ctx.st.lastDecision = `engineer moving to capture ${BUILDINGS[target.defId]?.name ?? 'objective'}`;
    }
  }

  /**
   * Occupy nearby cover while defending, and release the occupants when the
   * commander switches to the attack or the shelter is about to fall.
   */
  private manageGarrison(ctx: AIContext): void {
    const tick = ctx.game.state.tick;
    // Neutral shelters are authored assets, not part of the AI's own building
    // list, so scan the battlefield for any usable cover.
    const ownedShelters = ctx.game.state.entities.filter(
      (e) =>
        e.kind === 'building' &&
        e.hp > 0 &&
        !e.construction &&
        !!BUILDINGS[e.defId]?.garrison &&
        (e.owner === ctx.aiId || e.owner === -1),
    );
    const occupied = ownedShelters.filter(
      (e) => ctx.game.garrisonOccupants(e.id).length > 0,
    );
    const shouldLeave =
      ctx.st.phase === 'assault' ||
      occupied.some((e) => e.hp < e.maxHp * 0.4);
    if (shouldLeave) {
      const last = ctx.st.lastGarrisonTick;
      if (last !== undefined && tick < last + 20 * 8) return;
      const leave = occupied.filter(
        (e) =>
          ctx.game.garrisonOccupants(e.id).some((u) => u.owner === ctx.aiId) &&
          (e.hp < e.maxHp * 0.4 || ctx.st.phase === 'assault'),
      );
      if (leave.length === 0) return;
      ctx.game.enqueueCommand({
        type: 'ungarrison',
        team: ctx.aiId,
        ids: leave.map((e) => e.id),
      });
      ctx.st.lastGarrisonTick = tick;
      ctx.st.lastDecision = `releasing ${leave.length} garrison${leave.length === 1 ? '' : 's'} for the attack`;
      return;
    }
    if (ctx.threats.length === 0 && ctx.st.phase !== 'defend') return;
    const lastGarrison = ctx.st.lastGarrisonTick;
    if (lastGarrison !== undefined && tick < lastGarrison + 20 * 8) return;
    const infantry = ctx.own
      .filter(
        (e) =>
          e.kind === 'unit' &&
          e.hp > 0 &&
          !e.garrisonId &&
          !!UNITS[e.defId]?.canGarrison &&
          this.free(e),
      )
      .sort((a, b) => a.id - b.id);
    if (infantry.length === 0) return;
    const scored = ownedShelters
      .map((building) => {
        const cfg = BUILDINGS[building.defId]?.garrison;
        if (!cfg) return null;
        const inside = ctx.game.garrisonOccupants(building.id);
        if (inside.some((u) => ctx.game.isHostile(ctx.aiId, u.owner))) return null;
        const room = cfg.capacity - inside.length;
        if (room <= 0) return null;
        const nearest = Math.min(
          ...infantry.map((u) => dist(u.x, u.z, building.x, building.z)),
        );
        if (nearest > 18 * TILE_SIZE) return null;
        const threatened = ctx.threats.some(
          (t) => dist(t.x, t.z, building.x, building.z) < 20 * TILE_SIZE,
        );
        if (!threatened && ctx.st.phase !== 'defend') return null;
        return { building, room, nearest, protection: cfg.protection };
      })
      .filter((v): v is { building: Entity; room: number; nearest: number; protection: number } => !!v)
      .sort(
        (a, b) =>
          b.protection - a.protection ||
          a.nearest - b.nearest ||
          a.building.id - b.building.id,
      );
    let assigned = 0;
    for (const candidate of scored) {
      if (assigned >= 2) break;
      const building = candidate.building;
      const available = infantry
        .filter((u) => this.free(u))
        .sort(
          (a, b) =>
            dist(a.x, a.z, building.x, building.z) -
            dist(b.x, b.z, building.x, building.z),
        );
      const chosen = available.slice(0, candidate.room);
      if (chosen.length === 0) continue;
      for (const unit of chosen) this.claim(unit);
      ctx.game.enqueueCommand({
        type: 'garrison',
        team: ctx.aiId,
        ids: chosen.map((u) => u.id),
        targetId: building.id,
      });
      assigned++;
    }
    if (assigned > 0) {
      ctx.st.lastGarrisonTick = tick;
      ctx.st.lastDecision = `infantry occupying ${assigned} shelter${assigned === 1 ? '' : 's'}`;
    }
  }

  private offensive(ctx: AIContext): void {
    const enemyMilitary = ctx.known.filter(
      (e) =>
        e.kind === 'unit' &&
        UNITS[e.defId]?.domain === 'land' &&
        (UNITS[e.defId]?.weapons.length ?? 0) > 0,
    ).length;
    ctx.st.desiredArmy = desiredArmySize(
      enemyMilitary,
      ctx.st.attackWave,
      ctx.profile.aggression,
      ctx.profile.armyScale,
    );

    if (ctx.threats.length > 0) {
      ctx.st.phase = 'defend';
      return;
    }
    // Reflect claims made by air, naval, capture and garrison tasking this
    // tick; the snapshot taken at the start of update is already stale.
    const idle = ctx.combat.filter((e) => this.free(e));
    // A commander that keeps a home guard does not lose its base to a
    // counter-attack while its army is across the map. The guard is simply not
    // committed; it still answers a threat through the defence pass. At least
    // one unit always remains eligible to attack.
    const keepHome = Math.min(ctx.profile.reserve, Math.max(0, idle.length - 1));
    const ready = keepHome > 0 ? idle.slice(0, idle.length - keepHome) : idle;
    if (!ctx.st.targetKnown || ctx.known.length === 0) {
      ctx.st.phase = 'build';
      ctx.st.lastDecision =
        idle.length > 0
          ? `holding ${idle.length}/${ctx.st.desiredArmy} units — scouting for contact`
          : 'reconnaissance screen has no contact yet';
      return;
    }

    const tick = ctx.game.state.tick;
    // Aggressive commanders commit a smaller force; cautious ones wait for
    // most of the desired army. The level's commitShare then scales that gate:
    // a recruit leaves with a fraction of it, an elite insists on more than the
    // nominal army. A wave also has a real cooldown so an unreachable order
    // cannot re-fire every second.
    const gate = Math.max(
      3,
      Math.round(
        ctx.st.desiredArmy *
          ctx.profile.commitShare *
          (0.55 + (1 - ctx.profile.aggression) * 0.35),
      ),
    );
    const cooldown = 20 * Math.round(10 + (1 - ctx.profile.aggression) * 8);
    // If production cannot lift the army to the gate — a stalled economy, a
    // lost factory, a scouted force larger than expected — commit the trained
    // force rather than parking it at the base for the rest of the match.
    const overdue = tick - ctx.st.lastWaveTick > 20 * 40;
    const committed = ready.length >= gate || (overdue && ready.length >= 4);
    if (committed && tick - ctx.st.lastWaveTick >= cooldown) {
      const ids = ready.map((e) => e.id);
      for (const unit of ready) this.claim(unit);
      ctx.game.enqueueCommand({
        type: 'move',
        team: ctx.aiId,
        ids,
        x: ctx.st.targetBaseX,
        z: ctx.st.targetBaseZ,
        attackMove: true,
      });
      ctx.st.attackWave++;
      ctx.st.lastWaveTick = tick;
      ctx.st.phase = 'assault';
      ctx.st.lastDecision = `assault wave ${ctx.st.attackWave} with ${ids.length} units`;
      return;
    }

    if (
      ctx.st.phase === 'assault' &&
      ready.length >= 2 &&
      tick - ctx.st.lastWaveTick > 20 * 15
    ) {
      const ids = ready.map((e) => e.id);
      for (const unit of ready) this.claim(unit);
      ctx.game.enqueueCommand({
        type: 'move',
        team: ctx.aiId,
        ids,
        x: ctx.st.targetBaseX,
        z: ctx.st.targetBaseZ,
        attackMove: true,
      });
      ctx.st.lastWaveTick = tick;
      ctx.st.lastDecision = `pressing toward last known contact at ${Math.round(ctx.st.targetBaseX / TILE_SIZE)},${Math.round(ctx.st.targetBaseZ / TILE_SIZE)}`;
      return;
    }

    ctx.st.phase = ready.length > 0 ? 'build' : 'pressure';
    ctx.st.lastDecision =
      ready.length > 0
        ? `massing ${ready.length}/${gate} units at base`
        : 'forces committed; supporting economy';
  }

  private toKnown(entity: Entity): KnownEnemy {
    return {
      id: entity.id,
      kind: entity.kind,
      defId: entity.defId,
      x: entity.x,
      z: entity.z,
      visible: true,
      tick: 0,
    };
  }
}

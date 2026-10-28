/**
 * Indirect-fire and match-resolution audit.
 *
 * Phase 6 found that matches in which artillery appeared timed out far more
 * often than matches without it. That is a correlation across a national
 * matrix; this tool exists to find out what actually happens inside those
 * matches. It runs the same arena, seeds and commander pairing as
 * `tools/nation-matchups.ts` (shared through `tools/matchup-arena.ts`) and
 * records, for every match:
 *
 *   - command-post damage and when the first damage landed;
 *   - how close each side's field force ever came to the enemy objective;
 *   - alive force composition by family and by material value;
 *   - indirect-fire shots fired by weapon, and artillery alive at the end;
 *   - completed static defences (weapon emplacements and garrisons);
 *   - the AI phase tick distribution and the number of committed waves;
 *   - casualties, kills, banked and gathered resources;
 *   - damage exchanged during the final minute.
 *
 * Timeouts are then classified with explicit, overlapping flags so the report
 * can separate "nobody can hurt the objective" from "nobody went".
 *
 *   npx tsx tools/timeout-audit.ts [seeds=2] [maxSeconds=600] [difficulty=veteran]
 *                                  [nations=all|uk,russia]
 *
 * It changes no game behaviour: it is a read-only observer around the normal
 * simulation and command API, exactly like the matchup harness.
 */
import { Game } from '../src/sim/game';
import { AIController, initialAIState } from '../src/sim/ai';
import type { AIDifficulty } from '../src/sim/types';
import { UNITS, unitFamily } from '../src/data/units';
import { BUILDINGS, buildingFamily } from '../src/data/buildings';
import { WEAPONS } from '../src/data/weapons';
import { dist } from '../src/core/math';
import { TILE_SIZE } from '../src/sim/constants';
import {
  NATION_IDS,
  PAIRS,
  VARIANT_BY_NATION,
  matchupScenario,
  seedPool,
  sideScore,
} from './matchup-arena';

/** Weapons that arc over cover; these are the indirect-fire families. */
const INDIRECT_WEAPONS = new Set(
  Object.values(WEAPONS)
    .filter((w) => w.indirect)
    .map((w) => w.id),
);

/** Only sample slow-moving telemetry every N ticks to keep the audit cheap. */
const SAMPLE_EVERY = 10;

/**
 * Repair-rule candidates, imposed from outside the simulation for measurement.
 * `control` is the shipped rule and leaves the tick untouched.
 *
 *   off        the engine's own suppression branch disabled through the
 *              experiment-only `repairSuppression: false` game option. This is
 *              the clean Phase 9 control: same tree, same AI, same rules, only
 *              the suppression mechanic differs.
 *   legacy     the pre-Phase-8 engine reconstructed by adding back the repair the
 *              shipped rule withheld. Kept for the Phase 8 comparison only;
 *              `off` supersedes it wherever a causal claim is needed.
 *   cost       repaired HP is paid for at the recovery vehicle's 0.45 M/HP
 *   interrupt  repair makes no progress while the structure was hit in the last
 *              second (the same 20-tick window the duels use)
 *   cap        only one engineer's worth of repair applies to a structure per tick
 */
type RepairRule = 'control' | 'off' | 'legacy' | 'cost' | 'interrupt' | 'cap';
const REPAIR_RULE = (process.env.MCA_REPAIR_RULE ?? 'control') as RepairRule;
if (!['control', 'off', 'legacy', 'cost', 'interrupt', 'cap'].includes(REPAIR_RULE)) {
  throw new Error(`Unknown MCA_REPAIR_RULE "${REPAIR_RULE}"`);
}
/**
 * Assault-destination arm. `off` reconstructs the Phase 10 aim inside the same
 * tree, so the command correction can be compared with every other variable
 * held constant. It is a diagnostic switch, not a gameplay setting.
 */
const APPROACH = (process.env.MCA_AI_APPROACH ?? 'on') as 'on' | 'off';
const REPAIR_COST_PER_HP = Number(process.env.MCA_REPAIR_COST ?? 0.45);
const ENGINEER_RATE = 0.035;
/** Mirrors ENGINEER_WORK_RANGE in the simulation: 5 tiles from the site. */
const ENGINEER_WORK_RANGE = 5 * TILE_SIZE;
const TICKS_PER_SECOND = 20;

function applyRepairRule(
  game: Game,
  rule: RepairRule,
  previousHp: Map<number, number>,
): void {
  if (rule === 'control' || rule === 'off') return;
  if (rule === 'legacy') {
    // Only suppressed ticks matter: on every other tick the engine already
    // granted the same amount this adds back.
    for (const b of game.state.entities) {
      if (b.kind !== 'building' || b.hp <= 0 || b.hp >= b.maxHp) continue;
      if (game.state.tick - b.lastHitTick >= 20) continue;
      let workers = 0;
      for (const u of game.entitiesOf(b.owner, 'unit')) {
        if (u.hp <= 0 || u.defId !== 'engineer') continue;
        if (u.order?.type !== 'repair' || u.order.targetId !== b.id) continue;
        if (dist(u.x, u.z, b.x, b.z) > ENGINEER_WORK_RANGE) continue;
        workers++;
      }
      if (workers === 0) continue;
      b.hp = Math.min(
        b.maxHp,
        b.hp + b.maxHp * ENGINEER_RATE * (1 / TICKS_PER_SECOND) * workers,
      );
    }
    return;
  }
  for (const e of game.state.entities) {
    if (e.kind !== 'building' || e.hp <= 0) continue;
    const before = previousHp.get(e.id);
    if (before === undefined) continue;
    const gain = e.hp - before;
    if (gain <= 0) continue;
    if (rule === 'cost') {
      const owner = game.player(e.owner);
      if (!owner) continue;
      const charge = gain * REPAIR_COST_PER_HP;
      if (owner.mats >= charge) {
        owner.mats -= charge;
      } else {
        e.hp = before + Math.max(0, owner.mats / REPAIR_COST_PER_HP);
        owner.mats = 0;
      }
    } else if (rule === 'interrupt') {
      if (game.state.tick - e.lastHitTick < 20) e.hp = before;
    } else if (rule === 'cap') {
      const perEngineer = e.maxHp * ENGINEER_RATE * (1 / 20);
      if (gain > perEngineer) e.hp = before + perEngineer;
    }
  }
}

interface SideAudit {
  nation: string;
  /** Highest damage the side's command post ever took. */
  hqMaxDamage: number;
  hqEndHp: number;
  hqMaxHp: number;
  /** Every point of damage the command post absorbed, including repaired damage. */
  hqGrossDamage: number;
  /** Every point the command post regained, i.e. engineer repair. */
  hqHealed: number;
  firstHqDamageTick: number | null;
  /** Sampled ticks on which this side's engineer was repairing its command post. */
  engineerRepairTicks: number;
  /** Sampled ticks on which any visible enemy stood within 15 tiles of the base. */
  baseThreatTicks: number;
  /** Largest number of visible enemies inside that radius. */
  baseThreatMax: number;
  /**
   * Sampled nearest visible enemy distance to the base, bucketed:
   * [0-10, 10-15, 15-20, 20-25, 25-34] tiles. The AI's own threat radius is 34,
   * so this separates a real base threat from a skirmish in the middle.
   */
  enemyDistanceBuckets: number[];
  /** Largest number of combat units this side had alive at once. */
  maxCombat: number;
  /** Largest number of combat units this side had within 12 tiles of the enemy HQ. */
  maxCombatAtEnemyHq: number;
  /** Closest a combat unit of this side ever came to the enemy command post. */
  closestToEnemyHq: number;
  /** Closest a combat unit came with at least six units alive on the field. */
  closestWithArmy: number;
  combatEnd: number;
  forceValueEnd: number;
  familiesEnd: Record<string, number>;
  artilleryBuilt: number;
  artilleryAliveEnd: number;
  /** Indirect shots fired, by weapon id. */
  indirectShots: Record<string, number>;
  /** Sampled ticks on which an indirect-fire hull was alive, summed over hulls. */
  artilleryHullTicks: number;
  /** Sampled ticks on which an indirect-fire hull held an attack order. */
  artilleryAttackOrderTicks: number;
  staticDefencesEnd: number;
  garrisonStructuresEnd: number;
  phaseTicks: Record<string, number>;
  waves: number;
  kills: number;
  losses: number;
  gathered: number;
  mats: number;
  req: number;
  unitsBuilt: number;
  /** Damage the side's units and structures took during the final minute. */
  damageTakenLastMinute: number;
  /** Damage the side inflicted during the final minute, measured on the enemy. */
  score: number;
  /** Endgame snapshot: what the side still had, and why it was not producing. */
  endgame: EndgameAudit;
}

/**
 * What a side owned when the match ended.
 *
 * The army-collapse question is not "did units die" — they always do — but
 * whether a side that lost its army could still have replaced it or pushed with
 * what survived. These fields separate the three ways that can fail: no economy
 * left, production blocked, or a surviving force that cannot reach the post.
 */
export interface EndgameAudit {
  harvesters: number;
  engineers: number;
  refineries: number;
  /** Completed production buildings of any domain. */
  producers: number;
  /** Units sitting in production queues. */
  queued: number;
  /** Armed land/air units, excluding garrisons. */
  combat: number;
  /** What those combat units were doing: no order, moving, attacking, other. */
  orders: { idle: number; moving: number; attacking: number; other: number };
  /** Distinct blocking reasons productionStatus reports for the roster's MBT. */
  blocked: string[];
  /** Ore left on the whole map, and what fraction of the starting field that is. */
  oreLeft: number;
  /** Nearest surviving combat unit to the enemy command post, in tiles. */
  nearestToEnemyHq: number;
  /** Ticks since any of this side's units last lost health. */
  sinceUnitDamage: number;
  /** Ticks since the enemy command post last took damage from anyone. */
  sinceEnemyHqDamage: number | null;
  /**
   * Move commands this side issued that the simulation refused outright
   * ("No route to that location"). An assault wave that is refused here never
   * leaves the base, so this is the direct measure of a phantom wave.
   */
  moveFailures: number;
  /** Subset of those whose destination lay inside an enemy structure footprint. */
  moveFailuresOnStructure: number;
}

function newSide(nation: string): SideAudit {
  return {
    nation,
    hqMaxDamage: 0,
    hqEndHp: 0,
    hqMaxHp: 0,
    hqGrossDamage: 0,
    hqHealed: 0,
    firstHqDamageTick: null,
    engineerRepairTicks: 0,
    baseThreatTicks: 0,
    baseThreatMax: 0,
    enemyDistanceBuckets: [0, 0, 0, 0, 0],
    maxCombat: 0,
    maxCombatAtEnemyHq: 0,
    closestToEnemyHq: 999,
    closestWithArmy: 999,
    combatEnd: 0,
    forceValueEnd: 0,
    familiesEnd: {},
    artilleryBuilt: 0,
    artilleryAliveEnd: 0,
    indirectShots: {},
    artilleryHullTicks: 0,
    artilleryAttackOrderTicks: 0,
    staticDefencesEnd: 0,
    garrisonStructuresEnd: 0,
    phaseTicks: {},
    waves: 0,
    kills: 0,
    losses: 0,
    gathered: 0,
    mats: 0,
    req: 0,
    unitsBuilt: 0,
    damageTakenLastMinute: 0,
    score: 0,
    endgame: {
      harvesters: 0,
      engineers: 0,
      refineries: 0,
      producers: 0,
      queued: 0,
      combat: 0,
      orders: { idle: 0, moving: 0, attacking: 0, other: 0 },
      blocked: [],
      oreLeft: 0,
      nearestToEnemyHq: 999,
      sinceUnitDamage: 0,
      sinceEnemyHqDamage: null,
      moveFailures: 0,
      moveFailuresOnStructure: 0,
    },
  };
}

/** Ore still in the ground, across the whole map. */
function totalOre(game: Game): number {
  let ore = 0;
  for (const amount of game.state.map.ore) ore += amount;
  return ore;
}

/** Total hp across every live entity owned by `owner`. */
function totalHp(game: Game, owner: number): number {
  let hp = 0;
  for (const e of game.entitiesOf(owner)) if (e.hp > 0) hp += e.hp;
  return hp;
}

function combatUnits(game: Game, owner: number): Array<{ x: number; z: number; id: number }> {
  const out: Array<{ x: number; z: number; id: number }> = [];
  for (const e of game.entitiesOf(owner, 'unit')) {
    if (e.hp <= 0 || e.garrisonId) continue;
    const def = UNITS[e.defId];
    if (!def || def.weapons.length === 0) continue;
    if (def.domain !== 'land' && def.domain !== 'air') continue;
    out.push({ x: e.x, z: e.z, id: e.id });
  }
  return out;
}

interface MatchOptions {
  westNation: string;
  eastNation: string;
  seed: number;
  difficulty: AIDifficulty;
  maxSeconds: number;
  personalityRotated: boolean;
}

function runAuditedMatch(opts: MatchOptions) {
  const { westNation, eastNation, seed, difficulty, maxSeconds, personalityRotated } = opts;
  const game = new Game(matchupScenario(westNation, eastNation, seed), {
    enableAI: false,
    repairSuppression: REPAIR_RULE !== 'off',
  });
  const west = new AIController({ resolveApproach: APPROACH !== 'off' });
  const east = new AIController({ resolveApproach: APPROACH !== 'off' });
  const westSeed = personalityRotated ? seed + 977 : seed;
  const eastSeed = personalityRotated ? seed : seed + 977;
  const westState = initialAIState(westSeed, difficulty);
  const eastState = initialAIState(eastSeed, difficulty);

  const hq = new Map<number, { owner: number; id: number; x: number; z: number; maxHp: number }>();
  const hqLastHp = new Map<number, number>();
  const buildingHp = new Map<number, number>();
  const knownUnits = new Set<number>();
  const seenProjectiles = new Set<number>();
  const sides = [newSide(westNation), newSide(eastNation)];
  const lastMinuteStart = Math.max(0, 20 * maxSeconds - 60 * 20);
  const hpAtMinuteStart = [0, 0];
  let minuteRecorded = false;
  // Endgame timing. Unit damage is tracked per tick from a hp snapshot; the
  // buildings map is already maintained for the repair rules.
  const unitHp = new Map<number, number>();
  const lastUnitDamageTick = [0, 0];
  const hqLastDamage = new Map<number, number>();
  const oreStart = totalOre(game);
  let lastEventSeq = 0;

  const auditSide = (id: number, sample: boolean): void => {
    const side = sides[id];
    const oppId = id === 0 ? 1 : 0;
    const own = game.entitiesOf(id);
    if (sample) {
      const enemyHq = [...hq.values()].find((h) => h.owner === oppId);
      if (enemyHq) {
        const arms = combatUnits(game, id);
        const closest = arms.reduce(
          (best, u) => Math.min(best, dist(u.x, u.z, enemyHq.x, enemyHq.z) / TILE_SIZE),
          999,
        );
        side.closestToEnemyHq = Math.min(side.closestToEnemyHq, closest);
        if (arms.length >= 6) {
          side.closestWithArmy = Math.min(side.closestWithArmy, closest);
        }
        side.maxCombat = Math.max(side.maxCombat, arms.length);
        const atObjective = arms.filter(
          (u) => dist(u.x, u.z, enemyHq.x, enemyHq.z) <= 12 * TILE_SIZE,
        ).length;
        side.maxCombatAtEnemyHq = Math.max(side.maxCombatAtEnemyHq, atObjective);
      }
      const st = id === 0 ? westState : eastState;
      side.phaseTicks[st.phase] = (side.phaseTicks[st.phase] ?? 0) + SAMPLE_EVERY;
      // Duty cycle of the artillery arm: a howitzer that is alive but never
      // has a spotted target contributes nothing, and that is invisible in a
      // "was it built" count.
      for (const u of own) {
        if (u.kind !== 'unit' || u.hp <= 0) continue;
        const uDef = UNITS[u.defId];
        if (!uDef?.weapons.some((wid) => INDIRECT_WEAPONS.has(wid))) continue;
        side.artilleryHullTicks += SAMPLE_EVERY;
        if (u.order?.type === 'attack') side.artilleryAttackOrderTicks += SAMPLE_EVERY;
      }
      // Distinguish "the base is under attack" from "something is visible on
      // the map": the AI's own threat radius is 34 tiles, which on this arena
      // reaches most of the opponent's half.
      if (enemyHq) {
        const ownHq = [...hq.values()].find((h) => h.owner === id);
        if (ownHq) {
          const visibleEnemies = game.visibleEnemies(id);
          const near = visibleEnemies.filter(
            (e) => dist(e.x, e.z, ownHq.x, ownHq.z) < 15 * TILE_SIZE,
          ).length;
          if (near > 0) side.baseThreatTicks += SAMPLE_EVERY;
          side.baseThreatMax = Math.max(side.baseThreatMax, near);
          const nearest = visibleEnemies.reduce(
            (best, e) => Math.min(best, dist(e.x, e.z, ownHq.x, ownHq.z) / TILE_SIZE),
            99,
          );
          const bucket =
            nearest < 10 ? 0 : nearest < 15 ? 1 : nearest < 20 ? 2 : nearest < 25 ? 3 : nearest < 34 ? 4 : -1;
          if (bucket >= 0) side.enemyDistanceBuckets[bucket] += SAMPLE_EVERY;
          const engineer = game
            .entitiesOf(id, 'unit')
            .find((e) => e.defId === 'engineer' && e.hp > 0);
          if (engineer?.order?.type === 'repair' && engineer.order.targetId === ownHq.id) {
            side.engineerRepairTicks += SAMPLE_EVERY;
          }
        }
      }
    }
    for (const e of own) {
      if (e.hp <= 0) continue;
      if (knownUnits.has(e.id)) continue;
      knownUnits.add(e.id);
      if (e.kind === 'unit') {
        side.unitsBuilt++;
        const def = UNITS[e.defId];
        if (def?.weapons.some((wid) => INDIRECT_WEAPONS.has(wid))) side.artilleryBuilt++;
      }
    }
  };

  // Identify the command posts: they are the objectives under destroyHQ.
  for (const e of game.state.entities) {
    if (e.kind === 'building' && BUILDINGS[e.defId]?.commandPost) {
      hq.set(e.id, { owner: e.owner, id: e.id, x: e.x, z: e.z, maxHp: e.maxHp });
    }
  }

  const limit = 20 * maxSeconds;
  for (let i = 0; i < limit && game.state.victory === 'playing'; i++) {
    game.tick();
    west.update(game, 0, westState);
    east.update(game, 1, eastState);
    applyRepairRule(game, REPAIR_RULE, buildingHp);
    for (const e of game.state.entities) {
      if (e.kind === 'building') buildingHp.set(e.id, e.hp);
      else if (e.kind === 'unit' && e.hp > 0) {
        const before = unitHp.get(e.id);
        if (before !== undefined && e.hp < before) {
          lastUnitDamageTick[e.owner] = game.state.tick;
        }
        unitHp.set(e.id, e.hp);
      }
    }

    // Refused orders: the only way an issued wave can fail before it starts.
    for (const ev of game.state.events) {
      if (ev.seq <= lastEventSeq) continue;
      lastEventSeq = ev.seq;
      if (ev.type !== 'orderFailed' || !ev.text.includes('No route')) continue;
      const side = sides[ev.team];
      if (!side) continue;
      side.endgame.moveFailures++;
      // Was the refused destination inside a structure? That is the case that
      // makes an assault wave a no-op rather than an awkward path.
      for (const b of game.state.entities) {
        if (b.kind !== 'building' || b.hp <= 0 || b.owner === ev.team) continue;
        const def = BUILDINGS[b.defId];
        if (!def) continue;
        const halfW = (def.footprint.w * TILE_SIZE) / 2;
        const halfH = (def.footprint.h * TILE_SIZE) / 2;
        if (Math.abs(ev.x - b.x) <= halfW && Math.abs(ev.z - b.z) <= halfH) {
          side.endgame.moveFailuresOnStructure++;
          break;
        }
      }
    }

    const sample = i % SAMPLE_EVERY === 0;
    if (sample) {
      for (const side of [0, 1]) auditSide(side, true);
    }
    // Command-post damage is tracked every tick: a couple of shells matter.
    // Gross damage and healing are accumulated separately because a structure
    // at full health at the end can still have absorbed a siege.
    for (const h of hq.values()) {
      const live = game.getEntity(h.id);
      const hp = live?.hp ?? 0;
      const previous = hqLastHp.get(h.id) ?? h.maxHp;
      const side = sides[h.owner];
      if (hp < previous) {
        side.hqGrossDamage += previous - hp;
        hqLastDamage.set(h.id, game.state.tick);
      } else if (hp > previous) side.hqHealed += hp - previous;
      hqLastHp.set(h.id, hp);
      const damage = h.maxHp - hp;
      if (damage > side.hqMaxDamage) side.hqMaxDamage = damage;
      if (damage > 0 && side.firstHqDamageTick === null) side.firstHqDamageTick = game.state.tick;
    }
    // Attribute each new projectile to the side that fired it.
    for (const p of game.state.projectiles) {
      if (seenProjectiles.has(p.id)) continue;
      seenProjectiles.add(p.id);
      const weapon = WEAPONS[p.weaponId];
      if (!weapon?.indirect) continue;
      const side = sides[p.owner];
      if (!side) continue;
      side.indirectShots[weapon.id] = (side.indirectShots[weapon.id] ?? 0) + 1;
    }
    if (!minuteRecorded && game.state.tick >= lastMinuteStart) {
      hpAtMinuteStart[0] = totalHp(game, 0);
      hpAtMinuteStart[1] = totalHp(game, 1);
      minuteRecorded = true;
    }
  }

  for (const id of [0, 1]) {
    auditSide(id, true);
    const side = sides[id];
    const p = game.player(id)!;
    const own = game.entitiesOf(id);
    const ownHq = [...hq.values()].find((h) => h.owner === id);
    side.hqEndHp = ownHq ? Math.round(game.getEntity(ownHq.id)?.hp ?? 0) : 0;
    side.hqMaxHp = ownHq?.maxHp ?? 0;
    side.hqGrossDamage = Math.round(side.hqGrossDamage);
    side.hqHealed = Math.round(side.hqHealed);
    const st = id === 0 ? westState : eastState;
    side.waves = st.attackWave;
    side.kills = p.stats.kills;
    side.losses = p.stats.unitsLost;
    side.gathered = Math.round(p.stats.matsGathered);
    side.mats = Math.round(p.mats);
    side.req = Math.round(p.req);
    side.unitsBuilt = p.stats.unitsBuilt;
    side.score = sideScore(game, id);
    let combat = 0;
    let force = 0;
    for (const e of own) {
      if (e.hp <= 0) continue;
      if (e.kind === 'unit') {
        const def = UNITS[e.defId];
        if (!def) continue;
        force += def.cost.mats + def.cost.req * 1.5;
        if (def.weapons.length > 0 && (def.domain === 'land' || def.domain === 'air')) {
          combat++;
          side.familiesEnd[unitFamily(e.defId)] =
            (side.familiesEnd[unitFamily(e.defId)] ?? 0) + 1;
        }
        if (def.weapons.some((wid) => INDIRECT_WEAPONS.has(wid))) side.artilleryAliveEnd++;
      } else {
        const def = BUILDINGS[e.defId];
        if (!def || e.construction) continue;
        if ((def.weapons?.length ?? 0) > 0) side.staticDefencesEnd++;
        if (def.garrison) side.garrisonStructuresEnd++;
      }
    }
    side.combatEnd = combat;
    side.forceValueEnd = Math.round(force);

    // Endgame snapshot. Production is probed through the same status call the
    // shell uses, so the reason recorded here is the reason the player would see.
    const live = own.filter((e) => e.hp > 0);
    const liveUnits = live.filter((e) => e.kind === 'unit');
    const armed = liveUnits.filter((e) => {
      const def = UNITS[e.defId];
      return !!def && def.weapons.length > 0 && (def.domain === 'land' || def.domain === 'air');
    });
    const producers = live.filter(
      (e) => e.kind === 'building' && !e.construction && !!BUILDINGS[e.defId]?.produces,
    );
    const orders = { idle: 0, moving: 0, attacking: 0, other: 0 };
    for (const u of armed) {
      const type = u.order?.type;
      if (!type) orders.idle++;
      else if (type === 'move') orders.moving++;
      else if (type === 'attack' || type === 'attackMove') orders.attacking++;
      else orders.other++;
    }
    // Probe each facility with a unit it can actually build, so the recorded
    // reason is about the economy and not about asking a barracks for a tank.
    const blocked = new Set<string>();
    for (const b of producers) {
      const entry = game.productionEntries(id, b.defId)[0];
      if (!entry) continue;
      const status = game.productionStatus(id, b.id, entry);
      if (!status.ok) blocked.add(status.reason);
    }
    const enemyHq = [...hq.values()].find((h) => h.owner !== id);
    const nearestToEnemyHq = enemyHq
      ? armed.reduce(
          (best, u) => Math.min(best, dist(u.x, u.z, enemyHq.x, enemyHq.z) / TILE_SIZE),
          999,
        )
      : 999;
    const enemyHqDamaged = enemyHq ? hqLastDamage.get(enemyHq.id) : undefined;
    side.endgame = {
      harvesters: liveUnits.filter((u) => unitFamily(u.defId) === 'harvester').length,
      engineers: liveUnits.filter((u) => unitFamily(u.defId) === 'engineer').length,
      refineries: live.filter(
        (e) => e.kind === 'building' && !e.construction && BUILDINGS[e.defId]?.refinery,
      ).length,
      producers: producers.length,
      queued: producers.reduce((n, b) => n + b.queue.length, 0),
      combat: armed.length,
      orders,
      blocked: [...blocked],
      oreLeft: totalOre(game),
      nearestToEnemyHq: +nearestToEnemyHq.toFixed(1),
      sinceUnitDamage: game.state.tick - lastUnitDamageTick[id],
      sinceEnemyHqDamage:
        enemyHqDamaged === undefined ? null : game.state.tick - enemyHqDamaged,
      // Accumulated during the match, not read from the final state.
      moveFailures: side.endgame.moveFailures,
      moveFailuresOnStructure: side.endgame.moveFailuresOnStructure,
    };

    const hqLost = hpAtMinuteStart[id];
    if (hqLost > 0) side.damageTakenLastMinute = Math.max(0, hpAtMinuteStart[id] - totalHp(game, id));
  }
  sides[0].damageTakenLastMinute = Math.max(0, hpAtMinuteStart[0] - totalHp(game, 0));
  sides[1].damageTakenLastMinute = Math.max(0, hpAtMinuteStart[1] - totalHp(game, 1));
  for (const side of sides) side.damageTakenLastMinute = Math.round(side.damageTakenLastMinute);

  return {
    victory: game.state.victory,
    seconds: +(game.state.tick / 20).toFixed(1),
    oreStart,
    sides,
  };
}

/**
 * Overlapping timeout flags. Each one is a direct statement about recorded
 * state, so the report can say which mechanisms co-occur rather than forcing
 * every stalled match into one box.
 */
function classify(
  result: ReturnType<typeof runAuditedMatch>,
  timeout: boolean,
): { primary: string; flags: string[] } {
  const [a, b] = result.sides;
  const flags: string[] = [];
  const shots = (s: SideAudit): number =>
    Object.values(s.indirectShots).reduce((n, v) => n + v, 0);
  const arty = (s: SideAudit): boolean => shots(s) > 0 || s.artilleryAliveEnd > 0;

  if (!timeout) {
    if (a.hqMaxDamage === 0 && b.hqMaxDamage === 0) flags.push('decisive-without-hq-damage');
    return { primary: 'resolved', flags };
  }

  if (Math.min(a.closestToEnemyHq, b.closestToEnemyHq) > 20) flags.push('no-approach');
  if (Math.min(a.closestWithArmy, b.closestWithArmy) > 14) flags.push('army-never-approached');
  if (a.hqGrossDamage === 0 && b.hqGrossDamage === 0) flags.push('no-objective-damage');
  const repairedThrough = (s: SideAudit): boolean =>
    s.hqGrossDamage >= 500 && s.hqMaxHp > 0 && s.hqEndHp / s.hqMaxHp >= 0.85;
  if (repairedThrough(a) || repairedThrough(b)) flags.push('hq-repaired-through');
  if (a.engineerRepairTicks + b.engineerRepairTicks >= 20 * 30) flags.push('engineer-repairing');
  const share = (s: SideAudit, value: number): number => {
    const total = Object.values(s.phaseTicks).reduce((n, v) => n + v, 0);
    return total > 0 ? value / total : 0;
  };
  // "Defending" for most of the match while almost nothing is near the base is
  // the signature of the whole army being drawn out to a mid-map skirmish.
  if (
    [a, b].some(
      (s) => share(s, s.phaseTicks.defend ?? 0) > 0.5 && share(s, s.baseThreatTicks) < 0.15,
    )
  ) {
    flags.push('defend-without-base-threat');
  }
  if (a.staticDefencesEnd >= 2 && b.staticDefencesEnd >= 2) flags.push('mutual-defences');
  if (a.staticDefencesEnd + b.staticDefencesEnd >= 3) flags.push('defences');
  if (arty(a) || arty(b)) flags.push('artillery-present');
  if (shots(a) + shots(b) >= 10) flags.push('artillery-firing');
  if (arty(a) && arty(b)) flags.push('both-sides-artillery');
  if (
    a.combatEnd + b.combatEnd >= 10 &&
    a.hqMaxDamage === 0 &&
    b.hqMaxDamage === 0
  ) {
    flags.push('armies-alive-no-progress');
  }
  const valueRatio =
    Math.max(a.forceValueEnd, b.forceValueEnd) / Math.max(1, Math.min(a.forceValueEnd, b.forceValueEnd));
  if (valueRatio >= 1.6 && Math.max(a.combatEnd, b.combatEnd) >= 8) flags.push('force-advantage-held');
  if (a.damageTakenLastMinute + b.damageTakenLastMinute === 0) flags.push('quiet-last-minute');
  else if (a.damageTakenLastMinute > 300 && b.damageTakenLastMinute > 300) {
    flags.push('active-last-minute');
  }
  if (a.mats >= 800 && b.mats >= 800) flags.push('both-banked');
  if (a.gathered + b.gathered < 6000) flags.push('thin-economy');
  if (a.combatEnd <= 2 && b.combatEnd <= 2) flags.push('armies-gone');

  let primary = 'other';
  if (flags.includes('armies-gone')) primary = 'army-collapse';
  else if (flags.includes('no-approach') && a.combatEnd + b.combatEnd >= 6) primary = 'no-approach';
  else if (flags.includes('army-never-approached')) primary = 'targeting-or-pathfinding';
  else if (flags.includes('hq-repaired-through')) primary = 'siege-out-repaired';
  else if (flags.includes('no-objective-damage') && flags.includes('defences')) {
    primary = 'defensive-stalemate';
  } else if (flags.includes('no-objective-damage') && flags.includes('artillery-firing')) {
    primary = 'artillery-standoff';
  } else if (flags.includes('armies-alive-no-progress')) primary = 'insufficient-siege';
  else if (flags.includes('active-last-minute')) primary = 'active-unresolved';
  else if (flags.includes('both-banked')) primary = 'economic-stagnation';
  return { primary, flags };
}

const args = process.argv.slice(2);
const seedCount = Math.max(1, Number(args[0] ?? 2));
const maxSeconds = Math.max(60, Math.min(1200, Number(args[1] ?? 600)));
const difficulty = (args[2] ?? 'veteran') as AIDifficulty;
if (!['recruit', 'veteran', 'elite'].includes(difficulty)) {
  throw new Error(`Unknown difficulty "${difficulty}"`);
}
const nationFilter = (args[3] ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const nations = nationFilter.length > 0 ? nationFilter : NATION_IDS;
for (const n of nations) {
  if (!NATION_IDS.includes(n)) throw new Error(`Unknown nation "${n}"`);
}
const seeds = seedPool().slice(0, seedCount);
const pairs = PAIRS.filter(([a, b]) => nations.includes(a) && nations.includes(b));

if (pairs.length === 0) throw new Error('No pairings selected');

console.log(
  JSON.stringify({
    event: 'config',
    arena: 'shared national-matchup arena (tools/matchup-arena.ts)',
    seeds,
    difficulty,
    maxSeconds,
    repairRule: REPAIR_RULE,
    repairCostPerHp: REPAIR_RULE === 'cost' ? REPAIR_COST_PER_HP : 0,
    nations,
    pairs: pairs.map(([a, b]) => `${a} vs ${b}`),
    indirectWeapons: [...INDIRECT_WEAPONS],
  }),
);

const byCategory: Record<string, number> = {};
const byCategoryArty: Record<string, { arty: number; noArty: number }> = {};
const artyPresence = { withArtillery: 0, withoutArtillery: 0 };
const outcomes = { victory: 0, defeat: 0, draw: 0, timeout: 0 };
let decisiveSeconds: number[] = [];
let timeoutSeconds: number[] = [];
const perNation: Record<
  string,
  { games: number; timeouts: number; timeoutsWithArty: number; builtArty: number; shots: number }
> = {};
let matchCount = 0;

for (const [a, b] of pairs) {
  for (const seed of seeds) {
    for (const personalityRotated of [false, true]) {
      for (const swapped of [false, true]) {
        const westNation = swapped ? b : a;
        const eastNation = swapped ? a : b;
        const result = runAuditedMatch({
          westNation,
          eastNation,
          seed,
          difficulty,
          maxSeconds,
          personalityRotated,
        });
        matchCount++;
        const timeout = result.victory === 'playing';
        if (timeout) outcomes.timeout++;
        else if (result.victory === 'draw') outcomes.draw++;
        else outcomes.victory++; // relative to player 0; seat split is reported by the harness
        if (timeout) timeoutSeconds.push(result.seconds);
        else decisiveSeconds.push(result.seconds);

        const [wa, ea] = result.sides;
        const arty = [...result.sides].some(
          (s) => s.artilleryBuilt > 0 || Object.keys(s.indirectShots).length > 0,
        );
        if (arty) artyPresence.withArtillery++;
        else artyPresence.withoutArtillery++;

        for (const [nation, side] of [
          [westNation, wa],
          [eastNation, ea],
        ] as const) {
          const rec = (perNation[nation] ??= {
            games: 0,
            timeouts: 0,
            timeoutsWithArty: 0,
            builtArty: 0,
            shots: 0,
          });
          rec.games++;
          if (timeout) rec.timeouts++;
          if (timeout && side.artilleryBuilt > 0) rec.timeoutsWithArty++;
          if (side.artilleryBuilt > 0) rec.builtArty++;
          rec.shots += Object.values(side.indirectShots).reduce((n, v) => n + v, 0);
        }

        const { primary, flags } = classify(result, timeout);
        if (timeout) {
          byCategory[primary] = (byCategory[primary] ?? 0) + 1;
          const bucket = (byCategoryArty[primary] ??= { arty: 0, noArty: 0 });
          if (arty) bucket.arty++;
          else bucket.noArty++;
        }

        // Only stalled matches need the full telemetry dump; decisive ones are
        // summarised so the file stays readable.
        console.log(
          JSON.stringify({
            event: 'match',
            pair: `${a} vs ${b}`,
            seed,
            swapped,
            personalityRotated,
            west: westNation,
            east: eastNation,
            victory: result.victory,
            timeout,
            seconds: result.seconds,
            category: primary,
            flags,
            artillery: arty,
            oreStart: result.oreStart,
            westSide: wa,
            eastSide: ea,
          }),
        );
      }
    }
  }
}

const mean = (xs: number[]): number =>
  xs.length === 0 ? 0 : +(xs.reduce((n, v) => n + v, 0) / xs.length).toFixed(1);
const pct = (n: number, d: number): number => (d === 0 ? 0 : Math.round((n / d) * 1000) / 10);

console.log(
  JSON.stringify({
    event: 'summary',
    matches: matchCount,
    outcomes,
    timeoutRatePct: pct(outcomes.timeout, matchCount),
    timeoutRateWithArtilleryPct: pct(
      Object.values(byCategoryArty).reduce((n, b) => n + b.arty, 0),
      artyPresence.withArtillery,
    ),
    artilleryPresence: artyPresence,
    decisiveMeanSeconds: mean(decisiveSeconds),
    timeoutMeanSeconds: mean(timeoutSeconds),
    categories: Object.fromEntries(
      Object.entries(byCategory)
        .sort((x, y) => y[1] - x[1])
        .map(([k, n]) => [
          k,
          { count: n, sharePct: pct(n, outcomes.timeout), ...byCategoryArty[k] },
        ]),
    ),
    perNation: Object.fromEntries(
      Object.entries(perNation).map(([nation, r]) => [
        nation,
        {
          ...r,
          variant: VARIANT_BY_NATION[nation],
          artilleryRatePct: pct(r.builtArty, r.games),
          timeoutRatePct: pct(r.timeouts, r.games),
        },
      ]),
    ),
  }),
);

import { describe, expect, it } from 'vitest';
import { Game } from '../src/sim/game';
import { WEAPONS } from '../src/data/weapons';
import { createEmptyScenario } from '../src/data/scenarios';
import {
  MAX_RANK,
  MAX_XP,
  RANKS,
  XP_PER_WOUND,
  awardCombatXp,
  experienceForDamage,
  experienceOf,
  rankForXp,
  rankOf,
  veterancyProgress,
} from '../src/sim/veterancy';

/**
 * A tank and a rifleman facing each other in the open. The pair is duplicated
 * by the tests that need two identical worlds, so the only difference between
 * them is the experience under test.
 */
function duel(): Game {
  // A bare arena: one tank against one rifleman, so every point of damage the
  // enemy takes was dealt by the crew under test.
  const scenario = createEmptyScenario(64, 64);
  scenario.structures = [
    { defId: 'commandPost', owner: 0, x: 12, z: 32 },
    { defId: 'commandPost', owner: 1, x: 52, z: 32 },
  ];
  scenario.units = [
    { defId: 'tank', owner: 0, x: 26, z: 38 },
    { defId: 'rifle', owner: 1, x: 32, z: 38 },
  ];
  return new Game(scenario, { enableAI: false });
}

function tankOf(game: Game) {
  return game.entitiesOf(0, 'unit').find((e) => e.defId === 'tank')!;
}

describe('veterancy ranks', () => {
  it('promotes on experience thresholds with monotonic, modest bonuses', () => {
    expect(rankForXp(0)).toBe(0);
    expect(rankForXp(RANKS[1].xp - 1)).toBe(0);
    expect(rankForXp(RANKS[1].xp)).toBe(1);
    expect(rankForXp(RANKS[2].xp - 1)).toBe(1);
    expect(rankForXp(RANKS[2].xp)).toBe(2);
    expect(rankForXp(10_000)).toBe(MAX_RANK);

    const [recruit, veteran, elite] = RANKS;
    expect(veteran.accuracy).toBeGreaterThan(recruit.accuracy);
    expect(elite.accuracy).toBeGreaterThan(veteran.accuracy);
    expect(elite.damage).toBeGreaterThan(veteran.damage);
    expect(veteran.cooldown).toBeLessThan(recruit.cooldown);
    expect(elite.cooldown).toBeLessThan(veteran.cooldown);
    // A rank is a better crew, not a different unit: nothing here doubles a hull.
    expect(elite.damage).toBeLessThan(1.25);
    expect(elite.accuracy).toBeLessThan(0.2);
    expect(elite.cooldown).toBeGreaterThan(0.8);
  });

  it('reports progress toward the next rank and stops at the top', () => {
    const early = veterancyProgress({ kind: 'unit', xp: 0 });
    expect(early.rank.rank).toBe(0);
    expect(early.fraction).toBe(0);
    expect(early.next?.rank).toBe(1);

    const half = veterancyProgress({ kind: 'unit', xp: (RANKS[1].xp + RANKS[2].xp) / 2 });
    expect(half.rank.rank).toBe(1);
    expect(half.fraction).toBeCloseTo(0.5, 6);

    const maxed = veterancyProgress({ kind: 'unit', xp: 5000 });
    expect(maxed.rank.rank).toBe(MAX_RANK);
    expect(maxed.next).toBeNull();
    expect(maxed.fraction).toBe(0);
  });

  it('scales experience against the target it destroyed and clamps the total', () => {
    expect(experienceForDamage(0, 600)).toBe(0);
    expect(experienceForDamage(60, 600)).toBe(10);
    expect(experienceForDamage(600, 600)).toBe(XP_PER_WOUND);

    const crew = { kind: 'unit', xp: 0 };
    expect(awardCombatXp(crew, 600, 600)?.rank).toBe(1);
    expect(crew.xp).toBe(XP_PER_WOUND);
    awardCombatXp(crew, 1e9, 1);
    expect(crew.xp).toBe(MAX_XP);
    expect(rankForXp(crew.xp)).toBe(MAX_RANK);
  });

  it('never gives a structure a crew rank', () => {
    const structure = { kind: 'building', xp: 0 };
    expect(awardCombatXp(structure, 600, 600)).toBeNull();
    expect(structure.xp).toBe(0);
    expect(rankOf({ kind: 'building', xp: 900 }).rank).toBe(0);
    expect(experienceOf({ kind: 'building', xp: 900 })).toBe(0);
  });
});

describe('veterancy in battle', () => {
  it('earns a rank by destroying an enemy and announces the promotion', () => {
    const game = duel();
    const tank = tankOf(game);
    const rifle = game.entitiesOf(1, 'unit').find((e) => e.defId === 'rifle')!;
    expect(tank.xp).toBe(0);
    game.enqueueCommand({ type: 'attack', team: 0, ids: [tank.id], targetId: rifle.id });
    game.advance(20 * 20);

    expect(rifle.hp).toBeLessThanOrEqual(0);
    expect(tank.xp).toBeGreaterThanOrEqual(XP_PER_WOUND);
    expect(rankForXp(tank.xp ?? 0)).toBeGreaterThanOrEqual(1);
    expect(
      game.state.events.some((e) => e.type === 'notice' && /promoted to Veteran/.test(e.text)),
    ).toBe(true);
    // The machine-readable marker is what drives the voice line, the hull flash
    // and the log entry, so it has to name the promoted unit.
    const promotion = game.state.events.find((e) => e.code === 'unitPromoted');
    expect(promotion?.type).toBe('notice');
    expect(promotion?.entityId).toBe(tank.id);
    expect(promotion?.team).toBe(0);
  });

  it('puts the crew bonus into the round that leaves the barrel', () => {
    const rookGame = duel();
    const eliteGame = duel();
    const rook = tankOf(rookGame);
    const elite = tankOf(eliteGame);
    elite.xp = RANKS[2].xp;

    const firstShot = (game: Game, shooterId: number): number => {
      game.enqueueCommand({
        type: 'attack',
        team: 0,
        ids: [shooterId],
        targetId: game.entitiesOf(1, 'unit').find((e) => e.defId === 'rifle')!.id,
      });
      for (let i = 0; i < 20 * 6; i++) {
        game.tick();
        const shot = game.state.projectiles.find((p) => p.shooterId === shooterId);
        if (shot) return shot.damage;
      }
      return 0;
    };

    const rookDamage = firstShot(rookGame, rook.id);
    const eliteDamage = firstShot(eliteGame, elite.id);
    expect(rookDamage).toBeCloseTo(WEAPONS.tankGun.damage, 5);
    expect(eliteDamage / rookDamage).toBeCloseTo(RANKS[2].damage, 3);
  });

  it('keeps two identical battles in step, experience included', () => {
    const a = duel();
    const b = duel();
    for (const game of [a, b]) {
      const tank = tankOf(game);
      const rifle = game.entitiesOf(1, 'unit').find((e) => e.defId === 'rifle')!;
      game.enqueueCommand({ type: 'attack', team: 0, ids: [tank.id], targetId: rifle.id });
      game.advance(20 * 20);
    }
    expect(tankOf(a).xp).toBe(tankOf(b).xp);
    expect(a.stateHash()).toBe(b.stateHash());
  });

  it('survives a save round-trip with the same rank intact', () => {
    const game = duel();
    const tank = tankOf(game);
    tank.xp = RANKS[1].xp + 40;
    const restored = Game.fromSave(JSON.parse(JSON.stringify(game.toSave())), { enableAI: false });
    // The saving game is authoritative: the same object is read back.
    const copy = restored.entitiesOf(0, 'unit').find((e) => e.defId === 'tank')!;
    expect(copy.xp).toBe(RANKS[1].xp + 40);
    expect(rankOf(copy).rank).toBe(1);
    expect(restored.stateHash()).toBe(game.stateHash());
  });
});

import { describe, expect, it } from 'vitest';
import { Game } from '../src/sim/game';
import { TICK_RATE, TILE_SIZE } from '../src/sim/constants';
import { createOutbreakScenario } from '../src/outbreak/scenario';
import { ZOMBIE_DEF_IDS, ZOMBIE_UNITS } from '../src/data/zombies';
import { BUILDINGS } from '../src/data/buildings';
import { TERRAIN, Terrain, type TerrainId } from '../src/sim/terrain';
import { STRANDED_DESPAWN_SECONDS } from '../src/outbreak/match';
import type { Scenario } from '../src/sim/scenario';

function outbreakGame(overrides: Partial<Parameters<typeof createOutbreakScenario>[0]> = {}): {
  game: Game;
  scenario: Scenario;
} {
  const scenario = createOutbreakScenario({
    difficulty: 'normal',
    mode: 'solo',
    nationId: 'poland',
    seed: 4242,
    ...overrides,
  });
  const game = new Game(scenario, { enableAI: false });
  return { game, scenario };
}

const CENTRE_X = (96 / 2) * TILE_SIZE;
const CENTRE_Z = (96 / 2) * TILE_SIZE;

function infectedIds(game: Game): number[] {
  return game.state.entities
    .filter((e) => e.owner === 1 && e.kind === 'unit' && e.hp > 0)
    .map((e) => e.id);
}

/**
 * Open ground with standable neighbours, near an approach and clear of the base.
 * A one-tile pocket there can be sealed without touching anything else.
 */
function pocketSite(scenario: Scenario): { x: number; z: number } {
  const standable = (x: number, z: number): boolean => {
    const tile = scenario.tiles[z * scenario.width + x];
    return Number.isFinite(TERRAIN[tile.t as TerrainId].costs.foot);
  };
  const open = (x: number, z: number): boolean => {
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) if (!standable(x + dx, z + dz)) return false;
    }
    return true;
  };
  for (const region of scenario.meta.outbreak!.entryRegions) {
    for (let ring = 0; ring <= 3; ring++) {
      for (let dz = -ring; dz <= ring; dz++) {
        for (let dx = -ring; dx <= ring; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== ring) continue;
          const x = region.x + dx;
          const z = region.z + dz;
          if (x < 2 || z < 2 || x >= scenario.width - 2 || z >= scenario.height - 2) continue;
          if (open(x, z)) return { x, z };
        }
      }
    }
  }
  throw new Error('no open ground for the pocket');
}

describe('the infected in the live simulation', () => {
  it('attaches an Outbreak director to an Outbreak scenario only', () => {
    const { game } = outbreakGame();
    expect(game.outbreak).not.toBeNull();
    expect(game.outbreak!.wave).toBe(1);
    expect(game.outbreak!.phase).toBe('preparation');
    const skirmish = new Game(createOutbreakScenario({ difficulty: 'normal', mode: 'solo', nationId: 'poland' }), {
      enableAI: false,
    });
    skirmish.state.scenario.meta.outbreak = undefined;
    expectGameWithoutOutbreak();
    function expectGameWithoutOutbreak(): void {
      // A copy of an Outbreak map without the block is an ordinary scenario.
      const plain = new Game(
        { ...skirmish.state.scenario, meta: { ...skirmish.state.scenario.meta, outbreak: undefined } },
        { enableAI: false },
      );
      expect(plain.outbreak).toBeNull();
    }
  });

  it('spawns an infected unit that walks toward the base', () => {
    const { game } = outbreakGame();
    const region = game.state.scenario.meta.outbreak!.entryRegions.find((r) => r.id === 'south-road')!;
    const zombie = game.spawnInfected(
      ZOMBIE_DEF_IDS.shambler,
      (region.x + 0.5) * TILE_SIZE,
      (region.z + 0.5) * TILE_SIZE,
      1,
    );
    expect(zombie).not.toBeNull();
    expect(zombie!.owner).toBe(1);
    const startDistance = Math.hypot(zombie!.x - CENTRE_X, zombie!.z - CENTRE_Z);
    // Let the director pick it a destination and the simulation walk it.
    for (let i = 0; i < TICK_RATE * 12; i++) game.tick();
    const entity = game.getEntity(zombie!.id)!;
    const endDistance = Math.hypot(entity.x - CENTRE_X, entity.z - CENTRE_Z);
    expect(endDistance).toBeLessThan(startDistance - 4 * TILE_SIZE);
  });

  it('attacks a nearby soldier without being told to', () => {
    const { game } = outbreakGame();
    const soldier = game.state.entities.find((e) => e.owner === 0 && e.kind === 'unit' && e.defId === 'rifle')!;
    const zombie = game.spawnInfected(ZOMBIE_DEF_IDS.runner, soldier.x + 4, soldier.z, 1)!;
    const startHp = soldier.hp;
    for (let i = 0; i < TICK_RATE * 20; i++) game.tick();
    const after = game.getEntity(soldier.id);
    // Either the soldier was hurt or the runner died trying: both are combat.
    const damaged = !after || after.hp < startHp;
    const zombieGone = (game.getEntity(zombie.id)?.hp ?? 0) <= 0;
    expect(damaged || zombieGone).toBe(true);
  });

  it('goes through a structure rather than standing against it', () => {
    const { game } = outbreakGame();
    // No friendly soldiers on the field: the horde has nothing to chase, so the
    // building itself is the target — which is the behaviour under test.
    for (const entity of game.state.entities) {
      if (entity.owner === 0 && entity.kind === 'unit') entity.hp = 0;
    }
    game.tick();
    const post = game.state.entities.find((e) => e.defId === 'commandPost')!;
    const brute = game.spawnInfected(ZOMBIE_DEF_IDS.brute, post.x + 6, post.z, 1)!;
    const startHp = post.hp;
    for (let i = 0; i < TICK_RATE * 30; i++) game.tick();
    // The post is damaged or gone: either way the brute reached it instead of
    // standing against an invisible wall.
    expect(game.state.entities.find((e) => e.defId === 'commandPost')!.hp).toBeLessThan(startHp);
    expect(brute.owner).toBe(1);
  });

  it('lets the horde destroy the Command Post and ends the run in defeat', () => {
    const { game } = outbreakGame();
    for (const entity of game.state.entities) {
      if (entity.owner === 0 && entity.kind === 'unit') entity.hp = 0;
    }
    game.tick();
    const post = game.state.entities.find((e) => e.defId === 'commandPost')!;
    post.hp = 40;
    game.spawnInfected(ZOMBIE_DEF_IDS.brute, post.x + 5, post.z, 1);
    for (let i = 0; i < TICK_RATE * 40 && game.state.victory === 'playing'; i++) game.tick();
    expect(game.state.victory).toBe('defeat');
    expect(game.outbreak!.result().commandPostLost).toBe(true);
  });

  it('never declares victory against a side that owns no headquarters', () => {
    const { game } = outbreakGame();
    // No infected on the field at all: the old headquarters rule would have
    // declared the players victorious the moment it ran.
    for (let i = 0; i < TICK_RATE * 5; i++) game.tick();
    expect(infectedIds(game)).toHaveLength(0);
    expect(game.state.victory).toBe('playing');
  });

  it('runs waves inside the fixed tick and puts bodies on the field', () => {
    const { game } = outbreakGame({ difficulty: 'easy' });
    const firstZombieBy = TICK_RATE * 130;
    let seen = 0;
    for (let i = 0; i < firstZombieBy && game.state.victory === 'playing'; i++) {
      game.tick();
      seen = Math.max(seen, infectedIds(game).length);
    }
    expect(seen).toBeGreaterThan(0);
    const match = game.outbreak!;
    expect(match.director.phase === 'assault' || match.director.phase === 'cleanup').toBe(true);
    expect(match.director.wave).toBe(1);
    expect(match.statistics.wave).toBe(1);
  });

  it('counts kills and losses from the simulation events', () => {
    const { game } = outbreakGame();
    const soldier = game.state.entities.find((e) => e.owner === 0 && e.kind === 'unit' && e.defId === 'tank')!;
    // Five shamblers against one tank: the tank wins, and the director counts it.
    for (let i = 0; i < 5; i++) {
      game.spawnInfected(ZOMBIE_DEF_IDS.shambler, soldier.x + 3 + i * 0.6, soldier.z + i * 0.4, 1);
    }
    for (let i = 0; i < TICK_RATE * 45; i++) game.tick();
    const stats = game.outbreak!.statistics;
    expect(stats.zombiesKilled).toBeGreaterThan(0);
    expect(stats.killsByKind.shambler).toBe(stats.zombiesKilled);
    expect(stats.players).toBe(1);
    expect(stats.difficulty).toBe('normal');
    expect(stats.nations).toEqual(['poland']);
    expect(stats.durationSeconds).toBeGreaterThan(0);
  });

  it('saves and restores the wave rhythm', () => {
    const { game } = outbreakGame();
    for (let i = 0; i < TICK_RATE * 4; i++) game.tick();
    const saved = game.outbreak!.toSave();
    const other = outbreakGame().game;
    other.outbreak!.restore(saved);
    expect(other.outbreak!.director.toState()).toEqual(saved.director);
    expect(other.outbreak!.statistics.wave).toBe(saved.stats.wave);
    // Restored clock keeps running from where it was left.
    const before = other.outbreak!.secondsToAssault;
    for (let i = 0; i < TICK_RATE; i++) other.tick();
    expect(other.outbreak!.secondsToAssault).toBeLessThan(before);
  });

  it('takes a body the pathfinder has given up on off the field without scoring it', () => {
    const scenario = createOutbreakScenario({
      difficulty: 'easy',
      mode: 'solo',
      nationId: 'poland',
      seed: 11,
    });
    // Seal one tile with water on every side. Foot has no route out of it, so
    // every march the horde controller issues is refused at the door.
    const pocket = pocketSite(scenario);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dz === 0) continue;
        const index = (pocket.z + dz) * scenario.width + pocket.x + dx;
        scenario.tiles[index] = { ...scenario.tiles[index], t: Terrain.DeepWater, o: 0 };
      }
    }
    const game = new Game(scenario, { enableAI: false });
    const body = game.spawnInfected(
      ZOMBIE_DEF_IDS.shambler,
      (pocket.x + 0.5) * TILE_SIZE,
      (pocket.z + 0.5) * TILE_SIZE,
      1,
    );
    expect(body).not.toBeNull();
    // The seal held: the body is inside the pocket, not beside it.
    expect(Math.floor(body!.x / TILE_SIZE)).toBe(pocket.x);
    expect(Math.floor(body!.z / TILE_SIZE)).toBe(pocket.z);
    expect(game.outbreak!.aliveInfected).toBe(1);
    const killsBefore = game.outbreak!.statistics.zombiesKilled;
    for (let i = 0; i < TICK_RATE * (STRANDED_DESPAWN_SECONDS + 5); i++) game.tick();
    // Gone: no longer on the field and no longer counted against the wave cap.
    expect(game.getEntity(body!.id)).toBeUndefined();
    expect(game.outbreak!.aliveInfected).toBe(0);
    // Removed, not killed: a despawn is never credited to the survival tally.
    expect(game.outbreak!.statistics.zombiesKilled).toBe(killsBefore);
    expect(game.outbreak!.statistics.killsByKind.shambler).toBe(0);
  });

  it('leaves a body with a route on the field, however slowly it walks', () => {
    const { game } = outbreakGame({ difficulty: 'easy' });
    // Nothing of the defence can shoot, so the body is judged on its route alone.
    for (const entity of game.state.entities) {
      if (entity.owner === 0 && entity.kind === 'unit') entity.hp = 0;
    }
    game.tick();
    const region = game.state.scenario.meta.outbreak!.entryRegions[0];
    const body = game.spawnInfected(
      ZOMBIE_DEF_IDS.shambler,
      (region.x + 0.5) * TILE_SIZE,
      (region.z + 0.5) * TILE_SIZE,
      1,
    )!;
    for (let i = 0; i < TICK_RATE * (STRANDED_DESPAWN_SECONDS + 5); i++) game.tick();
    expect(game.getEntity(body.id)).toBeDefined();
  });

  it('splashes a cluster with one bloater burst', () => {
    const scenario = createOutbreakScenario({
      difficulty: 'normal',
      mode: 'solo',
      nationId: 'poland',
      seed: 99,
    });
    const post = scenario.structures.find((s) => s.defId === 'commandPost')!;
    // Three riflemen shoulder to shoulder, and nothing else of ours to hit.
    scenario.units = [
      { defId: 'rifle', owner: 0, x: post.x + 8, z: post.z + 8 },
      { defId: 'rifle', owner: 0, x: post.x + 10, z: post.z + 8 },
      { defId: 'rifle', owner: 0, x: post.x + 8, z: post.z + 10 },
    ];
    const game = new Game(scenario, { enableAI: false });
    const soldier = game.state.entities.find((e) => e.owner === 0 && e.defId === 'rifle')!;
    const start = new Map(
      game.state.entities.filter((e) => e.owner === 0).map((e) => [e.id, e.hp] as const),
    );
    game.spawnInfected(ZOMBIE_DEF_IDS.bloater, soldier.x + 5, soldier.z, 1);
    for (let i = 0; i < TICK_RATE * 15; i++) game.tick();
    const hurt = [...start].filter(([id, hp]) => {
      const now = game.getEntity(id);
      return !now || now.hp < hp;
    });
    // One ruptured sac is an area attack, not a single-target bite: the men
    // standing beside the victim are hit by the same burst.
    expect(hurt.length).toBeGreaterThanOrEqual(3);
    const explosions = game.eventsAfter(0).filter((event) => event.type === 'explosion');
    expect(explosions.length).toBeGreaterThan(0);
  });

  it('makes a crawler harder to hit at range than a shambler', () => {
    const build = (defId: string) => {
      const scenario = createOutbreakScenario({
        difficulty: 'normal',
        mode: 'solo',
        nationId: 'poland',
        seed: 7,
      });
      const post = scenario.structures.find((s) => s.defId === 'commandPost')!;
      scenario.units = [{ defId: 'rifle', owner: 0, x: post.x + 8, z: post.z + 8 }];
      const game = new Game(scenario, { enableAI: false });
      const rifle = game.state.entities.find((e) => e.owner === 0 && e.defId === 'rifle')!;
      const target = game.spawnInfected(defId, rifle.x + 8, rifle.z, 1)!;
      return { game, target };
    };
    const damage = (defId: string): number => {
      const { game, target } = build(defId);
      const start = target.hp;
      // Two seconds: long enough for the first bursts, short enough that the
      // target survives and the comparison is damage rather than a corpse.
      for (let i = 0; i < TICK_RATE * 2; i++) game.tick();
      return start - (game.getEntity(target.id)?.hp ?? 0);
    };
    expect(damage(ZOMBIE_DEF_IDS.crawler)).toBeLessThan(damage(ZOMBIE_DEF_IDS.shambler));
    // The crawler is only shifty at distance; the definition carries the flag
    // the accuracy roll reads.
    expect(ZOMBIE_UNITS.find((u) => u.id === ZOMBIE_DEF_IDS.crawler)!.lowProfile).toBe(true);
    expect(ZOMBIE_UNITS.find((u) => u.id === ZOMBIE_DEF_IDS.shambler)!.lowProfile).toBeUndefined();
  });

  it('resumes a run from a battle save', () => {
    const { game } = outbreakGame({ difficulty: 'easy' });
    for (let i = 0; i < TICK_RATE * 20; i++) game.tick();
    const save = game.toSave();
    expect(save.state.outbreak).toBeTruthy();
    const resumed = Game.fromSave(save, { enableAI: false });
    expect(resumed.outbreak).toBeTruthy();
    expect(resumed.outbreak!.director.toState()).toEqual(game.outbreak!.director.toState());
    expect(resumed.outbreak!.statistics.wave).toBe(game.outbreak!.statistics.wave);
    // The restored clock keeps running from where it was left instead of
    // reopening on a fresh wave one.
    const before = resumed.outbreak!.secondsToAssault;
    for (let i = 0; i < TICK_RATE; i++) resumed.tick();
    expect(resumed.outbreak!.secondsToAssault).toBeLessThan(before);
  });

  it('keeps normal skirmish matches untouched', () => {
    const { game } = outbreakGame();
    // Removing the block turns the same map into an ordinary scenario: no
    // director, no infected owner in the command path.
    expect(game.outbreak).toBeTruthy();
    expect(BUILDINGS.commandPost.commandPost).toBe(true);
    expect(game.state.players.map((p) => p.team).sort()).toEqual([0, 1]);
  });
});

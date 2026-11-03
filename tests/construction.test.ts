import { describe, expect, it } from 'vitest';
import { Game } from '../src/sim/game';
import { createIslandAssault } from '../src/data/scenarios';
import { checkPlacement } from '../src/sim/scenario';
import { tileIndex } from '../src/sim/terrain';
import type { Entity } from '../src/sim/types';

function newGame(extraEngineer = false): Game {
  const scenario = createIslandAssault();
  if (extraEngineer) scenario.units.push({ defId: 'engineer', owner: 0, x: 23, z: 37 });
  return new Game(scenario, { enableAI: false });
}

function engineers(game: Game): Entity[] {
  return game.entitiesOf(0, 'unit').filter((e) => e.defId === 'engineer');
}

function barracksSite(game: Game): { x: number; z: number } {
  for (let z = 28; z <= 40; z++) {
    for (let x = 12; x <= 24; x++) {
      if (game.placementStatus(0, 'mgNest', x, z).ok) return { x, z };
    }
  }
  throw new Error('no barracks site');
}

/** Find a valid, non-overlapping site for each requested structure. */
function sites(game: Game, defIds: string[]): Array<{ defId: string; x: number; z: number }> {
  const chosen: Array<{ defId: string; x: number; z: number }> = [];
  for (const defId of defIds) {
    let found: { x: number; z: number } | null = null;
    for (let z = 24; z <= 44 && !found; z++) {
      for (let x = 10; x <= 28 && !found; x++) {
        if (!game.placementStatus(0, defId, x, z).ok) continue;
        if (chosen.some((s) => Math.abs(s.x - x) < 4 && Math.abs(s.z - z) < 4)) continue;
        found = { x, z };
      }
    }
    if (!found) throw new Error(`no site for ${defId}`);
    chosen.push({ defId, ...found });
  }
  return chosen;
}

function place(game: Game, defId: string, x: number, z: number): void {
  game.enqueueCommand({ type: 'placeBuilding', team: 0, defId, tileX: x, tileZ: z });
}

describe('automatic construction', () => {
  it('sends an idle engineer to a site placed without a selection', () => {
    const game = newGame();
    const site = barracksSite(game);
    place(game, 'barracks', site.x, site.z);
    game.tick();

    const building = game.entitiesOf(0, 'building').find((e) => e.defId === 'barracks')!;
    expect(building.construction).toBe(true);
    expect(engineers(game)[0].buildTargetId).toBe(building.id);
  });

  it('builds two sites in parallel with two engineers and leaves a third waiting', () => {
    const game = newGame(true);
    expect(engineers(game)).toHaveLength(2);
    const [first, second, third] = sites(game, ['barracks', 'refinery', 'powerPlant']);
    place(game, first.defId, first.x, first.z);
    place(game, second.defId, second.x, second.z);
    place(game, third.defId, third.x, third.z);
    game.tick();

    const site = (defId: string) =>
      game.entitiesOf(0, 'building').find((e) => e.defId === defId)!;
    const one = site(first.defId);
    const two = site(second.defId);
    const waiting = site(third.defId);
    const builderOf = (e: Entity) => engineers(game).find((eng) => eng.buildTargetId === e.id);

    expect(builderOf(one)).toBeDefined();
    expect(builderOf(two)).toBeDefined();
    expect(builderOf(one)!.id).not.toBe(builderOf(two)!.id);
    // A committed engineer is never pulled off its site to start a third.
    expect(builderOf(waiting)).toBeUndefined();

    // Long enough for both engineers to walk to sites found across the base.
    game.advance(20 * 12);
    expect(one.buildProgress).toBeGreaterThan(0);
    expect(two.buildProgress).toBeGreaterThan(0);
    expect(waiting.buildProgress).toBe(0);
    expect(builderOf(waiting)).toBeUndefined();
  });

  it('delivers a harvester with a completed refinery and offloads it on command', () => {
    const game = newGame();
    const site = sites(game, ['refinery'])[0];
    place(game, 'refinery', site.x, site.z);
    for (let i = 0; i < 20 * 45; i++) {
      const refinery = game.entitiesOf(0, 'building').find((e) => e.defId === 'refinery');
      if (refinery && !refinery.construction) break;
      game.tick();
    }
    const refinery = game.entitiesOf(0, 'building').find((e) => e.defId === 'refinery')!;
    expect(refinery.construction).toBe(false);
    const harvester = game.entitiesOf(0, 'unit').find((e) => e.defId === 'harvester');
    expect(harvester).toBeDefined();
    expect(harvester!.harvester?.ore).toBe(0);

    harvester!.harvester!.ore = 60;
    harvester!.x = refinery.x + 60;
    harvester!.z = refinery.z;
    const gathered = game.player(0)!.stats.matsGathered;
    game.enqueueCommand({
      type: 'move',
      team: 0,
      ids: [harvester!.id],
      x: refinery.x,
      z: refinery.z,
    });
    game.advance(20 * 12);
    expect(game.player(0)!.stats.matsGathered - gathered).toBeCloseTo(60, 5);
  });

  it('frees a foundation once the deposit on it has been worked out', () => {
    const game = newGame();
    const map = game.state.map;
    let site: { x: number; z: number } | null = null;
    let reason = '';
    for (let z = 0; z < map.height && !site; z++) {
      for (let x = 0; x < map.width && !site; x++) {
        const i = tileIndex(map.width, x, z);
        if (map.ore[i] <= 0) continue;
        const before = game.placementStatus(0, 'mgNest', x, z);
        if (before.code !== 'ore') continue;
        reason = before.reason;
        // Harvesters drain the runtime field, the authored tiles never change.
        // A barracks covers a 2x2, so clear its whole footprint.
        if (x + 1 >= map.width || z + 1 >= map.height) continue;
        map.ore[i] = 0;
        map.ore[i + 1] = 0;
        map.ore[i + map.width] = 0;
        map.ore[i + map.width + 1] = 0;
        if (game.placementStatus(0, 'mgNest', x, z).ok) site = { x, z };
      }
    }
    expect(reason).toBe('Clear the material deposit before building here.');
    expect(site).not.toBeNull();
  });

  it('reads the live ore field rather than the authored tiles for a deposit', () => {
    const scenario = createIslandAssault();
    let deposit: { x: number; z: number } | null = null;
    for (let z = 0; z < scenario.height && !deposit; z++) {
      for (let x = 0; x < scenario.width && !deposit; x++) {
        if (checkPlacement(scenario, 'barracks', x, z).code === 'ore') deposit = { x, z };
      }
    }
    expect(deposit).not.toBeNull();
    const drained = new Uint16Array(scenario.width * scenario.height);
    expect(
      checkPlacement(scenario, 'barracks', deposit!.x, deposit!.z, undefined, drained).code,
    ).not.toBe('ore');
  });

  it('resumes a paused site when the engineer is sent back to it', () => {
    const game = newGame();
    const site = barracksSite(game);
    place(game, 'barracks', site.x, site.z);
    game.tick();
    const building = game.entitiesOf(0, 'building').find((e) => e.defId === 'barracks')!;
    const engineer = engineers(game)[0];
    game.advance(20 * 3);
    const paused = building.buildProgress;
    expect(paused).toBeGreaterThan(0);

    // Called away, then shot off the site: nothing advances while it is gone.
    game.enqueueCommand({ type: 'move', team: 0, ids: [engineer.id], x: 30, z: 30 });
    game.tick();
    building.lastHitTick = game.state.tick;
    game.advance(20 * 3);
    expect(building.buildProgress).toBeCloseTo(paused, 5);
    expect(engineer.buildTargetId).toBe(0);

    // The site is not damaged, so this is not a repair — but the same order has
    // to put an engineer back on it, or the site is stuck for good.
    game.enqueueCommand({ type: 'repair', team: 0, ids: [engineer.id], targetId: building.id });
    game.tick();
    expect(engineer.buildTargetId).toBe(building.id);
    game.advance(20 * 8);
    expect(building.buildProgress).toBeGreaterThan(paused + 0.05);
  });

  it('refuses an enemy construction site as a work target', () => {
    const scenario = createIslandAssault();
    scenario.units.push({ defId: 'engineer', owner: 1, x: 60, z: 60 });
    const game = new Game(scenario, { enableAI: false });
    const enemyEngineer = game.entitiesOf(1, 'unit').find((e) => e.defId === 'engineer')!;
    const site = barracksSite(game);
    place(game, 'barracks', site.x, site.z);
    game.tick();
    const building = game.entitiesOf(0, 'building').find((e) => e.defId === 'barracks')!;
    game.enqueueCommand({ type: 'repair', team: 1, ids: [enemyEngineer.id], targetId: building.id });
    game.tick();
    expect(enemyEngineer.buildTargetId).toBe(0);
    expect(game.state.events.some((e) => e.type === 'orderFailed')).toBe(true);
  });

  it('does not place foundations without any engineer', () => {
    const scenario = createIslandAssault();
    scenario.units = scenario.units.filter((u) => u.defId !== 'engineer');
    const game = new Game(scenario, { enableAI: false });
    const site = barracksSite(game);
    place(game, 'barracks', site.x, site.z);
    game.tick();
    expect(game.entitiesOf(0, 'building').some((e) => e.defId === 'barracks')).toBe(false);
    expect(game.state.events.some((e) => e.type === 'orderFailed')).toBe(true);
  });
});

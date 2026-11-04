import { describe, expect, it } from 'vitest';
import { Game } from '../src/sim/game';
import { createIslandAssault } from '../src/data/scenarios';
import { BUILDINGS, isIndestructibleStructure } from '../src/data/buildings';
import { UNITS } from '../src/data/units';
import { CommandGate } from '../src/multiplayer/commandGate';
import { serverGame, twoSeats } from './phase1-helpers';
import type { Entity } from '../src/sim/types';

/** Island Assault plus one finished barracks the player can sell. */
function saleGame(): { game: Game; building: Entity } {
  const scenario = createIslandAssault();
  scenario.structures.push({ defId: 'barracks', owner: 0, x: 30, z: 40 });
  const game = new Game(scenario, { enableAI: false });
  const building = game
    .entitiesOf(0, 'building')
    .find((e) => e.defId === 'barracks')!;
  building.construction = false;
  building.buildProgress = 1;
  return { game, building };
}

function sell(game: Game, building: Entity): void {
  game.enqueueCommand({ type: 'sellBuilding', team: 0, buildingId: building.id });
}

describe('selling a structure', () => {
  it('quotes 75% of the price and half the build time, never under three seconds', () => {
    const { game, building } = saleGame();
    const def = BUILDINGS[building.defId];
    const quote = game.sellQuote(building.id)!;
    expect(quote.mats).toBe(Math.floor(def.cost.mats * 0.75));
    expect(quote.req).toBe(Math.floor(def.cost.req * 0.75));
    expect(quote.seconds).toBe(Math.max(3, def.buildTime * 0.5));
    // The fastest emplacement still takes longer than an instant.
    expect(Game.sellSeconds('mgNest')).toBe(4.5);
  });

  it('dismantles first and only pays the refund when the structure comes down', () => {
    const { game, building } = saleGame();
    const player = game.player(0)!;
    const quote = game.sellQuote(building.id)!;
    const before = player.mats;
    sell(game, building);
    game.tick();

    expect(building.deconstruct?.total).toBe(quote.seconds);
    expect(building.state).toBe('selling');
    expect(player.mats - before).toBeLessThan(quote.mats);

    const startMats = player.mats;
    const startReq = player.req;
    building.deconstruct!.remaining = 0.01;
    game.tick();

    expect(game.getEntity(building.id)).toBeUndefined();
    expect(player.mats - startMats).toBeGreaterThan(quote.mats - 1);
    expect(player.mats - startMats).toBeLessThan(quote.mats + 1);
    expect(player.req - startReq).toBeGreaterThan(quote.req - 1);
    expect(player.req - startReq).toBeLessThan(quote.req + 1);
  });

  it('refunds queued production as soon as the sale starts and clears the queue', () => {
    const { game, building } = saleGame();
    const player = game.player(0)!;
    const rifle = UNITS.rifle.cost;
    player.mats -= rifle.mats;
    player.req -= rifle.req;
    building.queue = [{ defId: 'rifle', remaining: 4, total: 8 }];
    const before = player.mats;

    sell(game, building);
    game.tick();

    expect(building.queue).toHaveLength(0);
    expect(player.mats - before).toBeGreaterThan(rifle.mats - 1);
    expect(player.mats - before).toBeLessThan(rifle.mats + 1);
  });

  it('refuses a garrisoned, unfinished or objective structure', () => {
    const { game, building } = saleGame();
    const soldier = game.entitiesOf(0, 'unit')[0];
    soldier.garrisonId = building.id;
    expect(game.sellStatus(0, building.id).reason).toContain('garrison');
    soldier.garrisonId = 0;

    building.construction = true;
    expect(game.sellStatus(0, building.id).reason).toContain('construction');
    building.construction = false;

    const objective = game.state.entities.find(
      (e) => e.kind === 'building' && isIndestructibleStructure(e.defId),
    )!;
    objective.owner = 0;
    expect(game.sellStatus(0, objective.id).reason).toContain('Objective');

    // Only the owner may sell: the same structure is not yours for seat 1.
    expect(game.sellStatus(1, building.id).ok).toBe(false);
  });

  it('accepts the owner through the command gate and rejects a foreign structure', () => {
    const game = serverGame();
    const gate = new CommandGate(game, twoSeats());
    const own = game
      .entitiesOf(0, 'building')
      .find((e) => e.defId === 'commandPost')!;
    const enemy = game
      .entitiesOf(1, 'building')
      .find((e) => e.defId === 'commandPost')!;

    const accepted = gate.submit(
      0,
      { v: 1, command: { type: 'sellBuilding', buildingId: own.id } },
      1000,
    );
    expect(accepted).toMatchObject({ ok: true, queued: true });
    expect(game.pending.at(-1)).toMatchObject({
      type: 'sellBuilding',
      team: 0,
      buildingId: own.id,
    });

    expect(
      gate.submit(0, { v: 1, command: { type: 'sellBuilding', buildingId: enemy.id } }, 1200),
    ).toMatchObject({ ok: false, code: 'not-your-entity' });
  });
});

import { describe, expect, it } from 'vitest';
import { Game } from '../src/sim/game';
import { createIslandAssault } from '../src/data/scenarios';
import { FACTIONS } from '../src/data/factions';
import { relayMeterState, RELAY_NEUTRAL_COLOR } from '../src/ui/relayMeter';

function newGame(): Game {
  return new Game(createIslandAssault(), { enableAI: false });
}

function relay(game: Game) {
  return game.state.entities.find((e) => e.defId === 'relay')!;
}

function tank(game: Game) {
  return game.state.entities.find((e) => e.kind === 'unit' && e.defId === 'tank' && e.owner === 0)!;
}

describe('signals relays are capture-only objectives', () => {
  it('rejects an explicit attack order and leaves the relay intact', () => {
    const game = newGame();
    const target = relay(game);
    const attacker = tank(game);
    game.enqueueCommand({ type: 'attack', team: 0, ids: [attacker.id], targetId: target.id });
    game.tick();
    expect(target.hp).toBe(target.maxHp);
    expect(attacker.targetId).not.toBe(target.id);
    expect(
      game.state.events.some(
        (e) => e.type === 'orderFailed' && /cannot be destroyed/.test(e.text),
      ),
    ).toBe(true);
  });

  it('does not auto-engage a relay owned by the enemy', () => {
    const game = newGame();
    const target = relay(game);
    target.owner = 1;
    const attacker = tank(game);
    attacker.x = target.x - 3 * 4;
    attacker.z = target.z;
    attacker.order = null;
    game.advance(20 * 8);
    expect(target.hp).toBe(target.maxHp);
    expect(attacker.targetId).not.toBe(target.id);
  });

  it('still changes hands through an engineer capture', () => {
    const game = newGame();
    const target = relay(game);
    const engineer = game.entitiesOf(0, 'unit').find((e) => e.defId === 'engineer')!;
    engineer.x = target.x - 12;
    engineer.z = target.z;
    game.enqueueCommand({ type: 'capture', team: 0, ids: [engineer.id], targetId: target.id });
    game.advance(20 * 8);
    expect(target.owner).toBe(0);
  });
});

describe('relay ownership and capture meter', () => {
  it('reports an unclaimed neutral relay', () => {
    const game = newGame();
    const meter = relayMeterState(game, relay(game));
    expect(meter.owner).toBe(-1);
    expect(meter.ownerLabel).toBe('NEUTRAL');
    expect(meter.ownerColor).toBe(RELAY_NEUTRAL_COLOR);
    expect(meter.progress).toBe(0);
    expect(meter.caption).toBe('NEUTRAL · UNCLAIMED');
  });

  it('follows the engineer making capture progress', () => {
    const game = newGame();
    const target = relay(game);
    const engineer = game.entitiesOf(0, 'unit').find((e) => e.defId === 'engineer')!;
    engineer.captureTargetId = target.id;
    engineer.captureProgress = 0.42;
    const meter = relayMeterState(game, target);
    expect(meter.progress).toBeCloseTo(0.42, 6);
    expect(meter.capturer).toBe(0);
    expect(meter.capturerColor).toBe(FACTIONS.baltic.color);
    expect(meter.caption).toBe('NEUTRAL · 42% CAPTURED');
  });

  it('shows the owning faction once captured', () => {
    const game = newGame();
    const target = relay(game);
    target.owner = 0;
    const engineer = game.entitiesOf(0, 'unit').find((e) => e.defId === 'engineer')!;
    engineer.captureTargetId = 0;
    engineer.captureProgress = 0;
    const meter = relayMeterState(game, target);
    expect(meter.ownerLabel).toBe(FACTIONS.baltic.shortName);
    expect(meter.ownerColor).toBe(FACTIONS.baltic.color);
    expect(meter.caption).toBe('BALTIC');
  });
});

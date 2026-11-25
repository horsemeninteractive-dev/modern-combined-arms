import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { Game } from '../src/sim/game';
import { createIslandAssault } from '../src/data/scenarios';
import { BUILDINGS, canSeizeStructure } from '../src/data/buildings';
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

  it('puts the control meter on every capture-only objective, not just the sturdy ones', () => {
    // A radar station changes hands by capture exactly like a relay. Gating the
    // world meter on indestructibility left the one destructible objective with
    // no owner label and no capture bar at all.
    const objectives = Object.values(BUILDINGS)
      .filter((b) => b.capturable && b.authoredOnly)
      .map((b) => b.id)
      .sort();
    expect(objectives).toEqual(['radarStation', 'relay', 'supplyDepot'].sort());
    // Emplacements left unmanned on a map are walk-ins too. They stay ordinary
    // concrete — shellable, with an integrity bar and a crew to clear.
    const emplacements = Object.values(BUILDINGS)
      .filter((b) => b.capturable && !b.authoredOnly)
      .map((b) => b.id)
      .sort();
    expect(emplacements).toEqual(
      ['atTurret', 'bunker', 'coastalBattery', 'longRangeSam', 'mgNest', 'samBattery'].sort(),
    );
    const overlaySource = readFileSync(new URL('../src/ui/overlay.ts', import.meta.url), 'utf8');
    // The meter belongs to sites that can still change hands, so a gun pit the
    // player raised off the same blueprint carries none.
    expect(overlaySource).toContain(
      'isSeizableSite(relay.defId, relay.owner, relay.neutralStart === true)',
    );
    // Remembered ground keeps the holder's name but never live capture progress.
    expect(overlaySource).toContain('const caption = remembered ? meter.ownerLabel : meter.caption;');
    expect(overlaySource).toContain('const progress = remembered ? 0 : meter.progress;');
  });

  it('lets an engineer take an unheld emplacement but not a manned one', () => {
    // A bunker the map left unmanned is a position waiting for a crew, whatever
    // map it stands on — including Outbreak's neutral strongpoints.
    expect(canSeizeStructure('bunker', -1, 0, true)).toBe(true);
    expect(canSeizeStructure('mgNest', -1, 1, true)).toBe(true);
    // An enemy's gun pit has its crew inside it: it has to be reduced first.
    expect(canSeizeStructure('bunker', 1, 0, true)).toBe(false);
    // A gun pit a player built is his own for good: the blueprint is capturable
    // on an authored map, the structure is not.
    expect(canSeizeStructure('mgNest', -1, 1, false)).toBe(false);
    expect(canSeizeStructure('bunker', 1, 0, false)).toBe(false);
    // Objectives are contested for the whole match, by either side.
    expect(canSeizeStructure('relay', 1, 0, false)).toBe(true);
    expect(canSeizeStructure('relay', 0, 0, false)).toBe(false);
    // An ordinary structure is not a capture target at all.
    expect(canSeizeStructure('barracks', -1, 0, true)).toBe(false);
  });

  it('takes a capture order on a relay that has slipped back into memory', () => {
    // The point of charting: a relay nobody is watching is still a legal order,
    // so an engineer can be sent to take an objective scouted a minute ago.
    const game = newGame();
    const target = relay(game);
    const scout = tank(game);
    const home = { x: scout.x, z: scout.z };
    scout.x = target.x + 8;
    scout.z = target.z;
    game.advance(20);
    expect(game.visionStateOf(0, target.id)).toBe('visible');
    scout.x = home.x;
    scout.z = home.z;
    game.advance(20);
    expect(game.isVisibleTo(0, target.id)).toBe(false);
    expect(game.visionStateOf(0, target.id)).toBe('remembered');
    expect(game.isKnownTo(0, target.id)).toBe(true);

    const engineer = game.entitiesOf(0, 'unit').find((e) => e.defId === 'engineer')!;
    game.enqueueCommand({ type: 'capture', team: 0, ids: [engineer.id], targetId: target.id });
    game.advance(2);
    expect(game.state.events.some((e) => e.type === 'orderFailed')).toBe(false);
    expect(engineer.order?.type).toBe('capture');
    expect(engineer.captureTargetId).toBe(target.id);
  });
});

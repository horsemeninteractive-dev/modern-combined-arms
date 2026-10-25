import { describe, expect, it } from 'vitest';
import { Game } from '../src/sim/game';
import { TILE_SIZE } from '../src/sim/constants';
import { islandWith } from './helpers';
import { contextOrderFor, isRepairTarget } from '../src/ui/orderIntent';
import { unitStyle, unitVisualScale } from '../src/render/unitMeshes';
import { UNITS } from '../src/data/units';
import type { Entity } from '../src/sim/types';

function find(game: Game, defId: string, owner = 0, kind: Entity['kind'] = 'unit'): Entity {
  return game.state.entities.find(
    (e) => e.defId === defId && e.owner === owner && e.kind === kind,
  )!;
}

function all(game: Game, defId: string, owner = 0, kind: Entity['kind'] = 'unit'): Entity[] {
  return game.state.entities.filter(
    (e) => e.defId === defId && e.owner === owner && e.kind === kind,
  );
}

describe('right-click orders for support engineers', () => {
  it('routes a damaged friendly structure to repair and a relay to capture', () => {
    const game = new Game(
      islandWith({ structures: [{ defId: 'barracks', owner: 0, x: 24, z: 34 }] }),
      { enableAI: false },
    );
    const engineer = find(game, 'engineer');
    const barracks = find(game, 'barracks', 0, 'building');
    const relay = find(game, 'relay', -1, 'building');
    barracks.hp = barracks.maxHp * 0.5;

    expect(contextOrderFor(barracks, [engineer], 0, false)).toBe('repair');
    expect(contextOrderFor(relay, [engineer], 0, false)).toBe('capture');

    // An enemy-held relay is still captured, never attacked.
    relay.owner = 1;
    expect(contextOrderFor(relay, [engineer], 0, true)).toBe('capture');

    // A full structure is not a repair job, and a relay we own is not a target.
    barracks.hp = barracks.maxHp;
    expect(contextOrderFor(barracks, [engineer], 0, false)).toBe('move');
    expect(isRepairTarget(barracks, 0)).toBe(false);
    relay.owner = 0;
    expect(contextOrderFor(relay, [engineer], 0, false)).toBe('move');
  });

  it('validates the target used by the mobile repair mode', () => {
    const game = new Game(
      islandWith({ structures: [{ defId: 'barracks', owner: 0, x: 24, z: 34 }] }),
      { enableAI: false },
    );
    const barracks = find(game, 'barracks', 0, 'building');
    barracks.hp = barracks.maxHp * 0.5;
    expect(isRepairTarget(barracks, 0)).toBe(true);
    expect(isRepairTarget(barracks, 1)).toBe(false);

    barracks.construction = true;
    expect(isRepairTarget(barracks, 0)).toBe(false);
    barracks.construction = false;
    barracks.hp = barracks.maxHp;
    expect(isRepairTarget(barracks, 0)).toBe(false);
    expect(isRepairTarget(null, 0)).toBe(false);
  });
});

describe('combat engineer repair orders', () => {
  function repairFixture(): { game: Game; engineer: Entity; barracks: Entity } {
    const game = new Game(
      islandWith({ structures: [{ defId: 'barracks', owner: 0, x: 24, z: 34 }] }),
      { enableAI: false },
    );
    const engineer = find(game, 'engineer');
    const barracks = find(game, 'barracks', 0, 'building');
    engineer.x = barracks.x - 10;
    engineer.z = barracks.z;
    barracks.hp = barracks.maxHp * 0.4;
    return { game, engineer, barracks };
  }

  it('walks into range and restores integrity at a steady rate', () => {
    const { game, engineer, barracks } = repairFixture();
    const start = barracks.hp;
    game.enqueueCommand({ type: 'repair', team: 0, ids: [engineer.id], targetId: barracks.id });
    game.advance(20 * 4);

    expect(engineer.order?.type).toBe('repair');
    expect(engineer.state).toBe('repairing');
    const healed = barracks.hp - start;
    // 3.5 % of 900 HP/s for four seconds = 126 HP.
    expect(healed).toBeGreaterThan(100);
    expect(healed).toBeLessThan(150);
    expect(barracks.hp).toBeLessThan(barracks.maxHp);
  });

  it('pauses when the engineer is called away', () => {
    const { game, engineer, barracks } = repairFixture();
    game.enqueueCommand({ type: 'repair', team: 0, ids: [engineer.id], targetId: barracks.id });
    game.advance(20 * 2);
    game.enqueueCommand({
      type: 'move',
      team: 0,
      ids: [engineer.id],
      x: engineer.x - 8 * TILE_SIZE,
      z: engineer.z,
    });
    game.advance(20);
    const pausedAt = barracks.hp;
    game.advance(20 * 3);

    expect(engineer.order?.type).not.toBe('repair');
    expect(barracks.hp).toBeCloseTo(pausedAt, 5);
  });

  it('clears the order once the structure is whole again', () => {
    const { game, engineer, barracks } = repairFixture();
    barracks.hp = barracks.maxHp - 12;
    game.enqueueCommand({ type: 'repair', team: 0, ids: [engineer.id], targetId: barracks.id });
    game.advance(20 * 2);

    expect(barracks.hp).toBe(barracks.maxHp);
    expect(engineer.order).toBeNull();
    expect(engineer.state).toBe('idle');
  });

  it('round-trips an in-progress repair and medic treatment through save/load', () => {
    const game = new Game(
      islandWith({
        structures: [{ defId: 'barracks', owner: 0, x: 24, z: 34 }],
        units: [
          { defId: 'medic', owner: 0, x: 26, z: 40 },
          { defId: 'rifle', owner: 0, x: 27, z: 40 },
        ],
      }),
      { enableAI: false },
    );
    const engineer = find(game, 'engineer');
    const barracks = find(game, 'barracks', 0, 'building');
    const medic = find(game, 'medic');
    const patient = find(game, 'rifle');
    engineer.x = barracks.x - 10;
    engineer.z = barracks.z;
    barracks.hp = barracks.maxHp * 0.5;
    medic.x = 26 * TILE_SIZE;
    medic.z = 40 * TILE_SIZE;
    patient.x = 27 * TILE_SIZE;
    patient.z = 40 * TILE_SIZE;
    patient.hp = 50;
    game.enqueueCommand({ type: 'repair', team: 0, ids: [engineer.id], targetId: barracks.id });
    game.advance(20);

    const restored = Game.fromSave(JSON.parse(JSON.stringify(game.toSave())), { enableAI: false });
    expect(restored.stateHash()).toBe(game.stateHash());
    game.advance(20 * 3);
    restored.advance(20 * 3);
    expect(restored.stateHash()).toBe(game.stateHash());
  });

  it('captures a hostile relay from a right-click capture order', () => {
    const game = new Game(islandWith({}), { enableAI: false });
    const engineer = find(game, 'engineer');
    const relay = find(game, 'relay', -1, 'building');
    relay.owner = 1;
    engineer.x = relay.x - 10;
    engineer.z = relay.z;

    expect(contextOrderFor(relay, [engineer], 0, true)).toBe('capture');
    game.enqueueCommand({ type: 'capture', team: 0, ids: [engineer.id], targetId: relay.id });
    game.advance(20 * 7);

    expect(relay.owner).toBe(0);
    expect(game.state.events.some((e) => e.type === 'capture' && e.entityId === relay.id)).toBe(true);
  });
});

describe('field medic', () => {
  function medicFixture(): { game: Game; medic: Entity; riflemen: Entity[] } {
    const game = new Game(
      islandWith({
        units: [
          { defId: 'medic', owner: 0, x: 26, z: 40 },
          { defId: 'rifle', owner: 0, x: 27, z: 40 },
        ],
      }),
      { enableAI: false },
    );
    const medic = find(game, 'medic');
    const riflemen = all(game, 'rifle');
    medic.x = 26 * TILE_SIZE;
    medic.z = 40 * TILE_SIZE;
    medic.order = null;
    medic.path = [];
    for (const [i, rifle] of riflemen.entries()) {
      rifle.hp = rifle.maxHp;
      rifle.x = (27 + i * 0.4) * TILE_SIZE;
      rifle.z = 40 * TILE_SIZE;
    }
    return { game, medic, riflemen };
  }

  it('is a buildable barracks infantry unit with its own visual rig', () => {
    const game = new Game(
      islandWith({ structures: [{ defId: 'barracks', owner: 0, x: 24, z: 34 }] }),
      { enableAI: false },
    );
    const barracks = find(game, 'barracks', 0, 'building');
    expect(UNITS.medic.producedBy).toContain('barracks');
    expect(game.productionStatus(0, barracks.id, 'medic').ok).toBe(true);
    expect(unitStyle('medic')?.infantry).toBeDefined();
    expect(unitVisualScale('medic')).toBeGreaterThan(1.2);
  });

  it('slowly heals one nearby wounded infantryman at a time', () => {
    const { game, medic, riflemen } = medicFixture();
    const first = riflemen[0];
    const second = riflemen[1];
    first.hp = 50;
    second.hp = 50;
    const before = [first.hp, second.hp];
    game.advance(20 * 5);

    expect(medic.state).toBe('healing');
    expect([first.id, second.id]).toContain(medic.healTargetId);
    const healed = [first, second].map((e, i) => e.hp - before[i]);
    // 4 HP/s for five seconds, and never both patients at once.
    expect(healed.filter((v) => v > 0).length).toBe(1);
    const gain = Math.max(...healed);
    expect(gain).toBeGreaterThan(16);
    expect(gain).toBeLessThan(24);
  });

  it('does not treat vehicles and releases a target that moves away', () => {
    const { game, medic, riflemen } = medicFixture();
    const tank = find(game, 'tank');
    tank.hp = tank.maxHp * 0.4;
    tank.x = 27 * TILE_SIZE;
    tank.z = 40 * TILE_SIZE;
    const tankHp = tank.hp;
    game.advance(20 * 3);

    expect(tank.hp).toBe(tankHp);
    expect(medic.healTargetId).toBe(0);
    expect(medic.state).toBe('idle');

    const patient = riflemen[0];
    patient.hp = 50;
    patient.x = medic.x + 2 * TILE_SIZE;
    patient.z = medic.z;
    game.advance(20);
    expect(medic.healTargetId).toBe(patient.id);

    patient.x = medic.x + 20 * TILE_SIZE;
    game.advance(1);
    expect(medic.healTargetId).toBe(0);
    expect(medic.state).toBe('idle');
  });

  it('switches patients after the first is healed to full', () => {
    const { game, medic, riflemen } = medicFixture();
    const first = riflemen[0];
    const second = riflemen[1];
    first.hp = 40;
    second.hp = 80;
    first.x = medic.x + TILE_SIZE;
    second.x = medic.x + 2 * TILE_SIZE;
    game.advance(20 * 24);

    expect(first.hp).toBe(first.maxHp);
    expect(second.hp).toBeGreaterThan(80);
    expect(medic.healTargetId).toBe(second.id);
  });
});

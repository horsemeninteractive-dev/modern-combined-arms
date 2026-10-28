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

  it('repairs a damaged shelter before garrisoning it when an engineer is selected', () => {
    const game = new Game(
      islandWith({ structures: [{ defId: 'tenement', owner: 0, x: 22, z: 36 }] }),
      { enableAI: false },
    );
    const house = find(game, 'tenement', 0, 'building');
    const engineer = find(game, 'engineer');
    const rifle = find(game, 'rifle');
    house.hp = house.maxHp * 0.5;

    expect(isRepairTarget(house, 0)).toBe(true);
    expect(contextOrderFor(house, [engineer, rifle], 0, false)).toBe('repair');
    // Without an engineer the same click still means "occupy it".
    expect(contextOrderFor(house, [rifle], 0, false)).toBe('garrison');
  });

  it('accepts an unoccupied neutral shelter for repair', () => {
    const game = new Game(islandWith({}), { enableAI: false });
    const house = find(game, 'tenement', -1, 'building');
    house.hp = house.maxHp * 0.5;
    expect(isRepairTarget(house, 0)).toBe(true);
    expect(contextOrderFor(house, [find(game, 'engineer')], 0, false)).toBe('repair');
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
    // Repair replaces 3.5 % of full integrity per second, so a structure takes
    // the same time to repair however its hit points scale. Asserting the share
    // instead of an absolute figure keeps that promise under durability changes.
    const perSecond = healed / 4 / barracks.maxHp;
    expect(perSecond).toBeGreaterThan(0.02);
    expect(perSecond).toBeLessThan(0.05);
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

  it('makes no progress while the structure is under fire, then resumes', () => {
    const { game, engineer, barracks } = repairFixture();
    const start = barracks.hp;
    game.enqueueCommand({ type: 'repair', team: 0, ids: [engineer.id], targetId: barracks.id });
    // Quiet approach and a couple of seconds of work.
    game.advance(20 * 2);
    const working = barracks.hp;
    expect(working).toBeGreaterThan(start);

    // Sustained shelling: every tick counts as a fresh hit, so the crew can
    // make no progress at all despite holding the order.
    for (let i = 0; i < 20 * 3; i++) {
      barracks.lastHitTick = game.state.tick;
      game.advance(1);
    }
    expect(engineer.order?.type).toBe('repair');
    expect(barracks.hp).toBeCloseTo(working, 5);

    // The firing stops; one second later the same order resumes by itself.
    game.advance(20 + 20 * 2);
    expect(barracks.hp).toBeGreaterThan(working);
  });

  it('keeps suppression out of the default game while the Phase 9 control can disable it', () => {
    // The experiment-only option must not leak into normal play: a game built the
    // way the shell builds one suspends repair under fire.
    const shipped = repairFixture();
    shipped.game.enqueueCommand({
      type: 'repair',
      team: 0,
      ids: [shipped.engineer.id],
      targetId: shipped.barracks.id,
    });
    for (let i = 0; i < 20 * 3; i++) {
      shipped.barracks.lastHitTick = shipped.game.state.tick;
      shipped.game.advance(1);
    }
    const suppressed = shipped.barracks.hp;

    // The same fixture with the replication control reproduces the pre-Phase-8
    // engine: repair progresses through the shelling.
    const control = new Game(
      islandWith({ structures: [{ defId: 'barracks', owner: 0, x: 24, z: 34 }] }),
      { enableAI: false, repairSuppression: false },
    );
    const controlEngineer = find(control, 'engineer');
    const controlBarracks = find(control, 'barracks', 0, 'building');
    controlEngineer.x = controlBarracks.x - 10;
    controlEngineer.z = controlBarracks.z;
    controlBarracks.hp = controlBarracks.maxHp * 0.4;
    control.enqueueCommand({
      type: 'repair',
      team: 0,
      ids: [controlEngineer.id],
      targetId: controlBarracks.id,
    });
    const controlStart = controlBarracks.hp;
    for (let i = 0; i < 20 * 3; i++) {
      controlBarracks.lastHitTick = control.state.tick;
      control.advance(1);
    }

    expect(suppressed).toBeCloseTo(shipped.barracks.maxHp * 0.4, 5);
    expect(controlBarracks.hp).toBeGreaterThan(controlStart + 20);

    // A save does not carry the switch: loading restores the shipped rule.
    const loaded = Game.fromSave(JSON.parse(JSON.stringify(control.toSave())), {
      enableAI: false,
    });
    const loadedBarracks = loaded.state.entities.find(
      (e) => e.defId === 'barracks' && e.owner === 0 && e.kind === 'building',
    )!;
    const loadedEngineer = loaded.state.entities.find(
      (e) => e.defId === 'engineer' && e.owner === 0 && e.kind === 'unit',
    )!;
    loadedBarracks.hp = loadedBarracks.maxHp * 0.4;
    loadedEngineer.x = loadedBarracks.x - 10;
    loadedEngineer.z = loadedBarracks.z;
    loaded.enqueueCommand({
      type: 'repair',
      team: 0,
      ids: [loadedEngineer.id],
      targetId: loadedBarracks.id,
    });
    const loadedStart = loadedBarracks.hp;
    for (let i = 0; i < 20 * 2; i++) {
      loadedBarracks.lastHitTick = loaded.state.tick;
      loaded.advance(1);
    }
    expect(loadedBarracks.hp).toBeCloseTo(loadedStart, 5);
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
    // The medic shares the rifleman's authored human silhouette; the old
    // 1.2 visual multiplier was an arbitrary inflation, not a physical scale.
    expect(unitVisualScale('medic')).toBe(1);
    expect(unitVisualScale('medic')).toBe(unitVisualScale('rifle'));
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

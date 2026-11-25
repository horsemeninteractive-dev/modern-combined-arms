import { describe, expect, it } from 'vitest';
import { Game, SaveFormatError } from '../src/sim/game';
import { createIslandAssault } from '../src/data/scenarios';
import { createOutbreakScenario } from '../src/outbreak/scenario';
import { TILE_SIZE } from '../src/sim/constants';

function scenario() {
  return createIslandAssault();
}

function commandSequence(game: Game, tick: number) {
  const ids = game
    .entitiesOf(0, 'unit')
    .filter((e) => e.defId === 'tank' || e.defId === 'rifle')
    .map((e) => e.id);
  if (tick === 100) {
    game.enqueueCommand({ type: 'move', team: 0, ids, x: 34 * TILE_SIZE, z: 38 * TILE_SIZE, attackMove: true });
  }
  if (tick === 400) {
    // An engineer is dispatched automatically; the site itself is authored at a
    // legal tile inside the beachhead build radius.
    game.enqueueCommand({
      type: 'placeBuilding',
      team: 0,
      defId: 'factory',
      tileX: 24,
      tileZ: 29,
    });
  }
  if (tick === 700) {
    const target = game.state.entities.find((e) => e.owner === 1 && e.kind === 'unit')!;
    game.enqueueCommand({ type: 'attack', team: 0, ids, targetId: target.id });
  }
}

describe('deterministic simulation', () => {
  it('produces identical state for identical seeds and commands', () => {
    const a = new Game(scenario(), { enableAI: false });
    const b = new Game(scenario(), { enableAI: false });
    for (let tick = 0; tick < 900; tick++) {
      commandSequence(a, tick);
      commandSequence(b, tick);
      a.tick();
      b.tick();
    }
    expect(a.stateHash()).toBe(b.stateHash());
    expect(a.state.tick).toBe(900);
    expect(a.player(0)!.mats).toBeCloseTo(b.player(0)!.mats, 6);
  });

  it('is unaffected by advancing in different batch sizes', () => {
    const a = new Game(scenario(), { enableAI: false });
    const b = new Game(scenario(), { enableAI: false });
    for (let tick = 0; tick < 900; tick++) {
      commandSequence(a, tick);
      commandSequence(b, tick);
      a.tick();
      b.tick();
    }
    expect(a.stateHash()).toBe(b.stateHash());
    const c = new Game(scenario(), { enableAI: false });
    for (let tick = 0; tick < 900; tick++) {
      commandSequence(c, tick);
      c.tick();
    }
    expect(c.stateHash()).toBe(a.stateHash());
  });

  it('diverges when commands differ', () => {
    const a = new Game(scenario(), { enableAI: false });
    const b = new Game(scenario(), { enableAI: false });
    const tankA = a.state.entities.find((e) => e.owner === 0 && e.defId === 'tank')!;
    const tankB = b.state.entities.find((e) => e.owner === 0 && e.defId === 'tank')!;
    a.enqueueCommand({ type: 'move', team: 0, ids: [tankA.id], x: 34 * TILE_SIZE, z: 38 * TILE_SIZE });
    b.enqueueCommand({ type: 'move', team: 0, ids: [tankB.id], x: 28 * TILE_SIZE, z: 44 * TILE_SIZE });
    a.advance(120);
    b.advance(120);
    expect(a.stateHash()).not.toBe(b.stateHash());
  });
});

describe('save and load', () => {
  it('restores an in-progress battle exactly', () => {
    const original = new Game(scenario(), { enableAI: false });
    for (let tick = 0; tick < 600; tick++) {
      commandSequence(original, tick);
      original.tick();
    }
    const saved = JSON.parse(JSON.stringify(original.toSave()));
    const restored = Game.fromSave(saved, { enableAI: false });
    expect(restored.stateHash()).toBe(original.stateHash());
    expect(restored.state.players[0].mats).toBeCloseTo(original.player(0)!.mats, 6);
    original.advance(400);
    restored.advance(400);
    expect(restored.stateHash()).toBe(original.stateHash());
  });

  it('rejects corrupted or unsupported saves with a clear error', () => {
    expect(() => Game.fromSave({ format: 'wrong' })).toThrow(SaveFormatError);
    const game = new Game(scenario(), { enableAI: false });
    const save = JSON.parse(JSON.stringify(game.toSave()));
    save.version = 999;
    expect(() => Game.fromSave(save)).toThrow(/Save version/);
    save.version = 1;
    save.state.entities = [{ defId: 'not-a-real-unit' }];
    expect(() => Game.fromSave(save)).toThrow(/not installed|corrupted/i);
  });

  it('keeps charted structures remembered across a reload', () => {
    const game = new Game(scenario(), { enableAI: false });
    const scout = game.state.entities.find((e) => e.owner === 0 && e.defId === 'tank')!;
    const relay = game.state.entities.find((e) => e.defId === 'relay')!;
    const home = { x: scout.x, z: scout.z };
    scout.x = relay.x + 6;
    scout.z = relay.z;
    game.advance(20);
    expect(game.visionStateOf(0, relay.id)).toBe('visible');
    scout.x = home.x;
    scout.z = home.z;
    game.advance(20);
    expect(game.visionStateOf(0, relay.id)).toBe('remembered');

    const restored = Game.fromSave(JSON.parse(JSON.stringify(game.toSave())), { enableAI: false });
    expect(restored.visionStateOf(0, relay.id)).toBe('remembered');
    expect(restored.isVisibleTo(0, relay.id)).toBe(false);
  });

  it('preserves depleted ore fields and projectile state', () => {
    const game = new Game(scenario(), { enableAI: false });
    const tank = game.state.entities.find((e) => e.owner === 0 && e.defId === 'tank')!;
    const target = game.state.entities.find((e) => e.owner === 1 && e.defId === 'tank')!;
    target.x = 30 * TILE_SIZE;
    target.z = 38 * TILE_SIZE;
    tank.x = 24 * TILE_SIZE;
    tank.z = 38 * TILE_SIZE;
    game.enqueueCommand({ type: 'attack', team: 0, ids: [tank.id], targetId: target.id });
    game.advance(90);
    const oreSnapshot = Array.from(game.state.map.ore);
    const save = JSON.parse(JSON.stringify(game.toSave()));
    const restored = Game.fromSave(save, { enableAI: false });
    expect(Array.from(restored.state.map.ore)).toEqual(oreSnapshot);
    expect(restored.state.events.length).toBeGreaterThan(0);
  });
});

describe('Outbreak save and load', () => {
  it('resumes a survival run with its wave, phase, record and drops intact', () => {
    const live = new Game(
      createOutbreakScenario({
        difficulty: 'nightmare',
        mode: 'solo',
        nationId: 'poland',
        seed: 90210,
      }),
      { enableAI: false },
    );
    const match = live.outbreak!;
    // Drops are rolled by kills, so the run is played until one is on the field:
    // a save taken while crates are lying there has to bring them back too.
    for (let ticks = 0; ticks < 6000 && match.hudState().pickups!.length === 0; ticks++) {
      if (live.state.victory !== 'playing') break;
      live.tick();
    }
    const drops = match.hudState().pickups!;
    expect(drops.length).toBeGreaterThan(0);
    const before = {
      wave: match.wave,
      phase: match.phase,
      statistics: match.statistics,
      drops,
    };
    expect(before.statistics.zombiesKilled).toBeGreaterThan(0);

    const saved = JSON.parse(JSON.stringify(live.toSave()));
    // The save path has to write the run, not just declare room for it.
    expect(saved.state.outbreak).toBeTruthy();
    expect(saved.state.outbreak.director.wave).toBe(before.wave);
    expect(saved.state.outbreak.pickups).toHaveLength(drops.length);

    const restored = Game.fromSave(saved, { enableAI: false });
    const resumed = restored.outbreak!;
    expect(resumed.wave).toBe(before.wave);
    expect(resumed.phase).toBe(before.phase);
    expect(resumed.statistics).toEqual(before.statistics);
    expect(resumed.hudState().pickups).toEqual(drops);
    expect(restored.stateHash()).toBe(live.stateHash());

    // And it keeps the run's rhythm: the wave plan, the director's own random
    // stream and the drop lifetime all have to advance exactly as the run that
    // was never saved does.
    live.advance(600);
    restored.advance(600);
    expect(resumed.wave).toBe(match.wave);
    expect(resumed.phase).toBe(match.phase);
    expect(resumed.statistics.zombiesKilled).toBe(match.statistics.zombiesKilled);
    expect(resumed.statistics.matsGathered).toBe(match.statistics.matsGathered);
    expect(resumed.hudState().pickups).toEqual(match.hudState().pickups);
    expect(restored.stateHash()).toBe(live.stateHash());
  });
});

describe('victory and defeat', () => {
  it('declares victory when the enemy command post is destroyed', () => {
    const game = new Game(scenario(), { enableAI: false });
    const enemyHq = game.state.entities.find(
      (e) => e.owner === 1 && e.defId === 'commandPost',
    )!;
    enemyHq.hp = 0;
    game.tick();
    expect(game.state.victory).toBe('victory');
    expect(game.state.events.some((e) => e.type === 'victory')).toBe(true);
  });

  it('declares defeat when the player command post is destroyed', () => {
    const game = new Game(scenario(), { enableAI: false });
    const hq = game.state.entities.find((e) => e.owner === 0 && e.defId === 'commandPost')!;
    hq.hp = 0;
    game.tick();
    expect(game.state.victory).toBe('defeat');
    expect(game.state.events.some((e) => e.type === 'defeat')).toBe(true);
  });

  it('freezes simulation after the battle ends', () => {
    const game = new Game(scenario(), { enableAI: false });
    const hq = game.state.entities.find((e) => e.owner === 0 && e.defId === 'commandPost')!;
    hq.hp = 0;
    game.tick();
    const tick = game.state.tick;
    const hash = game.stateHash();
    game.advance(100);
    expect(game.state.tick).toBe(tick);
    expect(game.stateHash()).toBe(hash);
  });
});

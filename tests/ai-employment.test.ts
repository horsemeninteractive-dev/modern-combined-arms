import { describe, expect, it } from 'vitest';
import { Game } from '../src/sim/game';
import { createEmptyScenario } from '../src/data/scenarios';
import { AIController, initialAIState } from '../src/sim/ai';
import { UNITS } from '../src/data/units';
import { BUILDINGS } from '../src/data/buildings';
import { Terrain } from '../src/sim/terrain';
import { dist } from '../src/core/math';
import { TILE_SIZE } from '../src/sim/constants';
import type { Scenario } from '../src/sim/scenario';

type Spawn = { defId: string; x: number; z: number };

interface ArenaOptions {
  buildings: string[];
  units: Spawn[];
  mats: number;
  req?: number;
  fog?: boolean;
  /**
   * Technologies the scenario grants at match start. These tests measure
   * employment, not research, so a support arm that is behind a research gate
   * is granted the way an authored scenario grants it — the AI still has to pay
   * for the unit itself.
   */
  technologies?: string[];
}

/**
 * A 64x64 arena with the AI base in the east and a quiet enemy command post far
 * away in the west. Nothing on the west side moves, so every measurement is the
 * AI's own decision. Ore is deliberately absent: these tests measure employment
 * decisions, and a finite bank makes "did it hold the bank" observable.
 */
function arena(nation: string, options: ArenaOptions): Scenario {
  const scenario = createEmptyScenario(64, 64);
  scenario.meta.id = 'ai-employment-test';
  scenario.settings.seed = 7;
  scenario.settings.startingMats = options.mats;
  scenario.settings.startingReq = options.req ?? 500;
  scenario.settings.fog = options.fog ?? true;
  scenario.players[0].factionId = 'baltic';
  scenario.players[0].startX = 18;
  scenario.players[0].startZ = 37;
  scenario.players[1].factionId = nation;
  scenario.players[1].startX = 40;
  scenario.players[1].startZ = 24;
  if (options.technologies) scenario.players[1].technologies = [...options.technologies];
  scenario.structures.push(
    { defId: 'commandPost', owner: 0, x: 16, z: 33 },
    { defId: 'commandPost', owner: 1, x: 44, z: 33 },
  );
  const slots: Array<[number, number]> = [
    [38, 26],
    [38, 30],
    [42, 26],
    [42, 30],
    [34, 26],
  ];
  options.buildings.forEach((defId, i) =>
    scenario.structures.push({ defId, owner: 1, x: slots[i][0], z: slots[i][1] }),
  );
  for (const spawn of options.units) {
    scenario.units.push({ defId: spawn.defId, owner: 1, x: spawn.x, z: spawn.z });
  }
  return scenario;
}

function runAI(game: Game, seconds: number, watch?: (game: Game) => void): AIController {
  const ai = new AIController();
  const state = initialAIState(7, 'elite');
  for (let i = 0; i < 20 * seconds && game.state.victory === 'playing'; i++) {
    game.tick();
    ai.update(game, 1, state);
    watch?.(game);
  }
  return ai;
}

function queued(game: Game, owner: number, defId: string): number {
  return game
    .entitiesOf(owner, 'building')
    .reduce((n, b) => n + b.queue.filter((q) => q.defId === defId).length, 0);
}

function alive(game: Game, owner: number, defIds: string[]): number {
  return game
    .entitiesOf(owner, 'unit')
    .filter((u) => defIds.includes(u.defId)).length;
}

const CORE = ['factory', 'barracks', 'refinery'];

/**
 * A field army already at or above every baseline target, so the only unmet
 * demand left is the support arm each test is about.
 */
const FORMED_ARMY: Spawn[] = [
  { defId: 'engineer', x: 36, z: 24 },
  { defId: 'harvester', x: 36, z: 24 },
  { defId: 'harvester', x: 34, z: 26 },
  { defId: 'harvester', x: 32, z: 26 },
  { defId: 'recon', x: 36, z: 28 },
  { defId: 'recon', x: 38, z: 28 },
  { defId: 'recon', x: 40, z: 28 },
  ...Array.from({ length: 8 }, (_, i) => ({
    defId: 'tank',
    x: 34 + (i % 4) * 3,
    z: 36 + Math.floor(i / 4) * 2,
  })),
  ...Array.from({ length: 8 }, (_, i) => ({
    defId: 'rifle',
    x: 34 + (i % 4) * 3,
    z: 40 + Math.floor(i / 4) * 2,
  })),
  ...Array.from({ length: 4 }, (_, i) => ({ defId: 'atgm', x: 46 + i, z: 30 })),
];

const ARTILLERY = ['spg', 'mlrs', 'heavyHowitzer'];

describe('AI support-arm employment', () => {
  it('plans a battery once a field army exists, without seeing a strongpoint', () => {
    for (const [nation, variant] of [
      ['baltic', 'spg'],
      ['uk', 'mlrs'],
      ['russia', 'heavyHowitzer'],
    ] as const) {
      const game = new Game(
        arena(nation, {
          buildings: [...CORE, 'airfield'],
          units: FORMED_ARMY,
          mats: 3000,
          technologies: ['fires1'],
        }),
        { enableAI: false },
      );
      runAI(game, 8);
      const requested = queued(game, 1, variant) + alive(game, 1, [variant]);
      expect(requested, `${nation} should request ${variant}`).toBeGreaterThan(0);
      // The national substitution is the only acceptable heavy gun.
      for (const other of ARTILLERY) {
        if (other === variant) continue;
        expect(queued(game, 1, other)).toBe(0);
        expect(alive(game, 1, [other])).toBe(0);
      }
    }
  });

  it('does not plan a battery before the field army is formed', () => {
    const thin: Spawn[] = [
      { defId: 'engineer', x: 36, z: 24 },
      { defId: 'harvester', x: 34, z: 26 },
      { defId: 'harvester', x: 32, z: 26 },
      { defId: 'tank', x: 36, z: 31 },
      { defId: 'rifle', x: 38, z: 31 },
    ];
    const game = new Game(arena('baltic', { buildings: [...CORE, 'airfield'], units: thin, mats: 3000 }), {
      enableAI: false,
    });
    runAI(game, 12);
    expect(queued(game, 1, 'spg')).toBe(0);
    expect(alive(game, 1, ['spg'])).toBe(0);
  });

  it('holds the bank for the battery instead of buying another rifle', () => {
    // One rifle short of the army target, with enough mats for the rifle but not
    // for the howitzer: without the hold the AI would spend the bank on the
    // rifle and never reach its support arm.
    const short: Spawn[] = [
      { defId: 'engineer', x: 36, z: 24 },
      { defId: 'harvester', x: 36, z: 24 },
      { defId: 'harvester', x: 34, z: 26 },
      { defId: 'harvester', x: 32, z: 26 },
      { defId: 'recon', x: 36, z: 28 },
      { defId: 'recon', x: 38, z: 28 },
      { defId: 'recon', x: 40, z: 28 },
      ...Array.from({ length: 6 }, (_, i) => ({ defId: 'tank', x: 34 + i * 2, z: 36 })),
      { defId: 'rifle', x: 36, z: 40 },
      { defId: 'rifle', x: 38, z: 40 },
      ...Array.from({ length: 4 }, (_, i) => ({ defId: 'atgm', x: 46 + i, z: 30 })),
    ];
    const game = new Game(
      arena('baltic', {
        buildings: [...CORE, 'airfield'],
        units: short,
        mats: 450,
        technologies: ['fires1'],
      }),
      { enableAI: false },
    );
    runAI(game, 2);
    // The bank is held: the one affordable infantry demand is not taken, and
    // the battery itself is not yet affordable.
    expect(queued(game, 1, 'rifle')).toBe(0);
    expect(alive(game, 1, ['rifle'])).toBe(2);
    expect(queued(game, 1, 'spg') + alive(game, 1, ['spg'])).toBe(0);

    // Raise the bank above the price: the battery is bought immediately.
    game.player(1)!.mats = 2000;
    runAI(game, 1);
    expect(queued(game, 1, 'spg')).toBe(1);
  });

  it('does not bank for the battery while the line is short', () => {
    // No engineer, so nothing competes for the bank in construction. Six core
    // units against a large hostile force put the line several hulls short; at
    // this bank the old planner would have withheld everything for a howitzer.
    const scenario = arena('baltic', {
      buildings: CORE,
      units: [
        { defId: 'harvester', x: 36, z: 26 },
        { defId: 'harvester', x: 34, z: 26 },
        { defId: 'recon', x: 36, z: 28 },
        { defId: 'tank', x: 36, z: 36 },
        { defId: 'tank', x: 38, z: 36 },
        { defId: 'tank', x: 40, z: 36 },
        { defId: 'rifle', x: 36, z: 40 },
        { defId: 'rifle', x: 38, z: 40 },
        { defId: 'rifle', x: 40, z: 40 },
      ],
      mats: 560,
      fog: false,
    });
    // Far outside the 34-tile threat radius: the contacts raise the target
    // army without putting the base itself under attack.
    for (let i = 0; i < 10; i++) {
      scenario.units.push({
        defId: 'tank',
        owner: 0,
        x: 6 + (i % 5) * 2,
        z: 6 + Math.floor(i / 5) * 3,
      });
    }
    const game = new Game(scenario, { enableAI: false });
    runAI(game, 3);
    const queuedAny = game
      .entitiesOf(1, 'building')
      .reduce((n, b) => n + b.queue.length, 0);
    expect(queuedAny).toBeGreaterThan(0);
    expect(queued(game, 1, 'spg')).toBe(0);
  });

  it('keeps at most one battery alive or queued', () => {
    const game = new Game(
      arena('baltic', {
        buildings: [...CORE, 'airfield'],
        units: FORMED_ARMY,
        mats: 4000,
        technologies: ['fires1'],
      }),
      { enableAI: false },
    );
    let peak = 0;
    runAI(game, 90, (g) => {
      peak = Math.max(peak, queued(g, 1, 'spg') + alive(g, 1, ['spg']));
    });
    expect(peak).toBe(1);
    expect(alive(game, 1, ['spg'])).toBe(1);
    expect(game.player(1)!.stats.unitsBuilt).toBeGreaterThan(0);
  });

  it('fields and flies the national drone when an airfield exists', () => {
    const game = new Game(
      arena('belarus', {
        buildings: [...CORE, 'airfield'],
        units: FORMED_ARMY,
        mats: 2500,
      }),
      { enableAI: false },
    );
    let airborne = 0;
    let peak = 0;
    runAI(game, 45, (g) => {
      const drones = g.entitiesOf(1, 'unit').filter((u) => u.defId === 'deepReconUAV');
      if (drones.some((u) => !u.aircraft?.landed)) airborne++;
      peak = Math.max(peak, drones.length + queued(g, 1, 'deepReconUAV'));
    });
    expect(queued(game, 1, 'deepReconUAV') + alive(game, 1, ['deepReconUAV'])).toBe(1);
    expect(airborne).toBeGreaterThan(0);
    expect(alive(game, 1, ['uav'])).toBe(0);
    expect(peak).toBe(1);
  });

  it('keeps the baseline drone for the legacy preset', () => {
    const game = new Game(
      arena('baltic', { buildings: [...CORE, 'airfield'], units: FORMED_ARMY, mats: 2500 }),
      { enableAI: false },
    );
    runAI(game, 30);
    expect(queued(game, 1, 'uav') + alive(game, 1, ['uav'])).toBe(1);
    expect(alive(game, 1, ['deepReconUAV'])).toBe(0);
  });
});

describe('AI repair under fire', () => {
  it('does not park the engineer on a structure that is being shelled', () => {
    // No bank, so the only construction option is repair; the question is
    // whether the engineer is sent into an active bombardment.
    const scenario = arena('baltic', {
      buildings: CORE,
      units: [{ defId: 'engineer', x: 36, z: 24 }],
      mats: 0,
    });
    const game = new Game(scenario, { enableAI: false });
    const ai = new AIController();
    const state = initialAIState(7, 'elite');
    const refinery = game
      .entitiesOf(1, 'building')
      .find((b) => b.defId === 'refinery')!;
    refinery.hp = refinery.maxHp * 0.4;
    const engineer = (): typeof refinery | undefined =>
      game.entitiesOf(1, 'unit').find((u) => u.defId === 'engineer');

    // Three seconds of shelling: a fresh hit every tick.
    let repairedUnderFire = false;
    for (let i = 0; i < 20 * 3; i++) {
      refinery.lastHitTick = game.state.tick;
      game.tick();
      ai.update(game, 1, state);
      if (engineer()?.order?.type === 'repair' && engineer()?.order?.targetId === refinery.id) {
        repairedUnderFire = true;
      }
    }
    expect(repairedUnderFire).toBe(false);
    expect(refinery.hp).toBeCloseTo(refinery.maxHp * 0.4, 5);

    // The shelling stops: the crew is sent back and the structure recovers.
    // Eight seconds covers the walk from the yard to the refinery and a few
    // seconds of work at 3.5 %/s.
    const quietStart = refinery.hp;
    for (let i = 0; i < 20 * 8; i++) {
      game.tick();
      ai.update(game, 1, state);
    }
    expect(engineer()?.order?.type).toBe('repair');
    expect(refinery.hp).toBeGreaterThan(quietStart);
  });
});

describe('AI Pathfinder screening', () => {
  const NO_RECON = FORMED_ARMY.filter((u) => u.defId !== 'recon');

  it('keeps an unarmed scout near the army and still clears ground', () => {
    const scenario = arena('lithuania', {
      buildings: CORE,
      units: [...NO_RECON, { defId: 'pathfinder', x: 34, z: 34 }],
      mats: 300,
    });
    const game = new Game(scenario, { enableAI: false });
    // fogAt: 0 unexplored, 1 explored, 2 currently visible. Counting explored
    // ground only grows, so it measures what the scout actually revealed rather
    // than momentary line of sight.
    const explored = (): number => {
      let n = 0;
      for (let z = 0; z < game.state.map.height; z++) {
        for (let x = 0; x < game.state.map.width; x++) {
          if (game.fogAt(game.teamOf(1), x, z) !== 0) n++;
        }
      }
      return n;
    };
    const before = explored();
    let maxLead = 0;
    let scoutTicks = 0;
    runAI(game, 40, (g) => {
      const scout = g.entitiesOf(1, 'unit').find((u) => u.defId === 'pathfinder');
      if (!scout) return;
      scoutTicks++;
      const arms = g
        .entitiesOf(1, 'unit')
        .filter((u) => (UNITS[u.defId]?.weapons.length ?? 0) > 0 && UNITS[u.defId]?.domain === 'land');
      if (arms.length === 0) return;
      const nearest = Math.min(...arms.map((u) => dist(scout.x, scout.z, u.x, u.z)));
      maxLead = Math.max(maxLead, nearest / TILE_SIZE);
    });
    expect(scoutTicks).toBeGreaterThan(20 * 10);
    // Twelve tiles is the screening leash; allow a tile of pathing slack.
    expect(maxLead).toBeLessThanOrEqual(12.5);
    expect(explored()).toBeGreaterThan(before);
  });

  it('breaks contact instead of finishing a patrol into an armed enemy', () => {
    const enemy: Spawn = { defId: 'recon', x: 34, z: 34 };
    const scenario = arena('lithuania', {
      buildings: CORE,
      units: [
        { defId: 'engineer', x: 36, z: 24 },
        { defId: 'tank', x: 40, z: 30 },
        { defId: 'tank', x: 42, z: 30 },
        { defId: 'rifle', x: 40, z: 33 },
        { defId: 'rifle', x: 42, z: 33 },
        { defId: 'pathfinder', x: 32, z: 34 },
      ],
      mats: 200,
      fog: false,
    });
    scenario.units.push({ defId: enemy.defId, owner: 0, x: enemy.x, z: enemy.z });
    const game = new Game(scenario, { enableAI: false });
    const scout = (): { x: number; z: number } | undefined => {
      const u = game.entitiesOf(1, 'unit').find((e) => e.defId === 'pathfinder');
      return u ? { x: u.x, z: u.z } : undefined;
    };
    const start = scout()!;
    const ex = enemy.x * TILE_SIZE + TILE_SIZE / 2;
    const ez = enemy.z * TILE_SIZE + TILE_SIZE / 2;
    const startDistance = dist(start.x, start.z, ex, ez);
    runAI(game, 3);
    const end = scout()!;
    const endDistance = dist(end.x, end.z, ex, ez);
    expect(endDistance).toBeGreaterThan(startDistance + 2 * TILE_SIZE);
  });
});

describe('AI assault destination', () => {
  /**
   * Six tanks, no economy and one remembered enemy post. Nothing can be
   * produced, so the only question is whether the wave the commander announces
   * is a wave it can actually order.
   */
  function assaultArena(units = 6): Scenario {
    return arena('baltic', {
      buildings: [],
      units: Array.from({ length: units }, (_, i) => ({
        defId: 'tank',
        x: 30 + (i % 2) * 2,
        z: 28 + Math.floor(i / 2) * 2,
      })),
      mats: 0,
    });
  }

  it('refuses a structure tile and accepts the ground beside it', () => {
    // A remembered contact reports the structure's centre, and every corner and
    // edge of its footprint is just as blocked. The approach has to leave the
    // whole footprint, not merely clear its centre.
    for (const defId of ['commandPost', 'barracks', 'refinery']) {
      const scenario = assaultArena();
      scenario.structures.push({ defId, owner: 0, x: 16, z: 28 });
      const game = new Game(scenario, { enableAI: false });
      const post = game
        .entitiesOf(0, 'building')
        .find((b) => b.defId === defId)!;
      const ids = game.entitiesOf(1, 'unit').map((u) => u.id);
      const def = BUILDINGS[defId]!;
      const halfW = (def.footprint.w * TILE_SIZE) / 2;
      const halfH = (def.footprint.h * TILE_SIZE) / 2;

      // The aim may only plan around structures the team knows about, so give
      // it the remembered sighting a real match would have left behind
      // (Phase 12: an unseen structure cannot steer the destination).
      game.state.contacts.push({
        team: game.teamOf(1),
        entityId: post.id,
        x: post.x,
        z: post.z,
        tick: 0,
        defId,
        kind: 'building',
      });

      expect(game.canOrderMove(1, ids, post.x, post.z)).toBe(false);
      expect(game.canOrderMove(1, ids, post.x + halfW * 0.9, post.z)).toBe(false);
      expect(game.canOrderMove(1, ids, post.x - halfW * 0.9, post.z + halfH * 0.9)).toBe(false);

      const point = game.groupApproach(1, ids, post.x, post.z, 44 * TILE_SIZE, 33 * TILE_SIZE);
      expect(point).not.toBeNull();
      expect(game.canOrderMove(1, ids, point!.x, point!.z)).toBe(true);
      // Outside the walls, and still close enough to be an attack on it.
      const dx = Math.abs(point!.x - post.x);
      const dz = Math.abs(point!.z - post.z);
      expect(dx > halfW - 0.01 || dz > halfH - 0.01).toBe(true);
      expect(Math.hypot(dx, dz)).toBeLessThan(
        (Math.max(def.footprint.w, def.footprint.h) / 2 + 5) * TILE_SIZE,
      );
    }
  });

  it('finds an approach for a post against the map edge', () => {
    const scenario = assaultArena();
    const game = new Game(scenario, { enableAI: false });
    const post = game
      .entitiesOf(0, 'building')
      .find((b) => b.defId === 'commandPost')!;
    post.x = 2 * TILE_SIZE;
    post.z = 2 * TILE_SIZE;
    const ids = game.entitiesOf(1, 'unit').map((u) => u.id);
    const point = game.groupApproach(1, ids, post.x, post.z, 62 * TILE_SIZE, 62 * TILE_SIZE);
    expect(point).not.toBeNull();
    expect(game.canOrderMove(1, ids, point!.x, point!.z)).toBe(true);
  });

  it('does not count a wave it cannot order as launched', () => {
    // Flood the map so no route exists out of the tanks' pocket. The commander
    // must hold: counting the refused order would both hide the failure and
    // start the wave cooldown.
    const scenario = assaultArena();
    for (const tile of scenario.tiles) tile.t = Terrain.DeepWater;
    const game = new Game(scenario, { enableAI: false });
    const post = game
      .entitiesOf(0, 'building')
      .find((b) => b.defId === 'commandPost')!;
    game.state.contacts.push({
      team: game.teamOf(1),
      entityId: post.id,
      x: post.x,
      z: post.z,
      tick: 0,
      defId: 'commandPost',
      kind: 'building',
    });
    const ai = new AIController();
    const state = initialAIState(7, 'veteran');
    let ordered = 0;
    for (let i = 0; i < 20 * 45; i++) {
      game.tick();
      ai.update(game, 1, state);
      // A sighting stays fresh only while someone is watching the base; without
      // this the commander drops the trail and starts scouting instead.
      const contact = game.state.contacts.find((c) => c.entityId === post.id);
      if (contact) contact.tick = game.state.tick;
      for (const tank of game.entitiesOf(1, 'unit')) if (tank.order) ordered++;
    }
    expect(state.attackWave).toBe(0);
    expect(ordered).toBe(0);
    expect(state.lastDecision).toContain('no approach');
  });

  it('replays the same approach decision on an identical seed', () => {
    // The destination search reads entity order and pathfinding only; two runs
    // of the same scenario must produce the same hash and the same waves.
    const run = () => {
      const scenario = assaultArena();
      const game = new Game(scenario, { enableAI: false });
      const post = game
        .entitiesOf(0, 'building')
        .find((b) => b.defId === 'commandPost')!;
      game.state.contacts.push({
        team: game.teamOf(1),
        entityId: post.id,
        x: post.x,
        z: post.z,
        tick: 0,
        defId: 'commandPost',
        kind: 'building',
      });
      const ai = new AIController();
      const state = initialAIState(7, 'veteran');
      for (let i = 0; i < 20 * 60 && game.state.victory === 'playing'; i++) {
        game.tick();
        ai.update(game, 1, state);
        const contact = game.state.contacts.find((c) => c.entityId === post.id);
        if (contact) contact.tick = game.state.tick;
      }
      return { hash: game.stateHash(), waves: state.attackWave, postHp: post.hp };
    };
    const a = run();
    const b = run();
    expect(a.hash).toBe(b.hash);
    expect(a.waves).toBe(b.waves);
    expect(a.postHp).toBe(b.postHp);
    expect(a.waves).toBeGreaterThanOrEqual(1);
  });

  it('orders an executable wave at a remembered post and damages it', () => {
    const scenario = assaultArena();
    const game = new Game(scenario, { enableAI: false });
    const post = game
      .entitiesOf(0, 'building')
      .find((b) => b.defId === 'commandPost')!;
    game.state.contacts.push({
      team: game.teamOf(1),
      entityId: post.id,
      x: post.x,
      z: post.z,
      tick: 0,
      defId: 'commandPost',
      kind: 'building',
    });
    const ai = new AIController();
    const state = initialAIState(7, 'veteran');
    let refused = 0;
    let lastEventSeq = 0;
    let moved = false;
    const start = game.entitiesOf(1, 'unit').map((u) => ({ id: u.id, x: u.x, z: u.z }));
    for (let i = 0; i < 20 * 120 && game.state.victory === 'playing'; i++) {
      game.tick();
      ai.update(game, 1, state);
      for (const ev of game.state.events) {
        if (ev.seq <= lastEventSeq) continue;
        lastEventSeq = ev.seq;
        if (ev.type === 'orderFailed' && ev.team === 1) refused++;
      }
      for (const u of game.entitiesOf(1, 'unit')) {
        const s = start.find((p) => p.id === u.id);
        if (s && dist(u.x, u.z, s.x, s.z) > 8 * TILE_SIZE) moved = true;
      }
    }
    expect(state.attackWave).toBeGreaterThanOrEqual(1);
    expect(refused).toBe(0);
    expect(moved).toBe(true);
    expect(post.hp).toBeLessThan(post.maxHp);
  });
});
